import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { statsApi } from '../api/endpoints'
import { FolderGrid, useFolderList } from '../components/Folders'
import { useLearningLang } from '../lib/learningLang'

export function ContextsPage() {
  const { t } = useTranslation()
  const learning = useLearningLang()
  const folders = useFolderList()
  const stats7 = useQuery({ queryKey: ['stats', 'week'], queryFn: () => statsApi.get('week') })
  const streak = stats7.data?.totals.current_streak_days ?? 0

  const stats = [
    { label: t('stats.wordsAdded'), value: folders.data?.all.total ?? 0, icon: '📝' },
    { label: t('stats.streak'), value: streak, icon: '🔥' },
    { label: t('stats.language'), value: learning.vars.langCode, icon: learning.flag },
  ]

  return (
    <div className="space-y-10">
      <section className="glass animate-rise relative overflow-hidden p-8 md:p-12">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-lime-400/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="display text-3xl font-extrabold md:text-4xl">
              {learning.greeting} <span className="text-lime-300">{learning.greetingAccent}</span>
            </h1>
            <p className="mt-2 text-emerald-100/70">{t('home.subtitle')}</p>
          </div>
          <Link to="/contexts/new" className="btn-primary shrink-0">{t('home.newPhrase')}</Link>
        </div>
        <div className="relative mt-8 grid grid-cols-3 gap-4">
          {stats.map((s) => (
            <div key={s.icon} className="rounded-2xl border border-emerald-400/15 bg-emerald-950/40 p-4 text-center">
              <div className="text-2xl">{s.icon}</div>
              <div className="display mt-1 text-2xl font-extrabold text-lime-300">{s.value}</div>
              <div className="text-xs text-emerald-100/60">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="display mb-4 text-xl font-bold">{t('folders.myFolders')}</h2>
        <FolderGrid />
      </section>
    </div>
  )
}
