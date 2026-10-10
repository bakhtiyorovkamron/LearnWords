import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { heroApi } from '../api/endpoints'
import { onHeroEvent } from '../lib/heroBus'
import { heroAsset, type HeroMood } from '../lib/heroAssets'
import { heroTranslation, pickHeroPhrase, type HeroLang, type HeroPhraseKey } from '../lib/heroPhrases'
import {
  isInactiveEnoughToSleep, reactToEvent, reactToReturn, reactToStageChanged, wasAbsent,
  type HeroReaction,
} from '../lib/heroReaction'

const LS_COLLAPSED = 'hero-collapsed'
const LS_HIDDEN = 'hero-hidden'
const LS_LAST_SEEN = 'hero-last-seen'

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}
function writeBool(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? 'true' : 'false')
  } catch {
    /* ignore — the choice just won't survive a reload */
  }
}
function readLastSeen(): number | null {
  try {
    const v = localStorage.getItem(LS_LAST_SEEN)
    return v ? Number(v) : null
  } catch {
    return null
  }
}
function writeLastSeen(ms: number) {
  try {
    localStorage.setItem(LS_LAST_SEEN, String(ms))
  } catch {
    /* ignore */
  }
}

interface Bubble {
  key: HeroPhraseKey
  de: string
  translation: string
}

/**
 * Global "German hero" widget — mounted once in Layout, visible on every page. Entirely
 * gated by GET /api/hero (FEATURE_HERO_EMAILS + German-only): a 404/error renders nothing.
 * Reacts to events from lib/heroBus — training code only emits events, nothing here leaks
 * into it (see ReviewSession.tsx).
 */
