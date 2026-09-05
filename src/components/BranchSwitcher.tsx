import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  Check,
  ChevronDown,
  Download,
  GitMerge,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Switch } from './ui/switch'
import { BranchInfo, BranchSyncOverview, CommitInfo } from '../types/git'
import { cn } from '../lib/utils'

type BranchStartPick =
  | { kind: 'head' }
  | { kind: 'branch'; name: string }
  | { kind: 'commit'; id: string; shortId: string; message: string }
  | { kind: 'custom'; value: string }

type StartPickerRow =
  | { key: 'head'; kind: 'head' }
  | { key: string; kind: 'branch'; branch: BranchInfo }
  | { key: string; kind: 'commit'; commit: CommitInfo }
  | { key: string; kind: 'custom'; value: string }

function startPointFromPick(pick: BranchStartPick): string | undefined {
  if (pick.kind === 'head') return undefined
  if (pick.kind === 'branch') return pick.name
  if (pick.kind === 'commit') return pick.id
  const custom = pick.value.trim()
  return custom || undefined
}

function firstLine(message: string): string {
  return message.split('\n')[0]?.trim() || '(无说明)'
}

function looksLikeGitRef(query: string): boolean {
  const q = query.trim()
  if (q.length < 4) return false
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(q)
}

function branchKey(branch: BranchInfo): string {
  return `${branch.is_remote ? 'r' : 'l'}:${branch.name}`
}

