// frontend/src/components/AddModelModal.tsx
import { useState, useCallback, useRef } from 'react'
import type { CustomModelClass, CustomModelMeta, InspectResult } from '../api/client'
import { inspectModel, uploadModel } from '../api/client'

// ─── Утилиты ─────────────────────────────────────────────────────────────────

/** BGR [R,G,B] → hex для input[type=color] (color хранит RGB) */
const bgrToHex = (bgr: [number, number, number]) => {
  const [b, g, r] = bgr
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

/** hex → BGR */
const hexToBgr = (hex: string): [number, number, number] => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [b, g, r]
}

/** Случайный яркий цвет */
const randomBgr = (): [number, number, number] => {
  const hues = [
    [0, 120, 255], [0, 200, 100], [255, 80, 0],
    [200, 0, 200], [0, 220, 220], [255, 150, 0],
    [100, 50, 255], [255, 0, 100],
  ]
  const c = hues[Math.floor(Math.random() * hues.length)] as [number, number, number]
  return c
}

// ─── Типы ────────────────────────────────────────────────────────────────────

interface Props {
  onClose:   () => void
  onSuccess: (meta: CustomModelMeta) => void
}

type Step = 'upload' | 'inspect' | 'configure' | 'saving'

interface ClassRow extends CustomModelClass {
  _tmpId: number
}

// ─── Компонент ───────────────────────────────────────────────────────────────

