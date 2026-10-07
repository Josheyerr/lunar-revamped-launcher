export function TitleBar() {
  return (
    <header className="flex h-10 items-center justify-between pl-4 pr-2" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <span className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">LUNAR REVAMPED</span>
      <div className="flex" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {(['minimize', 'maximize', 'close'] as const).map((action) => (
          <button
            key={action}
            className="h-8 w-10 text-sm text-[var(--muted)] hover:bg-white/10"
            onClick={() => void window.lunar.windowAction(action)}
          >
            {action === 'minimize' ? '–' : action === 'maximize' ? '□' : '×'}
          </button>
        ))}
      </div>
    </header>
  )
}
