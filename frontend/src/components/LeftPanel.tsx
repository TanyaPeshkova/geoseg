// frontend/src/components/LeftPanel.tsx
import { useState, useCallback } from 'react'
import type { AppMode }         from '../types'
import type { CustomModelMeta } from '../api/client'
import { deleteCustomModel }     from '../api/client'
import { MODELS }                from '../constants'
import AddModelModal             from './AddModelModal'

interface Props {
  mode:      AppMode
  onMode:    (m: AppMode) => void
  enabled:   Set<string>
  onToggle:  (key: string) => void
  loaded:    string[]
  file:      File | null
  onFile:    (f: File) => void
  // Кастомные модели
  customModels:    CustomModelMeta[]
  onCustomAdded:   (meta: CustomModelMeta) => void
  onCustomDeleted: (key: string) => void
}

// ─── Цвет «светофора» — доступна ли модель на бэкенде ────────────────────────
function StatusDot({ loaded, isCustom }: { loaded: boolean; isCustom?: boolean }) {
  return (
    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
      loaded ? 'bg-[#00e5a0]' : isCustom ? 'bg-yellow-500' : 'bg-[#2a3a4a]'
    }`} />
  )
}

export default function LeftPanel({
  mode, onMode, enabled, onToggle, loaded,
  file, onFile,
  customModels, onCustomAdded, onCustomDeleted,
}: Props) {
  const [showModal,  setShowModal]  = useState(false)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const [deleteErr,   setDeleteErr]   = useState('')

  // ── Drag-and-drop зоны ───────────────────────────────────────────────────
  const [drag, setDrag] = useState(false)
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }, [onFile])

  // ── Удаление кастомной модели ────────────────────────────────────────────
  const handleDelete = async (key: string) => {
    setDeletingKey(key)
    setDeleteErr('')
    try {
      await deleteCustomModel(key)
      onCustomDeleted(key)
    } catch (e) {
      setDeleteErr((e as Error).message)
    } finally {
      setDeletingKey(null)
    }
  }

  return (
    <>
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-[#1a2330]
        bg-[#080b0e] overflow-y-auto">

        {/* ── Загрузка изображения ── */}
        <div className="p-3 border-b border-[#1a2330]">
          <div className="font-mono text-[9px] text-[#3a4a5a] uppercase tracking-widest mb-2">
            Изображение
          </div>
          <div
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById('img-input')?.click()}
            className={`relative rounded-xl border-2 border-dashed cursor-pointer transition-all
              flex flex-col items-center justify-center gap-1.5 p-3 min-h-[80px]
              ${drag
                ? 'border-[#00e5a0] bg-[#00e5a0]/5'
                : file
                  ? 'border-[#1e3a28] bg-[#0a1e14]'
                  : 'border-[#1a2330] hover:border-[#2a3a4a]'}`}>
            <input id="img-input" type="file" accept="image/*" className="hidden"
              onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
            {file ? (
              <>
                <div className="text-base">🛰️</div>
                <div className="font-mono text-[9px] text-[#00e5a0] text-center leading-tight
                  max-w-full truncate px-1">
                  {file.name}
                </div>
                <div className="font-mono text-[8px] text-[#3a4a5a]">
                  {(file.size / 1024).toFixed(0)} KB
                </div>
              </>
            ) : (
              <>
                <div className="text-lg">📂</div>
                <div className="font-mono text-[9px] text-[#3a4a5a] text-center leading-tight">
                  Перетащите или нажмите
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Режим ── */}
        <div className="p-3 border-b border-[#1a2330]">
          <div className="font-mono text-[9px] text-[#3a4a5a] uppercase tracking-widest mb-2">
            Режим
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {(['auto', 'manual'] as AppMode[]).map(m => (
              <button key={m} onClick={() => onMode(m)}
                className={`py-1.5 rounded-lg font-display font-bold text-[10px] transition-all ${
                  mode === m
                    ? 'bg-[#00e5a0]/10 text-[#00e5a0] border border-[#00e5a0]/30'
                    : 'text-[#3a4a5a] hover:text-[#7a9ab0] border border-transparent'
                }`}>
                {m === 'auto' ? '⚡ Авто' : '🎛 Ручной'}
              </button>
            ))}
          </div>
          {mode === 'auto' && (
            <div className="mt-2 font-mono text-[8px] text-[#2a4a3a] leading-tight">
              Спец. модели подключаются автоматически по порогу покрытия
            </div>
          )}
          {mode === 'manual' && (
            <div className="mt-2 font-mono text-[8px] text-[#2a4a3a] leading-tight">
              Выберите модели вручную ↓
            </div>
          )}
        </div>

        {/* ── Стандартные модели ── */}
        <div className="p-3 border-b border-[#1a2330]">
          <div className="font-mono text-[9px] text-[#3a4a5a] uppercase tracking-widest mb-2">
            Модели
          </div>
          <div className="space-y-1">
            {MODELS.map(m => {
              const isLoaded  = loaded.includes(m.key)
              const isOn      = enabled.has(m.key)
              const isAlways  = m.alwaysOn
              const disabled  = isAlways || mode === 'auto'

              return (
                <button
                  key={m.key}
                  onClick={() => !disabled && onToggle(m.key)}
                  disabled={disabled}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg
                    text-left transition-all group ${
                    disabled
                      ? 'cursor-default opacity-60'
                      : isOn
                        ? 'bg-[#0d1e2a] hover:bg-[#102030]'
                        : 'hover:bg-[#0a1520] opacity-50 hover:opacity-70'
                  }`}>
                  <StatusDot loaded={isLoaded} />
                  <span className="text-sm">{m.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`font-display font-semibold text-[11px] leading-none truncate ${
                      isOn ? 'text-[#c8d8e8]' : 'text-[#4a6070]'
                    }`}>
                      {m.label}
                    </div>
                    {m.iou && (
                      <div className="font-mono text-[8px] text-[#3a4a5a] mt-0.5">
                        IoU {m.iou}
                      </div>
                    )}
                  </div>
                  {!disabled && (
                    <div className={`w-3 h-3 rounded border flex-shrink-0 flex items-center
                      justify-center transition-all ${
                      isOn
                        ? 'bg-[#00e5a0] border-[#00e5a0]'
                        : 'border-[#2a3a4a]'
                    }`}>
                      {isOn && <span className="text-[#041a0e] text-[8px] font-bold">✓</span>}
                    </div>
                  )}
                  {isAlways && (
                    <span className="font-mono text-[7px] text-[#2a4a3a]">авто</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Кастомные модели ── */}
        <div className="p-3 flex-1">
          <div className="flex items-center justify-between mb-2">
            <div className="font-mono text-[9px] text-[#3a4a5a] uppercase tracking-widest">
              Пользовательские модели
            </div>
            <button
              onClick={() => setShowModal(true)}
              title="Добавить модель"
              className="w-5 h-5 rounded flex items-center justify-center
                bg-[#0d1e2a] hover:bg-[#1a3040] border border-[#1e3a50]
                text-[#00e5a0] font-bold text-sm transition-colors leading-none">
              +
            </button>
          </div>

          {deleteErr && (
            <div className="mb-2 px-2 py-1.5 bg-red-900/20 border border-red-800/30
              rounded-lg font-mono text-[9px] text-red-400">
              ⚠ {deleteErr}
            </div>
          )}

          {customModels.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <div className="text-2xl opacity-30">🧩</div>
              <div className="font-mono text-[9px] text-[#2a3a4a] leading-tight">
                Нет пользовательских моделей.<br/>
                Нажмите «+» чтобы добавить
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {customModels.map(cm => {
                const isOn     = enabled.has(cm.key)
                const isLoaded = cm.loaded !== false
                const isDel    = deletingKey === cm.key
                const disabled = mode === 'auto'

                return (
                  <div key={cm.key}
                    className={`rounded-lg border transition-all ${
                      isOn && !disabled
                        ? 'border-[#1e3a50] bg-[#0a1828]'
                        : 'border-[#1a2330] bg-[#080b0e] opacity-60'
                    }`}>
                    <button
                      onClick={() => !disabled && onToggle(cm.key)}
                      disabled={disabled}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-left">
                      <StatusDot loaded={isLoaded} isCustom />
                      <div className="flex-1 min-w-0">
                        <div className={`font-display font-semibold text-[11px] leading-none truncate ${
                          isOn && !disabled ? 'text-[#c8d8e8]' : 'text-[#4a6070]'
                        }`}>
                          {cm.name}
                        </div>
                        <div className="font-mono text-[8px] text-[#3a4a5a] mt-0.5 flex items-center gap-1.5">
                          <span>{cm.num_classes === 1 ? 'binary' : `${cm.num_classes} cls`}</span>
                          <span>·</span>
                          <span>{cm.classes.length} кл.</span>
                        </div>
                      </div>
                      {!disabled && (
                        <div className={`w-3 h-3 rounded border flex-shrink-0 flex items-center
                          justify-center transition-all ${
                          isOn
                            ? 'bg-[#00e5a0] border-[#00e5a0]'
                            : 'border-[#2a3a4a]'
                        }`}>
                          {isOn && <span className="text-[#041a0e] text-[8px] font-bold">✓</span>}
                        </div>
                      )}
                    </button>

                    {/* Цветовые метки классов */}
                    <div className="flex flex-wrap gap-1 px-2.5 pb-2">
                      {cm.classes.slice(0, 6).map(cls => (
                        <div key={cls.id}
                          className="flex items-center gap-1 font-mono text-[8px] text-[#4a6070]">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor: `rgb(${cls.color[2]},${cls.color[1]},${cls.color[0]})`
                            }}
                          />
                          {cls.name_ru}
                        </div>
                      ))}
                      {cm.classes.length > 6 && (
                        <span className="font-mono text-[8px] text-[#3a4a5a]">
                          +{cm.classes.length - 6}
                        </span>
                      )}
                    </div>

                    {/* Кнопка удалить */}
                    <div className="border-t border-[#1a2330] px-2.5 py-1.5 flex items-center
                      justify-between">
                      <span className="font-mono text-[8px] text-[#2a3a4a] truncate">
                        {cm.key}
                      </span>
                      <button
                        onClick={() => handleDelete(cm.key)}
                        disabled={isDel}
                        title="Удалить модель"
                        className="font-mono text-[9px] text-[#3a4a5a] hover:text-red-400
                          transition-colors disabled:opacity-40 flex items-center gap-1">
                        {isDel
                          ? <span className="text-[8px]">удаление...</span>
                          : <span>🗑</span>}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {mode === 'auto' && customModels.length > 0 && (
            <div className="mt-2 font-mono text-[8px] text-[#2a3a4a] text-center leading-tight">
              Пользовательские модели работают только в ручном режиме
            </div>
          )}
        </div>
      </aside>

      {/* Модалка добавления */}
      {showModal && (
        <AddModelModal
          onClose={() => setShowModal(false)}
          onSuccess={meta => {
            setShowModal(false)
            onCustomAdded(meta)
          }}
        />
      )}
    </>
  )
}
