import type { SegResult } from '../types'

const BASE = 'http://localhost:8000/api'

export async function getHealth() {
  const r = await fetch(`${BASE}/health`)
  if (!r.ok) throw new Error('offline')
  return r.json()
}

export async function segment(
  file: File, mode: string, selected: string[]
): Promise<SegResult> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('mode', mode)
  fd.append('selected_models', selected.join(','))
  const r = await fetch(`${BASE}/segment`, { method:'POST', body:fd })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail) || r.statusText)
  }
  return r.json()
}

export async function exportData(fmt: 'geojson' | 'zip') {
  const r = await fetch(`${BASE}/export/${fmt}`, { method:'POST' })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(typeof e.detail === 'string' ? e.detail : r.statusText)
  }
  const blob = await r.blob()
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: fmt === 'geojson' ? 'segmentation.geojson' : 'geoseg_export.zip'
  })
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}
