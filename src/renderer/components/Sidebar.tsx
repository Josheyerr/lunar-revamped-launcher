import type { AppPage } from '../stores/appStore'

const items = [
  ['play', 'Play'],
  ['instances', 'Instances'],
  ['mods', 'Mods'],
  ['servers', 'Servers'],
  ['skins', 'Skins'],
  ['settings', 'Settings'],
  ['console', 'Console']
] as const

export function Sidebar(props: { page: AppPage; onChange: (page: AppPage) => void }) {
  return (
    <nav className="flex w-44 flex-col gap-1 p-3">
      {items.map(([id, label]) => (
        <button
          key={id}
          onClick={() => props.onChange(id)}
          className={`rounded-xl px-3 py-2 text-left text-sm ${props.page === id ? 'text-white' : 'text-[var(--muted)] hover:bg-white/5'}`}
          style={props.page === id ? { background: 'var(--accent)' } : undefined}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}