export function HeroWidget() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language as HeroLang

  const hero = useQuery({
    queryKey: ['hero', i18n.language],
    queryFn: () => heroApi.get(i18n.language),
    retry: false,
    staleTime: 30_000,
  })

  const [collapsed, setCollapsed] = useState(() => readBool(LS_COLLAPSED))
  const [hidden, setHidden] = useState(() => readBool(LS_HIDDEN))
  const [menuOpen, setMenuOpen] = useState(false)
  const [mood, setMood] = useState<HeroMood>('idle')
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)

  const lastBubbleAtRef = useRef(0)
  const lastActivityRef = useRef(Date.now())
  const moodTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seenStageChangeRef = useRef(false) // a cached stage_changed=true must only celebrate once
  const stageRef = useRef(1)
  stageRef.current = hero.data?.stage ?? 1

  function applyReaction(reaction: HeroReaction) {
    setMood(reaction.mood)
    if (moodTimeoutRef.current) clearTimeout(moodTimeoutRef.current)
    if (reaction.moodDurationMs != null) {
      moodTimeoutRef.current = setTimeout(() => setMood('idle'), reaction.moodDurationMs)
    }
    if (reaction.bubbleKey) {
      const phrase = pickHeroPhrase(reaction.bubbleKey, stageRef.current)
      setShowTranslation(false)
      setBubble({ key: reaction.bubbleKey, de: phrase.de, translation: heroTranslation(phrase, lang) })
      if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current)
      bubbleTimeoutRef.current = setTimeout(() => setBubble(null), 3000)
    }
  }

  // Training (and future) events — the only thing the rest of the app knows about the hero.
  useEffect(
    () =>
      onHeroEvent((event) => {
        lastActivityRef.current = Date.now()
        const { reaction, nextLastBubbleAt } = reactToEvent(event, Date.now(), lastBubbleAtRef.current)
        lastBubbleAtRef.current = nextLastBubbleAt
        applyReaction(reaction)
        if (event.type === 'word_learned' || event.type === 'session_finished') {
          void hero.refetch()
        }
      }),
    [hero],
  )

  // Returning after 3+ days away: welcome back, once per mount.
  useEffect(() => {
    const now = Date.now()
    if (wasAbsent(readLastSeen(), now)) {
      const { reaction, nextLastBubbleAt } = reactToReturn()
      lastBubbleAtRef.current = nextLastBubbleAt
      applyReaction(reaction)
    }
    writeLastSeen(now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The server just reported a new max stage: celebrate once, not on every cached re-render.
  useEffect(() => {
    if (hero.data?.stage_changed && !seenStageChangeRef.current) {
      seenStageChangeRef.current = true
      const { reaction, nextLastBubbleAt } = reactToStageChanged()
      lastBubbleAtRef.current = nextLastBubbleAt
      applyReaction(reaction)
    }
  }, [hero.data?.stage_changed])

  // Idle → sleepy after 2 minutes of no page activity; any activity wakes it immediately.
  useEffect(() => {
    function onActivity() {
      lastActivityRef.current = Date.now()
      setMood((m) => (m === 'sleepy' ? 'idle' : m))
    }
    window.addEventListener('pointerdown', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity)
    const id = setInterval(() => {
      if (isInactiveEnoughToSleep(lastActivityRef.current, Date.now())) {
        setMood((m) => (m === 'sleepy' ? m : 'sleepy'))
      }
    }, 5000)
    return () => {
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
      clearInterval(id)
    }
  }, [])

  useEffect(
    () => () => {
      if (moodTimeoutRef.current) clearTimeout(moodTimeoutRef.current)
      if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current)
    },
    [],
  )

  if (!hero.data) return null // not on the allowlist, not learning German, or still loading

  const asset = heroAsset(hero.data.stage, mood)
  const sleepyBubble = mood === 'sleepy' ? t('hero.sleepyBubble') : null

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => {
          setHidden(false)
          writeBool(LS_HIDDEN, false)
        }}
        title={t('hero.show')}
        aria-label={t('hero.show')}
        className="fixed bottom-2 left-2 z-30 grid h-7 w-7 place-items-center rounded-full bg-emerald-950/50 text-sm opacity-40 transition hover:opacity-90"
      >
        {asset.emoji}
      </button>
    )
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => {
          setCollapsed(false)
          writeBool(LS_COLLAPSED, false)
        }}
        title={t('hero.expand')}
        aria-label={t('hero.expand')}
        className={`fixed bottom-4 left-4 z-30 grid h-12 w-12 place-items-center rounded-full border border-emerald-400/20 bg-emerald-950/80 text-2xl shadow-lg shadow-emerald-500/20 sm:h-14 sm:w-14 ${asset.animationClass}`}
      >
        {asset.emoji}
      </button>
    )
  }

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-30 flex flex-col items-start sm:bottom-4 sm:left-4">
      {(bubble || sleepyBubble) && (
        <button
          type="button"
          onClick={() => bubble && setShowTranslation((v) => !v)}
          className="pointer-events-auto mb-2 max-w-[12rem] rounded-2xl rounded-bl-none border border-lime-400/30 bg-emerald-950/95 px-3 py-2 text-left text-xs font-semibold text-lime-100 shadow-xl sm:max-w-xs sm:text-sm"
        >
          „{bubble ? (showTranslation ? bubble.translation : bubble.de) : sleepyBubble}“
        </button>
      )}
      <div className="pointer-events-auto relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          title={hero.data.stage_name}
          aria-label={hero.data.stage_name}
          className={`grid h-12 w-12 place-items-center rounded-full border border-emerald-400/20 bg-emerald-950/80 text-2xl shadow-lg shadow-emerald-500/20 sm:h-16 sm:w-16 sm:text-4xl ${asset.animationClass}`}
        >
          {asset.emoji}
        </button>
        {menuOpen && (
          <div
            className="absolute bottom-full left-0 mb-2 w-40 overflow-hidden rounded-xl border border-emerald-400/20 bg-emerald-950 text-sm shadow-xl"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                setCollapsed(true)
                writeBool(LS_COLLAPSED, true)
              }}
              className="block w-full px-3 py-2 text-left text-emerald-100/80 hover:bg-emerald-400/10 hover:text-white"
            >
              {t('hero.collapse')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                setHidden(true)
                writeBool(LS_HIDDEN, true)
              }}
              className="block w-full px-3 py-2 text-left text-red-300/80 hover:bg-red-500/10 hover:text-red-200"
            >
              {t('hero.hide')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
