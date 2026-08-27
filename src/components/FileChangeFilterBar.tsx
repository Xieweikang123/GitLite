import { useMemo } from 'react'
import { FileText, GitBranch, Copy, Plus, Edit, Trash2, Search, X } from 'lucide-react'
import { FileChange } from '../types/git'
import { cn } from '../lib/utils'
import { Input } from './ui/input'

export type FileStatusFilter =
  | 'all'
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'other'

export interface FileStatusBucket {
  status: FileStatusFilter
  count: number
}

const STATUS_LABELS: Record<FileStatusFilter, string> = {
  all: '全部',
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
  copied: '复制',
  other: '其他',
}

const STATUS_DOT_CLASS: Record<FileStatusFilter, string> = {
  all: 'bg-muted-foreground/60',
  added: 'bg-emerald-500',
  modified: 'bg-blue-500',
  deleted: 'bg-red-500',
  renamed: 'bg-yellow-500',
  copied: 'bg-cyan-500',
  other: 'bg-gray-400 dark:bg-gray-600',
}

function statusToBucket(status: string): FileStatusFilter {
  switch (status) {
    case 'added':
    case 'deleted':
    case 'modified':
    case 'renamed':
    case 'copied':
      return status
    default:
      return 'other'
  }
}

/** 统计各状态的文件数，仅保留出现的状态（供筛选条渲染 chip） */
export function countFileChangeStatuses(files: FileChange[]): FileStatusBucket[] {
  const counts = new Map<FileStatusFilter, number>()
  for (const f of files) {
    const key = statusToBucket(f.status)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const order: FileStatusFilter[] = ['added', 'modified', 'deleted', 'renamed', 'copied', 'other']
  return order
    .filter((s) => counts.has(s))
    .map((s) => ({ status: s, count: counts.get(s)! }))
}

/** 按状态 + 关键字过滤；关键字按空白拆词，全词命中（大小写不敏感，匹配完整路径） */
export function filterFileChanges(
  files: FileChange[],
  query: string,
  status: FileStatusFilter
): FileChange[] {
  const q = query.trim().toLowerCase()
  const terms = q ? q.split(/\s+/) : []
  return files.filter((f) => {
    if (status !== 'all' && statusToBucket(f.status) !== status) return false
    if (terms.length === 0) return true
    const path = f.path.toLowerCase()
    return terms.every((t) => path.includes(t))
  })
}

export function isFileFilterActive(query: string, status: FileStatusFilter): boolean {
  return query.trim() !== '' || status !== 'all'
}

function StatusIcon({ status }: { status: FileStatusFilter }) {
  switch (status) {
    case 'added':
      return <Plus className="h-3 w-3" />
    case 'modified':
      return <Edit className="h-3 w-3" />
    case 'deleted':
      return <Trash2 className="h-3 w-3" />
    case 'renamed':
      return <GitBranch className="h-3 w-3" />
    case 'copied':
      return <Copy className="h-3 w-3" />
    case 'other':
      return <FileText className="h-3 w-3" />
    default:
      return null
  }
}

interface FileChangeFilterBarProps {
  query: string
  onQueryChange: (q: string) => void
  status: FileStatusFilter
  onStatusChange: (s: FileStatusFilter) => void
  buckets: FileStatusBucket[]
}

/** 文件列表顶部的紧凑筛选条：搜索框（匹配文件名/路径）+ 状态分组 chip */
export function FileChangeFilterBar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  buckets,
}: FileChangeFilterBarProps) {
  const hasBuckets = buckets.length > 0

  const clearButton = useMemo(() => {
    if (!query) return null
    return (
      <button
        type="button"
        aria-label="清空搜索"
        title="清空搜索"
        className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => onQueryChange('')}
      >
        <X className="h-3 w-3" />
      </button>
    )
  }, [query, onQueryChange])

  return (
    <div className="flex flex-col gap-1 px-1 pb-1 pt-0.5 sm:px-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索文件名或路径"
          spellCheck={false}
          className="h-6 border-border/60 bg-transparent py-0 pl-6 pr-6 text-[11px] leading-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
        />
        {clearButton}
      </div>
      {hasBuckets && (
        <div className="flex flex-wrap items-center gap-1">
          {[{ status: 'all' as const, count: buckets.reduce((n, b) => n + b.count, 0) }, ...buckets].map(
            ({ status: s, count }) => {
              const active = status === s
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onStatusChange(s)}
                  aria-pressed={active}
                  className={cn(
                    'flex h-[18px] items-center gap-1 rounded-full px-1.5 text-[11px] leading-none transition-colors',
                    active
                      ? 'bg-accent font-medium ring-1 ring-inset ring-primary/25'
                      : 'text-muted-foreground hover:bg-accent/55'
                  )}
                  title={`只看${STATUS_LABELS[s]}`}
                >
                  <span
                    className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT_CLASS[s])}
                    aria-hidden
                  />
                  {STATUS_LABELS[s]}
                  <span className="tabular-nums opacity-70">{count}</span>
                </button>
              )
            }
          )}
        </div>
      )}
    </div>
  )
}
