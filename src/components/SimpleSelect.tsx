import { useMemo } from 'react'
import { cn } from '../lib/utils'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from './ui/select'

export type SimpleSelectOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

export type SimpleSelectGroup = {
  label: string
  options: SimpleSelectOption[]
}

export type SimpleSelectSize = 'default' | 'sm' | 'xs' | 'inline'

const TRIGGER_SIZE: Record<SimpleSelectSize, string> = {
  default: 'h-10 text-sm',
  sm: 'h-8 text-xs',
  xs: 'h-7 text-xs px-2',
  inline:
    'h-5 border-0 bg-transparent px-0 py-0 text-xs shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:h-3 [&>svg]:w-3',
}

const ITEM_SIZE: Record<SimpleSelectSize, string> = {
  default: 'text-sm',
  sm: 'py-1.5 text-xs',
  xs: 'py-1.5 text-xs',
  inline: 'py-1.5 text-xs',
}

export type SimpleSelectProps = {
  value: string
  onValueChange: (value: string) => void
  options?: SimpleSelectOption[]
  groups?: SimpleSelectGroup[]
  placeholder?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  contentClassName?: string
  size?: SimpleSelectSize
  id?: string
  'aria-label'?: string
}

export function SimpleSelect({
  value,
  onValueChange,
  options,
  groups,
  placeholder,
  disabled,
  className,
  triggerClassName,
  contentClassName,
  size = 'default',
  id,
  'aria-label': ariaLabel,
}: SimpleSelectProps) {
  const allOptions = useMemo(() => {
    if (options) return options
    return groups?.flatMap((g) => g.options) ?? []
  }, [options, groups])

  const displayLabel = useMemo(() => {
    const found = allOptions.find((o) => o.value === value)
    if (found) return found.label
    if (placeholder) return placeholder
    return value
  }, [allOptions, value, placeholder])

  const itemClassName = ITEM_SIZE[size]

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled} className={className}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(TRIGGER_SIZE[size], triggerClassName)}
      >
        <span className="min-w-0 flex-1 truncate text-left">{displayLabel}</span>
      </SelectTrigger>
      <SelectContent className={cn('p-1', contentClassName)}>
        {options?.map((opt) => (
          <SelectItem
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled}
            className={itemClassName}
          >
            {opt.label}
          </SelectItem>
        ))}
        {groups?.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.options.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                className={itemClassName}
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
