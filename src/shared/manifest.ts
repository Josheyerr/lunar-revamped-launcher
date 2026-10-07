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
/** Official Minecraft launcher client. Sign-in is Minecraft's, and the account is stored only in this app. */
export const MS_CLIENT_ID = '00000000402b5328'
