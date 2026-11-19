import { useSearchParams } from 'react-router-dom'
import { ReviewSession } from '../components/ReviewSession'

/** /train?size=N&folder=<id|none> — the training session; /train?mode=practice[&folder=] — free practice. */
export function TrainPage() {
  const [params] = useSearchParams()
  // A fresh session when the link switches between review and practice.
  const mode = params.get('mode') === 'practice' ? 'practice' : 'review'
  return (
    <div className="space-y-4 md:space-y-6">
      <ReviewSession key={mode} />
    </div>
  )
}
