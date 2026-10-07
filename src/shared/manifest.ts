export interface ManifestFile {
  path: string
  sha256: string
  size: number
}

export interface ClientManifest {
  version: string
  minecraft: '1.8.9'
  files: ManifestFile[]
}

export const GITHUB_OWNER = 'Josheyerr'
export const LAUNCHER_REPO = 'lunar-revamped-launcher'
export const CLIENT_REPO = 'lunar-revamped-client'
export const MC_VERSION = '1.8.9'
export const MS_CLIENT_ID = '4358653d-21f6-4697-96bb-7963ff974196'
