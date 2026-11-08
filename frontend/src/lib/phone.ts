// The phone field: Uzbekistan numbers, +998 XX XXX XX XX. The input is formatted as the user types;
// the server gets the plain +998XXXXXXXXX (it validates and normalizes again).

const COUNTRY = '998'
const GROUPS = [2, 3, 2, 2] // 9 digits after +998

/** Formats what is in the field: "901234567" → "+998 90 123 45 67". Digits, spaces, dashes and a leading + are all fine. */
export function formatPhoneInput(raw: string): string {
  const hasPlus = raw.trim().startsWith('+')
  const digits = raw.replace(/\D/g, '')
  if (!digits) return hasPlus ? '+' : ''
  let local: string
  if (digits.startsWith(COUNTRY)) local = digits.slice(COUNTRY.length)
  else if (hasPlus && COUNTRY.startsWith(digits)) return `+${digits}` // still typing the country code
  else local = digits
  local = local.slice(0, 9)
  if (!local) return `+${COUNTRY}`
  const parts: string[] = []
  for (let i = 0, g = 0; i < local.length; i += GROUPS[g++]) parts.push(local.slice(i, i + GROUPS[g]))
  return `+${COUNTRY} ${parts.join(' ')}`
}

/** What goes to the server: "+998 90 123 45 67" → "+998901234567"; a field with no number in it → "". */
export function phoneForApi(display: string): string {
  const formatted = formatPhoneInput(display)
  return formatted.length > '+998'.length + 1 ? formatted.replace(/\s/g, '') : ''
}
