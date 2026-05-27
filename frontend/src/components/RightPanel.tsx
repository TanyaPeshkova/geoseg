// components/RightPanel.tsx
import type { SegResult } from '../types'
import { CLASS_COLOR, CLASS_LABEL } from '../constants'
import { exportData } from '../api/client'
import { useState } from 'react'

interface Props { result: SegResult | null }

export default function RightPanel({ result }: Props) {
  const [exporting, setExporting] = useState('')
  const [expErr,    setExpErr]    = useState('')

  const doExport = async (fmt: 'geojson' | 'zip') => {
    if (!result || exporting) return
    setExporting(fmt); setExpErr('')
    try { await exportData(fmt) }
    catch (e) { setExpErr((e as Error).message) }
    finally   { setExporting('') }
  }

  return (
    <aside className="w-[270px] flex-shrink-0 border-l border-[#1a2330] flex flex-col bg-[#0c1117] overflow-hidden">

      {/* Заголовок */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-[#1a2330]">
        <span className="text-[10px] font-mono text-[#4a5a6a] tracking-widest uppercase">Результаты</span>
        <div className="flex-1 h-px bg-[#1a2330]" />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">

        {!result && (
          <div className="text-center py-12 text-[#2a3a4a] text-[12px] leading-7">
            Здесь появятся<br />результаты сегментации
          </div>
        )}

        {result && <>

          {/* Terrain */}
          {result.terrain && (
            <div className="bg-[#111820] border border-[#1a2330] rounded-xl p-3
              flex items-center gap-3">
              <span className="text-2xl">{result.terrain.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-[#c8d8e8]">{result.terrain.label_ru}</div>
                <div className="text-[9px] font-mono text-[#4a5a6a]">terrain · {(result.terrain.confidence*100).toFixed(0)}% confidence</div>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background:'#a78bfa18', color:'#a78bfa', border:'1px solid #a78bfa25' }}>
                {(result.terrain.confidence*100).toFixed(0)}%
              </span>
            </div>
          )}

          {/* Coverage bars */}
          {Object.entries(result.coverage)
            .filter(([,v]) => v >= 0.5)
            .sort(([,a],[,b]) => b-a)
            .map(([cls, pct]) => {
              const color = CLASS_COLOR[cls] || '#888'
              const label = CLASS_LABEL[cls] || cls
              return (
                <div key={cls} className="bg-[#111820] border border-[#1a2330] rounded-xl p-2.5 space-y-1.5
                  hover:border-white/5 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background:color }} />
                    <span className="text-[12px] font-medium text-[#c8d8e8] flex-1">{label}</span>
                    <span className="text-[11px] font-mono" style={{ color }}>{pct.toFixed(1)}%</span>
                  </div>
                  <div className="bg-[#0a0d10] rounded-full h-1 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width:`${Math.min(pct,100)}%`, background:color }} />
                  </div>
                </div>
              )
            })}

          {/* Log */}
          <div className="bg-[#111820] border border-[#1a2330] rounded-xl overflow-hidden">
            <div className="px-3 py-1.5 border-b border-[#1a2330]">
              <span className="text-[9px] font-mono text-[#3a4a5a] tracking-widest uppercase">Пайплайн</span>
            </div>
            <div className="p-2 space-y-0.5 max-h-40 overflow-y-auto">
              {result.log.map((l,i) => (
                <div key={i} className={`font-mono text-[9px] px-2 py-0.5 rounded
                  ${l.startsWith('✓') ? 'text-[#00e5a0]'
                  : l.startsWith('▶') ? 'text-[#c8d8e8]'
                  : 'text-[#3a4a5a]'}`}>{l}</div>
              ))}
            </div>
          </div>

          {/* Models used */}
          <div className="flex flex-wrap gap-1">
            {result.models_used.map(k => (
              <span key={k} className="font-mono text-[9px] px-1.5 py-0.5 rounded-full
                bg-[#00e5a0]/8 text-[#00e5a0] border border-[#00e5a0]/15">{k}</span>
            ))}
          </div>
        </>}
      </div>

      {/* Export */}
      <div className="border-t border-[#1a2330] p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-[#4a5a6a] tracking-widest uppercase">Экспорт</span>
          <div className="flex-1 h-px bg-[#1a2330]" />
        </div>

        {expErr && (
          <div className="text-[10px] font-mono text-red-400 bg-red-900/15 border border-red-800/30 rounded-lg px-2 py-1.5">
            ⚠ {expErr}
          </div>
        )}

        <button disabled={!result || !!exporting} onClick={() => doExport('geojson')}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-[12px] font-medium
            border border-[#00e5a0]/25 bg-[#00e5a0]/8 text-[#00e5a0]
            hover:bg-[#00e5a0]/15 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
          <span>📐</span>
          <span className="flex-1 text-left">Векторный контур</span>
          <span className="font-mono text-[10px] opacity-60">GeoJSON</span>
        </button>

        <button disabled={!result || !!exporting} onClick={() => doExport('zip')}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]
            border border-[#1a2330] text-[#c8d8e8]
            hover:bg-white/5 hover:border-white/8 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
          <span>📦</span>
          <span className="flex-1 text-left">{exporting === 'zip' ? 'Экспорт...' : 'Полный экспорт'}</span>
          <span className="font-mono text-[10px] text-[#4a5a6a]">ZIP</span>
        </button>
      </div>
    </aside>
  )
}
