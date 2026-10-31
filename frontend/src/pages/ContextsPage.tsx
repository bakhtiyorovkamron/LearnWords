import { useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Camera, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FolderList } from '../components/FolderList'
import { useFolderList } from '../components/Folders'
import { Logo } from '../components/Logo'
import { TodayCard } from '../components/TodayCard'
import { useFeatures } from '../lib/features'
import { useLearningLang } from '../lib/learningLang'
import { handOffPhoto } from '../lib/photoHandoff'

const action = 'glass flex h-16 items-center gap-3 px-4 text-left transition hover:bg-surface-2'

/** Home: what to do today (the review), quick actions, and the folders. */
export function ContextsPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const learning = useLearningLang()
  const { isOn, remaining } = useFeatures()
  const folders = useFolderList()
  const fileInput = useRef<HTMLInputElement>(null)

  const all = folders.data?.all
  const words = all?.total ?? 0
  const due = all?.due_today ?? 0
  const date = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' }).format(new Date())
  const photoOn = isOn('photo_import')

  function onPhoto(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = ''
    if (file) handOffPhoto(file)
    navigate('/contexts/new')
  }

  const title = due > 0 ? t('home.titleDue') : words > 0 ? t('home.titleDone') : t('home.titleStart')

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex h-11 items-center">
        <Logo className="md:invisible" />
      </div>

      <div>
        <p className="text-[15px] text-muted">{t('home.today', { date })}</p>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-fg">{title}</h1>
      </div>

      {words === 0 && all ? (
        <section className="glass rounded-[20px] p-5">
          <p className="text-[15px] text-muted">{t('home.empty', learning.vars)}</p>
        </section>
      ) : (
        <TodayCard />
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link to="/contexts/new" className={`${action} ${photoOn ? '' : 'col-span-2'}`}>
          <Plus size={20} aria-hidden="true" className="shrink-0 text-accent-text" />
          <span className="text-[15px] font-semibold leading-tight text-fg">{t('home.addWord')}</span>
        </Link>
        {photoOn && (
          <>
            <input ref={fileInput} type="file" accept="image/*" className="hidden" data-testid="home-photo-input"
              onChange={(e) => onPhoto(e.target.files?.[0])} />
            <button type="button" className={action}
              // No photos left today: nothing to read, the Add page explains it.
              onClick={() => (remaining('photo_import') === 0 ? navigate('/contexts/new') : fileInput.current?.click())}>
              <Camera size={20} aria-hidden="true" className="shrink-0 text-accent-text" />
              <span className="text-[15px] font-semibold leading-tight text-fg">{t('home.photo')}</span>
            </button>
          </>
        )}
      </div>

      {words > 0 && <FolderList />}
    </div>
  )
}
