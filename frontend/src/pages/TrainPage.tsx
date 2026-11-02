import { ReviewSession } from '../components/ReviewSession'

/** /train?size=N&folder=<id|none> — the training session. */
export function TrainPage() {
  return (
    <div className="space-y-4 md:space-y-6">
      <ReviewSession />
    </div>
  )
}
