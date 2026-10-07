import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IpcChannel } from '../../shared/ipc'
import type { UpdaterPhase, UpdaterState } from '../../shared/types'
import { GITHUB_OWNER, LAUNCHER_REPO } from '../../shared/manifest'
import { emit } from '../bus'
import { markQuitting } from '../window'

const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${LAUNCHER_REPO}/releases/latest`
const INSTALLER_URL = `https://github.com/${GITHUB_OWNER}/${LAUNCHER_REPO}/releases/latest/download/LunarRevampedSetup.exe`

let seq = 0
let sessionManual = false
let configured = false
let installQueued = false
let inflight: Promise<UpdaterState> | null = null

let state: UpdaterState = {
  status: '',
  version: '0.0.0',
  phase: 'idle',
  latestVersion: '',
  percent: 0,
  packaged: false,
  seq: 0,
  notify: false
}

export function updaterState(): UpdaterState {
  state = { ...state, version: app.getVersion(), packaged: app.isPackaged }
  return state
}

export function checkLauncherUpdate(manual = false): Promise<UpdaterState> {
  if (
    state.phase === 'downloading' ||
    state.phase === 'downloaded' ||
    state.phase === 'installing'
  ) {
    if (!manual) return Promise.resolve(updaterState())
    return Promise.resolve(
      publish(state.phase, {
        latestVersion: state.latestVersion,
        percent: state.percent,
        forceNotify: true
      })
    )
  }
  if (inflight) {
    if (manual) sessionManual = true
    return inflight.then((result) => {
      if (!manual || result.notify) return updaterState()
      return publish(result.phase, {
        latestVersion: result.latestVersion,
        percent: result.percent,
        error: result.phase === 'error' ? result.status : undefined,
        forceNotify: true
      })
    })
  }
  sessionManual = manual
  inflight = runCheck().finally(() => {
    inflight = null
  })
  return inflight
}

export async function openUpdateDownload(): Promise<void> {
  await shell.openExternal(INSTALLER_URL)
}

async function runCheck(): Promise<UpdaterState> {
  publish('checking', { percent: 0 })
  if (!app.isPackaged) return checkGithubRelease()
  return checkPackagedRelease()
}

async function checkGithubRelease(): Promise<UpdaterState> {
  try {
    const latest = await fetchLatestVersion()
    if (compareVersions(latest, app.getVersion()) > 0) {
      return publish('available', { latestVersion: latest, percent: 0 })
    }
    return publish('current', { latestVersion: latest, percent: 0 })
  } catch (error) {
    return publish('error', { error: errorMessage(error), percent: 0 })
  }
}

async function checkPackagedRelease(): Promise<UpdaterState> {
  configureAutoUpdater()
  try {
    await autoUpdater.checkForUpdates()
    return updaterState()
  } catch (error) {
    if (state.phase === 'error') return updaterState()
    return publish('error', { error: errorMessage(error), percent: 0 })
  }
}

function configureAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  if (configured) return
  configured = true
  autoUpdater.setFeedURL({ provider: 'github', owner: GITHUB_OWNER, repo: LAUNCHER_REPO })
  autoUpdater.on('checking-for-update', () => {
    publish('checking', { percent: 0 })
  })
  autoUpdater.on('update-available', (info) => {
    publish('available', { latestVersion: info.version, percent: 0 })
  })
  autoUpdater.on('update-not-available', (info) => {
    publish('current', { latestVersion: info.version, percent: 0 })
  })
  autoUpdater.on('download-progress', (progress) => {
    const raw = Number.isFinite(progress.percent) ? progress.percent : 0
    publish('downloading', {
      latestVersion: state.latestVersion,
      percent: Math.max(0, Math.min(100, Math.round(raw)))
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    publish('downloaded', { latestVersion: info.version, percent: 100 })
    queueInstall()
  })
  autoUpdater.on('update-cancelled', (info) => {
    publish('error', { latestVersion: info.version, error: 'Update download was cancelled.', percent: 0 })
  })
  autoUpdater.on('error', (error) => {
    publish('error', { error: errorMessage(error), percent: state.percent })
  })
}

function queueInstall(): void {
  if (installQueued || !app.isPackaged) return
  installQueued = true
  setTimeout(() => {
    publish('installing', { latestVersion: state.latestVersion, percent: 100 })
    setTimeout(() => {
      markQuitting()
      autoUpdater.quitAndInstall(false, true)
    }, 700)
  }, 1200)
}

interface PublishExtra {
  latestVersion?: string
  percent?: number
  error?: string
  forceNotify?: boolean
}

function publish(phase: UpdaterPhase, extra: PublishExtra = {}): UpdaterState {
  const previous = state.phase
  const latestVersion = extra.latestVersion ?? state.latestVersion
  const percent = extra.percent ?? 0
  const notify = extra.forceNotify ?? shouldNotify(phase, sessionManual, previous)
  seq += 1
  state = {
    status: describe(phase, latestVersion, percent, extra.error ?? ''),
    version: app.getVersion(),
    phase,
    latestVersion,
    percent,
    packaged: app.isPackaged,
    seq,
    notify
  }
  emit(IpcChannel.updater, state)
  return state
}

function describe(phase: UpdaterPhase, latest: string, percent: number, error: string): string {
  switch (phase) {
    case 'idle':
      return ''
    case 'checking':
      return 'Checking for updates…'
    case 'current':
      return 'Up to date'
    case 'available':
      if (!latest) return 'Update check failed'
      if (app.isPackaged) return `Update ${latest} is available`
      return `Update ${latest} is available. Dev build cannot install, open the download.`
    case 'downloading':
      return `Downloading ${latest} (${percent}%)`
    case 'downloaded':
      return `Downloaded ${latest}. Installing…`
    case 'installing':
      return `Installing ${latest}…`
    case 'error':
      return error || 'Update check failed'
    default: {
      const unknown: never = phase
      return unknown
    }
  }
}

function shouldNotify(phase: UpdaterPhase, manual: boolean, previous: UpdaterPhase): boolean {
  switch (phase) {
    case 'idle':
    case 'checking':
      return false
    case 'current':
      return manual
    case 'available':
      return !app.isPackaged
    case 'downloaded':
    case 'installing':
    case 'error':
      return true
    case 'downloading':
      return previous !== 'downloading'
    default: {
      const unknown: never = phase
      return unknown
    }
  }
}

interface GithubReleaseBody {
  tag_name?: unknown
}

async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `LunarRevampedLauncher/${app.getVersion()}`
    },
    signal: AbortSignal.timeout(20000)
  })
  if (response.status === 404) throw new Error('No launcher release published.')
  if (response.status === 403) throw new Error('GitHub rate limit reached. Try again later.')
  if (!response.ok) throw new Error(`Update check failed (${response.status}).`)
  const body = (await response.json()) as GithubReleaseBody
  const tag = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/i, '').trim() : ''
  if (!tag) throw new Error('No launcher release published.')
  return tag
}

function versionParts(value: string): number[] {
  const core = value.trim().replace(/^v/i, '').split('-')[0] ?? ''
  return core.split('.').map((part) => {
    const match = /^(\d+)/.exec(part)
    return match ? Number(match[1]) : 0
  })
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left)
  const b = versionParts(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? 0
    const bv = b[index] ?? 0
    if (av > bv) return 1
    if (av < bv) return -1
  }
  return 0
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Update check failed'
  const text = raw.replace(/\s+/g, ' ').trim()
  if (/timed out|TimeoutError|AbortError/i.test(text)) return 'Update check timed out.'
  if (/fetch failed|ENOTFOUND|ECONNRESET|EAI_AGAIN|network/i.test(text)) {
    return 'Could not reach GitHub to check for updates.'
  }
  if (!text) return 'Update check failed'
  return text.length > 180 ? `${text.slice(0, 177)}…` : text
}
