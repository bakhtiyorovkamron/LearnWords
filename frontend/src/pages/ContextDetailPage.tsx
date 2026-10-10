import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { contextsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { WordCardView } from '../components/WordCard'
import { TimeImage } from '../components/TimeImage'
import { parseGermanTime } from '../lib/germanTime'
import { dateLocale } from '../i18n'
import { useLearningLang } from '../lib/learningLang'

export function ContextDetailPage() {
  const { t } = useTranslation()
  const learning = useLearningLang()
  const { id = '' } = useParams()
  // No GET /contexts/:id yet — take the context from the cached list.
  const contexts = useQuery({ queryKey: ['contexts'], queryFn: contextsApi.list })
  const words = useQuery({ queryKey: ['context-words', id], queryFn: () => contextsApi.words(id) })
  const ctx = contexts.data?.find((c) => c.id === id)
  // Clock-time phrases ("halb neun") get a generated time image instead of a photo.
  const time = ctx && ctx.language === 'de' ? parseGermanTime(ctx.source_text) : null

  if (words.error) return <p className="text-red-300">{errorMessage(words.error)}</p>

  return (
    <div className="space-y-8">
      <Link to="/contexts" className="btn-ghost">{t('detail.back')}</Link>

      <div className="grid gap-8 lg:grid-cols-5">
        <section className="lg:col-span-2">
          <div className="glass animate-rise sticky top-24 overflow-hidden p-8">
            <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-lime-400/20 blur-3xl" />

            {time ? (
              <div className="-mx-8 -mt-8 mb-6">
                <TimeImage time={time} />
              </div>
            ) : ctx?.image_url && (
              <figure className="relative -mx-8 -mt-8 mb-6">
                <img src={ctx.image_url} alt="" className="aspect-[4/3] w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-emerald-950/90 via-transparent to-transparent" />
              </figure>
            )}

            <p className="text-xs uppercase tracking-widest text-lime-300/80">{t('detail.original', { langNative: learning.name })}</p>
            <blockquote className="display relative mt-4 text-2xl font-semibold leading-snug text-white">
              „{ctx?.source_text ?? '…'}“
            </blockquote>
            {ctx?.meaning && (
              <>
                <p className="mt-5 text-xs uppercase tracking-widest text-lime-300/80">{t('detail.meaning')}</p>
                <p className="mt-2 text-lg text-emerald-50">{ctx.meaning}</p>
              </>
            )}
            {ctx && (
              <p className="mt-6 text-xs text-emerald-300/50">
                {t('detail.added', { date: new Date(ctx.created_at).toLocaleString(dateLocale()) })}
              </p>
            )}
          </div>
        </section>

        <section className="space-y-4 lg:col-span-3">
          <div className="flex items-baseline justify-between">
            <h2 className="display text-xl font-bold">{t('detail.words')}</h2>
            {words.data && (
              <span className="rounded-full bg-lime-400/15 px-3 py-1 text-sm font-semibold text-lime-300">
                {words.data.length}
              </span>
            )}
          </div>
          {words.isLoading && (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-emerald-800/30" />
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {words.data?.map((w, i) => <WordCardView key={w.id} card={w} index={i}
              meaning={ctx?.meaning} />)}
          </div>
        </section>
      </div>
    </div>
  )
}
