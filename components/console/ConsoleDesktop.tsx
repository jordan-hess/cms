'use client'

import { useLayoutEffect, useRef, useState } from 'react'
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

// Keep at least this much width and the full title bar height reachable within the
// desktop bounds, matching the drag-clamp rule in Window.tsx.
const MIN_REACHABLE_WIDTH = 120
const MIN_REACHABLE_HEIGHT = 48

export default function ConsoleDesktop({ role, dashboardData }: ConsoleDesktopProps) {
  const [windows, setWindows] = useState<WindowState[]>(() => buildInitialWindowStates(role))
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const desktopRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const node = desktopRef.current
    if (!node) return

    // The Dock (z-50, see Dock.tsx) always paints on top of windows, so a window clamped
    // merely to the container's bottom edge could still land with its whole title bar
    // underneath the Dock — reachable "within the container" but not actually clickable.
    // Measuring the Dock's own height and excluding it from the usable vertical space keeps
    // the title bar clear of the Dock entirely, not just clear of the container edge.
    function measure() {
      if (!node) return { width: 0, height: 0 }
      const dockHeight = dockRef.current?.clientHeight ?? 0
      return { width: node.clientWidth, height: Math.max(0, node.clientHeight - dockHeight) }
    }

    const initial = measure()
    setBounds(initial)

    // One-time correction of any hardcoded default positions (windowConfig.ts) that would
    // otherwise fall outside a normal viewport's actual measured bounds, leaving a window's
    // title bar unreachable (or hidden under the Dock) from mount. Intentionally mount-only —
    // re-running this whenever `windows` changes would fight the user's own drags every time
    // state updates.
    setWindows(prev =>
      prev.map(w => ({
        ...w,
        x: Math.min(w.x, Math.max(0, initial.width - MIN_REACHABLE_WIDTH)),
        y: Math.min(w.y, Math.max(0, initial.height - MIN_REACHABLE_HEIGHT)),
      })),
    )

    function handleResize() {
      setBounds(measure())
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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
    <div ref={desktopRef} className="relative h-full w-full overflow-hidden bg-gray-50 dark:bg-gray-950">
      {windows
        .filter(w => w.status === 'open')
        .map(w => (
          <Window
            key={w.id}
            state={w}
            bounds={bounds}
            onDrag={(x, y) => updateWindow(w.id, { x, y })}
            onResize={(width, height) => updateWindow(w.id, { width, height })}
            onFocus={() => focusWindow(w.id)}
            onMinimize={() => setStatus(w.id, 'minimized')}
            onClose={() => setStatus(w.id, 'closed')}
          >
            {renderConsole(w)}
          </Window>
        ))}
      <Dock ref={dockRef} windows={windows} onIconClick={id => setStatus(id, 'open')} />
    </div>
  )
}
