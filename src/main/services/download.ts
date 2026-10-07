import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { IpcChannel } from '../../shared/ipc'
import { CLIENT_REPO, GITHUB_OWNER, MC_VERSION, type ClientManifest } from '../../shared/manifest'
import type { ClientStatus, DownloadProgress, NewsItem } from '../../shared/types'
import { emit } from '../bus'
import { folders } from '../paths'
import { loadStore, updateStore } from '../store'

export interface DownloadOptions {
  label: string
  sha1?: string
  sha256?: string
  overallReceived?: number
  overallTotal?: number
}

let lastProgressAt = 0

function report(progress: DownloadProgress): void {
  const now = Date.now()
  if (now - lastProgressAt < 150 && progress.received !== progress.total) return
  lastProgressAt = now
  emit(IpcChannel.progress, progress)
}

export async function downloadFile(url: string, dest: string, options: DownloadOptions): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const part = `${dest}.part`
  let received = fs.existsSync(part) ? fs.statSync(part).size : 0
  const headers: Record<string, string> = { 'User-Agent': 'LunarRevampedLauncher' }
  if (received > 0) headers.Range = `bytes=${received}-`
  const response = await fetch(url, { headers })
  if (response.status === 416) {
    fs.renameSync(part, dest)
    return
  }
  if (!response.ok && response.status !== 206) {
    throw new Error(`Download failed (${response.status}) for ${path.basename(dest)}`)
  }
  const totalHeader = response.headers.get('content-length')
  const total = (totalHeader ? Number(totalHeader) : 0) + (response.status === 206 ? received : 0)
  if (response.status === 200) received = 0
  const file = fs.createWriteStream(part, { flags: response.status === 206 ? 'a' : 'w' })
  const body = response.body
  if (!body) throw new Error(`Empty download: ${url}`)
  const started = Date.now()
  const reader = body.getReader()
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      file.write(Buffer.from(chunk.value))
      received += chunk.value.byteLength
      const elapsed = Math.max(0.001, (Date.now() - started) / 1000)
      const speed = received / elapsed
      report({
        file: path.basename(dest),
        received,
        total,
        speedBps: speed,
        etaSeconds: speed > 0 && total > 0 ? (total - received) / speed : 0,
        overallReceived: (options.overallReceived ?? 0) + received,
        overallTotal: options.overallTotal ?? total,
        label: options.label
      })
    }
  } finally {
    await new Promise<void>((resolve) => file.end(() => resolve()))
  }
  if (options.sha1) await verify(part, 'sha1', options.sha1)
  if (options.sha256) await verify(part, 'sha256', options.sha256)
  fs.renameSync(part, dest)
}

function verify(file: string, algo: 'sha1' | 'sha256', expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algo)
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => {
        const actual = hash.digest('hex')
        if (actual.toLowerCase() !== expected.toLowerCase()) {
          fs.rmSync(file, { force: true })
          reject(new Error(`${path.basename(file)} failed ${algo} check.`))
        } else resolve()
      })
  })
}

interface GithubRelease {
  tag_name?: string
  body?: string
  html_url?: string
  published_at?: string
  assets?: { name: string; browser_download_url: string; size: number }[]
}

