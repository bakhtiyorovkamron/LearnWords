// Photos are checked in the browser before anything is sent: a photo that cannot work is
// rejected here, with no request — so it never costs the daily quota.

// Phone photos are often bigger than the server accepts (5 MB): such a photo is shrunk first.
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const SHRINK_ABOVE = 4 * 1024 * 1024
const MAX_SIDE = 2400

// Quality thresholds — deliberately conservative: a slightly soft but readable page must pass.
export const MIN_SIDE_PX = 600          // shorter side of the original image
// Too dark = nothing bright AND no contrast. Not the mean: a dark-theme screenshot has a low mean
// but bright, sharp text. Both are 0-255, on the grayscale copy.
export const MIN_BRIGHT_P95 = 90        // 95th percentile: below it, nothing in the image is bright
export const MIN_CONTRAST = 25          // p95 - p5: below it, the image has no contrast
export const MIN_LAPLACIAN_VARIANCE = 15 // sharpness of the grayscale copy
export const ANALYSIS_WIDTH = 256       // width of the grayscale copy

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const isPhotoType = (type: string) => TYPES.includes(type)

export type PhotoQuality = 'ok' | 'too_small' | 'too_dark' | 'blurry'

/** A photo rejected on this device. `reason` picks the message; nothing was sent. */
export class PhotoQualityError extends Error {
  constructor(public reason: Exclude<PhotoQuality, 'ok'>) {
    super(`photo rejected: ${reason}`)
  }
}

/** Luminance (0-255) of each pixel of an RGBA buffer. */
function grayscale(rgba: ArrayLike<number>, count: number): Float32Array {
  const g = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    g[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
  }
  return g
}

/** The 5th and 95th percentiles (0-255) of a grayscale copy, from a 256-bin histogram. */
function percentiles(gray: Float32Array): { p5: number; p95: number } {
  const bins = new Uint32Array(256)
  for (const v of gray) bins[Math.round(v)]++
  const at = (q: number) => {
    const target = q * gray.length
    let seen = 0
    for (let i = 0; i < 256; i++) {
      seen += bins[i]
      if (seen >= target) return i
    }
    return 255
  }
  return { p5: at(0.05), p95: at(0.95) }
}

/** Variance of the Laplacian (4-neighbour kernel) over the interior: low = blurry/flat. */
function laplacianVariance(gray: Float32Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0
  let sum = 0, sumSq = 0, n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const v = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i]
      sum += v
      sumSq += v * v
      n++
    }
  }
  const mean = sum / n
  return sumSq / n - mean * mean
}

/**
 * The verdict for a photo: `width`×`height` is the ORIGINAL image, `rgba` a downscaled copy
 * (`thumbW`×`thumbH`, RGBA bytes) of it. Pure — the canvas work is in checkPhotoQuality.
 */
export function assessPixels(width: number, height: number, rgba: ArrayLike<number>, thumbW: number, thumbH: number): PhotoQuality {
  if (Math.min(width, height) < MIN_SIDE_PX) return 'too_small'
  const gray = grayscale(rgba, thumbW * thumbH)
  const { p5, p95 } = percentiles(gray)
  if (p95 < MIN_BRIGHT_P95 && p95 - p5 < MIN_CONTRAST) return 'too_dark'
  if (laplacianVariance(gray, thumbW, thumbH) < MIN_LAPLACIAN_VARIANCE) return 'blurry'
  return 'ok'
}

/** Draws a 256 px wide copy of the decoded image and judges it. 'ok' when the canvas is unavailable. */
export function checkPhotoQuality(bitmap: { width: number; height: number } & CanvasImageSource): PhotoQuality {
  const w = Math.min(ANALYSIS_WIDTH, bitmap.width)
  const h = Math.max(1, Math.round(bitmap.height * (w / bitmap.width)))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return Math.min(bitmap.width, bitmap.height) < MIN_SIDE_PX ? 'too_small' : 'ok'
  ctx.drawImage(bitmap, 0, 0, w, h)
  return assessPixels(bitmap.width, bitmap.height, ctx.getImageData(0, 0, w, h).data, w, h)
}

/**
 * The file ready to upload: checked (throws PhotoQualityError for a photo that cannot work) and,
 * when too big, a JPEG scaled down to MAX_SIDE. If the browser cannot decode the file the checks
 * are skipped and the file goes as it is — the server and the AI still judge it.
 */
export async function preparePhoto(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  try {
    const quality = checkPhotoQuality(bitmap)
    if (quality !== 'ok') throw new PhotoQualityError(quality)
    if (file.size <= SHRINK_ABOVE) return file
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85))
    return blob && blob.size < file.size ? blob : file
  } finally {
    bitmap.close?.()
  }
}
