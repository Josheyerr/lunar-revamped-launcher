import { motion } from 'framer-motion'
import { useState } from 'react'
import { useApp } from '../stores/appStore'

function formatBytes(value: number): string {
  if (value > 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`
  if (value > 1024) return `${(value / 1024).toFixed(0)} KB/s`
  return `${value.toFixed(0)} B/s`
}

export function PlayPage() {
  const snap = useApp((s) => s.snap)
  const progress = useApp((s) => s.progress)
  const login = useApp((s) => s.login)
  const toast = useApp((s) => s.toast)
  const refresh = useApp((s) => s.refresh)
  const setPage = useApp((s) => s.setPage)
  const [offline, setOffline] = useState('')
  if (!snap) return <div className="skel h-40 rounded-2xl" />
  const account = snap.accounts.find((item) => item.id === snap.activeAccountId)
  const play = async () => {
    try {
      await window.lunar.startGame()
      toast('Game starting')
      if (snap.settings.showConsole) setPage('console')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Launch failed')
    }
  }
  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-3xl p-8">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,var(--accent),transparent_42%),radial-gradient(circle_at_80%_0%,#1b2240,transparent_40%)] opacity-80 blur-2xl" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Minecraft 1.8.9</p>
          <h1 className="mt-1 text-3xl font-semibold">Lunar Revamped</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{snap.client.message}</p>
        </div>
        <div className="glass flex items-center gap-3 rounded-2xl px-3 py-2">
          {account ? (
            <img
              alt=""
              className="h-10 w-10 rounded-full"
              src={`https://mc-heads.net/avatar/${account.uuid}/64`}
            />
          ) : (
            <div className="h-10 w-10 rounded-full bg-white/10" />
          )}
          <div>
            <div className="text-sm font-medium">{account?.username ?? 'No account'}</div>
            <div className="text-xs text-[var(--muted)]">{account?.kind ?? 'add one below'}</div>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => void play()}
          disabled={snap.launch.running}
          className="h-20 w-64 rounded-full text-lg font-semibold text-white shadow-lg disabled:opacity-60"
          style={{ background: 'var(--accent)' }}
        >
          {snap.launch.running ? 'Running' : 'PLAY'}
        </motion.button>
        {progress ? (
          <div className="w-80 text-center text-xs text-[var(--muted)]">
            {progress.label} · {formatBytes(progress.speedBps)} · ETA {Math.ceil(progress.etaSeconds)}s
            <div className="mt-1 h-1 overflow-hidden rounded bg-white/10">
              <div
                className="h-full"
                style={{
                  width: `${progress.overallTotal ? (progress.overallReceived / progress.overallTotal) * 100 : 0}%`,
                  background: 'var(--accent)'
                }}
              />
            </div>
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            className="rounded-full border border-white/15 px-4 py-1 text-sm"
            onClick={() =>
              void window.lunar.installClient().then(() => refresh()).catch((error: unknown) => toast(error instanceof Error ? error.message : 'Download failed'))
            }
          >
            {snap.client.kind === 'update' ? 'Update client' : 'Download client'}
          </button>
          <button className="rounded-full border border-white/15 px-4 py-1 text-sm" onClick={() => void window.lunar.rollbackClient().then(() => refresh()).catch((e: unknown) => toast(e instanceof Error ? e.message : 'Rollback failed'))}>
            Rollback
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <article className="glass rounded-2xl p-4">
          <h2 className="text-sm font-semibold">Changelog</h2>
          <p className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-xs text-[var(--muted)]">
            {snap.news[0]?.body || snap.client.changelog || 'No release notes yet.'}
          </p>
        </article>
        <article className="glass rounded-2xl p-4">
          <h2 className="text-sm font-semibold">Account</h2>
          {login?.state === 'waiting' ? (
            <p className="mt-2 text-sm">
              Code <span className="font-semibold">{login.code}</span> at {login.url}
            </p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button
              className="rounded-lg px-3 py-1 text-sm text-white"
              style={{ background: 'var(--accent)' }}
              onClick={() => void window.lunar.startMicrosoft()}
            >
              Microsoft
            </button>
            <input
              className="w-28 rounded-lg border border-white/10 bg-transparent px-2 text-sm"
              placeholder="offline name"
              value={offline}
              onChange={(event) => setOffline(event.target.value)}
            />
            <button
              className="rounded-lg border border-white/15 px-2 text-sm"
              onClick={() =>
                void window.lunar
                  .addOffline(offline)
                  .then(() => refresh())
                  .catch((error: unknown) => toast(error instanceof Error ? error.message : 'Could not add account'))
              }
            >
              Add
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {snap.accounts.map((item) => (
              <button key={item.id} className="rounded-full bg-white/5 px-2 py-1 text-xs" onClick={() => void window.lunar.selectAccount(item.id).then(() => refresh())}>
                {item.username}
              </button>
            ))}
          </div>
        </article>
      </div>
    </div>
  )
}
