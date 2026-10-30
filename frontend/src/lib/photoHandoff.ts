// A photo chosen on the Home page is read on the Add page: this slot carries the file across the
// navigation (a File cannot go through the URL). In memory only; the file comes out once.
let slot: File | null = null

export function handOffPhoto(file: File): void {
  slot = file
}

/** The handed-off photo, or null. Taking it empties the slot, so a photo is read exactly once. */
export function takeHandedOffPhoto(): File | null {
  const file = slot
  slot = null
  return file
}
