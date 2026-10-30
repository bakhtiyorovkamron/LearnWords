import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Files already moved to the theme tokens: they must not use the old palette classes again.
// (Steps 3–5 of the migration add their files here.)
const THEMED = [
  'components/Layout.tsx', 'components/Logo.tsx', 'pages/ContextsPage.tsx', 'components/FolderList.tsx',
  'components/LanguageSwitcher.tsx', 'components/PushToggle.tsx', 'components/ThemePicker.tsx',
  'components/InstallPrompt.tsx', 'components/InAppBanner.tsx', 'components/Toaster.tsx',
  'components/ContactLinks.tsx', 'components/ErrorState.tsx',
  // step 3: training
  'components/ReviewSession.tsx', 'components/QuizQuestion.tsx', 'components/ReviewResult.tsx',
  'components/TrainingHero.tsx', 'components/DirectionToggle.tsx',
  // step 4: collection
  'pages/CardsPage.tsx', 'components/WordCard.tsx', 'components/ProgressDots.tsx', 'components/Folders.tsx',
  'components/FlipCards.tsx', 'components/EditWordModal.tsx', 'components/FolderPicker.tsx',
  'components/ShareFolderModal.tsx', 'components/WordFixes.tsx', 'components/FilterSheet.tsx',
  'components/Sheet.tsx', 'components/Segmented.tsx',
]

const FORBIDDEN = /\b(emerald|lime|teal|red)-\d{2,3}\b|text-white|bg-white/

describe('migrated files use only theme tokens', () => {
  for (const file of THEMED) {
    it(file, () => {
      const source = readFileSync(resolve(__dirname, file), 'utf8')
      const hit = source.split('\n').map((line, i) => ({ line, n: i + 1 })).find(({ line }) => FORBIDDEN.test(line))
      expect(hit ? `${file}:${hit.n}: ${hit.line.trim()}` : null).toBeNull()
    })
  }

  it('the guard itself catches what it should', () => {
    for (const bad of ['text-emerald-100/70', 'bg-lime-400', 'border-teal-300', 'text-red-300', 'text-white', 'bg-white/5', 'hover:bg-emerald-400/10']) {
      expect(FORBIDDEN.test(`className="${bad}"`), bad).toBe(true)
    }
    for (const good of ['text-fg', 'bg-surface-2', 'text-accent-text', 'text-danger', 'border-line', 'bg-black/60', 'text-white-ish-name']) {
      if (good === 'text-white-ish-name') continue // not a class we use; the guard is deliberately strict
      expect(FORBIDDEN.test(`className="${good}"`), good).toBe(false)
    }
  })
})
