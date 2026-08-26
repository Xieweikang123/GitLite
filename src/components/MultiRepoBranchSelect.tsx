import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { GitBranch, ChevronDown, RefreshCw } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Badge } from './ui/badge'
import { Input } from './ui/input'
import { BranchInfo } from '../types/git'
import { cn } from '../lib/utils'

interface MultiRepoBranchSelectProps {
  currentBranch: string
  headShortId?: string | null
  branches: BranchInfo[]
  loading?: boolean
  disabled?: boolean
  onSelect: (branchName: string) => void
  /** 扫描结果尚无分支列表时（例如热更新后）再拉一次 */
  onNeedBranches?: () => void
}

export function MultiRepoBranchSelect({
  currentBranch,
  headShortId,
  branches,
  loading,
  disabled,
  onSelect,
  onNeedBranches,
}: MultiRepoBranchSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return branches
    return branches.filter((b) => b.name.toLowerCase().includes(q))
  }, [branches, search])

  useEffect(() => {
    setActiveIdx(0)
  }, [search, open])

  useEffect(() => {
    if (activeIdx >= filtered.length) {
      setActiveIdx(Math.max(0, filtered.length - 1))
    }
  }, [filtered.length, activeIdx])

  useEffect(() => {
    if (!open || filtered.length === 0) return
    const root = listRef.current
    if (!root) return
    const btn = root.querySelector<HTMLButtonElement>(`button:nth-of-type(${activeIdx + 1})`)
    btn?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open, filtered.length])

  const pick = useCallback(
    (name: string) => {
      if (name === currentBranch) {
        setOpen(false)
        setSearch('')
        return
      }
      onSelect(name)
      setOpen(false)
      setSearch('')
    },
    [currentBranch, onSelect]
  )

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const b = filtered[activeIdx]
      if (b) pick(b.name)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
        else if (branches.length === 0) onNeedBranches?.()
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || loading}
          title="选择分支（可搜索，↑↓ 选择，回车切换）"
          className={cn(
            'inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 shadow-sm',
            'hover:border-primary/40 hover:bg-muted/40 transition-colors',
            'disabled:opacity-60 disabled:pointer-events-none'
          )}
        >
          {loading ? (
            <RefreshCw className="h-3 w-3 animate-spin text-primary shrink-0" />
          ) : (
            <GitBranch className="h-3 w-3 text-primary shrink-0" />
          )}
          <span className="font-medium text-foreground truncate max-w-[9rem]">{currentBranch}</span>
          {headShortId && (
            <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded border shrink-0">
              {headShortId}
            </span>
          )}
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[min(92vw,20rem)] p-2"
        onOpenAutoFocus={(ev) => {
          ev.preventDefault()
          requestAnimationFrame(() => searchRef.current?.focus())
        }}
      >
        <div className="flex flex-col gap-2">
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="搜索分支名…"
            className="h-8 text-xs"
            disabled={loading}
            aria-label="搜索分支"
          />
          <div
            ref={listRef}
            className="max-h-[min(50vh,280px)] overflow-y-auto overflow-x-hidden rounded-md border border-border/60"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {branches.length === 0 ? '没有本地分支' : '无匹配分支'}
              </p>
            ) : (
              filtered.map((branch, idx) => {
                const isCurrent = branch.name === currentBranch
                const isActive = idx === activeIdx
                return (
                  <button
                    key={branch.name}
                    type="button"
                    disabled={loading}
                    className={cn(
                      'flex w-full items-start gap-2 border-b border-border/40 px-3 py-2 text-left text-xs last:border-b-0',
                      'hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive && 'bg-accent',
                      isCurrent && 'bg-muted/50'
                    )}
                    onClick={() => pick(branch.name)}
                    onMouseEnter={() => setActiveIdx(idx)}
                  >
                    <span className={cn('min-w-0 flex-1 break-all leading-snug', isCurrent && 'font-medium')}>
                      {branch.name}
                    </span>
                    {isCurrent && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                        当前
                      </Badge>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
