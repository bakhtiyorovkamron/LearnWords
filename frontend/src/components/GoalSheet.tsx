import { useTranslation } from 'react-i18next'
import { DAILY_GOALS, type DailyGoal } from '../api/endpoints'
import { minutesFor } from '../lib/dailyGoal'
import { Sheet } from './Sheet'

/** Choose the daily goal: one tap saves it and closes the sheet. */
export function GoalSheet({ goal, onPick, onClose }: { goal: DailyGoal; onPick: (g: DailyGoal) => void; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Sheet label={t('home.goalSheet')} onClose={onClose}>
      <h2 className="text-lg font-bold text-fg">{t('home.goalSheet')}</h2>
      <div role="radiogroup" aria-label={t('home.goalSheet')} className="mt-4 grid grid-cols-4 gap-2">
        {DAILY_GOALS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={goal === n}
            onClick={() => { onPick(n); onClose() }}
            className={`flex min-h-[72px] flex-col items-center justify-center rounded-[14px] border-2 transition ${
              goal === n ? 'border-accent bg-surface-2' : 'border-line bg-surface hover:bg-surface-2'}`}>
            <span className="text-[22px] font-bold tabular-nums text-fg">{n}</span>
            <span className="text-xs text-muted">{t('home.minutesShort', { count: minutesFor(n) })}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">{t('home.goalHint')}</p>
    </Sheet>
  )
}
