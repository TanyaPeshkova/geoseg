// components/Viewer.tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import type { SegResult, ViewMode } from '../types'

interface Props {
  file: File | null
  result: SegResult | null
  loading: boolean
  log: string[]
}

const VIEWS: { key: ViewMode; label: string }[] = [
  { key:'original', label:'🖼 Оригинал' },
  { key:'mask',     label:'🎨 Маска' },
  { key:'overlay',  label:'🔲 Наложение' },
  { key:'contours', label:'✏ Контуры' },
  { key:'split',    label:'⇔ Split' },
]

export default function Viewer({ file, result, loading, log }: Props) {
  const [view,    setView]    = useState<ViewMode>('original')
  const [splitX,  setSplitX]  = useState(50)
  const [alpha,   setAlpha]   = useState(55)   // 0–100, default 55%
  const [origSrc, setOrigSrc] = useState<string | null>(null)
  const [blendedSrc, setBlendedSrc] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const blendCanvas = useRef<HTMLCanvasElement>(document.createElement('canvas'))

  useEffect(() => {
    if (!file) { setOrigSrc(null); return }
    const url = URL.createObjectURL(file)
    setOrigSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (result) setView('overlay')
  }, [result])

  // Пересчитываем blended при изменении alpha или смене результата
  useEffect(() => {
    if (!result || !origSrc) { setBlendedSrc(null); return }

    const maskImg = new Image()
    const origImg = new Image()
    let cancelled = false

    const tryBlend = () => {
      if (cancelled || !maskImg.complete || !origImg.complete) return
      const w = origImg.naturalWidth
      const h = origImg.naturalHeight
      const c = blendCanvas.current
      c.width  = w
      c.height = h
      const ctx = c.getContext('2d')!
      // Рисуем оригинал
      ctx.globalAlpha = 1
      ctx.drawImage(origImg, 0, 0, w, h)
      // Накладываем маску с прозрачностью
      ctx.globalAlpha = alpha / 100
      ctx.drawImage(maskImg, 0, 0, w, h)
      ctx.globalAlpha = 1
      setBlendedSrc(c.toDataURL('image/png'))
    }

    maskImg.onload = tryBlend
    origImg.onload = tryBlend
    maskImg.src = `data:image/png;base64,${result.images.mask}`
    origImg.src = origSrc

    return () => { cancelled = true }
  }, [result, origSrc, alpha])

  // Split drag
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); dragging.current = true
  }, [])
  useEffect(() => {
    const mv = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const r = containerRef.current.getBoundingClientRect()
      setSplitX(Math.max(5, Math.min(95, ((e.clientX - r.left) / r.width) * 100)))
    }
    const up = () => { dragging.current = false }
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', mv)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const has = !!result

  const maskSrc     = result ? `data:image/png;base64,${result.images.mask}`     : null
  const overlaySrc  = result ? `data:image/png;base64,${result.images.overlay}`  : null
  const contoursSrc = result ? `data:image/png;base64,${result.images.contours}` : null

  // В режиме overlay показываем blendedSrc (с ползунком), иначе оригинал с бэкенда
  const currentSrc: string | null =
    view === 'original'  ? origSrc :
    view === 'mask'      ? maskSrc :
    view === 'overlay'   ? (blendedSrc ?? overlaySrc) :
    view === 'contours'  ? contoursSrc :
    (blendedSrc ?? overlaySrc)   // split — overlay справа

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[#1a2330]
        bg-[#0c1117] flex-wrap">
        {VIEWS.map(v => (
          <button key={v.key}
            disabled={!has && v.key !== 'original'}
            onClick={() => setView(v.key)}
            className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all
              disabled:opacity-25 disabled:cursor-not-allowed
              ${view === v.key
                ? 'bg-[#00e5a0]/10 text-[#00e5a0] border border-[#00e5a0]/25'
                : 'text-[#4a5a6a] hover:text-[#c8d8e8] hover:bg-white/5 border border-transparent'
              }`}>
            {v.label}
          </button>
        ))}

        {/* Ползунок прозрачности — только для overlay и split */}
        {has && (view === 'overlay' || view === 'split') && (
          <div className="flex items-center gap-2 ml-auto pl-2
            border-l border-[#1a2330]">
            <span className="font-mono text-[9px] text-[#3a4a5a] select-none">
              маска
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={alpha}
              onChange={e => setAlpha(Number(e.target.value))}
              className="w-24 h-1 accent-[#00e5a0] cursor-pointer"
              style={{
                accentColor: '#00e5a0',
                height: '3px',
              }}
            />
            <span className="font-mono text-[9px] text-[#00e5a0] w-7 text-right select-none">
              {alpha}%
            </span>
          </div>
        )}
      </div>

      {/* Canvas */}
      <div ref={containerRef}
        className="flex-1 relative bg-[#070a0c] flex items-center justify-center overflow-hidden">

        {!file && !loading && (
          <div className="text-center select-none">
            <div className="text-5xl opacity-10 mb-3">🛰</div>
            <div className="text-[#2a3a4a] text-[13px]">Загрузите снимок ДЗЗ</div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 bg-black/85 flex flex-col items-center
            justify-center gap-3 z-20">
            <div className="text-[13px] font-display font-bold text-[#c8d8e8] mb-1">
              Обработка снимка...
            </div>
            <div className="flex flex-col gap-1.5 w-72 max-h-64 overflow-y-auto">
              {(log.length ? log : ['▶ Запуск...']).map((line, i) => (
                <div key={i} className={`font-mono text-[10px] px-3 py-1.5 rounded-lg
                  ${line.startsWith('✓')
                    ? 'text-[#00e5a0] bg-[#00e5a0]/5 border border-[#00e5a0]/15'
                    : line.startsWith('▶')
                      ? 'text-[#c8d8e8] bg-[#1a2330] border border-[#2a3a4a] flex gap-2 items-center'
                      : 'text-[#3a4a5a]'}`}>
                  {line.startsWith('▶') && (
                    <div className="w-2.5 h-2.5 border border-[#4a6a5a] border-t-[#00e5a0]
                      rounded-full animate-spin flex-shrink-0" />
                  )}
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && view !== 'split' && currentSrc && (
          <img
            key={view === 'overlay' ? `overlay-${alpha}` : view}
            src={currentSrc}
            alt={view}
            draggable={false}
            className="max-w-full max-h-[calc(100vh-180px)] object-contain rounded-lg"
          />
        )}

        {!loading && view === 'split' && origSrc && (blendedSrc ?? overlaySrc) && (
          <div className="relative w-full h-full select-none overflow-hidden">
            <img src={blendedSrc ?? overlaySrc!} alt="overlay"
              className="absolute inset-0 w-full h-full object-contain"
              draggable={false} />
            <div className="absolute inset-0 overflow-hidden" style={{ width: `${splitX}%` }}>
              <img src={origSrc} alt="original" draggable={false}
                className="absolute inset-0 object-contain"
                style={{ width: `${100 / splitX * 100}%`, maxWidth: 'none', height: '100%' }} />
            </div>
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white/80 z-10 cursor-ew-resize"
              style={{ left: `${splitX}%` }}
              onMouseDown={onMouseDown}>
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2
                w-7 h-7 bg-white rounded-full flex items-center justify-center
                text-black text-[11px] shadow-lg">⇔</div>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[#1a2330]
        bg-[#0c1117] font-mono text-[10px] text-[#3a4a5a]">
        <div className={`w-1.5 h-1.5 rounded-full ${
          loading ? 'bg-yellow-400 animate-pulse' :
          has     ? 'bg-[#00e5a0]' :
                    'bg-[#2a3a4a]'}`} />
        <span>
          {loading ? 'Обработка...' : has ? 'Готово' : 'Ожидание снимка'}
        </span>
        {has && <>
          <span className="text-[#1a2330]">·</span>
          <span>{result!.models_used.length} моделей</span>
          <span className="text-[#1a2330]">·</span>
          <span>{result!.ms} мс</span>
          <span className="text-[#1a2330]">·</span>
          <span>{result!.size[1]}×{result!.size[0]} px</span>
        </>}
      </div>
    </div>
  )
}