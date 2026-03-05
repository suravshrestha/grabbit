interface ProgressBarProps {
  value: number
}

export function ProgressBar({ value }: ProgressBarProps): JSX.Element {
  const safeValue = Math.max(0, Math.min(100, value))
  return (
    <div className="grabbit-progress">
      <div className="grabbit-progress-inner" style={{ width: `${safeValue}%` }} />
    </div>
  )
}