async function latestRelease(repo: string): Promise<GithubRelease | null> {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LunarRevampedLauncher' }
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${repo}.`)
  return (await response.json()) as GithubRelease
}

export function runtimeRoot(): string {
  const data = loadStore()
  const installed = path.join(folders.versions(), data.installedClientVersion || 'none')
  if (data.installedClientVersion && fs.existsSync(path.join(installed, 'libs'))) return installed
  if (data.settings.devRuntime && fs.existsSync(path.join(data.settings.devRuntime, 'libs'))) {
    return data.settings.devRuntime
  }
  return installed
}

export async function clientStatus(): Promise<ClientStatus> {
  const data = loadStore()
  const root = runtimeRoot()
  let remote = ''
  let changelog = ''
  let message = 'Ready'
  let kind: ClientStatus['kind'] = fs.existsSync(path.join(root, 'libs')) ? 'ready' : 'missing'
  try {
    const release = await latestRelease(CLIENT_REPO)
    remote = (release?.tag_name ?? '').replace(/^v/, '')
    changelog = release?.body ?? ''
    if (!data.installedClientVersion && data.settings.devRuntime) {
      kind = 'ready'
      message = 'Using local development runtime'
    } else if (remote && data.installedClientVersion && remote !== data.installedClientVersion) {
      kind = 'update'
      message = `Update available: ${remote}`
    } else if (kind === 'missing') {
      message = remote ? `Install ${remote}` : 'No client release published yet'
    } else {
      message = data.installedClientVersion ? `Installed ${data.installedClientVersion}` : 'Local runtime'
    }
  } catch (error) {
    kind = fs.existsSync(path.join(root, 'libs')) ? 'ready' : 'error'
    message = error instanceof Error ? error.message : 'Could not check for updates'
  }
  return {
    kind,
    installedVersion: data.installedClientVersion,
    remoteVersion: remote,
    message,
    runtimeRoot: root,
    changelog
  }
}

export async function news(): Promise<NewsItem[]> {
  try {
    const release = await latestRelease(CLIENT_REPO)
    if (!release) return []
    return [
      {
        title: release.tag_name ?? 'Client',
        body: release.body ?? 'No notes.',
        url: release.html_url ?? '',
        publishedAt: release.published_at ?? ''
      }
    ]
  } catch {
    return []
  }
}

export async function installLatestClient(): Promise<ClientStatus> {
  const release = await latestRelease(CLIENT_REPO)
  if (!release?.assets?.length) throw new Error('No client release to download yet.')
  const zipAsset = release.assets.find((asset) => asset.name.endsWith('.zip'))
  if (!zipAsset) throw new Error('Client release has no zip.')
  const version = (release.tag_name ?? '0').replace(/^v/, '')
  const archive = path.join(folders.cache(), zipAsset.name)
  await downloadFile(zipAsset.browser_download_url, archive, { label: `Lunar Revamped ${version}` })
  const dest = path.join(folders.versions(), version)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  const Adm = new AdmZip(archive)
  Adm.extractAllTo(dest, true)
  const manifestPath = path.join(dest, 'manifest.json')
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ClientManifest
    if (manifest.minecraft !== MC_VERSION) throw new Error('Client manifest is not Minecraft 1.8.9.')
  }
  updateStore((data) => {
    if (data.installedClientVersion && data.installedClientVersion !== version) {
      data.previousClientVersion = data.installedClientVersion
    }
    data.installedClientVersion = version
  })
  const status = await clientStatus()
  emit(IpcChannel.clientStatus, status)
  return status
}

export function rollbackClient(): ClientStatus {
  const data = loadStore()
  if (!data.previousClientVersion) throw new Error('No previous build to roll back to.')
  const previous = path.join(folders.versions(), data.previousClientVersion)
  if (!fs.existsSync(previous)) throw new Error('Previous build files are missing.')
  updateStore((store) => {
    const current = store.installedClientVersion
    store.installedClientVersion = store.previousClientVersion
    store.previousClientVersion = current
  })
  return {
    kind: 'ready',
    installedVersion: loadStore().installedClientVersion,
    remoteVersion: '',
    message: `Rolled back to ${loadStore().installedClientVersion}`,
    runtimeRoot: runtimeRoot(),
    changelog: ''
  }
}

interface MojangLibrary {
  name: string
  downloads?: { artifact?: { url: string; path: string; sha1: string; size: number } }
  rules?: { action: string; os?: { name?: string } }[]
}

function libAllowed(lib: MojangLibrary): boolean {
  if (!lib.rules) return true
  let allow = false
  for (const rule of lib.rules) {
    const osName = rule.os?.name
    const matches = !osName || osName === (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux')
    if (matches) allow = rule.action === 'allow'
  }
  return allow
}

export async function ensureVanilla(runtime: string): Promise<void> {
  const versionJar = path.join(runtime, 'libs', 'vanilla', 'versions', MC_VERSION, `${MC_VERSION}.jar`)
  if (fs.existsSync(versionJar)) return
  const manifestRes = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
  const manifest = (await manifestRes.json()) as { versions: { id: string; url: string }[] }
  const version = manifest.versions.find((item) => item.id === MC_VERSION)
  if (!version) throw new Error('Mojang manifest has no 1.8.9.')
  const meta = (await (await fetch(version.url)).json()) as {
    downloads: { client: { url: string; sha1: string } }
    libraries: MojangLibrary[]
    assetIndex: { id: string; url: string; sha1: string }
  }
  const libRoot = path.join(runtime, 'libs', 'vanilla')
  await downloadFile(meta.downloads.client.url, versionJar, {
    label: 'Minecraft 1.8.9',
    sha1: meta.downloads.client.sha1
  })
  const libraries = meta.libraries.filter(libAllowed)
  let overall = 0
  const overallTotal = libraries.reduce((sum, lib) => sum + (lib.downloads?.artifact?.size ?? 0), 0)
  for (const lib of libraries) {
    const artifact = lib.downloads?.artifact
    if (!artifact?.url || !artifact.path) continue
    const dest = path.join(libRoot, 'libraries', artifact.path)
    if (!fs.existsSync(dest)) {
      await downloadFile(artifact.url, dest, {
        label: artifact.path,
        sha1: artifact.sha1,
        overallReceived: overall,
        overallTotal
      })
    }
    overall += artifact.size ?? 0
  }
  const indexPath = path.join(libRoot, 'assets', 'indexes', `${meta.assetIndex.id}.json`)
  await downloadFile(meta.assetIndex.url, indexPath, { label: 'Asset index', sha1: meta.assetIndex.sha1 })
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { objects: Record<string, { hash: string }> }
  const objects = Object.values(index.objects)
  for (const object of objects) {
    const hash = object.hash
    const dest = path.join(libRoot, 'assets', 'objects', hash.slice(0, 2), hash)
    if (fs.existsSync(dest)) continue
    const url = `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`
    await downloadFile(url, dest, { label: hash, sha1: hash })
  }
}
