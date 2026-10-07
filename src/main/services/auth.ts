import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { MS_CLIENT_ID } from '../../shared/manifest'
import type { Account, AccountPublic, MicrosoftLoginState } from '../../shared/types'
import { IpcChannel } from '../../shared/ipc'
import { emit } from '../bus'
import { loadStore, updateStore } from '../store'

const DEVICE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'
const TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
const XBL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile'

let login: MicrosoftLoginState = {
  state: 'idle',
  code: '',
  url: '',
  username: '',
  message: ''
}

function setLogin(next: MicrosoftLoginState): void {
  login = next
  emit(IpcChannel.authProgress, login)
}

export function microsoftStatus(): MicrosoftLoginState {
  return login
}

export function publicAccounts(): { accounts: AccountPublic[]; activeAccountId: string } {
  const data = loadStore()
  return {
    activeAccountId: data.activeAccountId,
    accounts: data.accounts.map((account) => ({
      id: account.id,
      username: account.username,
      uuid: account.uuid,
      kind: account.kind,
      expiresAt: account.expiresAt,
      hasToken: Boolean(account.accessToken)
    }))
  }
}

function offlineUuid(username: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest()
  hash[6] = (hash[6]! & 0x0f) | 0x30
  hash[8] = (hash[8]! & 0x3f) | 0x80
  return hash.toString('hex')
}

function offlineJwt(username: string): string {
  const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const header = b64('{"alg":"none","typ":"JWT"}')
  const payload = b64(JSON.stringify({ sub: username, iat: now, exp: now + 7 * 24 * 3600 }))
  return `${header}.${payload}.offline`
}

export function addOffline(username: string): AccountPublic {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    throw new Error('Username must be 3-16 characters: letters, numbers, underscore.')
  }
  const uuid = offlineUuid(username)
  const account: Account = {
    id: uuid,
    username,
    uuid,
    kind: 'offline',
    accessToken: offlineJwt(username),
    refreshToken: `local-offline-${uuid}`,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString()
  }
  updateStore((data) => {
    data.accounts = data.accounts.filter((item) => item.id !== uuid)
    data.accounts.push(account)
    data.activeAccountId = uuid
  })
  const pub = publicAccounts().accounts.find((item) => item.id === uuid)
  if (!pub) throw new Error('Failed to save account.')
  return pub
}

export function selectAccount(id: string): void {
  updateStore((data) => {
    if (!data.accounts.some((account) => account.id === id)) {
      throw new Error('Account not found.')
    }
    data.activeAccountId = id
  })
}

export function removeAccount(id: string): void {
  updateStore((data) => {
    data.accounts = data.accounts.filter((account) => account.id !== id)
    if (data.activeAccountId === id) {
      data.activeAccountId = data.accounts[0]?.id ?? ''
    }
  })
}

export function activeAccount(): Account | null {
  const data = loadStore()
  return data.accounts.find((account) => account.id === data.activeAccountId) ?? null
}

export function writeGameAccounts(file: string): void {
  const data = loadStore()
  const accounts: Record<string, unknown> = {}
  for (const account of data.accounts) {
    const id = account.uuid.replace(/-/g, '')
    accounts[id] = {
      accessToken: account.accessToken,
      accessTokenExpiresAt: account.expiresAt ?? new Date(Date.now() + 7 * 86400000).toISOString(),
      eligibleForMigration: false,
      hasMultipleProfiles: false,
      legacy: false,
      persistent: true,
      userProperites: [],
      minecraftProfile: { id, name: account.username },
      localId: id,
      refreshToken: account.refreshToken ?? '',
      remoteId: id,
      type: 'Xbox',
      username: account.username
    }
  }
  const active = (data.activeAccountId || data.accounts[0]?.uuid || '').replace(/-/g, '')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify({ activeAccountLocalId: active, accounts }, null, 2),
    'utf8'
  )
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const encoded = new URLSearchParams(body).toString()
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: encoded
  })
  return (await response.json()) as Record<string, unknown>
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  const json = (await response.json()) as Record<string, unknown>
  if (!response.ok) {
    const message = typeof json.errorMessage === 'string' ? json.errorMessage : `HTTP ${response.status}`
    throw new Error(message)
  }
  return json
}

export function startMicrosoftLogin(): void {
  if (login.state === 'waiting' || login.state === 'starting') return
  setLogin({ state: 'starting', code: '', url: '', username: '', message: 'Contacting Microsoft...' })
  void runMicrosoft().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Microsoft login failed.'
    setLogin({ state: 'error', code: '', url: '', username: '', message })
  })
}

async function runMicrosoft(): Promise<void> {
  const device = await postForm(DEVICE, {
    client_id: MS_CLIENT_ID,
    scope: 'XboxLive.signin offline_access'
  })
  const deviceCode = String(device.device_code ?? '')
  const userCode = String(device.user_code ?? '')
  const verification = String(device.verification_uri ?? 'https://microsoft.com/link')
  const interval = Number(device.interval ?? 5)
  const expiresIn = Number(device.expires_in ?? 900)
  setLogin({
    state: 'waiting',
    code: userCode,
    url: verification,
    username: '',
    message: `Enter ${userCode} at ${verification}`
  })

  const deadline = Date.now() + expiresIn * 1000
  let msToken = ''
  let refresh = ''
  let wait = interval
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, wait) * 1000))
    const token = await postForm(TOKEN, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: MS_CLIENT_ID,
      device_code: deviceCode
    })
    if (typeof token.access_token === 'string') {
      msToken = token.access_token
      refresh = typeof token.refresh_token === 'string' ? token.refresh_token : ''
      break
    }
    const error = String(token.error ?? '')
    if (error === 'authorization_pending') continue
    if (error === 'slow_down') {
      wait += 5
      continue
    }
    if (error) throw new Error(String(token.error_description ?? error))
  }
  if (!msToken) throw new Error('Device code expired before it was entered.')

  setLogin({
    state: 'waiting',
    code: userCode,
    url: verification,
    username: '',
    message: 'Microsoft login ok, signing into Xbox...'
  })

  const xbl = await postJson(XBL, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  })
  const xblToken = String(xbl.Token ?? '')
  const claims = xbl.DisplayClaims as { xui?: { uhs?: string }[] } | undefined
  const uhs = claims?.xui?.[0]?.uhs
  if (!xblToken || !uhs) throw new Error('Xbox Live did not return a user hash.')

  const xsts = await postJson(XSTS, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  })
  const xstsToken = String(xsts.Token ?? '')
  const mc = await postJson(MC_LOGIN, { identityToken: `XBL3.0 x=${uhs};${xstsToken}` })
  const access = String(mc.access_token ?? '')
  if (!access) throw new Error('Minecraft services did not return a token.')

  const profileRes = await fetch(MC_PROFILE, { headers: { Authorization: `Bearer ${access}` } })
  const profile = (await profileRes.json()) as { name?: string; id?: string }
  if (!profile.name || !profile.id) {
    throw new Error('This Microsoft account does not own Minecraft.')
  }

  const account: Account = {
    id: profile.id,
    username: profile.name,
    uuid: profile.id,
    kind: 'microsoft',
    accessToken: access,
    refreshToken: refresh,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  }
  updateStore((data) => {
    data.accounts = data.accounts.filter((item) => item.id !== account.id)
    data.accounts.push(account)
    data.activeAccountId = account.id
  })
  setLogin({
    state: 'success',
    code: '',
    url: verification,
    username: profile.name,
    message: `Added ${profile.name}`
  })
}
