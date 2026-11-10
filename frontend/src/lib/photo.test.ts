import { afterEach, describe, expect, it, vi } from 'vitest'
import { analysisSize, assessPixels, checkPhotoQuality, MAX_SIDE, preparePhoto, PhotoQualityError } from './photo'

// Synthetic thumbnails (RGBA), 128×120 (tall enough for the blur check).
const W = 128, H = 120
function image(pixel: (x: number, y: number) => number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = pixel(x, y), i = (y * W + x) * 4
      buf[i] = buf[i + 1] = buf[i + 2] = v
      buf[i + 3] = 255
    }
  }
  return buf
}
const black = image(() => 0)
const flatGray = image(() => 128)
// Black "text" bars on white paper: sharp edges, bright overall.
const textLike = image((x, y) => ((Math.floor(x / 2) + Math.floor(y / 3)) % 3 === 0 ? 0 : 255))
// The same page photographed softly: the sharp pattern replaced by a gentle gradient.
const softPage = image((x) => 190 + Math.round(20 * Math.sin(x / 20)))
// A dark-theme screenshot: white "text" bars on black, 1 pixel in 8 lit — mean 30, p95 240.
const darkMode = image((x, y) => ((Math.floor(x / 2) + Math.floor(y / 3)) % 8 === 0 ? 240 : 0))

describe('assessPixels', () => {
  it('too small only when the long side is under 400 px or the short side under 60 px', () => {
    expect(assessPixels(300, 300, textLike, W, H)).toBe('too_small') // long side < 400
    expect(assessPixels(399, 399, textLike, W, H)).toBe('too_small')
    expect(assessPixels(2000, 40, textLike, W, H)).toBe('too_small') // short side < 60
    expect(assessPixels(2000, 59, textLike, W, H)).toBe('too_small')
    expect(assessPixels(400, 400, textLike, W, H)).toBe('ok')
    expect(assessPixels(2000, 60, textLike, W, H)).toBe('ok')
  })

  it('a 780×150 crop with text-like stripes passes', () => {
    const { w, h } = analysisSize(780, 150)
    const strip = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, v = (Math.floor(x / 2) + Math.floor(y / 3)) % 3 === 0 ? 0 : 255
      strip[i] = strip[i + 1] = strip[i + 2] = v
      strip[i + 3] = 255
    }
    expect(assessPixels(780, 150, strip, w, h)).toBe('ok')
  })

  it('a thin strip is still checked for darkness, but not for blur', () => {
    const w = 333, h = 64
    const flat = (v: number) => { const b = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < b.length; i++) b[i] = i % 4 === 3 ? 255 : v; return b }
    expect(assessPixels(780, 150, flat(0), w, h)).toBe('too_dark')
    expect(assessPixels(780, 150, flat(128), w, h)).toBe('ok') // flat, but short: no blur check
  })

  it('analysisSize: shorter side at least 64, longer at most 1024, never upscaled', () => {
    expect(analysisSize(3000, 4000)).toEqual({ w: 256, h: 341 }) // as before
    expect(analysisSize(1200, 900)).toEqual({ w: 256, h: 192 })
    expect(analysisSize(780, 150)).toEqual({ w: 333, h: 64 })
    expect(analysisSize(10000, 100)).toEqual({ w: 1024, h: 10 }) // the cap wins over the short-side minimum
    expect(analysisSize(200, 100)).toEqual({ w: 200, h: 100 })
  })

  it('a black image is too dark', () => {
    expect(assessPixels(1200, 900, black, W, H)).toBe('too_dark')
  })

  it('a uniformly dark image is too dark', () => {
    expect(assessPixels(1200, 900, image(() => 25), W, H)).toBe('too_dark')
  })

  it('a dark gray low-contrast image is too dark, even with sharp noise in it', () => {
    const murky = image((x, y) => 40 + ((x * 7 + y * 13) % 16)) // 40–55
    expect(assessPixels(1200, 900, murky, W, H)).toBe('too_dark')
  })

  it('a dark-theme screenshot passes: low mean, but bright sharp text', () => {
    expect(assessPixels(1200, 900, darkMode, W, H)).toBe('ok')
  })

  it('a flat gray image without any detail is blurry', () => {
    expect(assessPixels(1200, 900, flatGray, W, H)).toBe('blurry')
  })

  it('a sharp black-on-white text-like pattern passes', () => {
    expect(assessPixels(1200, 900, textLike, W, H)).toBe('ok')
  })

  it('a dim but sharp page still passes (conservative)', () => {
    const dim = image((x, y) => ((Math.floor(x / 2) + Math.floor(y / 3)) % 3 === 0 ? 20 : 120))
    expect(assessPixels(1200, 900, dim, W, H)).toBe('ok')
  })

  it('nothing bright is not enough for too dark: the contrast must be missing too', () => {
    const dimmer = image((x, y) => ((Math.floor(x / 2) + Math.floor(y / 3)) % 3 === 0 ? 15 : 80)) // p95 80, contrast 65
    expect(assessPixels(1200, 900, dimmer, W, H)).toBe('ok')
  })

  it('a very soft, low-contrast picture is blurry', () => {
    expect(assessPixels(1200, 900, softPage, W, H)).toBe('blurry')
  })
})

