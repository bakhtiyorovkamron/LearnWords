/** The sentence with its "___" turned into a blank — or, after the answer, the answer in the blank. */
export function GapSentence({ sentence, answered, answer }: { sentence: string; answered: boolean; answer: string }) {
  const at = sentence.indexOf('___')
  if (at < 0) return <>{sentence}</>
  const blank = answered ? (
    <span data-testid="gap-answer" className="text-accent-text underline decoration-accent underline-offset-4">{answer}</span>
  ) : (
    <span data-testid="gap-blank" aria-hidden="true" className="inline-block min-w-[4ch] border-b-2 border-faint">&nbsp;</span>
  )
  return <>{sentence.slice(0, at)}{blank}{sentence.slice(at + 3)}</>
}
