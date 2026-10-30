import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const Eye = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
const EyeOff = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.9 17.9A10.4 10.4 0 0 1 12 19c-6.4 0-10-7-10-7a17.6 17.6 0 0 1 4.1-4.9M9.9 5.2A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17.7 17.7 0 0 1-2.2 3.1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="m2 2 20 20" />
  </svg>
)

/**
 * A password input with an eye button inside the field: it shows or hides THIS field only. The value
 * and the caret stay where they were; the input keeps its autoComplete. Tab order: input, then button.
 */
export function PasswordField({ value, onChange, placeholder, autoComplete }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoComplete: string
}) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const caret = useRef<[number | null, number | null] | null>(null)

  // Changing the type can reset the selection in some browsers: put it back.
  useLayoutEffect(() => {
    const el = input.current
    if (!el || !caret.current) return
    const [start, end] = caret.current
    caret.current = null
    if (document.activeElement === el && start !== null && end !== null) el.setSelectionRange(start, end)
  }, [shown])

  function toggle() {
    const el = input.current
    caret.current = el ? [el.selectionStart, el.selectionEnd] : null
    setShown((s) => !s)
  }

  const label = t(shown ? 'auth.hidePassword' : 'auth.showPassword')
  return (
    <div className="relative">
      <input ref={input} className="field !pr-12" type={shown ? 'text' : 'password'} placeholder={placeholder} required
        autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" aria-label={label} title={label} aria-pressed={shown} onClick={toggle}
        // Keep the focus (and the caret) in the input when the pointer presses the button.
        onMouseDown={(e) => e.preventDefault()}
        className="absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-xl text-emerald-100/60 transition hover:text-lime-300">
        {shown ? <EyeOff /> : <Eye />}
      </button>
    </div>
  )
}
