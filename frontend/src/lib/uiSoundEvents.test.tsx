import { cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import { MemoryRouter, NavigationType, useNavigate, type NavigateFunction } from 'react-router-dom'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playUi, unlockUiSounds } from './uiSounds'
import { installUiSounds, resetUiSoundEventsForTests } from './uiSoundEvents'
import { ORDER, pageSoundFor, setTrainingOpen, usePageSounds } from './pageSounds'

vi.mock('./uiSounds', () => ({ playUi: vi.fn(), unlockUiSounds: vi.fn(), setUiSoundsEnabled: vi.fn() }))

beforeEach(() => {
  vi.mocked(playUi).mockClear()
  vi.mocked(unlockUiSounds).mockClear()
  resetUiSoundEventsForTests()
  installUiSounds()
  setTrainingOpen(false)
})
afterEach(() => { cleanup(); document.body.innerHTML = '' })

const press = (el: Element) => fireEvent.pointerDown(el)
const sounds = () => vi.mocked(playUi).mock.calls.map((c) => c[0])

function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

describe('taps', () => {
  it('first pointerdown unlocks the audio, once', () => {
    const b = mount('<p id="p">text</p>')
    press(b.querySelector('#p')!)
    press(b.querySelector('#p')!)
    expect(unlockUiSounds).toHaveBeenCalledTimes(1)
    expect(sounds()).toEqual([]) // plain text is silent
  })

  it.each([
    ['button', '<button id="x">Go</button>'],
    ['inside a button', '<button><span id="x">Go</span></button>'],
    ['a[href]', '<a id="x" href="/cards">Cards</a>'],
    ['[role=button]', '<span id="x" role="button" tabindex="0">dots</span>'],
    ['[role=tab]', '<div id="x" role="tab">Tab</div>'],
    ['summary', '<details><summary id="x">More</summary></details>'],
    ['select', '<select id="x"><option>a</option></select>'],
  ])('%s → tap', (_n, html) => {
    press(mount(html).querySelector('#x')!)
    expect(sounds()).toEqual(['tap'])
  })

  it.each([
    ['text input', '<input id="x" type="text" />'],
    ['textarea', '<textarea id="x"></textarea>'],
    ['range slider', '<input id="x" type="range" />'],
    ['an <a> without href', '<a id="x">not a link</a>'],
    ['disabled button', '<button id="x" disabled>Go</button>'],
    ['aria-disabled', '<button id="x" aria-disabled="true">Go</button>'],
    ['inside an aria-disabled group', '<div aria-disabled="true"><span role="button" id="x">dots</span></div>'],
    ['[data-no-ui-sound] itself', '<button id="x" data-no-ui-sound>Answer</button>'],
    ['inside [data-no-ui-sound]', '<div data-no-ui-sound><button><span id="x">Next</span></button></div>'],
  ])('%s → silence', (_n, html) => {
    press(mount(html).querySelector('#x')!)
    expect(sounds()).toEqual([])
  })

  it('switches and checkboxes sound by the NEW state', () => {
    const b = mount(`
      <button id="off" role="switch" aria-checked="false"></button>
      <button id="on" role="switch" aria-checked="true"></button>
      <input id="unchecked" type="checkbox" />
      <input id="checked" type="checkbox" checked />`)
    press(b.querySelector('#off')!)
    press(b.querySelector('#on')!)
    press(b.querySelector('#unchecked')!)
    press(b.querySelector('#checked')!)
    expect(sounds()).toEqual(['toggleOn', 'toggleOff', 'toggleOn', 'toggleOff'])
  })

  it('installs once: a second install does not double the sound', () => {
    installUiSounds()
    press(mount('<button id="x">Go</button>').querySelector('#x')!)
    expect(sounds()).toEqual(['tap'])
  })
})

