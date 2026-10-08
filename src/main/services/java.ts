import { app } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import type { JavaRuntime } from '../../shared/types'
import { bundledPvpJavaPath, folders, GRAAL_RUNTIME_DIR, PVP_JAVA_DIR } from '../paths'
import { updateStore } from '../store'
import { downloadFile } from './download'

const execFileAsync = promisify(execFile)

/** Genesis / lunar modules ship class file 61 (Java 17). Java 8 cannot load them. */
const MIN_JAVA_MAJOR = 17

const KIT_MARKER = 'kit.version'
const KIT_VERSION = '21.0.2-2'

export { bundledPvpJavaPath, GRAAL_RUNTIME_DIR, PVP_JAVA_DIR }

const GRAAL_WIN_URL =
  'https://github.com/graalvm/graalvm-ce-builds/releases/download/jdk-21.0.2/graalvm-community-jdk-21.0.2_windows-x64_bin.zip'
const GRAAL_WIN_SHA256 = 'e17b7bead097bf372a5c75df17815b0a2f30b777a019d25eff7706b21421f7fa'
const GRAAL_WIN_ZIP = 'graalvm-community-jdk-21.0.2_windows-x64_bin.zip'

let installPromise: Promise<JavaRuntime> | null = null
const describeCache = new Map<string, JavaRuntime>()

function javaCacheKey(javaPath: string): string {
  return path.normalize(javaPath)
}

export function memoryMb(): { totalMb: number; freeMb: number } {
  return {
    totalMb: Math.round(os.totalmem() / (1024 * 1024)),
    freeMb: Math.round(os.freemem() / (1024 * 1024))
  }
}

function kitRoot(): string {
  return path.join(folders.runtimes(), PVP_JAVA_DIR)
}

function graalHome(): string {
  return path.join(folders.runtimes(), GRAAL_RUNTIME_DIR)
}

function packagedKitRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, PVP_JAVA_DIR)
  }
  return path.join(app.getAppPath(), 'resources', PVP_JAVA_DIR)
}

async function describe(javaPath: string, source: JavaRuntime['source']): Promise<JavaRuntime | null> {
  if (!javaPath || !fs.existsSync(javaPath)) return null
  const cached = describeCache.get(javaCacheKey(javaPath))
  if (cached) return { ...cached, source }
  try {
    const { stderr, stdout } = await execFileAsync(javaPath, ['-version'], { windowsHide: true })
    const text = `${stderr}\n${stdout}`
    const numeric = /version "([^"]+)"/.exec(text)?.[1] ?? 'unknown'
    // Keep vendor line so callers can detect GraalVM CE vs EE (numeric alone is just "21.0.2").
    const vendor = /^(?:OpenJDK|Java) Runtime Environment (.+)$/m.exec(text)?.[1]?.trim()
    const version = vendor ? `${numeric} ${vendor}` : numeric
    const majorMatch = /version "1\.(\d+)/.exec(text) ?? /version "(\d+)/.exec(text)
    const major = majorMatch ? Number(majorMatch[1]) : 0
    const arch = /64-Bit/.test(text) ? 'x64' : os.arch()
    const info: JavaRuntime = {
      path: javaPath,
      version,
      major: numeric.startsWith('1.') ? major : Number(numeric.split('.')[0] ?? major),
      arch,
      source
    }
    describeCache.set(javaCacheKey(javaPath), info)
    return info
  } catch {
    return null
  }
}

function pushJavaBins(found: string[], base: string): void {
  const push = (file: string) => {
    if (file && fs.existsSync(file)) found.push(file)
  }
  push(path.join(base, 'bin', 'java.exe'))
  push(path.join(base, 'bin', 'java'))
  push(path.join(base, 'Contents', 'Home', 'bin', 'java'))
}

