import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

export interface SidebarRowMenuItem {
  id: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  onSelect: () => void
}

interface SidebarRowMenuProps {
  menuKey: string
  label: string
  openMenuKey: string | null
  onOpenChange: (menuKey: string | null) => void
  items: SidebarRowMenuItem[]
}

function computePopoverPosition(trigger: HTMLElement, popover: HTMLElement) {
  const triggerRect = trigger.getBoundingClientRect()
  const popoverHeight = popover.offsetHeight
  const popoverWidth = popover.offsetWidth
  const gutter = 8
  const spaceBelow = window.innerHeight - triggerRect.bottom
  const openAbove = spaceBelow < popoverHeight + gutter && triggerRect.top > popoverHeight + gutter
  const top = openAbove
    ? Math.max(gutter, triggerRect.top - popoverHeight - gutter)
    : Math.min(window.innerHeight - popoverHeight - gutter, triggerRect.bottom + gutter)
  const left = Math.min(
    window.innerWidth - popoverWidth - gutter,
    Math.max(gutter, triggerRect.right - popoverWidth)
  )

  return { top, left }
}

export function SidebarRowMenu({ menuKey, label, openMenuKey, onOpenChange, items }: SidebarRowMenuProps) {
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const open = openMenuKey === menuKey

  useEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    function updatePosition() {
      const trigger = triggerRef.current
      const popover = popoverRef.current
      if (!trigger || !popover) return
      setPosition(computePopoverPosition(trigger, popover))
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
  }, [items.length, open])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: globalThis.MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      onOpenChange(null)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onOpenChange(null)
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
  }, [onOpenChange, open])

  function handleToggle(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    onOpenChange(open ? null : menuKey)
  }

  const menu = open
    ? createPortal(
        <div
          ref={popoverRef}
          className="sidebar-row-menu-popover sidebar-row-menu-popover-fixed"
          id={menuId}
          role="menu"
          style={
            position
              ? { top: position.top, left: position.left, visibility: 'visible' }
              : { top: -9999, left: -9999, visibility: 'hidden' }
          }
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`sidebar-row-menu-item${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onOpenChange(null)
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
    : null

  return (
    <>
      <div className="sidebar-row-menu" ref={rootRef}>
        <button
          ref={triggerRef}
          type="button"
          className={`sidebar-row-menu-trigger${open ? ' open' : ''}`}
          title={`${label} actions`}
          aria-label={`${label} actions`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={handleToggle}
        >
          <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {menu}
    </>
  )
}
