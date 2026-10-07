import { safeStorage } from 'electron'
import fs from 'node:fs'
import Store from 'electron-store'
import { DEFAULT_ACCENT } from '../shared/jvm'
import type { Account, Instance, LaunchSettings } from '../shared/types'
import { folders } from './paths'

export interface Persisted {
  accounts: Account[]
  activeAccountId: string
  instances: Instance[]
  activeInstanceId: string
  settings: LaunchSettings
  installedClientVersion: string
  previousClientVersion: string
}

const REMOTE_RUNTIME = 'F:\\Projects\\LunarClientremake-main'

export function defaultSettings(): LaunchSettings {
  const dev = process.env.LUNAR_REVAMPED_RUNTIME || (fs.existsSync(REMOTE_RUNTIME) ? REMOTE_RUNTIME : '')
  return {
    minRamMb: 512,
    maxRamMb: 2048,
    jvmArgs: '',
    jvmPreset: 'default',
    gameArgs: '',
    width: 1280,
    height: 720,
    fullscreen: false,
    borderless: false,
    rememberSize: true,
    gameDir: '',
    env: [],
    preLaunch: '',
    postExit: '',
    wrapper: '',
    closeOnLaunch: false,
    showConsole: true,
    keepOpen: true,
    onLaunch: 'stay',
    javaPath: '',
    theme: 'dark',
    accent: DEFAULT_ACCENT,
    devRuntime: dev
  }
}

function canCrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function seal(value: string): string {
  if (!value) return ''
  if (!canCrypt()) return `plain:${Buffer.from(value, 'utf8').toString('base64')}`
  return `enc:${safeStorage.encryptString(value).toString('base64')}`
}

function open(value: string | undefined): string {
  if (!value) return ''
  if (value.startsWith('enc:')) {
    return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
  }
  if (value.startsWith('plain:')) {
    return Buffer.from(value.slice(6), 'base64').toString('utf8')
  }
  return value
}

interface DiskAccount extends Omit<Account, 'accessToken' | 'refreshToken'> {
  accessToken: string
  refreshToken?: string
}

function defaultData(): Persisted {
  const id = 'default'
  const settings = defaultSettings()
  return {
    accounts: [],
    activeAccountId: '',
    instances: [
      {
        id,
        name: 'Lunar Revamped',
        minecraftVersion: '1.8.9',
        createdAt: new Date().toISOString(),
        settings: {}
      }
    ],
    activeInstanceId: id,
    settings,
    installedClientVersion: '',
    previousClientVersion: ''
  }
}

let cache: Persisted | null = null
let disk: Store<Persisted> | null = null

function db(): Store<Persisted> {
  if (!disk) {
    disk = new Store<Persisted>({
      cwd: folders.root(),
      name: 'settings',
      defaults: defaultData()
    })
  }
  return disk
}

export function loadStore(): Persisted {
  if (cache) return cache
  const raw = structuredClone(db().store)
  raw.accounts = (raw.accounts as DiskAccount[]).map((account) => ({
    ...account,
    accessToken: open(account.accessToken),
    refreshToken: open(account.refreshToken)
  }))
  raw.settings = { ...defaultSettings(), ...raw.settings }
  cache = raw
  return raw
}

export function saveStore(): void {
  if (!cache) return
  const sealed: Persisted = {
    ...cache,
    accounts: cache.accounts.map((account) => ({
      ...account,
      accessToken: seal(account.accessToken),
      refreshToken: account.refreshToken ? seal(account.refreshToken) : ''
    }))
  }
  db().store = sealed
}

export function updateStore(mutator: (data: Persisted) => void): Persisted {
  const data = loadStore()
  mutator(data)
  saveStore()
  return data
}