function candidates(): string[] {
  const found: string[] = []
  pushJavaBins(found, kitRoot())
  pushJavaBins(found, graalHome())
  if (process.env.JAVA_HOME) pushJavaBins(found, process.env.JAVA_HOME)
  // Dev-machine kits / local Graal installs.
  pushJavaBins(found, path.join(os.homedir(), 'mc-pvp-java17'))
  pushJavaBins(found, path.join(os.homedir(), 'graalvm', 'graalvm-community-openjdk-21.0.2+13.1'))
  const roots = [
    path.join(os.homedir(), '.lunarclient', 'jre'),
    path.join(os.homedir(), 'graalvm'),
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
      pushJavaBins(found, base)
      try {
        for (const nested of fs.readdirSync(base)) {
          pushJavaBins(found, path.join(base, nested))
        }
      } catch {
        /* not a directory */
      }
    }
  }
  pushJavaBins(found, path.join(folders.runtimes(), 'temurin-21'))
  return [...new Set(found)]
}

export async function listJava(): Promise<JavaRuntime[]> {
  const runtimes: JavaRuntime[] = []
  for (const file of candidates()) {
    const source: JavaRuntime['source'] = file.includes(`${path.sep}runtimes${path.sep}`) ? 'bundled' : 'detected'
    const info = await describe(file, source)
    if (info && info.major >= MIN_JAVA_MAJOR) runtimes.push(info)
  }
  return runtimes
}

export async function testJava(javaPath: string): Promise<JavaRuntime> {
  describeCache.delete(javaCacheKey(javaPath))
  const info = await describe(javaPath, 'custom')
  if (!info) throw new Error('Could not run that Java executable.')
  if (info.major < MIN_JAVA_MAJOR) {
    throw new Error(
      `Java ${info.version} is too old. The client needs Java ${MIN_JAVA_MAJOR}+ (Genesis is class file 61). Java 8 cannot run it.`
    )
  }
  return info
}

function preferPvpJava(a: JavaRuntime, b: JavaRuntime): number {
  const score = (j: JavaRuntime) => {
    let s = j.major * 10
    if (j.path.includes(`${path.sep}${PVP_JAVA_DIR}${path.sep}`)) s += 50
    if (/graal/i.test(j.version) || /graal/i.test(j.path)) s += 5
    if (/mc-pvp-java17/i.test(j.path)) s += 3
    return s
  }
  return score(b) - score(a)
}

function shouldAdoptBundledJava(current: string, bundled: string): boolean {
  if (!current) return true
  if (path.normalize(current) === path.normalize(bundled)) return false
  if (/mc-pvp-java(?!17)/i.test(current)) return true
  if (current.includes(`${path.sep}runtimes${path.sep}temurin-21`)) return true
  if (current.includes(`${path.sep}runtimes${path.sep}${PVP_JAVA_DIR}`)) return true
  return false
}

function adoptBundledJava(javaPath: string): void {
  updateStore((data) => {
    if (shouldAdoptBundledJava(data.settings.javaPath || '', javaPath)) {
      data.settings.javaPath = javaPath
      data.settings.pvpKitPath = ''
      data.settings.jvmPreset = data.settings.jvmPreset === 'pvp' ? 'default' : data.settings.jvmPreset
    }
  })
}

function copyKitPayload(dest: string): void {
  const src = packagedKitRoot()
  if (!fs.existsSync(src)) {
    throw new Error(`PVP Java kit is missing from the launcher package (${src}).`)
  }
  fs.mkdirSync(path.join(dest, 'bin'), { recursive: true })
  for (const name of ['timer-agent.jar', 'timer-agent.dll', 'pvp-client.args']) {
    const from = path.join(src, name)
    if (!fs.existsSync(from)) throw new Error(`PVP kit missing ${name}.`)
    fs.copyFileSync(from, path.join(dest, name))
  }
  for (const name of process.platform === 'win32' ? ['java.exe', 'javaw.exe'] : ['java']) {
    const from = path.join(src, 'bin', name)
    if (!fs.existsSync(from)) throw new Error(`PVP kit missing bin/${name}.`)
    fs.copyFileSync(from, path.join(dest, 'bin', name))
  }
  fs.writeFileSync(path.join(dest, KIT_MARKER), KIT_VERSION, 'utf8')
}

