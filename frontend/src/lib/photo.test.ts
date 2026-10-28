import { afterEach, describe, expect, it, vi } from 'vitest'
import { assessPixels, checkPhotoQuality, preparePhoto, PhotoQualityError } from './photo'

// Synthetic thumbnails (RGBA), 128×96, like the 256-px-wide copy the app analyses.
const W = 128, H = 96
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

describe('assessPixels', () => {
  it('a 400 px image is too small, whatever it shows', () => {
    expect(assessPixels(400, 300, textLike, W, H)).toBe('too_small')
    expect(assessPixels(2000, 599, textLike, W, H)).toBe('too_small') // the SHORTER side counts
    expect(assessPixels(600, 600, textLike, W, H)).toBe('ok')
  })

  it('a black image is too dark', () => {
    expect(assessPixels(1200, 900, black, W, H)).toBe('too_dark')
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

  it('a very soft, low-contrast picture is blurry', () => {
    expect(assessPixels(1200, 900, softPage, W, H)).toBe('blurry')
  })
})

// A canvas that answers with a prepared thumbnail, whatever is drawn on it.
function stubCanvas(data: Uint8ClampedArray) {
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return real(tag)
    return {
      width: 0, height: 0,
      getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data }) }),
    } as unknown as HTMLCanvasElement
  }) as typeof document.createElement)
}
const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() })

describe('checkPhotoQuality / preparePhoto', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('checkPhotoQuality reads the original size from the bitmap and the pixels from the canvas copy', () => {
    stubCanvas(textLike) // 128×96 thumbnail ← a 128×96 bitmap
    expect(checkPhotoQuality(bitmap(W, H) as unknown as ImageBitmap)).toBe('too_small') // the original is under 600 px
  })

  it('preparePhoto throws PhotoQualityError for a photo that cannot work, and closes the bitmap', async () => {
    stubCanvas(black)
    const bm = bitmap(256, 192)
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bm))
    await expect(preparePhoto(new Blob(['x']))).rejects.toMatchObject({ reason: 'too_small' })
    expect(bm.close).toHaveBeenCalled()
  })

  it('preparePhoto passes a good small file through untouched', async () => {
    // A 1200×900 bitmap is analysed as a 256×192 copy: give the stub exactly that many pixels.
    const wide = new Uint8ClampedArray(256 * 192 * 4)
    for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4, v = (Math.floor(x / 2) + Math.floor(y / 3)) % 3 === 0 ? 0 : 255
      wide[i] = wide[i + 1] = wide[i + 2] = v
      wide[i + 3] = 255
    }
    stubCanvas(wide)
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap(1200, 900)))
    const file = new Blob(['x'])
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
