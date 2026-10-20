import { useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { sharedApi } from '../api/endpoints'
import { apiErrorInfo } from '../api/client'
import type { SharedWord } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Logo } from '../components/Layout'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { FolderDot } from '../components/Folders'
import { toast } from '../components/Toaster'

// «Import after login»: set when a logged-out visitor presses «Add to my words», read once after
// they come back from /login or /register (a reload or the register redirect must not lose it).
const PENDING_KEY = 'pending-shared-import'

const ARTICLE_STYLE: Record<string, string> = {
  der: 'text-sky-300', die: 'text-rose-300', das: 'text-emerald-300',
}

/** «der Hund» with the article coloured by gender; a stored article is shown if the word lacks it. */
function WordLabel({ w }: { w: SharedWord }) {
  const [first, ...rest] = w.word.split(' ')
  const lead = first.toLowerCase()
  if (ARTICLE_STYLE[lead] && rest.length) {
    return <><span className={`font-semibold ${ARTICLE_STYLE[lead]}`}>{first}</span> {rest.join(' ')}</>
  }
  const art = w.article?.toLowerCase()
  if (art && ARTICLE_STYLE[art]) {
    return <><span className={`font-semibold ${ARTICLE_STYLE[art]}`}>{art}</span> {w.word}</>
  }
  return <>{w.word}</>
}

/**
 * /s/:token — public preview of a shared folder. Works logged in and logged out. «Add to my words»
 * imports a COPY; a logged-out visitor is sent to /login and, once back, the import runs by itself.
 */
export function SharedFolderPage() {
  const { token = '' } = useParams()
  const { t, i18n } = useTranslation()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()

  const folder = useQuery({
    queryKey: ['shared', token, i18n.language],
    queryFn: () => sharedApi.get(token, i18n.language),
    retry: false,
    staleTime: 0,
  })

  const importFolder = useMutation({
    mutationFn: () => sharedApi.import(token),
    onSuccess: (res) => {
      // The same caches that adding words refreshes, plus stats / hero / the training queue.
      for (const key of ['contexts', 'cards', 'stories', 'folders', 'collection', 'stats', 'hero', 'review-due']) {
        void qc.invalidateQueries({ queryKey: [key] })
      }
      toast(t('shared.added', { added: res.added, skipped: res.skipped }))
      navigate(`/cards?tab=all&folder=${res.folder_id}`, { replace: true })
    },
  })

  function add() {
    if (!isAuthenticated) {
      sessionStorage.setItem(PENDING_KEY, token)
      navigate('/login', { state: { from: location } })
      return
    }
    importFolder.mutate()
  }

  // Back from login/register with the import pending: do it once, without another click.
  const auto = useRef(false)
  useEffect(() => {
    if (auto.current || authLoading || !isAuthenticated || !folder.data) return
    if (sessionStorage.getItem(PENDING_KEY) !== token) return
    auto.current = true
    sessionStorage.removeItem(PENDING_KEY)
    importFolder.mutate()
  }, [authLoading, isAuthenticated, folder.data, token]) // eslint-disable-line react-hooks/exhaustive-deps

  const notFound = folder.isError && apiErrorInfo(folder.error).status === 404
  const failure = importFolder.error ? apiErrorInfo(importFolder.error) : null
  let failureText: string | null = null
  if (failure) {
    failureText = failure.status === 404 ? t('shared.notFound')
      : failure.code === 'own_folder' ? t('shared.own')
      : failure.code === 'lang_mismatch' ? t('shared.langMismatch')
      : t('errors.saveFailed')
  }
  const data = folder.data

  return (
    <div className="min-h-screen pt-[env(safe-area-inset-top)]">
      <header className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-4">
        <Link to="/"><Logo /></Link>
        <LanguageSwitcher sync={false} />
      </header>
      <main className="mx-auto max-w-2xl space-y-5 px-4 pb-16">
        {folder.isLoading && <div className="h-40 animate-pulse rounded-3xl bg-emerald-800/30" />}

        {(notFound || (folder.isError && !notFound)) && (
          <div className="glass p-10 text-center">
            <div className="text-5xl">🔗</div>
            <p className="mt-3 text-lg font-semibold">{notFound ? t('shared.notFound') : t('errors.saveFailed')}</p>
          </div>
        )}

        {data && (
          <>
            <div className="glass animate-rise space-y-3 p-6">
              <h1 className="display flex items-center gap-2 text-2xl font-extrabold">
                <FolderDot color={data.color} /> <span className="min-w-0 break-words">{data.name}</span>
              </h1>
              <p className="text-sm text-emerald-100/70">{t('shared.words', { count: data.word_count })}</p>
              <button type="button" onClick={add} disabled={importFolder.isPending || authLoading || data.words.length === 0}
                className="btn-primary w-full text-lg disabled:opacity-60">
                {importFolder.isPending ? t('common.loading')
                  : isAuthenticated ? t('shared.add') : t('shared.loginToAdd')}
              </button>
              {failureText && (
                <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200" role="alert">
                  {failureText}
                  {failure?.code === 'own_folder' && failure.folderId && (
                    <Link to={`/cards?tab=all&folder=${failure.folderId}`} className="ml-3 font-semibold text-lime-300 underline">
                      {t('folders.open')}
                    </Link>
                  )}
                </div>
              )}
            </div>

            {data.words.length === 0 ? (
              <p className="glass p-8 text-center text-emerald-100/70">{t('shared.empty')}</p>
            ) : (
              <ul className="glass divide-y divide-emerald-400/10 p-2">
                {data.words.map((w, i) => (
                  <li key={i} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <span className="text-lg font-bold text-white"><WordLabel w={w} /></span>
                      <span className="text-emerald-100/80">{w.translation}</span>
                    </div>
                    {w.transcription && <div className="font-mono text-xs text-lime-300/80">{w.transcription}</div>}
                    {w.example_sentence && (
                      <div className="mt-1 text-xs text-emerald-100/60">
                        <span className="italic">{w.example_sentence}</span>
                        {w.example_translation && <span> — {w.example_translation}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  )
}