async function ensureGraalRuntime(): Promise<string> {
  const home = graalHome()
  const probe = path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (fs.existsSync(probe)) {
    const ok = await describe(probe, 'bundled')
    if (ok && ok.major >= MIN_JAVA_MAJOR && /graal/i.test(ok.version)) return home
  }
  if (process.platform !== 'win32') {
    throw new Error('Bundled GraalVM CE 21 PVP Java is currently Windows-only. Install Java 17+ manually.')
  }
  const archive = path.join(folders.cache(), GRAAL_WIN_ZIP)
  await downloadFile(GRAAL_WIN_URL, archive, {
    label: 'GraalVM CE 21 (PVP Java)',
    sha256: GRAAL_WIN_SHA256
  })
  const staging = path.join(folders.runtimes(), `${GRAAL_RUNTIME_DIR}.extracting`)
  fs.rmSync(staging, { recursive: true, force: true })
  fs.rmSync(home, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  const zip = new AdmZip(archive)
  zip.extractAllTo(staging, true)
  const extracted = fs
    .readdirSync(staging)
    .map((entry) => path.join(staging, entry))
    .find((entry) => fs.existsSync(path.join(entry, 'bin', 'java.exe')))
  if (!extracted) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw new Error('GraalVM zip did not contain a JDK home.')
  }
  fs.renameSync(extracted, home)
  fs.rmSync(staging, { recursive: true, force: true })
  const info = await describe(path.join(home, 'bin', 'java.exe'), 'bundled')
  if (!info) throw new Error('GraalVM downloaded but could not be executed.')
  return home
}

/**
 * Installs the launcher-bundled PVP kit (timer agent + forwarder) and downloads
 * GraalVM CE 21 into `%APPDATA%\.lunar-revamped\runtimes`.
 */
export async function ensureBundledPvpJava(): Promise<JavaRuntime> {
  if (installPromise) return installPromise
  installPromise = (async () => {
    const dest = kitRoot()
    const marker = path.join(dest, KIT_MARKER)
    const needsKitCopy = !fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim() !== KIT_VERSION
    if (needsKitCopy) copyKitPayload(dest)

    const home = await ensureGraalRuntime()
    fs.writeFileSync(path.join(dest, 'graalvm.path'), home, 'utf8')

    const javaPath = bundledPvpJavaPath()
    const info = await describe(javaPath, 'bundled')
    if (!info || info.major < MIN_JAVA_MAJOR) {
      throw new Error('PVP Java kit installed but the forwarder could not start GraalVM CE 21.')
    }
    adoptBundledJava(javaPath)
    return info
  })().finally(() => {
    installPromise = null
  })
  return installPromise
}

/** Boot-time install; never throws (Play path will retry via ensureJava). */
export async function bootBundledPvpJava(): Promise<void> {
  try {
    await ensureBundledPvpJava()
  } catch (error) {
    console.warn('[java] Bundled PVP Java install deferred:', error instanceof Error ? error.message : error)
  }
}

export async function ensureJava(preferred: string): Promise<JavaRuntime> {
  if (preferred) {
    const custom = await describe(preferred, 'custom')
    if (custom && custom.major >= MIN_JAVA_MAJOR) return custom
    if (custom) {
      const tip = /mc-pvp-java(?!17)/i.test(custom.path)
        ? ' That wrap is Java 8 Graal — the launcher installs GraalVM CE 21 + PVP kit automatically.'
        : ''
      console.warn(
        `[java] Ignoring Java ${custom.version} at ${custom.path}; Lunar Revamped needs Java ${MIN_JAVA_MAJOR}+.${tip}`
      )
    }
  }

  const bundledPath = bundledPvpJavaPath()
  const bundled = await describe(bundledPath, 'bundled')
  if (bundled && bundled.major >= MIN_JAVA_MAJOR) {
    adoptBundledJava(bundledPath)
    return bundled
  }

  try {
    return await ensureBundledPvpJava()
  } catch (error) {
    console.warn('[java] Bundled PVP Java failed, falling back:', error instanceof Error ? error.message : error)
  }

  const found = await listJava()
  const best = found.sort(preferPvpJava)[0]
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
