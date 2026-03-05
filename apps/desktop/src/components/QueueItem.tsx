import type { DownloadJob } from '@grabbit/shared-types'

interface QueueItemProps {
  job: DownloadJob
  onCancel: (jobId: string) => void
}

export function QueueItem({ job, onCancel }: QueueItemProps): JSX.Element {
  return (
    <li style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>{job.request.videoId}</strong>
        <span>{job.status}</span>
      </div>
      <div style={{ marginTop: 6, height: 6, borderRadius: 99, background: '#e5e7eb' }}>
        <div
          style={{
            height: '100%',
            width: `${job.progress}%`,
            borderRadius: 99,
            background: '#16a34a',
          }}
        />
      </div>
      {job.error && <small style={{ color: '#dc2626' }}>{job.error}</small>}
      {job.status === 'downloading' && (
        <button style={{ marginTop: 8 }} onClick={() => onCancel(job.id)}>
          Cancel
        </button>
      )}
    </li>
  )
}
