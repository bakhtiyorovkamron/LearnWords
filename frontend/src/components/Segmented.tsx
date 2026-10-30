/** A group of toggle buttons in one pill: the tabs, the list/flashcards switch, the filter options. */
export function Segmented<T extends string>({ value, onChange, options, label, className = '' }: {
  value: T
  onChange: (v: T) => void
  options: readonly (readonly [T, string])[]
  label?: string
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={`inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1 ${className}`}>
      {options.map(([k, text]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
            value === k ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg'
          }`}>
          {text}
        </button>
      ))}
    </div>
  )
}
