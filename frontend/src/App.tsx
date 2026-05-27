// frontend/src/App.tsx
import { useState, useCallback, useEffect } from 'react'
import type { SegResult, AppMode }      from './types'
import type { CustomModelMeta }          from './api/client'
import { getHealth, segment }            from './api/client'
import { MODELS }                        from './constants'
import LeftPanel                         from './components/LeftPanel'
import Viewer                            from './components/Viewer'
import RightPanel                        from './components/RightPanel'

export default function App() {
  const [file,          setFile]         = useState<File | null>(null)
  const [result,        setResult]       = useState<SegResult | null>(null)
  const [loading,       setLoading]      = useState(false)
  const [error,         setError]        = useState('')
  const [log,           setLog]          = useState<string[]>([])
  const [mode,          setMode]         = useState<AppMode>('auto')
  const [enabled,       setEnabled]      = useState<Set<string>>(
    () => new Set(MODELS.filter(m => !m.alwaysOn).map(m => m.key))
  )
  const [loaded,        setLoaded]       = useState<string[]>([])
  const [backendOk,     setBackendOk]    = useState<boolean | null>(null)
  const [customModels,  setCustomModels] = useState<CustomModelMeta[]>([])

  // ── Проверка бэкенда + загрузка кастомных моделей ────────────────────────
  useEffect(() => {
    getHealth()
      .then(h => {
        setLoaded(h.loaded)
        setBackendOk(h.ok)
        // Инициализируем кастомные модели из health-ответа
        if (h.custom && h.custom.length > 0) {
          setCustomModels(h.custom)
          // Добавляем кастомные ключи в enabled по умолчанию
          setEnabled(prev => {
            const next = new Set(prev)
            h.custom.forEach(cm => next.add(cm.key))
            return next
          })
        }
      })
      .catch(() => setBackendOk(false))
  }, [])

  // ── Файл ─────────────────────────────────────────────────────────────────
  const onFile = useCallback((f: File) => {
    setFile(f); setResult(null); setError(''); setLog([])
  }, [])

  // ── Тоггл модели ─────────────────────────────────────────────────────────
  const toggleModel = useCallback((key: string) => {
    setEnabled(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  // ── Добавлена кастомная модель ────────────────────────────────────────────
  const handleCustomAdded = useCallback((meta: CustomModelMeta) => {
    setCustomModels(prev => [...prev, meta])
    setLoaded(prev => [...prev, meta.key])
    // Включаем по умолчанию
    setEnabled(prev => new Set([...prev, meta.key]))
  }, [])

  // ── Удалена кастомная модель ──────────────────────────────────────────────
  const handleCustomDeleted = useCallback((key: string) => {
    setCustomModels(prev => prev.filter(m => m.key !== key))
    setLoaded(prev => prev.filter(k => k !== key))
    setEnabled(prev => { const next = new Set(prev); next.delete(key); return next })
  }, [])

  // ── Сегментация ───────────────────────────────────────────────────────────
  const run = useCallback(async () => {
    if (!file || loading) return
    setLoading(true); setError(''); setResult(null)
    setLog(['▶ Отправка на сервер...'])
    try {
      const sel = [...enabled]
      const res = await segment(file, mode, sel)
      setResult(res)
      setLog(res.log)
    } catch (e) {
      setError((e as Error).message)
      setLog([])
    } finally {
      setLoading(false)
    }
  }, [file, loading, mode, enabled])

  // Ctrl+Enter
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') run()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [run])

  // Суммарное число загруженных (стандартных + кастомных)
  const totalModels  = 6 + customModels.length
  const loadedCount  = loaded.length

  return (
    <div className="flex flex-col h-screen bg-[#080b0e] text-[#c8d8e8] overflow-hidden">

      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5
        border-b border-[#1a2330] bg-[#080b0e] z-40 flex-shrink-0">

        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#00e5a0] to-[#0077cc]
            flex items-center justify-center text-sm">🛰</div>
          <div>
            <div className="font-display font-extrabold text-[17px] tracking-tight leading-none">
              Гео<span className="text-[#00e5a0]">Сегментация</span>
            </div>
            <div className="font-mono text-[9px] text-[#3a4a5a] leading-none mt-0.5">
              Адаптивная сегментация ДЗЗ
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Кастомные модели - бейдж */}
          {customModels.length > 0 && (
            <div className="font-mono text-[9px] px-2 py-1 rounded-full
              bg-[#0a1e28] border border-[#1e3a50] text-[#00e5a0]/70">
              🧩 {customModels.length} custom
            </div>
          )}

          {/* Backend status */}
          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            <div className={`w-1.5 h-1.5 rounded-full ${
              backendOk === null ? 'bg-yellow-400 animate-pulse' :
              backendOk ? 'bg-[#00e5a0]' : 'bg-red-500'}`} />
            <span className="text-[#3a4a5a]">
              {backendOk === null ? 'подключение...' :
               backendOk ? `${loadedCount}/${totalModels} моделей` : 'бэкенд недоступен'}
            </span>
          </div>

          {/* Run button */}
          <button
            disabled={!file || loading || backendOk === false}
            onClick={run}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-display font-bold text-[13px]
              bg-gradient-to-r from-[#00e5a0] to-[#00b87a] text-[#041a0e]
              hover:opacity-90 active:scale-[0.97] transition-all
              disabled:opacity-35 disabled:cursor-not-allowed">
            {loading
              ? <><div className="w-3.5 h-3.5 border-2 border-[#041a0e]/30 border-t-[#041a0e]
                  rounded-full animate-spin"/>Обработка</>
              : <>▶ Сегментировать</>}
          </button>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="mx-3 mt-2 px-4 py-2.5 bg-red-900/20 border border-red-800/30 rounded-xl
          font-mono text-[11px] text-red-400 flex items-center gap-2 flex-shrink-0">
          <span>⚠</span> {error}
        </div>
      )}

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        <LeftPanel
          mode={mode}          onMode={setMode}
          enabled={enabled}    onToggle={toggleModel}
          loaded={loaded}
          file={file}          onFile={onFile}
          customModels={customModels}
          onCustomAdded={handleCustomAdded}
          onCustomDeleted={handleCustomDeleted}
        />
        <Viewer  file={file} result={result} loading={loading} log={log} />
        <RightPanel result={result} />
      </div>
    </div>
  )
}
