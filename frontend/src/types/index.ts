export interface TerrainResult {
  label: string
  label_ru: string
  icon: string
  confidence: number
  all_probs: Record<string, number>
}

export interface SegResult {
  terrain: TerrainResult | null
  coverage: Record<string, number>   // class → %
  models_used: string[]
  log: string[]
  ms: number
  size: [number, number]
  images: { mask: string; overlay: string; contours: string }
}

export type ViewMode = 'original' | 'mask' | 'overlay' | 'contours' | 'split'
export type AppMode  = 'auto' | 'manual'

export interface ModelDef {
  key: string
  label: string
  file: string
  color: string
  iou: string
  alwaysOn: boolean
}
