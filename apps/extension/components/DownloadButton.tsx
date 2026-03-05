interface DownloadButtonProps {
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}

export function DownloadButton({ disabled, loading, onClick }: DownloadButtonProps): JSX.Element {
  return (
    <button disabled={disabled || loading} onClick={onClick}>
      {loading ? 'Downloading...' : 'Download'}
    </button>
  )
}
