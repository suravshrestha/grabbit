import type { DownloadFormat } from '@grabbit/shared-types'

interface FormatPickerProps {
  value: DownloadFormat
  onChange: (format: DownloadFormat) => void
  disabled?: boolean
}

export function FormatPicker({ value, onChange, disabled }: FormatPickerProps): JSX.Element {
  return (
    <div className="grid gap-2">
      <label className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
        Format
      </label>
      <select
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value as DownloadFormat)}
        className="styled-select border-input bg-card shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-2 text-sm outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="mp4">MP4 Video</option>
        <option value="mp3">MP3 Audio</option>
        <option value="srt">Subtitles (SRT)</option>
        <option value="vtt">Subtitles (VTT)</option>
      </select>
    </div>
  )
}
