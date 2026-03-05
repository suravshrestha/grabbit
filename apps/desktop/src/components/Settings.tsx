interface SettingsProps {
  outputDir: string
  onOutputDirChange: (value: string) => void
}

export function Settings({ outputDir, onOutputDirChange }: SettingsProps): JSX.Element {
  return (
    <section>
      <h2>Settings</h2>
      <label style={{ display: 'grid', gap: 4 }}>
        Output Directory
        <input value={outputDir} onChange={(event) => onOutputDirChange(event.target.value)} />
      </label>
    </section>
  )
}
