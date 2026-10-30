import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { contextsApi, wordsApi, type WordCheck, type WordGrammar } from '../api/endpoints'
import { errorMessage, isRateLimited, rateLimitMessage } from '../api/client'
import { FolderSelect } from '../components/Folders'
import { WordCheckHint } from '../components/WordCheckHint'
import { collapseSpaces, grammarOf, suggestionOf, useWordCheck } from '../lib/wordCheck'
import { useLearningLang } from '../lib/learningLang'
import { PhotoImport } from '../components/PhotoImport'
import { toast } from '../components/Toaster'

const MAX_LEN = 100 // a word or a short phrase; longer text goes through the photo import

export function NewContextPage() {
  const { t } = useTranslation()
  const learning = useLearningLang()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [meaning, setMeaning] = useState('')
  const [pronunciation, setPronunciation] = useState('')
  const [exampleSentence, setExampleSentence] = useState('')
  const [exampleTranslation, setExampleTranslation] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [folderId, setFolderId] = useState('') // optional; '' = no folder
  // Word check (German only): texts the user chose to keep despite a suggestion.
  const check = useWordCheck(text, learning.code === 'de')
  const [kept, setKept] = useState<Set<string>>(() => new Set())
  const [needDecision, setNeedDecision] = useState(false)
  const [checkingOnSave, setCheckingOnSave] = useState(false)
  const isKept = kept.has(collapseSpaces(text))

  // AI example generation works for any word or short phrase ("der Tisch", "sich freuen"): it needs
  // the text and its translation.
  const canGenerate = text.trim() !== '' && meaning.trim() !== ''
  const generate = useMutation({
    mutationFn: () => wordsApi.generateExample(text.trim(), meaning.trim()),
    onSuccess: (r) => {
      // Fill the fields; the user can still edit them before saving.
      setExampleSentence(r.example_sentence)
      setExampleTranslation(r.example_translation)
    },
  })

  const mutation = useMutation({
    mutationFn: (grammar: WordGrammar | null) =>
      contextsApi.create({
        text: text.trim(), meaning: meaning.trim(), pronunciation: pronunciation.trim(), language: learning.code,
        exampleSentence: exampleSentence.trim(), exampleTranslation: exampleTranslation.trim(),
        folderId: folderId || undefined, grammar,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['contexts'] })
      qc.invalidateQueries({ queryKey: ['cards'] })
      qc.invalidateQueries({ queryKey: ['stories'] })
      qc.invalidateQueries({ queryKey: ['folders'] })
      qc.invalidateQueries({ queryKey: ['collection'] })
      // Stay on the page for the next word: clear everything but the chosen folder.
      const added = folderId
      setText(''); setMeaning(''); setPronunciation(''); setExampleSentence(''); setExampleTranslation('')
      setNeedDecision(false)
      textRef.current?.focus()
      toast(t('newContext.added', { word: res.cards[0]?.word ?? res.context.source_text }), {
        action: { label: t('newContext.open'), onClick: () => navigate('/cards?tab=all' + (added ? '&folder=' + added : '')) },
        ms: 6000,
      })
    },
  })

  // "Use this": the user explicitly takes the suggestion (article + base form). The new text is
  // marked as checked, so it isn't sent to the check again.
  function useSuggestion(r: WordCheck) {
    const word = suggestionOf(r)
    check.seed(word, { ...r, status: 'ok', input: word, reason: '' })
    setText(word)
    if (!meaning.trim() && r.translation) setMeaning(r.translation)
    setNeedDecision(false)
  }

  function keepAsIs() {
    setKept((k) => new Set(k).add(collapseSpaces(text)))
    setNeedDecision(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (!text.trim()) return setLocalError(t('newContext.errTextRequired', learning.vars))
    if (!meaning.trim()) return setLocalError(t('newContext.errTranslationRequired'))
    // Pronunciation is optional.
    // Word check: an open correction must be decided first ("Use this" / "Keep as is");
    // "unknown" is only a warning; a failed check never blocks saving.
    setCheckingOnSave(true)
    const r = await check.ensure().finally(() => setCheckingOnSave(false))
    if (r?.status === 'corrected' && !isKept) return setNeedDecision(true)
    mutation.mutate(r?.status === 'ok' ? grammarOf(r) : null)
  }

  const error = localError ?? (mutation.error ? errorMessage(mutation.error) : null)
  const labelCls = 'mb-2 block text-xs uppercase tracking-wider text-emerald-300/60'

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="animate-rise text-center">
        <h1 className="display text-3xl font-extrabold md:text-4xl">
          {t('newContext.titleA')}<span className="text-lime-300">{t('newContext.titleB')}</span> ✨
        </h1>
        <p className="mt-2 text-emerald-100/70">{t('newContext.subtitle')}</p>
      </div>

      <PhotoImport />

      <form onSubmit={submit} className="glass animate-rise space-y-5 p-6 md:p-8">
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value.slice(0, MAX_LEN))
              setNeedDecision(false)
            }}
            ref={textRef}
            rows={3}
            autoFocus
            placeholder={learning.phrasePlaceholder}
            lang={learning.code}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="field resize-none text-lg leading-relaxed"
          />
          <span className="absolute bottom-3 right-4 text-xs text-emerald-300/50">
            {text.length}/{MAX_LEN}
          </span>
        </div>
        {text.length >= MAX_LEN && <p className="text-sm text-amber-200">{t('newContext.tooLong', { max: MAX_LEN })}</p>}
        {check.active && (
          <WordCheckHint state={check.state} kept={isKept} highlight={needDecision}
            onUse={useSuggestion} onKeep={keepAsIs} />
        )}

        <div>
          <label className={labelCls}>{t('newContext.translation')}</label>
          <input
            value={meaning}
            required
            onChange={(e) => setMeaning(e.target.value.slice(0, 500))}
            placeholder={t('newContext.translationPlaceholder')}
            className="field"
          />
        </div>

        <div>
          <label className={labelCls}>{t('newContext.pronunciation')}</label>
          <input
            value={pronunciation}
            onChange={(e) => setPronunciation(e.target.value.slice(0, 200))}
            placeholder={learning.pronunciationPlaceholder}
            className="field"
          />
        </div>

        <div>
          <label className={labelCls}>{t('folders.fieldLabel')}</label>
          <FolderSelect value={folderId} onChange={setFolderId} className="w-full" />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs uppercase tracking-wider text-emerald-300/60">{t('newContext.example')}</label>
            <button type="button" onClick={() => generate.mutate()}
              disabled={generate.isPending || !canGenerate}
              className="btn-ghost shrink-0 disabled:opacity-50">
              {generate.isPending ? (
                <>
                  <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-lime-300 border-t-transparent" />
                  {t('newContext.generating')}
                </>
              ) : (
                t('newContext.generate')
              )}
            </button>
          </div>
          {/* Visible, not a tooltip: phones have no hover. */}
          {!canGenerate && <p className="text-xs text-emerald-100/60">{t('newContext.hintNeedTranslation')}</p>}
          <input
            value={exampleSentence}
            onChange={(e) => setExampleSentence(e.target.value.slice(0, 500))}
            placeholder={learning.gapPlaceholder}
            className="field"
          />
          <input
            value={exampleTranslation}
            onChange={(e) => setExampleTranslation(e.target.value.slice(0, 500))}
            placeholder={t('newContext.exampleTranslationPlaceholder')}
            className="field"
          />
          {generate.error && (
            <p className="text-sm text-red-300">
              {isRateLimited(generate.error)
                ? rateLimitMessage(generate.error)
                : (generate.error as { response?: { status?: number } }).response?.status === 503
                  ? t('newContext.generateNotConfigured')
                  : t('newContext.generateFailed')}
            </p>
          )}
          {!exampleSentence && (
            <p className="text-xs text-emerald-300/50">{t('newContext.autoExampleHint')}</p>
          )}
        </div>

        {error && (
          <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</p>
        )}

        <button type="submit" disabled={mutation.isPending || checkingOnSave} className="btn-primary w-full text-lg">
          {mutation.isPending || checkingOnSave ? (
            <>
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-950 border-t-transparent" />
              {checkingOnSave ? t('check.checking') : t('newContext.analyzing')}
            </>
          ) : (
            t('newContext.submit')
          )}
        </button>
      </form>
    </div>
  )
}
