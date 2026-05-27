// components/LeftPanel.tsx
import { useCallback, useState } from 'react'
import { MODELS } from '../constants'
import type { AppMode } from '../types'

interface Props {
  mode: AppMode
  onMode: (m: AppMode) => void
  enabled: Set<string>
  onToggle: (k: string) => void
  loaded: string[]
  file: File | null
  onFile: (f: File) => void
}

export default function LeftPanel({ mode, onMode, enabled, onToggle, loaded, file, onFile }: Props) {
  const [drag, setDrag] = useState(false)

  const handle = useCallback((f: File) => {
    if (/\.(png|jpe?g|tiff?)$/i.test(f.name)) onFile(f)
  }, [onFile])

  return (
    <aside className="w-[290px] flex-shrink-0 border-r border-[#1a2330] flex flex-col bg-[#0c1117]">

      {/* Загрузка */}
      <div className="p-3 border-b border-[#1a2330]">
        <div className="text-[10px] font-mono text-[#4a5a6a] tracking-widest uppercase mb-2">Снимок ДЗЗ</div>
        <label
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if(f) handle(f) }}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed
            cursor-pointer transition-all duration-200 py-5 px-3
            ${drag ? 'border-[#00e5a0] bg-[#00e5a0]/5' : file
              ? 'border-[#00e5a0]/30 bg-[#00e5a0]/3'
              : 'border-[#1a2330] hover:border-[#00e5a0]/40'}`}
        >
          <input type="file" className="hidden" accept=".png,.jpg,.jpeg,.tif,.tiff"
            onChange={e => { const f = e.target.files?.[0]; if(f) handle(f) }} />
          {file ? (
            <>
              <span className="text-xl">🛰</span>
              <span className="text-[11px] font-medium text-[#c8d8e8] truncate max-w-full text-center">{file.name}</span>
              <span className="text-[9px] font-mono text-[#4a5a6a]">{(file.size/1024).toFixed(0)} КБ · сменить</span>
            </>
          ) : (
            <>
              <span className="text-2xl opacity-30">🛰</span>
              <span className="text-[11px] text-[#4a5a6a]"><span className="text-[#00e5a0]">Загрузить</span> или перетащить</span>
              <span className="text-[9px] font-mono text-[#2a3a4a]">PNG · JPG · TIFF</span>
            </>
          )}
        </label>
      </div>

      {/* Режим */}
      <div className="p-3 border-b border-[#1a2330]">
        <div className="text-[10px] font-mono text-[#4a5a6a] tracking-widest uppercase mb-2">Режим</div>
        <div className="flex rounded-lg overflow-hidden border border-[#1a2330]">
          {(['auto','manual'] as AppMode[]).map(m => (
            <button key={m} onClick={() => onMode(m)}
              className={`flex-1 py-1.5 text-[11px] font-medium transition-all
                ${mode === m ? 'bg-[#00e5a0]/10 text-[#00e5a0]' : 'text-[#4a5a6a] hover:text-[#c8d8e8]'}`}>
              {m === 'auto' ? '⚡ Авто' : '🎛 Ручной'}
            </button>
          ))}
        </div>
        <div className="mt-2 text-[10px] text-[#3a4a5a] leading-4">
          {mode === 'auto'
            ? 'Система сама выбирает модели по результату общей сегментации'
            : 'Выберите модели вручную. Всегда запускаются только выбранные.'}
        </div>
      </div>

      {/* Модели */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-[10px] font-mono text-[#4a5a6a] tracking-widest uppercase">Модели</span>
          <div className="flex-1 h-px bg-[#1a2330]" />
          {mode === 'auto' && <span className="text-[9px] font-mono text-[#2a3a4a]">🔒 авто</span>}
        </div>

        {MODELS.map(m => {
          const isLoaded  = loaded.includes(m.key)
          const isOn      = m.alwaysOn || enabled.has(m.key)
          const canToggle = !m.alwaysOn && mode === 'manual' && isLoaded

          return (
            <div key={m.key}
              onClick={() => canToggle && onToggle(m.key)}
              className={`flex items-center gap-2.5 px-3 py-2.5 border-b border-[#1a2330]
                transition-colors ${canToggle ? 'cursor-pointer hover:bg-white/[0.02]' : ''}
                ${isOn && isLoaded ? 'bg-[#00e5a0]/[0.02]' : ''}`}
            >
              {/* Dot */}
              <div className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: isLoaded && isOn ? m.color : '#2a3a4a' }} />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className={`text-[12px] font-medium truncate
                  ${isLoaded && isOn ? 'text-[#c8d8e8]' : 'text-[#3a4a5a]'}`}>
                  {m.label}
                </div>
                <div className="text-[9px] font-mono text-[#3a4a5a] truncate">
                  {m.file} · {m.iou}
                </div>
              </div>

              {/* Badge/Toggle */}
              {!isLoaded ? (
                <span className="text-[9px] font-mono text-[#2a3a4a]">нет</span>
              ) : m.alwaysOn ? (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                  style={{ background:`${m.color}15`, color:m.color, border:`1px solid ${m.color}25` }}>
                  всегда
                </span>
              ) : mode === 'manual' ? (
                <div className="w-8 h-[18px] rounded-full relative flex-shrink-0 transition-all duration-200"
                  style={isOn ? { background:m.color } : { background:'#1a2330', border:'1px solid #2a3a4a' }}>
                  <div className="absolute w-3 h-3 bg-white rounded-full top-[2px] transition-transform duration-200"
                    style={{ transform: isOn ? 'translateX(14px)' : 'translateX(2px)' }} />
                </div>
              ) : (
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 opacity-30"
                  style={{ background: m.color }} />
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
