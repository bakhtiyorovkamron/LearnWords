// Downscales an image file to at most `max` px on the longest side and re-encodes it as JPEG,
// so uploads stay small (photos are stored inline).
export async function resizeImage(file: File, max = 1280, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('Выберите файл изображения')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob) throw new Error('Не удалось обработать изображение')
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' })
}
