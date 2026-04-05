/**
 * landing.ts — Full-viewport Variable Typographic ASCII background
 *
 * Adapted from variable-typographic-ascii.ts.
 * Renders a particle-and-attractor brightness field as proportional ASCII art
 * covering the entire page background behind the landing page content.
 */

import { prepareWithSegments } from '../../src/layout.ts'

// ── Dynamically size the grid to fill the viewport ────────────────────
const FONT_SIZE = 14
const LINE_HEIGHT = 16
const PROP_FAMILY = 'Georgia, Palatino, "Times New Roman", serif'

function computeGridSize() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // target cell width ~8.8px (matches original TARGET_ROW_W / COLS = 440/50)
  const cellW = 8.8
  const cols = Math.max(30, Math.ceil(vw / cellW))
  const rows = Math.max(20, Math.ceil(vh / LINE_HEIGHT) + 4) // +4 for breathing room
  return { cols, rows, cellW, targetRowW: cols * cellW }
}

let { cols: COLS, rows: ROWS, targetRowW: TARGET_ROW_W } = computeGridSize()

const FIELD_OVERSAMPLE = 2
let FIELD_COLS = COLS * FIELD_OVERSAMPLE
let FIELD_ROWS = ROWS * FIELD_OVERSAMPLE
let CANVAS_W = Math.round(TARGET_ROW_W / 2)
let CANVAS_H = Math.round(CANVAS_W * ((ROWS * LINE_HEIGHT) / TARGET_ROW_W))
let FIELD_SCALE_X = FIELD_COLS / CANVAS_W
let FIELD_SCALE_Y = FIELD_ROWS / CANVAS_H

const PARTICLE_N = 160
const SPRITE_R = 14
const ATTRACTOR_R = 12
const LARGE_ATTRACTOR_R = 30
const ATTRACTOR_FORCE_1 = 0.22
const ATTRACTOR_FORCE_2 = 0.05
const FIELD_DECAY = 0.82
const CHARSET = ' .,:;!+-=*#@%&abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const WEIGHTS = [300, 500, 800] as const
const STYLES = ['normal', 'italic'] as const

type FontStyleVariant = typeof STYLES[number]

type PaletteEntry = {
  char: string
  weight: number
  style: FontStyleVariant
  font: string
  width: number
  brightness: number
}

type BrightnessEntry = {
  propHtml: string
}

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
}

type FieldStamp = {
  radiusX: number
  radiusY: number
  sizeX: number
  sizeY: number
  values: Float32Array
}

// ── Brightness estimation ───────────────────────────────────────────
const brightnessCanvas = document.createElement('canvas')
brightnessCanvas.width = 28
brightnessCanvas.height = 28
const brightnessContext = brightnessCanvas.getContext('2d', { willReadFrequently: true })
if (brightnessContext === null) throw new Error('brightness context not available')
const bCtx = brightnessContext

function estimateBrightness(ch: string, font: string): number {
  const size = 28
  bCtx.clearRect(0, 0, size, size)
  bCtx.font = font
  bCtx.fillStyle = '#fff'
  bCtx.textBaseline = 'middle'
  bCtx.fillText(ch, 1, size / 2)
  const data = bCtx.getImageData(0, 0, size, size).data
  let sum = 0
  for (let i = 3; i < data.length; i += 4) sum += data[i]!
  return sum / (255 * size * size)
}

function measureWidth(ch: string, font: string): number {
  const prepared = prepareWithSegments(ch, font)
  return prepared.widths.length > 0 ? prepared.widths[0]! : 0
}

// ── Build palette ───────────────────────────────────────────────────
const palette: PaletteEntry[] = []
for (const style of STYLES) {
  for (const weight of WEIGHTS) {
    const font = `${style === 'italic' ? 'italic ' : ''}${weight} ${FONT_SIZE}px ${PROP_FAMILY}`
    for (const ch of CHARSET) {
      if (ch === ' ') continue
      const width = measureWidth(ch, font)
      if (width <= 0) continue
      const brightness = estimateBrightness(ch, font)
      palette.push({ char: ch, weight, style, font, width, brightness })
    }
  }
}

