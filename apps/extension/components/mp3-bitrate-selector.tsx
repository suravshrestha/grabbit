interface Mp3BitrateSelectorProps {
  value: 128 | 192 | 256 | 320
  onChange: (bitrate: 128 | 192 | 256 | 320) => void
  disabled?: boolean
}

export function Mp3BitrateSelector({
  value,
  onChange,
  disabled,
}: Mp3BitrateSelectorProps): JSX.Element {
  return (
    <div className="grid gap-2">
      <label className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
        MP3 Bitrate
      </label>
      <select
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) as 128 | 192 | 256 | 320)}
        className="styled-select border-input bg-card shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-2 text-sm outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="128">128 kbps</option>
        <option value="192">192 kbps</option>
        <option value="256">256 kbps</option>
        <option value="320">320 kbps</option>
      </select>
    </div>
  )
}
