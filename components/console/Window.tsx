'use client'

import { useEffect, useRef } from 'react'
import { Minus, X } from 'lucide-react'
import { animate } from 'animejs'
import { WindowState } from './types'

export interface WindowProps {
  state: WindowState
  children: React.ReactNode
  onDrag: (x: number, y: number) => void
  onResize: (width: number, height: number) => void
  onFocus: () => void
  onMinimize: () => void
  onClose: () => void
}

const MIN_WIDTH = 320
const MIN_HEIGHT = 240

export default function Window({ state, children, onDrag, onResize, onFocus, onMinimize, onClose }: WindowProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null)
  const resizeOrigin = useRef<{ pointerX: number; pointerY: number; startWidth: number; startHeight: number } | null>(null)

  useEffect(() => {
    const node = rootRef.current
    if (!node) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return

    animate(node, {
      opacity: [0, 1],
      scale: [0.9, 1],
      duration: 200,
      delay: state.entryDelayMs,
      ease: 'outQuad',
    })
    // Intentionally mount-only: every open/reopen of a window is a fresh mount of this
    // component (ConsoleDesktop only renders windows with status === 'open'), so re-running
    // this on prop changes would replay the entrance animation on every drag/resize update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function playExitAnimation(after: () => void) {
    const node = rootRef.current
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!node || reduceMotion) {
      after()
      return
    }
    animate(node, {
      opacity: [1, 0],
      scale: [1, 0.9],
      duration: 150,
      ease: 'inQuad',
      onComplete: after,
    })
  }

  function handleTitlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    onFocus()
    dragOrigin.current = { pointerX: e.clientX, pointerY: e.clientY, startX: state.x, startY: state.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handleTitlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragOrigin.current) return
    const dx = e.clientX - dragOrigin.current.pointerX
    const dy = e.clientY - dragOrigin.current.pointerY
    onDrag(Math.max(0, dragOrigin.current.startX + dx), Math.max(0, dragOrigin.current.startY + dy))
  }

  function handleTitlePointerUp() {
    dragOrigin.current = null
  }

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation()
    onFocus()
    resizeOrigin.current = { pointerX: e.clientX, pointerY: e.clientY, startWidth: state.width, startHeight: state.height }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handleResizePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizeOrigin.current) return
    const dx = e.clientX - resizeOrigin.current.pointerX
    const dy = e.clientY - resizeOrigin.current.pointerY
    onResize(
      Math.max(MIN_WIDTH, resizeOrigin.current.startWidth + dx),
      Math.max(MIN_HEIGHT, resizeOrigin.current.startHeight + dy),
    )
  }

  function handleResizePointerUp() {
    resizeOrigin.current = null
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={state.title}
      onPointerDown={onFocus}
      className="absolute flex flex-col bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden"
      style={{ left: state.x, top: state.y, width: state.width, height: state.height, zIndex: state.zIndex }}
    >
      <div
        onPointerDown={handleTitlePointerDown}
        onPointerMove={handleTitlePointerMove}
        onPointerUp={handleTitlePointerUp}
        className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 cursor-move select-none shrink-0"
      >
        <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{state.title}</span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => playExitAnimation(onMinimize)}
            aria-label={`Minimize ${state.title}`}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => playExitAnimation(onClose)}
            aria-label={`Close ${state.title}`}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {children}
      </div>

      <div
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
        aria-hidden="true"
      />
    </div>
  )
}
