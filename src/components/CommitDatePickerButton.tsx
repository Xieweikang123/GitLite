import { useCallback, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { DayPicker, UI } from 'react-day-picker'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from './ui/select'
import { cn } from '../lib/utils'
import { formatLocalYmd, parseLocalYmd } from '../utils/dateYmd'

function localToday(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

const START_YEAR = 1990

type Props = {
  value: string
  onChange: (ymd: string) => void
  placeholder: string
  title?: string
  className?: string
}

export function CommitDatePickerButton({
  value,
  onChange,
  placeholder,
  title,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Date | undefined>(undefined)
  const [month, setMonth] = useState<Date>(() => new Date())

  const selected = useMemo(() => parseLocalYmd(value), [value])
  const label = selected
    ? format(selected, 'yyyy/MM/dd', { locale: zhCN })
    : placeholder

  const yearEnd = new Date().getFullYear() + 1

  const years = useMemo(
    () =>
      Array.from(
        { length: yearEnd - START_YEAR + 1 },
        (_, i) => String(START_YEAR + i)
      ),
    [yearEnd]
  )

  const monthItems = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        value: String(i + 1),
        label: format(new Date(2024, i, 1), 'LLLL', { locale: zhCN }),
      })),
    []
  )

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        const d = parseLocalYmd(value)
        setDraft(d)
        const base = d ?? new Date()
        setMonth(new Date(base.getFullYear(), base.getMonth(), 1))
      }
      setOpen(next)
    },
    [value]
  )

  const apply = useCallback(() => {
    onChange(draft ? formatLocalYmd(draft) : '')
    setOpen(false)
  }, [draft, onChange])

  const onYearChange = useCallback((y: string) => {
    const year = parseInt(y, 10)
    const m = month.getMonth()
    const dim = new Date(year, m + 1, 0).getDate()
    const day = Math.min(
      draft?.getFullYear() === year && draft.getMonth() === m
        ? draft.getDate()
        : 1,
      dim
    )
    const next = new Date(year, m, day)
    setMonth(new Date(year, m, 1))
    setDraft(next)
  }, [month, draft])

  const onMonthChangeSelect = useCallback(
    (mStr: string) => {
      const mi = parseInt(mStr, 10) - 1
      const y = month.getFullYear()
      const dim = new Date(y, mi + 1, 0).getDate()
      const day = Math.min(
        draft?.getFullYear() === y && draft.getMonth() === mi
          ? draft.getDate()
          : 1,
        dim
      )
      const next = new Date(y, mi, day)
      setMonth(new Date(y, mi, 1))
      setDraft(next)
    },
    [month, draft]
  )

  const syncMonthFromDraft = useCallback((d: Date | undefined) => {
    if (!d) return
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1))
  }, [])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          title={title}
          className={cn(
            'h-7 min-w-0 max-w-[min(100%,10rem)] justify-start px-2 text-xs font-normal',
            className
          )}
        >
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-w-[min(100vw-2rem,20rem)] overflow-visible p-2"
        align="start"
      >
        <div className="flex flex-col gap-2">
          {open ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Select
                  value={String(month.getFullYear())}
                  onValueChange={onYearChange}
                >
                  <SelectTrigger
                    className="h-7 w-[4.75rem] px-2 text-xs"
                    aria-label="选择年份"
                  >
                    <span>{month.getFullYear()}年</span>
                  </SelectTrigger>
                  <SelectContent className="z-[110] max-h-52">
                    {years.map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}年
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(month.getMonth() + 1)}
                  onValueChange={onMonthChangeSelect}
                >
                  <SelectTrigger
                    className="h-7 w-[5.5rem] px-2 text-xs"
                    aria-label="选择月份"
                  >
                    <span>
                      {monthItems[month.getMonth()]?.label ?? ''}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="z-[110] max-h-52">
                    {monthItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DayPicker
                mode="single"
                required={false}
                selected={draft}
                onSelect={(d) => {
                  setDraft(d)
                  if (d) syncMonthFromDraft(d)
                }}
                month={month}
                onMonthChange={(m) => {
                  setMonth(new Date(m.getFullYear(), m.getMonth(), 1))
                }}
                locale={zhCN}
                captionLayout="label"
                hideNavigation
                classNames={{
                  [UI.MonthCaption]: 'hidden',
                }}
                startMonth={new Date(START_YEAR, 0)}
                endMonth={new Date(yearEnd, 11)}
              />
            </>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-t border-border pt-2">
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const t = localToday()
                  setDraft(t)
                  setMonth(new Date(t.getFullYear(), t.getMonth(), 1))
                }}
              >
                今日
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setDraft(undefined)}
              >
                清除
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button type="button" size="sm" className="h-7 text-xs" onClick={apply}>
                确定
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
