import { useState } from 'react'
import { DownloadQueue } from '@/components/DownloadQueue'
import { Settings } from '@/components/Settings'
import { useQueue } from '@/hooks/useQueue'

export function App(): JSX.Element {
  const { jobs, cancel } = useQueue()
  const [outputDir, setOutputDir] = useState('~/Downloads')

  return (
    <main style={{ padding: 16, width: 420, minHeight: 600, boxSizing: 'border-box' }}>
      <h1>Grabbit</h1>
      <p>Desktop download engine is running on localhost:47891.</p>
      <Settings outputDir={outputDir} onOutputDirChange={setOutputDir} />
      <DownloadQueue jobs={jobs} onCancel={(jobId) => void cancel(jobId)} />
    </main>
  )
}
