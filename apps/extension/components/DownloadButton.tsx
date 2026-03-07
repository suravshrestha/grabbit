import { LoaderCircle, Rocket } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DownloadButtonProps {
  disabled?: boolean
  loading?: boolean
  idleLabel?: string
  loadingLabel?: string
  onClick: () => void
}

export function DownloadButton({
  disabled,
  loading,
  idleLabel = 'Start Download',
  loadingLabel = 'Adding to Queue...',
  onClick,
}: DownloadButtonProps): JSX.Element {
  return (
    <Button
      className="w-full rounded-lg font-semibold"
      disabled={disabled || loading}
      onClick={onClick}
      size="lg"
    >
      {loading ? (
        <>
          <LoaderCircle className="size-4 animate-spin" />
          {loadingLabel}
        </>
      ) : (
        <>
          <Rocket className="size-4" />
          {idleLabel}
        </>
      )}
    </Button>
  )
}
