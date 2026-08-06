import { WindowConfig, WindowState } from './types'

export function getWindowConfigs(role: 'admin' | 'management'): WindowConfig[] {
  const configs: WindowConfig[] = [
    { id: 'teamleader-1', kind: 'teamleader', title: 'Teamleaders', defaultX: 40, defaultY: 32, defaultWidth: 560, defaultHeight: 420, entryDelayMs: 0 },
    { id: 'teamleader-2', kind: 'teamleader', title: 'Teamleaders', defaultX: 620, defaultY: 32, defaultWidth: 560, defaultHeight: 420, entryDelayMs: 40 },
    { id: 'agents-1', kind: 'agents', title: 'Agents', defaultX: 40, defaultY: 480, defaultWidth: 400, defaultHeight: 320, entryDelayMs: 80 },
    { id: 'agents-2', kind: 'agents', title: 'Agents', defaultX: 460, defaultY: 480, defaultWidth: 400, defaultHeight: 320, entryDelayMs: 120 },
  ]

  if (role === 'management') {
    configs.push({ id: 'management', kind: 'management', title: 'Management', defaultX: 880, defaultY: 480, defaultWidth: 480, defaultHeight: 360, entryDelayMs: 160 })
  }

  return configs
}

export function buildInitialWindowStates(role: 'admin' | 'management'): WindowState[] {
  return getWindowConfigs(role).map((config, index) => ({
    ...config,
    x: config.defaultX,
    y: config.defaultY,
    width: config.defaultWidth,
    height: config.defaultHeight,
    zIndex: index + 1,
    status: 'open' as const,
  }))
}
