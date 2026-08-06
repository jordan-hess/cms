'use client'

import { useState } from 'react'
import { WindowState } from './types'
import { buildInitialWindowStates } from './windowConfig'
import Window from './Window'
import Dock from './Dock'
import TeamleadersConsole from './TeamleadersConsole'
import AgentsConsole from './AgentsConsole'
import ManagementConsole from './ManagementConsole'
import { DashboardContentProps } from '@/components/dashboard/DashboardContent'

export interface ConsoleDesktopProps {
  role: 'admin' | 'management'
  dashboardData: DashboardContentProps
}

export default function ConsoleDesktop({ role, dashboardData }: ConsoleDesktopProps) {
  const [windows, setWindows] = useState<WindowState[]>(() => buildInitialWindowStates(role))

  function updateWindow(id: string, patch: Partial<WindowState>) {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, ...patch } : w)))
  }

  function focusWindow(id: string) {
    setWindows(prev => {
      const maxZ = Math.max(...prev.map(w => w.zIndex))
      return prev.map(w => (w.id === id ? { ...w, zIndex: maxZ + 1 } : w))
    })
  }

  function setStatus(id: string, status: WindowState['status']) {
    updateWindow(id, { status })
    if (status === 'open') focusWindow(id)
  }

  function renderConsole(w: WindowState) {
    switch (w.kind) {
      case 'teamleader':
        return <TeamleadersConsole {...dashboardData} />
      case 'agents':
        return <AgentsConsole />
      case 'management':
        return <ManagementConsole />
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-gray-50 dark:bg-gray-950">
      {windows
        .filter(w => w.status === 'open')
        .map(w => (
          <Window
            key={w.id}
            state={w}
            onDrag={(x, y) => updateWindow(w.id, { x, y })}
            onResize={(width, height) => updateWindow(w.id, { width, height })}
            onFocus={() => focusWindow(w.id)}
            onMinimize={() => setStatus(w.id, 'minimized')}
            onClose={() => setStatus(w.id, 'closed')}
          >
            {renderConsole(w)}
          </Window>
        ))}
      <Dock windows={windows} onIconClick={id => setStatus(id, 'open')} />
    </div>
  )
}
