import { useTranslation } from 'react-i18next'
import { DAILY_GOALS, type DailyGoal } from '../api/endpoints'
import { minutesFor } from '../lib/dailyGoal'
import { DIRECTIONS, type Direction } from '../lib/quiz'
import { useStoredChoice } from './DirectionToggle'
import { Sheet } from './Sheet'

const ASK: Record<Direction, [title: string, hint: string]> = {
  de_ru: ['home.askDeRu', 'home.askDeRuHint'],
  ru_de: ['home.askRuDe', 'home.askRuDeHint'],
  mixed: ['home.askMixed', 'home.askMixedHint'],
}

/**
 * The training settings, opened from Home's goal card: the daily goal (a tap saves it and highlights
 * the tile) and how the words are asked. "Done" closes the sheet.
 */
export function GoalSheet({ goal, onPick, onClose }: { goal: DailyGoal; onPick: (g: DailyGoal) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [direction, setDirection] = useStoredChoice<Direction>('review-direction', DIRECTIONS, 'mixed')
  return (
    <Sheet label={t('home.goalSheet')} onClose={onClose}>
      <h2 className="text-lg font-bold text-fg">{t('home.goalSheet')}</h2>
      <div role="radiogroup" aria-label={t('home.goalSheet')} className="mt-4 grid grid-cols-4 gap-2">
        {DAILY_GOALS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={goal === n} onClick={() => onPick(n)}
            className={`flex min-h-[72px] flex-col items-center justify-center rounded-[14px] border-2 transition ${
              goal === n ? 'border-accent bg-surface-2' : 'border-line bg-surface hover:bg-surface-2'}`}>
            <span className="text-[22px] font-bold tabular-nums text-fg">{n}</span>
            <span className="text-xs text-muted">{t('home.minutesShort', { count: minutesFor(n) })}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">{t('home.goalHint')}</p>

      <h3 className="mt-6 text-[15px] font-semibold text-fg">{t('home.askTitle')}</h3>
      <div role="radiogroup" aria-label={t('home.askTitle')} className="mt-3 space-y-2">
        {DIRECTIONS.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={direction === d} onClick={() => setDirection(d)}
            className={`flex min-h-[60px] w-full items-center gap-3 rounded-[14px] border-2 px-4 py-2.5 text-left ${
              direction === d ? 'border-accent bg-surface-2' : 'border-line bg-surface'}`}>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-fg">{t(ASK[d][0])}</span>
              <span className="block text-sm text-muted">{t(ASK[d][1])}</span>
            </span>
            <span aria-hidden="true" className={`h-5 w-5 shrink-0 rounded-full ${direction === d ? 'border-[6px] border-accent' : 'border-2 border-line'}`} />
          </button>
        ))}
      </div>

      <button type="button" onClick={onClose} className="btn-primary mt-5 h-[52px] w-full rounded-[14px]">{t('home.sheetDone')}</button>
    </Sheet>
  )
}
