import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The UI engine is mocked: we only look at whether it is switched on. The training engine is real
// (over a fake AudioContext), to show that muting the interface does not mute the training.
const setUiSoundsEnabled = vi.fn()
vi.mock('./uiSounds', () => ({ playUi: vi.fn(), unlockUiSounds: vi.fn(), setUiSoundsEnabled }))
vi.mock('../api/endpoints', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/endpoints')>()
  return { ...mod, settingsApi: { ...mod.settingsApi, setSounds: vi.fn().mockResolvedValue({}), setUiSounds: vi.fn().mockResolvedValue({}) } }
})

class FakeAudioContext {
  static oscillators = 0
  currentTime = 0; state = 'running'; destination = {}
  resume() { return Promise.resolve() }
  createOscillator() {
    FakeAudioContext.oscillators++
    return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }
  }
  createGain() {
    return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }
  }
}

const lastUiEngine = () => setUiSoundsEnabled.mock.calls.at(-1)?.[0]

beforeEach(() => {
  vi.resetModules()
  setUiSoundsEnabled.mockClear()
  FakeAudioContext.oscillators = 0
  localStorage.clear()
  vi.stubGlobal('AudioContext', FakeAudioContext)
})
afterEach(() => vi.unstubAllGlobals())

describe('interface-sounds switch', () => {
  it('on by default: the UI engine runs when both switches are on', async () => {
    await import('./sounds')
    expect(lastUiEngine()).toBe(true)
  })

  it('UI switch off → the UI engine is off, but training sounds still play', async () => {
    const sounds = await import('./sounds')
    sounds.setUiSoundsSwitch(false)
    expect(lastUiEngine()).toBe(false)
    expect(localStorage.getItem('ui-sounds-enabled')).toBe('false')

    window.dispatchEvent(new Event('pointerdown')) // a user gesture creates the training audio context
    sounds.playSound('correct')
    expect(FakeAudioContext.oscillators).toBeGreaterThan(0)
  })

  it('master off mutes the UI engine too; turning it back on restores what the UI switch says', async () => {
    const sounds = await import('./sounds')
    sounds.setSoundsEnabled(false)
    expect(lastUiEngine()).toBe(false)
    sounds.setSoundsEnabled(true)
    expect(lastUiEngine()).toBe(true)

    sounds.setUiSoundsSwitch(false)
    sounds.setSoundsEnabled(false)
    sounds.setSoundsEnabled(true)
    expect(lastUiEngine()).toBe(false) // the UI switch is still off
  })

  it('adopts the profile value, ignoring junk; the stored value is read at start', async () => {
    localStorage.setItem('ui-sounds-enabled', 'false')
    const sounds = await import('./sounds')
    expect(lastUiEngine()).toBe(false)
    sounds.adoptServerUiSounds(true)
    expect(lastUiEngine()).toBe(true)
    sounds.adoptServerUiSounds('nonsense')
    expect(lastUiEngine()).toBe(true)
  })

  it('saves the choice to the profile', async () => {
    const sounds = await import('./sounds')
    const { settingsApi } = await import('../api/endpoints')
    sounds.setUiSoundsSwitch(false)
    expect(settingsApi.setUiSounds).toHaveBeenCalledWith(false)
  })
})
