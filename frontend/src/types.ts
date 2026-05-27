// src/types.ts

export type AppMode = 'auto' | 'manual'
export type SegMode = 'standard' | 'sam'

export interface TerrainInfo {
  label_ru: string
  icon: string
  confidence: number
}

export interface SegResult {
  terrain: TerrainInfo | null
  coverage: Record<string, number>
  models_used: string[]
  log: string[]
  ms: number
  size: [number, number]  // [height, width]
  sam_info?: {
    segments_count: number
    coverage: number
    iterations: number
    sam_ms: number
  }
  images: {
    mask: string       // base64 PNG
    overlay: string    // base64 PNG
    contours: string   // base64 PNG
    boundaries?: string // base64 PNG — SAM segment boundaries
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
  image: string  // base64 PNG — highlight overlay
}
