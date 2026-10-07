import type { JvmPreset } from './types'

export const DEFAULT_ACCENT = '#6d7cff'

export function presetArgs(preset: JvmPreset, major: number): string {
  switch (preset) {
    case 'default':
      return '-XX:+UseG1GC -Djava.net.preferIPv4Stack=true'
    case 'aikar':
      return [
        '-XX:+UseG1GC',
        '-XX:+ParallelRefProcEnabled',
        '-XX:MaxGCPauseMillis=200',
        '-XX:+UnlockExperimentalVMOptions',
        '-XX:+DisableExplicitGC',
        '-XX:+AlwaysPreTouch',
        '-XX:G1NewSizePercent=30',
        '-XX:G1MaxNewSizePercent=40',
        '-XX:G1HeapRegionSize=8M',
        '-XX:G1ReservePercent=20',
        '-XX:G1HeapWastePercent=5',
        '-XX:G1MixedGCCountTarget=4',
        '-XX:InitiatingHeapOccupancyPercent=15',
        '-XX:G1MixedGCLiveThresholdPercent=90',
        '-XX:G1RSetUpdatingPauseTimePercent=5',
        '-XX:SurvivorRatio=32',
        '-XX:+PerfDisableSharedMem',
        '-XX:MaxTenuringThreshold=1',
        '-Dusing.aikars.flags=https://mcflags.emc.gs',
        '-Daikars.new.flags=true'
      ].join(' ')
    case 'low':
      return '-XX:+UseSerialGC -XX:+UseStringDeduplication -Djava.net.preferIPv4Stack=true'
    case 'zgc':
      return major >= 21
        ? '-XX:+UseZGC -XX:+ZGenerational -Djava.net.preferIPv4Stack=true'
        : '-XX:+UseG1GC -Djava.net.preferIPv4Stack=true'
    case 'custom':
      return ''
    default: {
      const _never: never = preset
      return _never
    }
  }
}

export interface ArgCheck {
  args: string[]
  warnings: string[]
  error?: string
}

/** Split a JVM/game arg string into tokens. Rejects shell chaining. */
export function parseArgs(raw: string): ArgCheck {
  const warnings: string[] = []
  const args: string[] = []
  if (/[\r\n|&;`$]/.test(raw)) {
    return { args: [], warnings, error: 'Arguments cannot contain newlines or shell operators.' }
  }
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    const token = match[1] ?? match[2] ?? match[3] ?? ''
    if (token) args.push(token)
  }
  for (const token of args) {
    if (token.startsWith('-XX:') && token.includes(' ')) {
      warnings.push(`Suspicious flag: ${token}`)
    }
  }
  return { args, warnings }
}
