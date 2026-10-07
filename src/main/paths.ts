import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export function appDataRoot(): string {
  const root = path.join(app.getPath('appData'), '.lunar-revamped')
  fs.mkdirSync(root, { recursive: true })
  return root
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const folders = {
  root: () => appDataRoot(),
  instances: () => ensureDir(path.join(appDataRoot(), 'instances')),
  runtimes: () => ensureDir(path.join(appDataRoot(), 'runtimes')),
  libraries: () => ensureDir(path.join(appDataRoot(), 'libraries')),
  assets: () => ensureDir(path.join(appDataRoot(), 'assets')),
  versions: () => ensureDir(path.join(appDataRoot(), 'versions')),
  logs: () => ensureDir(path.join(appDataRoot(), 'logs')),
  cache: () => ensureDir(path.join(appDataRoot(), 'cache')),
  accounts: () => ensureDir(path.join(appDataRoot(), 'accounts'))
}

export function instanceRoot(id: string): string {
  return ensureDir(path.join(folders.instances(), id))
}