const maxBrightness = Math.max(...palette.map(e => e.brightness))
if (maxBrightness > 0) {
  for (let i = 0; i < palette.length; i++) palette[i]!.brightness /= maxBrightness
}
palette.sort((a, b) => a.brightness - b.brightness)

let targetCellW = TARGET_ROW_W / COLS

function findBest(targetBrightness: number): PaletteEntry {
  let lo = 0
  let hi = palette.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (palette[mid]!.brightness < targetBrightness) lo = mid + 1
    else hi = mid
  }
  let bestScore = Infinity
  let best = palette[lo]!
  const start = Math.max(0, lo - 15)
  const end = Math.min(palette.length, lo + 15)
  for (let i = start; i < end; i++) {
    const entry = palette[i]!
    const bErr = Math.abs(entry.brightness - targetBrightness) * 2.5
    const wErr = Math.abs(entry.width - targetCellW) / targetCellW
    const score = bErr + wErr
    if (score < bestScore) { bestScore = score; best = entry }
  }
  return best
}

// ── Brightness lookup ───────────────────────────────────────────────
function esc(ch: string): string {
  if (ch === '<') return '&lt;'
  if (ch === '>') return '&gt;'
  if (ch === '&') return '&amp;'
  if (ch === '"') return '&quot;'
  return ch
}

function wCls(weight: number, style: FontStyleVariant): string {
  const wc = weight === 300 ? 'w3' : weight === 500 ? 'w5' : 'w8'
  return style === 'italic' ? `${wc} it` : wc
}

const brightnessLookup: BrightnessEntry[] = []
for (let b = 0; b < 256; b++) {
  const brightness = b / 255
  if (brightness < 0.03) {
    brightnessLookup.push({ propHtml: ' ' })
    continue
  }
  const match = findBest(brightness)
  const alphaIndex = Math.max(1, Math.min(10, Math.round(brightness * 10)))
  brightnessLookup.push({
    propHtml: `<span class="${wCls(match.weight, match.style)} a${alphaIndex}">${esc(match.char)}</span>`,
  })
}

// ── Particles ───────────────────────────────────────────────────────
const particles: Particle[] = []
for (let i = 0; i < PARTICLE_N; i++) {
  const angle = Math.random() * Math.PI * 2
  const r = Math.random() * 40 + 20
  particles.push({
    x: CANVAS_W / 2 + Math.cos(angle) * r,
    y: CANVAS_H / 2 + Math.sin(angle) * r,
    vx: (Math.random() - 0.5) * 0.8,
    vy: (Math.random() - 0.5) * 0.8,
  })
}

// ── Off-screen simulation canvas ────────────────────────────────────
const simulationCanvas = document.createElement('canvas')
simulationCanvas.width = CANVAS_W
simulationCanvas.height = CANVAS_H
const simulationContext = simulationCanvas.getContext('2d', { willReadFrequently: true })
if (simulationContext === null) throw new Error('simulation context not available')
const sCtx = simulationContext
let brightnessField = new Float32Array(FIELD_COLS * FIELD_ROWS)

// ── Field stamps ────────────────────────────────────────────────────
function spriteAlphaAt(d: number): number {
  if (d >= 1) return 0
  if (d <= 0.35) return 0.45 + (0.15 - 0.45) * (d / 0.35)
  return 0.15 * (1 - (d - 0.35) / 0.65)
}

function createFieldStamp(radiusPx: number): FieldStamp {
  const fieldRadiusX = radiusPx * FIELD_SCALE_X
  const fieldRadiusY = radiusPx * FIELD_SCALE_Y
  const radiusX = Math.ceil(fieldRadiusX)
  const radiusY = Math.ceil(fieldRadiusY)
  const sizeX = radiusX * 2 + 1
  const sizeY = radiusY * 2 + 1
  const values = new Float32Array(sizeX * sizeY)
  for (let y = -radiusY; y <= radiusY; y++) {
    for (let x = -radiusX; x <= radiusX; x++) {
      const norm = Math.sqrt((x / fieldRadiusX) ** 2 + (y / fieldRadiusY) ** 2)
      values[(y + radiusY) * sizeX + x + radiusX] = spriteAlphaAt(norm)
    }
  }
  return { radiusX, radiusY, sizeX, sizeY, values }
}