// A canvas that answers with a prepared thumbnail, whatever is drawn on it, and encodes to a tiny
// blob. Returns the canvases made, in order: [0] the quality check's copy, [1] the shrunk photo.
type StubCanvas = { width: number; height: number; toBlob: ReturnType<typeof vi.fn> }
function stubCanvas(data: Uint8ClampedArray): StubCanvas[] {
  const made: StubCanvas[] = []
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return real(tag)
    const c = {
      width: 0, height: 0,
      getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data }) }),
      toBlob: vi.fn((done: (b: Blob | null) => void, type: string) => done(new Blob(['jpeg'], { type }))),
    }
    made.push(c)
    return c as unknown as HTMLCanvasElement
  }) as typeof document.createElement)
  return made
}
const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() })

// Text-like pixels for a 256×192 copy: what a 4:3 photo (1200×900, 2000×1500, 4000×3000) is analysed as.
function page4x3(): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(256 * 192 * 4)
  for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4, v = (Math.floor(x / 2) + Math.floor(y / 3)) % 3 === 0 ? 0 : 255
    buf[i] = buf[i + 1] = buf[i + 2] = v
    buf[i + 3] = 255
  }
  return buf
}

describe('checkPhotoQuality / preparePhoto', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('checkPhotoQuality reads the original size from the bitmap and the pixels from the canvas copy', () => {
    stubCanvas(textLike) // 128×120 thumbnail ← a 128×120 bitmap
    expect(checkPhotoQuality(bitmap(W, H) as unknown as ImageBitmap)).toBe('too_small') // the original's long side is under 400 px
  })

  it('preparePhoto throws PhotoQualityError for a photo that cannot work, and closes the bitmap', async () => {
    stubCanvas(black)
    const bm = bitmap(256, 192)
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bm))
    await expect(preparePhoto(new Blob(['x']))).rejects.toMatchObject({ reason: 'too_small' })
    expect(bm.close).toHaveBeenCalled()
  })

  it('preparePhoto passes a good small file through untouched', async () => {
    stubCanvas(page4x3())
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap(1200, 900)))
    const file = new Blob(['x'])
    expect(await preparePhoto(file)).toBe(file)
  })

  it('the long side is capped at 1568 px: what the AI uses at most', () => {
    expect(MAX_SIDE).toBe(1568)
  })

  it('a file over 4 MB is shrunk to 1568 px on the long side, as a JPEG at quality 0.85', async () => {
    const canvases = stubCanvas(page4x3())
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap(4000, 3000)))
    const file = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: 'image/jpeg' })
    const out = await preparePhoto(file)
    const shrunk = canvases[1]
    expect([shrunk.width, shrunk.height]).toEqual([1568, 1176])
    expect(shrunk.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85)
    expect(out).not.toBe(file)
    expect(out.type).toBe('image/jpeg')
  })

  it('a small file that is over 1568 px on the long side is shrunk too', async () => {
    const canvases = stubCanvas(page4x3())
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap(2000, 1500)))
    const file = new Blob(['x'.repeat(1000)], { type: 'image/png' })
    const out = await preparePhoto(file)
    expect([canvases[1].width, canvases[1].height]).toEqual([1568, 1176])
    expect(out.type).toBe('image/jpeg')
  })

  it('a small file at exactly 1568 px goes as it is', async () => {
    const canvases = stubCanvas(page4x3())
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap(1568, 1176)))
    const file = new Blob(['x'])
    expect(await preparePhoto(file)).toBe(file)
    expect(canvases).toHaveLength(1) // only the quality check's copy
  })

  it('the shrunk JPEG is used only when it is smaller than the original', async () => {
    stubCanvas(page4x3())
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap(2000, 1500)))
    const file = new Blob(['x']) // 1 byte: the 4-byte "JPEG" is bigger
    expect(await preparePhoto(file)).toBe(file)
  })

  it('a file the browser cannot decode goes on unchecked', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')))
    const file = new Blob(['x'])
    expect(await preparePhoto(file)).toBe(file)
  })

  it('PhotoQualityError carries the reason', () => {
    expect(new PhotoQualityError('blurry').reason).toBe('blurry')
  })
})