function CreateBranchStartPicker({
  branches,
  commits,
  currentBranch,
  headShortId,
  loading,
  value,
  onChange,
}: {
  branches: BranchInfo[]
  commits: CommitInfo[]
  currentBranch: string
  headShortId?: string | null
  loading: boolean
  value: BranchStartPick
  onChange: (next: BranchStartPick) => void
}) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const headLabel = [currentBranch, headShortId].filter(Boolean).join(' · ') || '当前 HEAD'

  const rows = useMemo<StartPickerRow[]>(() => {
    const q = query.trim().toLowerCase()
    const filteredBranches = q
      ? branches.filter((b) => b.name.toLowerCase().includes(q))
      : branches
    const filteredCommits = (q
      ? commits.filter((c) => {
          const subject = firstLine(c.message).toLowerCase()
          return (
            c.short_id.toLowerCase().includes(q) ||
            c.id.toLowerCase().includes(q) ||
            subject.includes(q) ||
            c.author.toLowerCase().includes(q)
          )
        })
      : commits
    ).slice(0, 40)

    const next: StartPickerRow[] = []
    if (!q) next.push({ key: 'head', kind: 'head' })
    for (const branch of filteredBranches) {
      next.push({ key: `b:${branch.name}`, kind: 'branch', branch })
    }
    for (const commit of filteredCommits) {
      next.push({ key: `c:${commit.id}`, kind: 'commit', commit })
    }

    const raw = query.trim()
    if (
      looksLikeGitRef(raw) &&
      !filteredBranches.some((b) => b.name === raw) &&
      !commits.some((c) => c.id === raw || c.short_id === raw)
    ) {
      next.push({ key: `custom:${raw}`, kind: 'custom', value: raw })
    }
    return next
  }, [branches, commits, query])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    if (activeIdx >= rows.length) {
      setActiveIdx(Math.max(0, rows.length - 1))
    }
  }, [rows.length, activeIdx])

  useEffect(() => {
    const root = listRef.current
    if (!root) return
    const btn = root.querySelector<HTMLButtonElement>(`button[data-start-row="${activeIdx}"]`)
    btn?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, rows.length])

  const applyRow = (row: StartPickerRow) => {
    if (row.kind === 'head') onChange({ kind: 'head' })
    else if (row.kind === 'branch') onChange({ kind: 'branch', name: row.branch.name })
    else if (row.kind === 'commit') {
      onChange({
        kind: 'commit',
        id: row.commit.id,
        shortId: row.commit.short_id,
        message: firstLine(row.commit.message),
      })
    } else onChange({ kind: 'custom', value: row.value })
  }

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, rows.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[activeIdx]
      if (row) applyRow(row)
    }
  }

  const selected = (() => {
    if (value.kind === 'head') {
      return { title: '当前 HEAD', detail: headLabel }
    }
    if (value.kind === 'branch') {
      return { title: '分支', detail: value.name }
    }
    if (value.kind === 'commit') {
      return { title: value.shortId, detail: value.message }
    }
    return { title: '指定起点', detail: value.value }
  })()

  const isRowSelected = (row: StartPickerRow) => {
    if (row.kind === 'head') return value.kind === 'head'
    if (row.kind === 'branch') return value.kind === 'branch' && value.name === row.branch.name
    if (row.kind === 'commit') return value.kind === 'commit' && value.id === row.commit.id
    return value.kind === 'custom' && value.value === row.value
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="new-branch-start-search">起点</Label>
        {value.kind !== 'head' && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            disabled={loading}
            onClick={() => {
              setQuery('')
              onChange({ kind: 'head' })
            }}
          >
            恢复为当前 HEAD
          </button>
        )}
      </div>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
        <p className="text-xs text-muted-foreground">{selected.title}</p>
        <p className="mt-0.5 truncate text-sm text-foreground" title={selected.detail}>
          {selected.detail}
        </p>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="new-branch-start-search"
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="搜索分支、提交说明或 hash…"
          className="h-9 pl-8 text-sm"
          disabled={loading}
        />
      </div>
      <div
        ref={listRef}
        className="max-h-[min(40vh,260px)] overflow-y-auto overflow-x-hidden rounded-md border border-border/60"
      >
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">无匹配项</p>
        ) : (
          rows.map((row, idx) => {
            const active = idx === activeIdx
            const selectedRow = isRowSelected(row)
            const sectionLabel =
              row.kind === 'branch' && rows[idx - 1]?.kind !== 'branch'
                ? '分支'
                : row.kind === 'commit' && rows[idx - 1]?.kind !== 'commit'
                  ? '最近提交'
                  : null
            const section = sectionLabel ? (
              <p className="sticky top-0 z-[1] bg-muted/80 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
                {sectionLabel}
              </p>
            ) : null
            if (row.kind === 'head') {
              return (
                <button
                  key={row.key}
                  type="button"
                  data-start-row={idx}
                  disabled={loading}
                  className={cn(
                    'flex w-full items-start gap-2 border-b border-border/40 px-3 py-2 text-left text-sm last:border-b-0',
                    'hover:bg-accent focus:outline-none',
                    active && 'bg-accent',
                    selectedRow && 'bg-muted/50'
                  )}
                  onClick={() => applyRow(row)}
                  onMouseEnter={() => setActiveIdx(idx)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">当前 HEAD</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {headLabel}（默认）
                    </span>
                  </span>
                  {selectedRow && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              )
            }
            if (row.kind === 'branch') {
              return (
                <div key={row.key}>
                  {section}
                  <button
                    type="button"
                    data-start-row={idx}
                    disabled={loading}
                    className={cn(
                      'flex w-full items-start gap-2 border-b border-border/40 px-3 py-2 text-left text-sm last:border-b-0',
                      'hover:bg-accent focus:outline-none',
                      active && 'bg-accent',
                      selectedRow && 'bg-muted/50'
                    )}
                    onClick={() => applyRow(row)}
                    onMouseEnter={() => setActiveIdx(idx)}
                  >
                    <span className="min-w-0 flex-1 break-all leading-snug">{row.branch.name}</span>
                    <span className="flex shrink-0 flex-row flex-wrap items-center justify-end gap-1 pt-0.5">
                      {row.branch.is_current && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          当前
                        </Badge>
                      )}
                      {row.branch.is_remote && (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          远程
                        </Badge>
                      )}
                      {selectedRow && <Check className="h-3.5 w-3.5 text-primary" />}
                    </span>
                  </button>
                </div>
              )
            }
            if (row.kind === 'commit') {
              const subject = firstLine(row.commit.message)
              return (
                <div key={row.key}>
                  {section}
                  <button
                    type="button"
                    data-start-row={idx}
                    disabled={loading}
                    className={cn(
                      'flex w-full items-start gap-2 border-b border-border/40 px-3 py-2 text-left text-sm last:border-b-0',
                      'hover:bg-accent focus:outline-none',
                      active && 'bg-accent',
                      selectedRow && 'bg-muted/50'
                    )}
                    onClick={() => applyRow(row)}
                    onMouseEnter={() => setActiveIdx(idx)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{row.commit.short_id}</span>
                        <span className="truncate text-xs text-muted-foreground">{row.commit.author}</span>
                      </span>
                      <span className="mt-0.5 block truncate" title={subject}>
                        {subject}
                      </span>
                    </span>
                    {selectedRow && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                </div>
              )
            }
            return (
              <button
                key={row.key}
                type="button"
                data-start-row={idx}
                disabled={loading}
                className={cn(
                  'flex w-full items-start gap-2 border-b border-border/40 px-3 py-2 text-left text-sm last:border-b-0',
                  'hover:bg-accent focus:outline-none',
                  active && 'bg-accent',
                  selectedRow && 'bg-muted/50'
                )}
                onClick={() => applyRow(row)}
                onMouseEnter={() => setActiveIdx(idx)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">使用输入内容作为起点</span>
                  <span className="mt-0.5 block truncate font-mono text-sm">{row.value}</span>
                </span>
                {selectedRow && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

export interface BranchSwitcherProps {
  branches: BranchInfo[]
  currentBranch: string
  headShortId?: string | null
  commits: CommitInfo[]
  loading: boolean
  onBranchSelect: (branchName: string) => void
  onCreateBranch?: (branchName: string, checkout: boolean, startPoint?: string) => Promise<boolean>
  onDeleteBranch?: (branchName: string, force: boolean) => Promise<boolean>
  onRenameBranch?: (oldName: string, newName: string) => Promise<boolean>
  onMergeBranch?: (sourceBranch: string, ffOnly: boolean) => Promise<boolean>
  onFetchRemoteOverview?: () => Promise<BranchSyncOverview[]>
}

export function BranchSwitcher({
  branches,
  currentBranch,
  headShortId,
  commits,
  loading,
  onBranchSelect,
  onCreateBranch,
  onDeleteBranch,
  onRenameBranch,
  onMergeBranch,
  onFetchRemoteOverview,
}: BranchSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [branchStartPick, setBranchStartPick] = useState<BranchStartPick>({ kind: 'head' })
  const [checkoutAfterCreate, setCheckoutAfterCreate] = useState(true)

  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeSource, setMergeSource] = useState<BranchInfo | null>(null)
  const [mergeFfOnly, setMergeFfOnly] = useState(false)
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)

  const [fetchingRemote, setFetchingRemote] = useState(false)
  const [syncOverview, setSyncOverview] = useState<Map<string, BranchSyncOverview>>(new Map())
  const [fetchRemoteError, setFetchRemoteError] = useState<string | null>(null)

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameFrom, setRenameFrom] = useState('')
  const [renameTo, setRenameTo] = useState('')

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState('')
  const [deleteForce, setDeleteForce] = useState(false)

  const filteredBranches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return branches
    return branches.filter((b) => b.name.toLowerCase().includes(q))
  }, [branches, search])

  useEffect(() => {
    setActiveIdx(0)
    setMenuKey(null)
  }, [search, open])

  useEffect(() => {
    if (activeIdx >= filteredBranches.length) {
      setActiveIdx(Math.max(0, filteredBranches.length - 1))
    }
  }, [filteredBranches.length, activeIdx])

  useEffect(() => {
    if (!open || filteredBranches.length === 0) return
    const root = listRef.current
    if (!root) return
    const btn = root.querySelector<HTMLButtonElement>(`button[data-branch-row="${activeIdx}"]`)
    btn?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open, filteredBranches.length])

  const closePanel = useCallback(() => {
    setOpen(false)
    setSearch('')
    setMenuKey(null)
  }, [])

  const pickBranch = useCallback(
    (name: string) => {
      if (name === currentBranch) {
        closePanel()
        return
      }
      onBranchSelect(name)
      closePanel()
    },
    [closePanel, currentBranch, onBranchSelect]
  )

  const openCreate = (start?: BranchStartPick) => {
    setNewBranchName('')
    setBranchStartPick(start ?? { kind: 'head' })
    setCheckoutAfterCreate(true)
    closePanel()
    setCreateOpen(true)
  }

  const openMerge = (branch: BranchInfo) => {
    setMergeSource(branch)
    setMergeFfOnly(false)
    setMergeError(null)
    closePanel()
    setMergeOpen(true)
  }

  const handleFetchRemoteOverview = async () => {
    if (!onFetchRemoteOverview || fetchingRemote) return
    setFetchingRemote(true)
    setFetchRemoteError(null)
    try {
      const overview = await onFetchRemoteOverview()
      const map = new Map<string, BranchSyncOverview>()
      for (const item of overview) map.set(item.name, item)
      setSyncOverview(map)
    } catch (err) {
      setFetchRemoteError(err instanceof Error ? err.message : '获取远端状态失败')
    } finally {
      setFetchingRemote(false)
    }
  }

  // 面板打开时自动获取一次远端状态（静默进行，不阻塞面板交互）
  const fetchOverviewRef = useRef(onFetchRemoteOverview)
  fetchOverviewRef.current = onFetchRemoteOverview
  const autoFetchedForOpenRef = useRef(false)
  useEffect(() => {
    if (!open) {
      autoFetchedForOpenRef.current = false
      return
    }
    if (autoFetchedForOpenRef.current) return
    autoFetchedForOpenRef.current = true
    void handleFetchRemoteOverview()
    // 仅在面板打开瞬间触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const openRename = (name: string) => {
    setRenameFrom(name)
    setRenameTo(name)
    closePanel()
    setRenameOpen(true)
  }

  const openDelete = (name: string) => {
    setDeleteTarget(name)
    setDeleteForce(false)
    closePanel()
    setDeleteOpen(true)
  }

  const handleSubmitCreate = async () => {
    const name = newBranchName.trim()
    if (!name || !onCreateBranch) return
    const ok = await onCreateBranch(name, checkoutAfterCreate, startPointFromPick(branchStartPick))
    if (ok) {
      setCreateOpen(false)
      setNewBranchName('')
      setBranchStartPick({ kind: 'head' })
    }
  }

  const handleSubmitMerge = async () => {
    if (!onMergeBranch || !mergeSource || mergeBusy) return
    setMergeBusy(true)
    setMergeError(null)
    const ok = await onMergeBranch(mergeSource.name, mergeFfOnly)
    setMergeBusy(false)
    if (ok) {
      setMergeOpen(false)
    } else {
      setMergeError('合并未完成：请查看顶部通知里的日志了解原因（最常见的是存在冲突或未提交改动）。')
    }
  }

  const handleSubmitRename = async () => {
    if (!onRenameBranch) return
    const from = renameFrom.trim()
    const to = renameTo.trim()
    if (!from || !to) return
    const ok = await onRenameBranch(from, to)
    if (ok) setRenameOpen(false)
  }

  const handleSubmitDelete = async () => {
    if (!onDeleteBranch) return
    const target = deleteTarget.trim()
    if (!target) return
    const ok = await onDeleteBranch(target, deleteForce)
    if (ok) setDeleteOpen(false)
  }

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, filteredBranches.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const b = filteredBranches[activeIdx]
      if (b) pickBranch(b.name)
    }
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setSearch('')
            setMenuKey(null)
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            className="h-8 min-w-[10.5rem] max-w-[min(22rem,40vw)] justify-between gap-2 px-2.5 font-normal sm:min-w-[12rem]"
            title="切换分支，或对某个分支合并 / 新建 / 重命名 / 删除"
          >
            <span className="min-w-0 truncate text-left text-sm">{currentBranch}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[min(92vw,28rem)] p-2"
          onOpenAutoFocus={(ev) => {
            ev.preventDefault()
            requestAnimationFrame(() => searchRef.current?.focus())
          }}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="搜索分支…"
                  className="h-8 pl-8 text-sm"
                  disabled={loading}
                  aria-label="搜索分支"
                />
              </div>
              {onCreateBranch && (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 shrink-0 px-2 text-xs"
                  disabled={loading}
                  title="新建分支"
                  onClick={() => openCreate()}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  新建
                </Button>
              )}
              {onFetchRemoteOverview && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 px-2 text-xs"
                  disabled={loading || fetchingRemote}
                  title="从远程获取最新状态（不改动本地分支与工作区），并显示各分支可拉取的更新"
                  onClick={() => void handleFetchRemoteOverview()}
                >
                  {fetchingRemote ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-1 h-3.5 w-3.5" />
                  )}
                  {fetchingRemote ? '获取中…' : '获取远端'}
                </Button>
              )}
            </div>
            <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
              点名称切换到该分支。合并会把选中分支合进当前的「{currentBranch}」。
            </p>
            {fetchRemoteError && (
              <p className="break-words rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] leading-relaxed text-destructive">
                {fetchRemoteError}
              </p>
            )}
            <div
              ref={listRef}
              className="max-h-[min(55vh,360px)] overflow-y-auto overflow-x-hidden rounded-md border border-border/60"
            >
              {filteredBranches.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">无匹配分支</p>
              ) : (
                filteredBranches.map((branch, idx) => {
                  const isCurrent = !branch.is_remote && branch.name === currentBranch
                  const isActive = idx === activeIdx
                  const showLocalHeader = !branch.is_remote && idx === 0
                  const showRemoteHeader =
                    !!branch.is_remote && (idx === 0 || !filteredBranches[idx - 1]?.is_remote)
                  const key = branchKey(branch)
                  const menuOpen = menuKey === key
                  return (
                    <div key={key} className="relative">
                      {showLocalHeader && (
                        <p className="bg-muted/40 px-3 py-1 text-[10px] font-medium text-muted-foreground">
                          本地
                        </p>
                      )}
                      {showRemoteHeader && (
                        <p className="bg-muted/40 px-3 py-1 text-[10px] font-medium text-muted-foreground">
                          远程跟踪
                        </p>
                      )}
                      <div
                        className={cn(
                          'flex items-stretch border-b border-border/40 last:border-b-0',
                          isActive && 'bg-accent',
                          isCurrent && 'bg-muted/50'
                        )}
                        onMouseEnter={() => setActiveIdx(idx)}
                      >
                        <button
                          type="button"
                          data-branch-row={idx}
                          disabled={loading}
                          className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => pickBranch(branch.name)}
                        >
                          <span
                            className={cn(
                              'min-w-0 flex-1 break-all leading-snug',
                              isCurrent && 'font-medium text-foreground'
                            )}
                          >
                            {branch.name}
                          </span>
                          <span className="flex shrink-0 flex-row flex-wrap items-center justify-end gap-1 pt-0.5">
                            {branch.is_current && (
                              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                当前
                              </Badge>
                            )}
                            {branch.is_remote && (
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                远程
                              </Badge>
                            )}
                            {!branch.is_remote &&
                              (() => {
                                const sync = syncOverview.get(branch.name)
                                if (!sync || sync.behind <= 0) return null
                                return (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-500/40 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-300"
                                    title={`${branch.name} 落后其上游 ${sync.behind} 个提交，可切过去拉取或快进更新`}
                                  >
                                    可拉取 {sync.behind}
                                  </Badge>
                                )
                              })()}
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5 pr-1">
                          {!isCurrent && onMergeBranch && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-1.5 text-[11px]"
                              disabled={loading}
                              title={`把 ${branch.name} 合并进 ${currentBranch}`}
                              onClick={() => openMerge(branch)}
                            >
                              <GitMerge className="mr-0.5 h-3.5 w-3.5" />
                              合并
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={loading}
                            title="更多操作"
                            onClick={() => setMenuKey(menuOpen ? null : key)}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {menuOpen && (
                        <div className="flex flex-wrap gap-1 border-b border-border/40 bg-muted/30 px-2 py-1.5">
                          {!isCurrent && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => pickBranch(branch.name)}
                            >
                              切换
                            </Button>
                          )}
                          {onCreateBranch && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => openCreate({ kind: 'branch', name: branch.name })}
                            >
                              <Plus className="mr-1 h-3 w-3" />
                              从此新建
                            </Button>
                          )}
                          {!branch.is_remote && onRenameBranch && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => openRename(branch.name)}
                            >
                              <Pencil className="mr-1 h-3 w-3" />
                              重命名
                            </Button>
                          )}
                          {!branch.is_remote && !isCurrent && onDeleteBranch && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[11px] text-destructive"
                              onClick={() => openDelete(branch.name)}
                            >
                              <Trash2 className="mr-1 h-3 w-3" />
                              删除
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[min(90vh,760px)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新建分支</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground">
              默认从当前 HEAD 创建。也可选择已有分支或最近提交作为起点。
            </p>
            <div className="space-y-2">
              <Label htmlFor="new-branch-name">分支名</Label>
              <Input
                id="new-branch-name"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="例如 feature/login"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSubmitCreate()
                }}
                autoFocus
              />
            </div>
            <CreateBranchStartPicker
              branches={branches}
              commits={commits}
              currentBranch={currentBranch}
              headShortId={headShortId}
              loading={loading}
              value={branchStartPick}
              onChange={setBranchStartPick}
            />
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <Label htmlFor="checkout-after-create" className="cursor-pointer text-sm font-normal">
                创建后切换到新分支
              </Label>
              <Switch
                id="checkout-after-create"
                checked={checkoutAfterCreate}
                onCheckedChange={setCheckoutAfterCreate}
                disabled={loading}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={loading}>
                取消
              </Button>
              <Button
                type="button"
                onClick={() => void handleSubmitCreate()}
                disabled={loading || !newBranchName.trim()}
              >
                创建
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>合并到当前分支</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm leading-relaxed">
              把 <span className="font-medium">{mergeSource?.name}</span> 的提交合并进当前分支{' '}
              <span className="font-medium">{currentBranch}</span>。
              完成后你仍停留在 {currentBranch}。
            </p>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <div className="min-w-0">
                <Label htmlFor="merge-ff-only" className="cursor-pointer text-sm font-normal">
                  仅快进
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  两边有分叉时会失败。一般保持关闭即可。
                </p>
              </div>
              <Switch
                id="merge-ff-only"
                checked={mergeFfOnly}
                onCheckedChange={setMergeFfOnly}
                disabled={mergeBusy || loading}
              />
            </div>
            {mergeError && (
              <p className="break-words rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                {mergeError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setMergeOpen(false)} disabled={mergeBusy || loading}>
                取消
              </Button>
              <Button type="button" onClick={() => void handleSubmitMerge()} disabled={mergeBusy || loading || !mergeSource}>
                {mergeBusy ? (
                  <>
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    合并中…
                  </>
                ) : (
                  '合并'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>重命名分支</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground">将本地分支 {renameFrom} 改名。</p>
            <div className="space-y-2">
              <Label htmlFor="rename-branch-to">新名称</Label>
              <Input
                id="rename-branch-to"
                value={renameTo}
                onChange={(e) => setRenameTo(e.target.value)}
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSubmitRename()
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)} disabled={loading}>
                取消
              </Button>
              <Button
                type="button"
                onClick={() => void handleSubmitRename()}
                disabled={loading || !renameFrom.trim() || !renameTo.trim() || renameFrom.trim() === renameTo.trim()}
              >
                重命名
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除分支</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm leading-relaxed">
              删除本地分支 <span className="font-medium">{deleteTarget}</span>。不会删除远程上的同名分支。
            </p>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <div className="min-w-0">
                <Label htmlFor="delete-force" className="cursor-pointer text-sm font-normal">
                  尚未合并也删除
                </Label>
                <p className="text-[11px] text-muted-foreground">对应 git branch -D，未合进去的提交会丢掉引用。</p>
              </div>
              <Switch
                id="delete-force"
                checked={deleteForce}
                onCheckedChange={setDeleteForce}
                disabled={loading}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={loading}>
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleSubmitDelete()}
                disabled={loading || !deleteTarget.trim()}
              >
                删除
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
