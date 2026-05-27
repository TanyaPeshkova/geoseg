// src/api/client.ts
// API клиент GeoSeg AI v2.1 (+ SAM)

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export interface HealthResponse {
  ok: boolean
  loaded: string[]
  failed: Record<string, string>
  sam_available: boolean
}

export interface SegResult {
  terrain: string
  coverage: Record<string, number>
  models_used: string[]
  log: string[]
  ms: number
  size: [number, number]
  sam_info?: {
    segments_count: number
    coverage: number
    iterations: number
    sam_ms: number
  }
  images: {
    mask: string
    overlay: string
    contours: string
    boundaries?: string   // SAM segment boundaries
  }
}

export interface SAMPointResult {
  class_id: number
  class_name: string
  class_confidence: number
  sam_score: number
  area_pixels: number
  area_fraction: number
  point: [number, number]
  image: string
}

// ─── Health ─────────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/api/health`)
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
  return res.json()
}

// ─── Standard segment ───────────────────────────────────────────────────

export async function segment(
  file: File,
  mode: string,
  selectedModels: string[],
): Promise<SegResult> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('mode', mode)
  fd.append('selected_models', selectedModels.join(','))

  const res = await fetch(`${BASE}/api/segment`, { method: 'POST', body: fd })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Segment error ${res.status}: ${text}`)
  }
  return res.json()
}

// ─── SAM segment (iterative) ────────────────────────────────────────────

export async function segmentSAM(
  file: File,
  mode: string,
  selectedModels: string[],
  options?: {
    coverageThreshold?: number
    gridSpacing?: number
    maxIterations?: number
  },
): Promise<SegResult> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('mode', mode)
  fd.append('selected_models', selectedModels.join(','))

  if (options?.coverageThreshold !== undefined)
    fd.append('coverage_threshold', String(options.coverageThreshold))
  if (options?.gridSpacing !== undefined)
    fd.append('grid_spacing', String(options.gridSpacing))
  if (options?.maxIterations !== undefined)
    fd.append('max_iterations', String(options.maxIterations))

  const res = await fetch(`${BASE}/api/segment/sam`, { method: 'POST', body: fd })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SAM segment error ${res.status}: ${text}`)
  }
  return res.json()
}

// ─── SAM point (interactive click) ──────────────────────────────────────

export async function segmentSAMPoint(
  file: File,
  x: number,
  y: number,
): Promise<SAMPointResult> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('x', String(Math.round(x)))
  fd.append('y', String(Math.round(y)))

  const res = await fetch(`${BASE}/api/segment/sam/point`, {
    method: 'POST',
    body: fd,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SAM point error ${res.status}: ${text}`)
  }
  return res.json()
}

// ─── Export ─────────────────────────────────────────────────────────────

export async function exportResult(
  fmt: 'geojson' | 'zip' | 'sam_geojson',
): Promise<Blob> {
  const res = await fetch(`${BASE}/api/export/${fmt}`, { method: 'POST' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Export error ${res.status}: ${text}`)
  }
  return res.blob()
}
