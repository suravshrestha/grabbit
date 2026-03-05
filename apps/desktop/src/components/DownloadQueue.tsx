import type { DownloadJob } from '@grabbit/shared-types'
import { QueueItem } from '@/components/QueueItem'

interface DownloadQueueProps {
  jobs: DownloadJob[]
  onCancel: (jobId: string) => void
}

export function DownloadQueue({ jobs, onCancel }: DownloadQueueProps): JSX.Element {
  return (
    <section>
      <h2>Queue</h2>
      <ul style={{ display: 'grid', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
        {jobs.map((job) => (
          <QueueItem key={job.id} job={job} onCancel={onCancel} />
        ))}
      </ul>
    </section>
  )
}
