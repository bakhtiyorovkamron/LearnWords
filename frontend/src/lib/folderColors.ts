// The colours a user picks for a folder. They are the user's own choice, not part of the theme, so
// they stay the same in every theme.
export const FOLDER_COLORS = ['lime', 'amber', 'sky', 'rose', 'violet', 'slate'] as const

export const FOLDER_DOT: Record<string, string> = {
  lime: 'bg-lime-400', amber: 'bg-amber-400', sky: 'bg-sky-400',
  rose: 'bg-rose-400', violet: 'bg-violet-400', slate: 'bg-slate-400',
}
