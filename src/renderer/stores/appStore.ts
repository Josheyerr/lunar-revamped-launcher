import { create } from 'zustand'
import type { AppSnapshot, ConsoleLine, DownloadProgress, MicrosoftLoginState } from '@shared/types'

interface Toast {
  id: number
  text: string
}

export type AppPage = 'play' | 'instances' | 'mods' | 'servers' | 'skins' | 'settings' | 'console'

interface AppState {
  snap: AppSnapshot | null
  page: AppPage
  loading: boolean
  toasts: Toast[]
  progress: DownloadProgress | null
  login: MicrosoftLoginState | null
  consoleLines: ConsoleLine[]
  setPage: (page: AppPage) => void
  toast: (text: string) => void
  refresh: () => Promise<void>
  pushConsole: (line: ConsoleLine) => void
}

let toastId = 1

export const useApp = create<AppState>((set, get) => ({
  snap: null,
  page: 'play',
  loading: true,
  toasts: [],
  progress: null,
  login: null,
  consoleLines: [],
  setPage: (page) => set({ page }),
  toast: (text) => {
    const id = toastId++
    set({ toasts: [...get().toasts, { id, text }] })
    setTimeout(() => set({ toasts: get().toasts.filter((item) => item.id !== id) }), 3200)
  },
  refresh: async () => {
    const snap = await window.lunar.snapshot()
    document.documentElement.dataset.theme = snap.settings.theme
    document.documentElement.style.setProperty('--accent', snap.settings.accent)
    set({ snap, loading: false })
  },
  pushConsole: (line) => set({ consoleLines: [...get().consoleLines.slice(-400), line] })
}))
