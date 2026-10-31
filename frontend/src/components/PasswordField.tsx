import { useLayoutEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
        className="absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-xl text-muted transition hover:text-fg">
        {shown ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
      </button>
    </div>
  )
}
