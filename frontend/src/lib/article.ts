export type Article = 'der' | 'die' | 'das'

/** Text colour class of each article (theme tokens: readable on every theme). */
export const ARTICLE_COLOR: Record<Article, string> = { der: 'text-der', die: 'text-die', das: 'text-das' }

const LEADING = /^(der|die|das)\s+/i

/**
 * A word split into its German article and the rest. The article is the card's own `article` when it
 * is der/die/das, otherwise a leading "der "/"die "/"das " of the word (any case). No article → null
 * and the whole word as the rest. A leading article of the word itself is not repeated.
 */
export function splitArticle(word: string, article?: string | null): { article: Article | null; rest: string } {
  const text = word.trim()
  const own = article?.trim().toLowerCase()
  const lead = LEADING.exec(text)
  const found = (own === 'der' || own === 'die' || own === 'das' ? own : lead?.[1].toLowerCase()) as Article | undefined
  if (!found) return { article: null, rest: text }
  return { article: found, rest: lead ? text.slice(lead[0].length) : text }
}
