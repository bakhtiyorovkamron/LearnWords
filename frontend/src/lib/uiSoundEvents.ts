import { playUi, unlockUiSounds, type UiSound } from './uiSounds'

// One delegated listener for the whole app (installed once in main.tsx): taps and toggles.
// Typing, sliders, scrolling and anything inside [data-no-ui-sound] stay silent.

// What counts as a tap target. Text inputs, textareas and range sliders are deliberately absent.
const TAPPABLE = 'button, a[href], [role=button], [role=tab], [role=switch], summary, select, input[type=checkbox]'

let gesture = false

/** True once the user has touched the page: before that no UI sound may play (autoplay rules, and no sound on load). */
export function hasUserGesture(): boolean {
  return gesture
}

function markGesture() {
  if (gesture) return
  gesture = true
  unlockUiSounds() // the context must exist before the first route change
}

function isDisabled(el: Element): boolean {
  return el.matches(':disabled') || el.closest('[aria-disabled=true]') !== null
}

/** Which sound a pointerdown on `target` makes (null = silence). Pure: no audio here. */
export function soundForTarget(target: EventTarget | null): UiSound | null {
  if (!(target instanceof Element)) return null
  if (target.closest('[data-no-ui-sound]')) return null // quiz answers, Check/Next: they have their own sounds
  const el = target.closest(TAPPABLE)
  if (!el || isDisabled(el)) return null
  // Switches and checkboxes: the sound tells the state they are going TO (pointerdown comes before the flip).
  if (el.getAttribute('role') === 'switch') return el.getAttribute('aria-checked') === 'true' ? 'toggleOff' : 'toggleOn'
  if (el instanceof HTMLInputElement) return el.checked ? 'toggleOff' : 'toggleOn'
  return 'tap'
}

export function handleUiPointerDown(e: Event) {
  markGesture()
  const kind = soundForTarget(e.target)
  if (kind) playUi(kind)
}

let installed = false

/** Installs the listeners once. */
export function installUiSounds() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('pointerdown', handleUiPointerDown, { capture: true, passive: true })
  // A keyboard user is a user too: Enter on a link is a gesture that may start the audio context.
  document.addEventListener('keydown', markGesture, { capture: true, passive: true, once: true })
}

/** Test helper: forget the gesture and the installed state. */
export function resetUiSoundEventsForTests() {
  gesture = false
  if (installed) document.removeEventListener('pointerdown', handleUiPointerDown, { capture: true })
  installed = false
}
