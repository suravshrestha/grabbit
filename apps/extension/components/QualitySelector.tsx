interface QualitySelectorProps {
  value: '720p' | '1080p' | '4k' | 'best'
  onChange: (quality: '720p' | '1080p' | '4k' | 'best') => void
}

export function QualitySelector({ value, onChange }: QualitySelectorProps): JSX.Element {
  return (
    <div className="grid gap-2">
      <label className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
        Quality
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as '720p' | '1080p' | '4k' | 'best')}
        className="styled-select border-input bg-card shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-2 text-sm outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
      >
        <option value="720p">720p</option>
        <option value="1080p">1080p</option>
        <option value="4k">4K</option>
        <option value="best">Best Available</option>
      </select>
    </div>
  )
}
