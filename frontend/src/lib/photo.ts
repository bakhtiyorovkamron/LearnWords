// Phone photos are often bigger than the server accepts (5 MB): such a photo is shrunk first.
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const SHRINK_ABOVE = 4 * 1024 * 1024
const MAX_SIDE = 2400

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const isPhotoType = (type: string) => TYPES.includes(type)

/** The file as it is, or — when too big — a JPEG scaled down to MAX_SIDE. Falls back to the file itself. */
export async function preparePhoto(file: Blob): Promise<Blob> {
  if (file.size <= SHRINK_ABOVE) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}
