import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import type { JavaRuntime } from '../../shared/types'
import { folders } from '../paths'
import { downloadFile } from './download'

const execFileAsync = promisify(execFile)

export function memoryMb(): { totalMb: number; freeMb: number } {
  return {
    totalMb: Math.round(os.totalmem() / (1024 * 1024)),
    freeMb: Math.round(os.freemem() / (1024 * 1024))
  }
}

async function describe(javaPath: string, source: JavaRuntime['source']): Promise<JavaRuntime | null> {
  if (!javaPath || !fs.existsSync(javaPath)) return null
  try {
    const { stderr, stdout } = await execFileAsync(javaPath, ['-version'], { windowsHide: true })
    const text = `${stderr}\n${stdout}`
    const version = /version "([^"]+)"/.exec(text)?.[1] ?? 'unknown'
    const majorMatch = /version "1\.(\d+)/.exec(text) ?? /version "(\d+)/.exec(text)
    const major = majorMatch ? Number(majorMatch[1]) : 0
    const arch = /64-Bit/.test(text) ? 'x64' : os.arch()
    return { path: javaPath, version, major: version.startsWith('1.') ? major : Number(version.split('.')[0] ?? major), arch, source }
  } catch {
    return null
  }
}

function candidates(): string[] {
  const found: string[] = []
  const push = (file: string) => {
    if (file && fs.existsSync(file)) found.push(file)
  }
  if (process.env.JAVA_HOME) push(path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
  const roots = [
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Zulu',
    'C:\\Program Files\\Microsoft',
    '/Library/Java/JavaVirtualMachines',
    '/usr/lib/jvm',
    path.join(os.homedir(), '.sdkman', 'candidates', 'java')
  ]
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root)) {
      const base = path.join(root, entry)
      push(path.join(base, 'bin', 'java.exe'))
      push(path.join(base, 'bin', 'java'))
      push(path.join(base, 'Contents', 'Home', 'bin', 'java'))
    }
  }
  const bundled = path.join(folders.runtimes(), 'temurin-21', 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  push(bundled)
  return [...new Set(found)]
}

export async function listJava(): Promise<JavaRuntime[]> {
  const runtimes: JavaRuntime[] = []
  for (const file of candidates()) {
    const source: JavaRuntime['source'] = file.includes(`${path.sep}runtimes${path.sep}`) ? 'bundled' : 'detected'
    const info = await describe(file, source)
    if (info && info.major >= 8) runtimes.push(info)
  }
  return runtimes
}

export async function testJava(javaPath: string): Promise<JavaRuntime> {
  const info = await describe(javaPath, 'custom')
  if (!info) throw new Error('Could not run that Java executable.')
  if (info.major < 8) throw new Error(`Java ${info.version} is too old. Lunar Revamped needs 8 or newer.`)
  return info
}

export async function ensureJava(preferred: string): Promise<JavaRuntime> {
  if (preferred) {
    const custom = await describe(preferred, 'custom')
    if (custom && custom.major >= 8) return custom
  }
  const found = await listJava()
  const best = found.sort((a, b) => b.major - a.major)[0]
  if (best) return best
  return downloadTemurin21()
}

async function downloadTemurin21(): Promise<JavaRuntime> {
  const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
  const api = `https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=${arch}&image_type=jre&os=${osName}&vendor=eclipse`
  const response = await fetch(api, { headers: { 'User-Agent': 'LunarRevampedLauncher' } })
  if (!response.ok) throw new Error('Could not reach Adoptium to download Java 21.')
  const assets = (await response.json()) as {
    binary?: { package?: { link?: string; name?: string } }
  }[]
  const link = assets[0]?.binary?.package?.link
  const name = assets[0]?.binary?.package?.name
  if (!link || !name) throw new Error('Adoptium did not return a Java 21 download.')
  const archive = path.join(folders.cache(), name)
  await downloadFile(link, archive, { label: 'Java 21 (Temurin)' })
  const dest = path.join(folders.runtimes(), 'temurin-21')
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  if (name.endsWith('.zip')) {
    const zip = new AdmZip(archive)
    zip.extractAllTo(folders.runtimes(), true)
    const extracted = fs.readdirSync(folders.runtimes()).find((entry) => entry.startsWith('jdk-') || entry.startsWith('jre-'))
    if (extracted && extracted !== 'temurin-21') {
      fs.renameSync(path.join(folders.runtimes(), extracted), dest)
    }
  } else {
    throw new Error('Downloaded Java is not a zip. Install Temurin 21 manually and pick it in Settings.')
  }
  const javaPath = path.join(dest, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  const info = await describe(javaPath, 'bundled')
  if (!info) throw new Error('Java downloaded but could not be executed.')
  return info
}