function splatFieldStamp(cx: number, cy: number, stamp: FieldStamp): void {
  const gcx = Math.round(cx * FIELD_SCALE_X)
  const gcy = Math.round(cy * FIELD_SCALE_Y)
  for (let y = -stamp.radiusY; y <= stamp.radiusY; y++) {
    const gy = gcy + y
    if (gy < 0 || gy >= FIELD_ROWS) continue
    const fro = gy * FIELD_COLS
    const sro = (y + stamp.radiusY) * stamp.sizeX
    for (let x = -stamp.radiusX; x <= stamp.radiusX; x++) {
      const gx = gcx + x
      if (gx < 0 || gx >= FIELD_COLS) continue
      const sv = stamp.values[sro + x + stamp.radiusX]!
      if (sv === 0) continue
      const fi = fro + gx
      brightnessField[fi] = Math.min(1, brightnessField[fi]! + sv)
    }
  }
}

let particleFieldStamp = createFieldStamp(SPRITE_R)
let largeAttractorFieldStamp = createFieldStamp(LARGE_ATTRACTOR_R)
let smallAttractorFieldStamp = createFieldStamp(ATTRACTOR_R)

const spriteCache = new Map<number, HTMLCanvasElement>()

function getSpriteCanvas(radius: number): HTMLCanvasElement {
  const cached = spriteCache.get(radius)
  if (cached !== undefined) return cached
  const c = document.createElement('canvas')
  c.width = radius * 2
  c.height = radius * 2
  const ctx = c.getContext('2d')
  if (ctx === null) throw new Error('sprite context not available')
  const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius)
  g.addColorStop(0, 'rgba(255,255,255,0.45)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.15)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, radius * 2, radius * 2)
  spriteCache.set(radius, c)
  return c
}

// ── DOM setup ───────────────────────────────────────────────────────
const bgContainer = document.getElementById('ascii-bg')!

type RowNode = HTMLDivElement

let rowNodes: RowNode[] = []

function buildRows() {
  bgContainer.innerHTML = ''
  rowNodes = []
  for (let r = 0; r < ROWS; r++) {
    const row = document.createElement('div')
    row.className = 'art-row'
    row.style.height = row.style.lineHeight = `${LINE_HEIGHT}px`
    bgContainer.appendChild(row)
    rowNodes.push(row)
  }
}

buildRows()

// ── Resize handler ──────────────────────────────────────────────────
let resizeTimer: ReturnType<typeof setTimeout> | null = null
window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    const newSize = computeGridSize()
    COLS = newSize.cols
    ROWS = newSize.rows
    TARGET_ROW_W = newSize.targetRowW
    targetCellW = TARGET_ROW_W / COLS

    FIELD_COLS = COLS * FIELD_OVERSAMPLE
    FIELD_ROWS = ROWS * FIELD_OVERSAMPLE
    CANVAS_W = Math.round(TARGET_ROW_W / 2)
    CANVAS_H = Math.round(CANVAS_W * ((ROWS * LINE_HEIGHT) / TARGET_ROW_W))
    FIELD_SCALE_X = FIELD_COLS / CANVAS_W
    FIELD_SCALE_Y = FIELD_ROWS / CANVAS_H

    simulationCanvas.width = CANVAS_W
    simulationCanvas.height = CANVAS_H
    brightnessField = new Float32Array(FIELD_COLS * FIELD_ROWS)

    particleFieldStamp = createFieldStamp(SPRITE_R)
    largeAttractorFieldStamp = createFieldStamp(LARGE_ATTRACTOR_R)
    smallAttractorFieldStamp = createFieldStamp(ATTRACTOR_R)

    // Redistribute particles across the new canvas size
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]!
      p.x = Math.random() * CANVAS_W
      p.y = Math.random() * CANVAS_H
    }

    buildRows()
  }, 200)
})

