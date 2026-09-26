import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { contextsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'

const MAX_SIZE = 10 * 1024 * 1024
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']

export function NewContextPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const mutation = useMutation({
    mutationFn: () => contextsApi.create({ text: text.trim() || undefined, image: file ?? undefined, language: 'de' }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['contexts'] })
      qc.invalidateQueries({ queryKey: ['cards'] })
      qc.setQueryData(['context-words', res.context.id], res.cards)
      navigate(`/contexts/${res.context.id}`, { state: { context: res.context } })
    },
  })

  function pick(f: File | undefined) {
    setLocalError(null)
    if (!f) return
    if (!ACCEPTED.includes(f.type)) return setLocalError('Поддерживаются PNG, JPEG, WEBP')
    if (f.size > MAX_SIZE) return setLocalError('Файл больше 10 МБ')
    setFile(f)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    pick(e.dataTransfer.files[0])
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!file && !text.trim()) return setLocalError('Добавьте картинку или введите текст')
    mutation.mutate()
  }

  const error = localError ?? (mutation.error ? errorMessage(mutation.error) : null)

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-2xl font-bold">Новый контекст</h1>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
          dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:border-indigo-400'
        }`}
      >
        {preview ? (
          <img src={preview} alt="Превью" className="max-h-80 rounded-md object-contain" />
        ) : (
          <p className="text-slate-500">Перетащите скриншот сюда или нажмите, чтобы выбрать файл</p>
        )}
        <input ref={inputRef} type="file" accept={ACCEPTED.join(',')} hidden
          onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {file && (
        <button type="button" onClick={() => setFile(null)} className="text-sm text-slate-500 hover:text-red-600">
          Убрать картинку ({file.name})
        </button>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={file ? 'Необязательно: текст с картинки (иначе распознаем через OCR)' : 'Или вставьте немецкий текст…'}
        className="w-full rounded-md border border-slate-300 p-3 focus:border-indigo-500 focus:outline-none"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={mutation.isPending}
        className="rounded-md bg-indigo-600 px-6 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {mutation.isPending ? 'Обработка…' : 'Разобрать'}
      </button>
    </form>
  )
}
