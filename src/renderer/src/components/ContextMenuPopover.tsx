import React, { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  onSelect: () => void
}

interface ContextMenuPopoverProps {
  open: boolean
  x: number
  y: number
  label: string
  items: ContextMenuItem[]
  onClose: () => void
}

function computePosition(x: number, y: number, popover: HTMLElement) {
  const gutter = 8
  const left = Math.min(window.innerWidth - popover.offsetWidth - gutter, Math.max(gutter, x))
  const top = Math.min(window.innerHeight - popover.offsetHeight - gutter, Math.max(gutter, y))
  return { top, left }
}

export function ContextMenuPopover({ open, x, y, label, items, onClose }: ContextMenuPopoverProps) {
  const menuId = useId()
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    function updatePosition() {
      const popover = popoverRef.current
      if (!popover) return
      setPosition(computePosition(x, y, popover))
    }

    updatePosition()
    const frame = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, x, y, items.length])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: globalThis.MouseEvent) {
      const target = event.target as Node
      if (popoverRef.current?.contains(target)) return
      onClose()
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    const timeout = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown)
      window.addEventListener('keydown', handleEscape)
    }, 0)

    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, open])

  if (!open) return null

  return createPortal(
    <div
      ref={popoverRef}
      className="sidebar-row-menu-popover sidebar-row-menu-popover-fixed context-menu-popover"
      id={menuId}
      role="menu"
      aria-label={label}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        top: position?.top ?? y,
        left: position?.left ?? x,
        visibility: 'visible'
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={`sidebar-row-menu-item${item.danger ? ' danger' : ''}`}
          disabled={item.disabled}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onClose()
            item.onSelect()
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body
  )
}