// ── Render loop ─────────────────────────────────────────────────────
function render(now: number): void {
  const a1x = Math.cos(now * 0.0007) * CANVAS_W * 0.25 + CANVAS_W / 2
  const a1y = Math.sin(now * 0.0011) * CANVAS_H * 0.3 + CANVAS_H / 2
  const a2x = Math.cos(now * 0.0013 + Math.PI) * CANVAS_W * 0.2 + CANVAS_W / 2
  const a2y = Math.sin(now * 0.0009 + Math.PI) * CANVAS_H * 0.25 + CANVAS_H / 2

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]!
    const d1x = a1x - p.x
    const d1y = a1y - p.y
    const d2x = a2x - p.x
    const d2y = a2y - p.y
    const dist1 = d1x * d1x + d1y * d1y
    const dist2 = d2x * d2x + d2y * d2y
    const ax = dist1 < dist2 ? d1x : d2x
    const ay = dist1 < dist2 ? d1y : d2y
    const dist = Math.sqrt(Math.min(dist1, dist2)) + 1
    const force = dist1 < dist2 ? ATTRACTOR_FORCE_1 : ATTRACTOR_FORCE_2

    p.vx += ax / dist * force
    p.vy += ay / dist * force
    p.vx += (Math.random() - 0.5) * 0.25
    p.vy += (Math.random() - 0.5) * 0.25
    p.vx *= 0.97
    p.vy *= 0.97
    p.x += p.vx
    p.y += p.vy

    if (p.x < -SPRITE_R) p.x += CANVAS_W + SPRITE_R * 2
    if (p.x > CANVAS_W + SPRITE_R) p.x -= CANVAS_W + SPRITE_R * 2
    if (p.y < -SPRITE_R) p.y += CANVAS_H + SPRITE_R * 2
    if (p.y > CANVAS_H + SPRITE_R) p.y -= CANVAS_H + SPRITE_R * 2
  }

  sCtx.fillStyle = 'rgba(0,0,0,0.18)'
  sCtx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  sCtx.globalCompositeOperation = 'lighter'
  const particleSprite = getSpriteCanvas(SPRITE_R)
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]!
    sCtx.drawImage(particleSprite, p.x - SPRITE_R, p.y - SPRITE_R)
  }
  sCtx.drawImage(getSpriteCanvas(LARGE_ATTRACTOR_R), a1x - LARGE_ATTRACTOR_R, a1y - LARGE_ATTRACTOR_R)
  sCtx.drawImage(getSpriteCanvas(ATTRACTOR_R), a2x - ATTRACTOR_R, a2y - ATTRACTOR_R)
  sCtx.globalCompositeOperation = 'source-over'

  for (let i = 0; i < brightnessField.length; i++) {
    brightnessField[i] = brightnessField[i]! * FIELD_DECAY
  }
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]!
    splatFieldStamp(p.x, p.y, particleFieldStamp)
  }
  splatFieldStamp(a1x, a1y, largeAttractorFieldStamp)
  splatFieldStamp(a2x, a2y, smallAttractorFieldStamp)

  for (let row = 0; row < ROWS; row++) {
    if (row >= rowNodes.length) break
    let propHtml = ''
    const fieldRowStart = row * FIELD_OVERSAMPLE * FIELD_COLS
    for (let col = 0; col < COLS; col++) {
      const fieldColStart = col * FIELD_OVERSAMPLE
      let brightness = 0
      for (let sy = 0; sy < FIELD_OVERSAMPLE; sy++) {
        const sro = fieldRowStart + sy * FIELD_COLS + fieldColStart
        for (let sx = 0; sx < FIELD_OVERSAMPLE; sx++) {
          brightness += brightnessField[sro + sx]!
        }
      }
      const bByte = Math.min(255, ((brightness / (FIELD_OVERSAMPLE * FIELD_OVERSAMPLE)) * 255) | 0)
      propHtml += brightnessLookup[bByte]!.propHtml
    }
    rowNodes[row]!.innerHTML = propHtml
  }

  requestAnimationFrame(render)
}

requestAnimationFrame(render)
