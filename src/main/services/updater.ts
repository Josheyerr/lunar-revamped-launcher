import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { GITHUB_OWNER, LAUNCHER_REPO } from '../../shared/manifest'

export interface UpdaterState {
  status: string
  version: string
}

let state: UpdaterState = { status: 'idle', version: '0.0.0' }

export function updaterState(): UpdaterState {
  state.version = app.getVersion()
  return state
}

export async function checkLauncherUpdate(): Promise<UpdaterState> {
  state.version = app.getVersion()
  if (!app.isPackaged) {
    state = { status: 'dev build', version: app.getVersion() }
    return state
  }
  try {
    autoUpdater.autoDownload = true
    autoUpdater.setFeedURL({ provider: 'github', owner: GITHUB_OWNER, repo: LAUNCHER_REPO })
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo.version ?? app.getVersion()
    state = { status: result?.updateInfo.version ? `update ${version}` : 'up to date', version }
  } catch (error) {
    state = { status: error instanceof Error ? error.message : 'update check failed', version: app.getVersion() }
  }
  return state
}
