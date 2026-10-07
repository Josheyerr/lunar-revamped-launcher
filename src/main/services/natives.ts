import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'

function tags(): string[] {
  if (process.platform === 'win32') return ['windows', 'win']
  if (process.platform === 'darwin') return ['macos', 'osx', 'darwin', 'mac']
  return ['linux']
}

export function extractNatives(runtime: string, outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true })
  const nativesDir = path.join(runtime, 'libs', 'natives')
  const wanted = tags()
  const marker = process.platform === 'win32' ? 'lwjgl64.dll' : process.platform === 'darwin' ? 'liblwjgl.dylib' : 'liblwjgl64.so'
  if (fs.existsSync(path.join(outDir, marker))) return
  if (!fs.existsSync(nativesDir)) {
    throw new Error('No natives folder in the client runtime.')
  }
  const zips = fs.readdirSync(nativesDir).filter((name) => name.endsWith('.zip') && wanted.some((tag) => name.toLowerCase().includes(tag)))
  if (zips.length === 0) throw new Error('No native zips for this operating system.')
  for (const name of zips) {
    const zip = new AdmZip(path.join(nativesDir, name))
    zip.extractAllTo(outDir, true)
  }
  const resources = path.join(nativesDir, 'resources')
  if (fs.existsSync(resources)) {
    for (const file of fs.readdirSync(resources)) {
      const from = path.join(resources, file)
      if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(outDir, file))
    }
  }
  if (!fs.existsSync(path.join(outDir, marker)) && process.platform === 'win32') {
    const nested = findFile(outDir, marker)
    if (nested) fs.copyFileSync(nested, path.join(outDir, marker))
  }
  if (process.platform === 'win32' && !fs.existsSync(path.join(outDir, 'lwjgl64.dll'))) {
    throw new Error('natives dir missing lwjgl64.dll after extract.')
  }
}

function findFile(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findFile(full, name)
      if (found) return found
    } else if (entry.name === name) return full
  }
  return null
}
