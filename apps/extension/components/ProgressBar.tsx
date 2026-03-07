import { Progress } from '@/components/ui/progress'

interface ProgressBarProps {
  progress: number
}

export function ProgressBar({ progress }: ProgressBarProps): JSX.Element {
  const safe = Math.min(100, Math.max(0, progress))

  return (
    <div className="grid gap-1.5" role="status" aria-live="polite">
      <Progress value={safe} />
      <p className="text-muted-foreground text-right text-xs tabular-nums">{safe.toFixed(1)}%</p>
    </div>
  )
}
