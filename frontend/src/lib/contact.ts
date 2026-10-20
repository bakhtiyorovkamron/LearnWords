// Where users can reach us (problem reports, questions). An empty value hides that channel.
export const CONTACT = {
  instagram: 'https://instagram.com/yodla.fun',
  instagramHandle: '@yodla.fun',
  telegram: '', // e.g. 'https://t.me/yodla_fun'; empty = hidden
}

/** Every external link opens in a new tab and must not get access to window.opener. */
export const EXTERNAL_LINK = { target: '_blank', rel: 'noopener noreferrer' } as const
