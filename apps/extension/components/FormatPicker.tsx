import type { DownloadFormat } from '@grabbit/shared-types'

interface FormatPickerProps {
  value: DownloadFormat
  onChange: (format: DownloadFormat) => void
}

export function FormatPicker({ value, onChange }: FormatPickerProps): JSX.Element {
  return (
    <label>
      Format
      <select value={value} onChange={(event) => onChange(event.target.value as DownloadFormat)}>
        <option value="mp4">MP4 Video</option>
        <option value="mp3">MP3 Audio</option>
        <option value="srt">Subtitles (SRT)</option>
        <option value="vtt">Subtitles (VTT)</option>
      </select>
    </label>
  )
}