describe('pageSoundFor', () => {
  it('sections follow ORDER; going down the list turns forward, up turns back', () => {
    expect(pageSoundFor('/cards', '/search', NavigationType.Push)).toBe('pageForward')
    expect(pageSoundFor('/search', '/cards', NavigationType.Push)).toBe('pageBack')
    expect(pageSoundFor('/stats', '/contexts/new', NavigationType.Push)).toBe('pageBack') // /stats is later in ORDER
    expect(pageSoundFor('/contexts/new', '/stats', NavigationType.Push)).toBe('pageForward')
    expect(ORDER).toEqual(['/', '/cards', '/contexts/new', '/search', '/story', '/stats', '/admin'])
  })
  it('"/" is the first section: home → cards turns forward, cards → home back; it is never a parent path', () => {
    expect(pageSoundFor('/', '/cards', NavigationType.Push)).toBe('pageForward')
    expect(pageSoundFor('/cards', '/', NavigationType.Push)).toBe('pageBack')
    expect(pageSoundFor('/', '/admin', NavigationType.Push)).toBe('pageForward')
    expect(pageSoundFor('/story', '/', NavigationType.Push)).toBe('pageBack')
    // an unlisted path is not "deeper than /": it is just an unrelated push
    expect(pageSoundFor('/', '/somewhere', NavigationType.Push)).toBe('pageForward')
    expect(pageSoundFor('/somewhere', '/', NavigationType.Push)).toBe('pageForward')
  })
  it('deeper pages turn forward, back up turns back', () => {
    expect(pageSoundFor('/contexts', '/contexts/abc', NavigationType.Push)).toBe('pageForward')
    expect(pageSoundFor('/contexts/abc', '/contexts', NavigationType.Push)).toBe('pageBack')
  })
  it('browser back/forward is always pageBack; the same path is nothing', () => {
    expect(pageSoundFor('/search', '/story', NavigationType.Pop)).toBe('pageBack')
    expect(pageSoundFor('/cards', '/cards', NavigationType.Push)).toBeNull()
  })
})

describe('usePageSounds', () => {
  let go: NavigateFunction = (() => undefined) as unknown as NavigateFunction
  function Nav() { go = useNavigate(); return null }

  function renderAt(path: string) {
    return renderHook(() => { usePageSounds() }, {
      wrapper: ({ children }) => <MemoryRouter initialEntries={[path]}><Nav />{children}</MemoryRouter>,
    })
  }
  const nav = (to: string | number) => act(() => { go(to as never) })

  it('first render is silent', () => {
    press(mount('<p id="x">x</p>').querySelector('#x')!) // a gesture happened
    renderAt('/cards')
    expect(sounds()).toEqual([])
  })

  it('/cards → /search is pageForward, browser back is pageBack', () => {
    press(mount('<p id="x">x</p>').querySelector('#x')!)
    renderAt('/cards')
    nav('/search')
    expect(sounds()).toEqual(['pageForward'])
    nav(-1) // browser back (POP)
    expect(sounds()).toEqual(['pageForward', 'pageBack'])
  })

  it('a query-param or hash change is not a page turn', () => {
    press(mount('<p id="x">x</p>').querySelector('#x')!)
    renderAt('/cards')
    nav('/cards?folder=abc')
    nav('/cards?folder=abc&tab=all#top')
    expect(sounds()).toEqual([])
  })

  it('a redirect (replace) is not a page turn', () => {
    press(mount('<p id="x">x</p>').querySelector('#x')!)
    renderAt('/cards')
    act(() => { go('/stats', { replace: true }) })
    expect(sounds()).toEqual([])
  })

  it('nothing before the first user gesture (load, redirect after login)', () => {
    renderAt('/cards')
    nav('/search')
    expect(sounds()).toEqual([])
  })

  it('nothing while a training session is open', () => {
    press(mount('<p id="x">x</p>').querySelector('#x')!)
    renderAt('/cards')
    setTrainingOpen(true)
    nav('/search')
    expect(sounds()).toEqual([])
    setTrainingOpen(false)
    nav('/story')
    expect(sounds()).toEqual(['pageForward'])
  })
})