export default function AddModelModal({ onClose, onSuccess }: Props) {
  // Шаги: upload → inspect → configure → saving
  const [step,         setStep]         = useState<Step>('upload')
  const [pthFile,      setPthFile]      = useState<File | null>(null)
  const [inspect,      setInspect]      = useState<InspectResult | null>(null)
  const [inspecting,   setInspecting]   = useState(false)
  const [inspectErr,   setInspectErr]   = useState('')
  const [dragOver,     setDragOver]     = useState(false)

  // Форма
  const [name,         setName]         = useState('')
  const [description,  setDescription]  = useState('')
  const [modelType,    setModelType]    = useState<'binary' | 'multiclass'>('binary')
  const [numClasses,   setNumClasses]   = useState(1)
  const [encoderName,  setEncoderName]  = useState('efficientnet-b0')
  const [imgSize,      setImgSize]      = useState(512)
  const [classes,      setClasses]      = useState<ClassRow[]>([
    { _tmpId: 0, id: 1, name: 'class1', name_ru: 'Класс 1', color: [0, 120, 255] }
  ])
  const [saving,       setSaving]       = useState(false)
  const [saveErr,      setSaveErr]      = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const tmpIdRef = useRef(1)

  // ── Загрузка файла ───────────────────────────────────────────────────────

  const handleFile = useCallback(async (f: File) => {
    if (!f.name.endsWith('.pth')) {
      setInspectErr('Нужен файл с расширением .pth')
      return
    }
    setPthFile(f)
    setInspectErr('')
    setInspecting(true)
    setStep('inspect')
    try {
      const info = await inspectModel(f)
      setInspect(info)
      // Пре-заполняем форму из чекпоинта
      setEncoderName(info.encoder_name)
      setImgSize(info.img_size)
      if (info.num_classes !== null) {
        const nc = info.num_classes
        setNumClasses(nc)
        setModelType(nc === 1 ? 'binary' : 'multiclass')
        // Генерируем строки классов
        if (nc === 1) {
          setClasses([{ _tmpId: 0, id: 0, name: 'target', name_ru: 'Объект', color: [0, 120, 255] }])
        } else {
          setClasses(Array.from({ length: nc }, (_, i) => ({
            _tmpId:  i,
            id:      i,
            name:    `class${i}`,
            name_ru: `Класс ${i}`,
            color:   randomBgr(),
          })))
        }
      }
      setStep('configure')
    } catch (e) {
      setInspectErr((e as Error).message)
      setStep('upload')
    } finally {
      setInspecting(false)
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  // ── Классы ───────────────────────────────────────────────────────────────

  const addClassRow = () => {
    const id = tmpIdRef.current++
    setClasses(prev => [...prev, {
      _tmpId:  id,
      id:      prev.length,
      name:    `class${prev.length}`,
      name_ru: `Класс ${prev.length}`,
      color:   randomBgr(),
    }])
  }

  const removeClassRow = (tmpId: number) => {
    setClasses(prev => prev.filter(c => c._tmpId !== tmpId))
  }

  const updateClass = (tmpId: number, field: keyof ClassRow, value: unknown) => {
    setClasses(prev => prev.map(c => c._tmpId === tmpId ? { ...c, [field]: value } : c))
  }

  // При изменении numClasses — пересоздаём строки
  const onNumClassesChange = (n: number) => {
    setNumClasses(n)
    // onNumClassesChange (строка ~147) и при inspect (строка ~98):
    setClasses(Array.from({ length: n }, (_, i) => ({
        _tmpId:  i,
        id:      i + 1,   // ← было: i
        name:    `class${i + 1}`,
        name_ru: `Класс ${i + 1}`,
        color:   randomBgr(),
    })))
  }

  // ── Сохранение ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!pthFile || !name.trim()) return
    if (classes.length === 0) { setSaveErr('Добавьте хотя бы один класс'); return }

    setSaving(true)
    setSaveErr('')
    setStep('saving')

    try {
      const res = await uploadModel({
        file:         pthFile,
        name:         name.trim(),
        description:  description.trim(),
        num_classes:  numClasses,
        model_type:   modelType,
        classes:      classes.map(({ _tmpId, ...rest }) => rest),
        encoder_name: encoderName,
        img_size:     imgSize,
        mean:         inspect?.mean,
        std:          inspect?.std,
      })
      onSuccess(res.meta)
    } catch (e) {
      setSaveErr((e as Error).message)
      setStep('configure')
    } finally {
      setSaving(false)
    }
  }

  // ── Рендер ───────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto
        bg-[#0d1520] border border-[#1e2e40] rounded-2xl shadow-2xl flex flex-col">

        {/* Шапка */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2e40] flex-shrink-0">
          <div>
            <div className="font-display font-bold text-[15px] text-[#c8d8e8]">
              Добавить модель
            </div>
            <div className="font-mono text-[10px] text-[#3a4a5a] mt-0.5">
              {step === 'upload'    && 'Шаг 1 из 2 — загрузка файла'}
              {step === 'inspect'   && 'Анализ чекпоинта...'}
              {step === 'configure' && 'Шаг 2 из 2 — настройка модели'}
              {step === 'saving'    && 'Сохранение...'}
            </div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg text-[#3a4a5a] hover:text-[#c8d8e8]
              hover:bg-[#1e2e40] transition-colors text-lg flex items-center justify-center">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── Шаг: загрузка файла ── */}
          {(step === 'upload' || step === 'inspect') && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`relative flex flex-col items-center justify-center gap-3
                border-2 border-dashed rounded-xl p-10 cursor-pointer transition-all
                ${dragOver
                  ? 'border-[#00e5a0] bg-[#00e5a0]/5'
                  : 'border-[#2a3a4a] hover:border-[#3a5a70] bg-[#0a1018]'}`}>
              <input
                ref={fileRef}
                type="file"
                accept=".pth"
                className="hidden"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {inspecting ? (
                <>
                  <div className="w-8 h-8 border-2 border-[#00e5a0]/30 border-t-[#00e5a0] rounded-full animate-spin" />
                  <div className="font-mono text-[11px] text-[#3a5a70]">Анализ чекпоинта...</div>
                </>
              ) : (
                <>
                  <div className="text-3xl">🧠</div>
                  <div className="text-center">
                    <div className="font-display text-[13px] text-[#7a9ab0] font-semibold">
                      {pthFile ? pthFile.name : 'Перетащите .pth файл'}
                    </div>
                    <div className="font-mono text-[10px] text-[#3a4a5a] mt-1">
                      или нажмите для выбора
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {inspectErr && (
            <div className="px-3 py-2 bg-red-900/20 border border-red-800/30 rounded-lg
              font-mono text-[11px] text-red-400">
              ⚠ {inspectErr}
            </div>
          )}

          {/* ── Шаг: настройка ── */}
          {step === 'configure' && (
            <>
              {/* Инфо из чекпоинта */}
              {inspect && (
                <div className="px-3 py-2.5 bg-[#0a1e18] border border-[#00e5a0]/20 rounded-lg
                  font-mono text-[10px] text-[#00e5a0]/70 space-y-0.5">
                  <div className="text-[#00e5a0] font-semibold mb-1">
                    ✓ Чекпоинт проанализирован
                  </div>
                  <div>Классов (авто): <span className="text-[#c8d8e8]">
                    {inspect.num_classes ?? 'не определено'}
                  </span></div>
                  <div>Энкодер: <span className="text-[#c8d8e8]">{inspect.encoder_name}</span></div>
                  <div>Размер входа: <span className="text-[#c8d8e8]">{inspect.img_size}×{inspect.img_size}</span></div>
                  <div>Файл: <span className="text-[#c8d8e8]">{pthFile?.name}</span></div>
                </div>
              )}

              {/* Имя */}
              <Field label="Название модели *">
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Например: Пожары, Затопления, Снег..."
                  className={inputCls}
                />
              </Field>

              {/* Описание */}
              <Field label="Описание (опц.)">
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Краткое описание задачи модели"
                  className={inputCls + ' resize-none'}
                />
              </Field>

              {/* Тип + число классов */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Тип модели">
                  <select
                    value={modelType}
                    onChange={e => {
                      const t = e.target.value as 'binary' | 'multiclass'
                      setModelType(t)
                      if (t === 'binary') onNumClassesChange(1)
                    }}
                    className={inputCls}>
                    <option value="binary">Бинарная (1 класс)</option>
                    <option value="multiclass">Многоклассовая</option>
                  </select>
                </Field>

                <Field label="Число классов">
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={numClasses}
                    disabled={modelType === 'binary'}
                    onChange={e => onNumClassesChange(Math.max(1, parseInt(e.target.value) || 1))}
                    className={inputCls + (modelType === 'binary' ? ' opacity-50' : '')}
                  />
                </Field>
              </div>

              {/* Дополнительные параметры */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Энкодер">
                  <select value={encoderName} onChange={e => setEncoderName(e.target.value)} className={inputCls}>
                    <option value="efficientnet-b0">efficientnet-b0</option>
                    <option value="efficientnet-b2">efficientnet-b2</option>
                    <option value="efficientnet-b4">efficientnet-b4</option>
                    <option value="resnet34">resnet34</option>
                    <option value="resnet50">resnet50</option>
                    <option value="mobilenet_v2">mobilenet_v2</option>
                  </select>
                </Field>
                <Field label="Размер входа (px)">
                  <input
                    type="number"
                    min={128}
                    max={1024}
                    step={32}
                    value={imgSize}
                    onChange={e => setImgSize(parseInt(e.target.value) || 512)}
                    className={inputCls}
                  />
                </Field>
              </div>

              {/* Классы */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={labelCls}>
                    Классы сегментации
                  </label>
                  {modelType === 'multiclass' && (
                    <button onClick={addClassRow}
                      className="font-mono text-[10px] text-[#00e5a0] hover:text-[#00c585]
                        transition-colors flex items-center gap-1">
                      + добавить класс
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {classes.map((cls, i) => (
                    <div key={cls._tmpId}
                      className="grid grid-cols-[28px_1fr_1fr_28px] gap-2 items-center
                        bg-[#0a1018] border border-[#1e2e40] rounded-lg px-3 py-2">
                      {/* Цвет */}
                      <div className="relative">
                        <input
                          type="color"
                          value={bgrToHex(cls.color)}
                          onChange={e => updateClass(cls._tmpId, 'color', hexToBgr(e.target.value))}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          title="Выберите цвет"
                        />
                        <div
                          className="w-5 h-5 rounded-full border border-white/20 cursor-pointer"
                          style={{ backgroundColor: bgrToHex(cls.color) }}
                        />
                      </div>
                      {/* EN name */}
                      <input
                        value={cls.name}
                        onChange={e => updateClass(cls._tmpId, 'name', e.target.value)}
                        placeholder="eng_name"
                        className="bg-transparent border border-[#1e2e40] rounded-md px-2 py-1
                          font-mono text-[10px] text-[#7a9ab0] focus:outline-none
                          focus:border-[#3a5a70] w-full"
                      />
                      {/* RU name */}
                      <input
                        value={cls.name_ru}
                        onChange={e => updateClass(cls._tmpId, 'name_ru', e.target.value)}
                        placeholder="Рус. название"
                        className="bg-transparent border border-[#1e2e40] rounded-md px-2 py-1
                          font-mono text-[10px] text-[#c8d8e8] focus:outline-none
                          focus:border-[#3a5a70] w-full"
                      />
                      {/* Удалить */}
                      {modelType === 'multiclass' && classes.length > 1 ? (
                        <button
                          onClick={() => removeClassRow(cls._tmpId)}
                          className="text-[#3a4a5a] hover:text-red-400 transition-colors
                            font-mono text-sm w-5 h-5 flex items-center justify-center">
                          ×
                        </button>
                      ) : <div />}
                    </div>
                  ))}
                </div>
              </div>

              {saveErr && (
                <div className="px-3 py-2 bg-red-900/20 border border-red-800/30 rounded-lg
                  font-mono text-[11px] text-red-400">
                  ⚠ {saveErr}
                </div>
              )}
            </>
          )}

          {/* ── Шаг: сохранение ── */}
          {step === 'saving' && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <div className="w-10 h-10 border-2 border-[#00e5a0]/30 border-t-[#00e5a0] rounded-full animate-spin" />
              <div className="font-display text-[13px] text-[#7a9ab0]">
                Загрузка и инициализация модели...
              </div>
              <div className="font-mono text-[10px] text-[#3a4a5a]">
                Это может занять несколько секунд
              </div>
            </div>
          )}
        </div>

        {/* Футер */}
        {(step === 'configure' || step === 'upload') && (
          <div className="flex items-center justify-between px-6 py-4
            border-t border-[#1e2e40] flex-shrink-0">
            <button onClick={onClose}
              className="font-mono text-[11px] text-[#3a4a5a] hover:text-[#7a9ab0] transition-colors">
              Отмена
            </button>
            {step === 'configure' && (
              <button
                onClick={handleSave}
                disabled={!name.trim() || saving}
                className="flex items-center gap-2 px-5 py-2 rounded-lg font-display
                  font-bold text-[12px] bg-gradient-to-r from-[#00e5a0] to-[#00b87a]
                  text-[#041a0e] hover:opacity-90 active:scale-[0.97] transition-all
                  disabled:opacity-35 disabled:cursor-not-allowed">
                {saving
                  ? <><div className="w-3 h-3 border-2 border-[#041a0e]/30 border-t-[#041a0e] rounded-full animate-spin"/>Сохранение...</>
                  : '✓ Добавить модель'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Мелкие компоненты ────────────────────────────────────────────────────────

const labelCls = 'font-mono text-[10px] text-[#3a5a70] uppercase tracking-wider'
const inputCls = `w-full bg-[#0a1018] border border-[#1e2e40] rounded-lg px-3 py-2
  font-mono text-[12px] text-[#c8d8e8] focus:outline-none focus:border-[#3a5a70]
  transition-colors`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}
