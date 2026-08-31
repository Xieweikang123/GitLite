import * as React from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface SelectProps {
  value?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
  disabled?: boolean
  className?: string
}

type SelectContextValue = {
  value?: string
  onValueChange?: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  disabled: boolean
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>
  contentRef: React.MutableRefObject<HTMLDivElement | null>
}

const SelectContext = React.createContext<SelectContextValue>({
  open: false,
  setOpen: () => {},
  disabled: false,
  triggerRef: { current: null },
  contentRef: { current: null },
})

export function Select({ value, onValueChange, children, className, disabled }: SelectProps) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (contentRef.current?.contains(target)) return
      setOpen(false)
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <SelectContext.Provider
      value={{
        value,
        onValueChange,
        open,
        setOpen,
        disabled: disabled ?? false,
        triggerRef,
        contentRef,
      }}
    >
      <div
        className={cn('relative', className)}
        data-app-interactive-overlay={open ? '' : undefined}
      >
        {children}
      </div>
    </SelectContext.Provider>
  )
}

export interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
}

export const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const { open, setOpen, disabled, triggerRef } = React.useContext(SelectContext)

    const setRefs = React.useCallback(
      (node: HTMLButtonElement | null) => {
        triggerRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      },
      [ref, triggerRef]
    )

    return (
      <button
        ref={setRefs}
        type="button"
        className={cn(
          'flex h-10 w-full items-center justify-between gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => {
          if (!disabled) setOpen(!open)
        }}
        {...props}
      >
        {children}
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>
    )
  }
)
SelectTrigger.displayName = 'SelectTrigger'

export interface SelectContentProps {
  children: React.ReactNode
  className?: string
  align?: 'start' | 'end'
  sideOffset?: number
}

export const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
  ({ className, children, align = 'start', sideOffset = 4, ...props }, ref) => {
    const { open, triggerRef, contentRef } = React.useContext(SelectContext)
    const [style, setStyle] = React.useState<React.CSSProperties>({})

    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        contentRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      },
      [ref, contentRef]
    )

    React.useLayoutEffect(() => {
      if (!open || !triggerRef.current) return

      const updatePosition = () => {
        const trigger = triggerRef.current
        if (!trigger) return
        const rect = trigger.getBoundingClientRect()
        setStyle({
          position: 'fixed',
          top: rect.bottom + sideOffset,
          left: align === 'end' ? rect.right : rect.left,
          transform: align === 'end' ? 'translateX(-100%)' : undefined,
          minWidth: rect.width,
          zIndex: 100,
        })
      }

      updatePosition()
      window.addEventListener('scroll', updatePosition, true)
      window.addEventListener('resize', updatePosition)
      return () => {
        window.removeEventListener('scroll', updatePosition, true)
        window.removeEventListener('resize', updatePosition)
      }
    }, [open, align, sideOffset, triggerRef])

    if (!open) return null

    return createPortal(
      <div
        ref={setRefs}
        style={style}
        className={cn(
          'max-h-60 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg',
          className
        )}
        {...props}
      >
        {children}
      </div>,
      document.body
    )
  }
)
SelectContent.displayName = 'SelectContent'

export interface SelectGroupProps {
  children: React.ReactNode
  className?: string
}

export function SelectGroup({ children, className }: SelectGroupProps) {
  return <div className={cn('py-1', className)}>{children}</div>
}

export interface SelectLabelProps {
  children: React.ReactNode
  className?: string
}

export function SelectLabel({ children, className }: SelectLabelProps) {
  return (
    <div className={cn('px-3 py-1.5 text-[10px] font-medium text-muted-foreground', className)}>
      {children}
    </div>
  )
}

export interface SelectItemProps {
  value: string
  children: React.ReactNode
  className?: string
  disabled?: boolean
}

export const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, children, value, disabled, ...props }, ref) => {
    const { value: selectedValue, onValueChange, setOpen } = React.useContext(SelectContext)

    return (
      <div
        ref={ref}
        role="option"
        aria-selected={selectedValue === value}
        aria-disabled={disabled}
        className={cn(
          'relative flex w-full cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground',
          selectedValue === value && 'bg-accent font-medium text-accent-foreground',
          disabled && 'pointer-events-none opacity-50',
          className
        )}
        onClick={() => {
          if (disabled) return
          onValueChange?.(value)
          setOpen(false)
        }}
        {...props}
      >
        {children}
      </div>
    )
  }
)
SelectItem.displayName = 'SelectItem'
