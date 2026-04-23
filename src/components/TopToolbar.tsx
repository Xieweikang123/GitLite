import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { invoke } from '@tauri-apps/api/tauri'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import {
  GitBranch,
  Moon,
  Sun,
  GitPullRequest,
  Plus,
  ChevronDown,
  GitMerge,
} from 'lucide-react'
import { BranchInfo } from '../types/git'
import { cn } from '../lib/utils'

interface TopToolbarProps {
  onBranchSelect: (branchName: string) => void
  onCreateBranch?: (branchName: string, checkout: boolean, startPoint?: string) => Promise<boolean>
  onDeleteBranch?: (branchName: string, force: boolean) => Promise<boolean>
  onRenameBranch?: (oldName: string, newName: string) => Promise<boolean>
  onMergeBranch?: (sourceBranch: string, ffOnly: boolean) => Promise<boolean>
  onOpenRemoteRepository?: () => void
  onPullChanges?: () => void
  loading: boolean
  repoInfo: any
  isDark: boolean
  onToggleDarkMode: () => void
}

export function TopToolbar({
  onBranchSelect,
  onCreateBranch,
  onDeleteBranch,
  onRenameBranch,
  onMergeBranch,
  onOpenRemoteRepository,
  onPullChanges,
  loading,
  repoInfo,
  isDark,
  onToggleDarkMode
}: TopToolbarProps) {
  const [createBranchOpen, setCreateBranchOpen] = useState(false)
  const [branchManageOpen, setBranchManageOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [branchStartPoint, setBranchStartPoint] = useState('')
  const [checkoutAfterCreate, setCheckoutAfterCreate] = useState(true)
  const [renameFrom, setRenameFrom] = useState('')
  const [renameTo, setRenameTo] = useState('')
  const [deleteTarget, setDeleteTarget] = useState('')
  const [deleteForce, setDeleteForce] = useState(false)
  const [mergeSource, setMergeSource] = useState('')
  const [mergeFfOnly, setMergeFfOnly] = useState(true)

  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false)
  const [branchSearch, setBranchSearch] = useState('')
  const [branchActiveIdx, setBranchActiveIdx] = useState(0)
  const branchSearchInputRef = useRef<HTMLInputElement>(null)
  const branchListRef = useRef<HTMLDivElement>(null)

  const handleOpenCreateBranch = () => {
    setNewBranchName('')
    setBranchStartPoint('')
    setCheckoutAfterCreate(true)
    setCreateBranchOpen(true)
  }

  const handleSubmitCreateBranch = async () => {
    const name = newBranchName.trim()
    if (!name || !onCreateBranch) return
    const startPoint = branchStartPoint.trim() || undefined
    const ok = await onCreateBranch(name, checkoutAfterCreate, startPoint)
    if (ok) {
      setCreateBranchOpen(false)
      setNewBranchName('')
      setBranchStartPoint('')
    }
  }
  const branches = (repoInfo?.branches ?? []) as BranchInfo[]
  const localBranches = useMemo(() => branches.filter((b) => !b.is_remote), [branches])
  const currentLocalBranch = useMemo(
    () => localBranches.find((b) => b.is_current)?.name ?? repoInfo?.current_branch ?? '',
    [localBranches, repoInfo?.current_branch]
  )
  const nonCurrentLocalBranches = useMemo(
    () => localBranches.filter((b) => b.name !== currentLocalBranch),
    [localBranches, currentLocalBranch]
  )
  const filteredBranches = useMemo(() => {
    const q = branchSearch.trim().toLowerCase()
    if (!q) return branches
    return branches.filter((b) => b.name.toLowerCase().includes(q))
  }, [branches, branchSearch])

  useEffect(() => {
    setBranchActiveIdx(0)
  }, [branchSearch, branchPopoverOpen])

  useEffect(() => {
    if (!branchManageOpen) return
    setRenameFrom(currentLocalBranch)
    setRenameTo('')
    setDeleteTarget(nonCurrentLocalBranches[0]?.name ?? '')
    setDeleteForce(false)
    setMergeSource(nonCurrentLocalBranches[0]?.name ?? '')
    setMergeFfOnly(true)
  }, [branchManageOpen, currentLocalBranch, nonCurrentLocalBranches])

  useEffect(() => {
    if (branchActiveIdx >= filteredBranches.length) {
      setBranchActiveIdx(Math.max(0, filteredBranches.length - 1))
    }
  }, [filteredBranches.length, branchActiveIdx])

  useEffect(() => {
    if (!branchPopoverOpen || filteredBranches.length === 0) return
    const root = branchListRef.current
    if (!root) return
    const btn = root.querySelector<HTMLButtonElement>(
      `button:nth-of-type(${branchActiveIdx + 1})`
    )
    btn?.scrollIntoView({ block: 'nearest' })
  }, [branchActiveIdx, branchPopoverOpen, filteredBranches.length])

  const pickBranch = useCallback(
    (name: string) => {
      if (!repoInfo) return
      if (name === repoInfo.current_branch) {
        setBranchPopoverOpen(false)
        setBranchSearch('')
        return
      }
      onBranchSelect(name)
      setBranchPopoverOpen(false)
      setBranchSearch('')
    },
    [onBranchSelect, repoInfo]
  )

  const onBranchPopoverOpenChange = (open: boolean) => {
    setBranchPopoverOpen(open)
    if (!open) setBranchSearch('')
  }

  const onBranchSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setBranchActiveIdx((i) => Math.min(i + 1, Math.max(0, filteredBranches.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setBranchActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const b = filteredBranches[branchActiveIdx]
      if (b) pickBranch(b.name)
    }
  }

  const handleOpenFolder = async () => {
    try {
      if (repoInfo?.path) {
        await invoke('open_folder', { path: repoInfo.path })
      }
    } catch (error) {
      console.error('无法打开文件夹:', error)
    }
  }

  const handleRenameBranch = async () => {
    if (!onRenameBranch) return
    const from = renameFrom.trim()
    const to = renameTo.trim()
    if (!from || !to) return
    const ok = await onRenameBranch(from, to)
    if (ok) {
      setBranchManageOpen(false)
    }
  }

  const handleDeleteBranch = async () => {
    if (!onDeleteBranch) return
    const target = deleteTarget.trim()
    if (!target) return
    const ok = await onDeleteBranch(target, deleteForce)
    if (ok) {
      setBranchManageOpen(false)
    }
  }

  const handleMergeBranch = async () => {
    if (!onMergeBranch) return
    const source = mergeSource.trim()
    if (!source) return
    const ok = await onMergeBranch(source, mergeFfOnly)
    if (ok) {
      setBranchManageOpen(false)
    }
  }

  return (
    <div className="flex items-center justify-between bg-card border-b px-6 py-3">
      {/* 左侧：应用标题（紧凑） */}
      <div className="flex-shrink-0">
        <h1 className="text-lg font-bold text-foreground">GitLite</h1>
        <p className="text-xs text-muted-foreground">
          轻量级 Git GUI 客户端
        </p>
      </div>

      {/* 中间：当前仓库信息 */}
      <div className="flex items-center gap-6">
        {/* 当前仓库信息和分支选择 */}
        {repoInfo && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <GitBranch
                className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-foreground"
                onClick={onOpenRemoteRepository}
              />
              <Popover open={branchPopoverOpen} onOpenChange={onBranchPopoverOpenChange}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    className="h-8 min-w-[10.5rem] max-w-[min(22rem,40vw)] justify-between gap-2 px-2.5 font-normal sm:min-w-[12rem]"
                    title="选择分支（可搜索，↑↓ 选择，回车切换）"
                  >
                    <span className="min-w-0 truncate text-left text-sm">
                      {repoInfo.current_branch}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={6}
                  className="w-[min(92vw,22rem)] p-2"
                  onOpenAutoFocus={(ev) => {
                    ev.preventDefault()
                    requestAnimationFrame(() => branchSearchInputRef.current?.focus())
                  }}
                >
                  <div className="flex flex-col gap-2">
                    <Input
                      ref={branchSearchInputRef}
                      value={branchSearch}
                      onChange={(e) => setBranchSearch(e.target.value)}
                      onKeyDown={onBranchSearchKeyDown}
                      placeholder="搜索分支名…"
                      className="h-8 text-sm"
                      disabled={loading}
                      aria-label="搜索分支"
                    />
                    <div
                      ref={branchListRef}
                      className="max-h-[min(55vh,320px)] overflow-y-auto overflow-x-hidden rounded-md border border-border/60"
                    >
                      {filteredBranches.length === 0 ? (
                        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                          无匹配分支
                        </p>
                      ) : (
                        filteredBranches.map((branch, idx) => {
                          const isCurrent = branch.name === repoInfo.current_branch
                          const isActive = idx === branchActiveIdx
                          return (
                            <button
                              key={branch.name}
                              type="button"
                              disabled={loading}
                              className={cn(
                                'flex w-full items-start gap-2 border-b border-border/40 px-3 py-2.5 text-left text-sm last:border-b-0',
                                'hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                isActive && 'bg-accent',
                                isCurrent && 'bg-muted/50'
                              )}
                              onClick={() => pickBranch(branch.name)}
                              onMouseEnter={() => setBranchActiveIdx(idx)}
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
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                    当前
                                  </Badge>
                                )}
                                {branch.is_remote && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                    远程
                                  </Badge>
                                )}
                              </span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              {onCreateBranch && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title="新建分支"
                    disabled={loading}
                    onClick={handleOpenCreateBranch}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title="分支管理（重命名/删除/合并）"
                    disabled={
                      loading || (!onDeleteBranch && !onRenameBranch && !onMergeBranch)
                    }
                    onClick={() => setBranchManageOpen(true)}
                  >
                    <GitMerge className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm">
              {typeof repoInfo.ahead === 'number' && repoInfo.ahead > 0 && (
                <span className="text-xs rounded bg-blue-600/10 text-blue-600 px-2 py-0.5">{repoInfo.ahead} 待推送</span>
              )}
              {typeof repoInfo.behind === 'number' && repoInfo.behind > 0 && (
                <span className="text-xs rounded bg-amber-600/10 text-amber-600 px-2 py-0.5">{repoInfo.behind} 待拉取</span>
              )}
            </div>
            <div
              className="text-xs text-muted-foreground max-w-[280px] truncate cursor-pointer hover:text-foreground hover:underline transition-colors"
              title={`${repoInfo.path}\n\n点击打开本地文件夹`}
              onClick={handleOpenFolder}
            >
              {repoInfo.path}
            </div>
          </div>
        )}
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-3">
        {/* 暗色模式切换按钮 */}
        <Button
          onClick={onToggleDarkMode}
          variant="outline"
          size="icon"
          className="h-9 w-9"
          title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
        >
          {isDark ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
        
        {repoInfo && typeof repoInfo.behind === 'number' && repoInfo.behind > 0 && onPullChanges && (
          <Button
            onClick={onPullChanges}
            disabled={loading}
            variant="outline"
            className="flex items-center gap-2"
          >
            <GitPullRequest className="h-4 w-4" />
            拉取 ({repoInfo.behind})
          </Button>
        )}
      </div>

      <Dialog open={createBranchOpen} onOpenChange={setCreateBranchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建分支</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground">
              可从指定提交创建本地分支；起点留空时默认使用当前 HEAD。
            </p>
            <div className="space-y-2">
              <Label htmlFor="new-branch-name">分支名</Label>
              <Input
                id="new-branch-name"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="例如 feature/login"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSubmitCreateBranch()
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-branch-start-point">起点提交（可选）</Label>
              <Input
                id="new-branch-start-point"
                value={branchStartPoint}
                onChange={(e) => setBranchStartPoint(e.target.value)}
                placeholder="例如 a1b2c3d 或完整 commit hash"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSubmitCreateBranch()
                }}
                disabled={loading}
              />
            </div>
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
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateBranchOpen(false)}
                disabled={loading}
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={() => void handleSubmitCreateBranch()}
                disabled={loading || !newBranchName.trim()}
              >
                创建
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={branchManageOpen} onOpenChange={setBranchManageOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>分支管理</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 pt-1">
            {onRenameBranch && (
              <div className="grid gap-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">重命名分支</p>
                <div className="grid gap-1.5">
                  <Label htmlFor="rename-branch-from">原分支</Label>
                  <select
                    id="rename-branch-from"
                    value={renameFrom}
                    onChange={(e) => setRenameFrom(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    disabled={loading || localBranches.length === 0}
                  >
                    {localBranches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rename-branch-to">新分支名</Label>
                  <Input
                    id="rename-branch-to"
                    value={renameTo}
                    onChange={(e) => setRenameTo(e.target.value)}
                    placeholder="例如 feature/login"
                    disabled={loading}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRenameBranch()
                    }}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleRenameBranch()}
                    disabled={loading || !renameFrom.trim() || !renameTo.trim()}
                  >
                    重命名
                  </Button>
                </div>
              </div>
            )}

            {onDeleteBranch && (
              <div className="grid gap-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">删除分支</p>
                <div className="grid gap-1.5">
                  <Label htmlFor="delete-branch-target">目标分支</Label>
                  <select
                    id="delete-branch-target"
                    value={deleteTarget}
                    onChange={(e) => setDeleteTarget(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    disabled={loading || nonCurrentLocalBranches.length === 0}
                  >
                    {nonCurrentLocalBranches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <Label htmlFor="delete-force" className="cursor-pointer text-sm font-normal">
                    强制删除（等价于 `git branch -D`）
                  </Label>
                  <Switch
                    id="delete-force"
                    checked={deleteForce}
                    onCheckedChange={setDeleteForce}
                    disabled={loading}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleDeleteBranch()}
                    disabled={loading || !deleteTarget.trim()}
                  >
                    删除分支
                  </Button>
                </div>
              </div>
            )}

            {onMergeBranch && (
              <div className="grid gap-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">合并到当前分支</p>
                <div className="grid gap-1.5">
                  <Label htmlFor="merge-branch-source">来源分支</Label>
                  <select
                    id="merge-branch-source"
                    value={mergeSource}
                    onChange={(e) => setMergeSource(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    disabled={loading || nonCurrentLocalBranches.length === 0}
                  >
                    {nonCurrentLocalBranches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <Label htmlFor="merge-ff-only" className="cursor-pointer text-sm font-normal">
                    仅快进合并（`--ff-only`）
                  </Label>
                  <Switch
                    id="merge-ff-only"
                    checked={mergeFfOnly}
                    onCheckedChange={setMergeFfOnly}
                    disabled={loading}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleMergeBranch()}
                    disabled={loading || !mergeSource.trim()}
                  >
                    合并
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
