import {
  useState,
  useEffect,
  useRef,
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Button } from './ui/button'
import {
  Clock,
  FileText,
  FolderOpen,
  FolderPlus,
  Download,
  Network,
  ShieldCheck,
  Sparkles,
  Pencil,
  Search,
  Trash2,
  Loader2,
  MoreHorizontal,
  Moon,
  Sun,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { RecentRepo, type RepoInfo } from '../types/git'
import { cn, shortenPathMiddle } from '../lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

const INLINE_RECENT_REPO_LIMIT = 5

function normalizePastedPath(value: string) {
  let q = value.trim()
  if (
    (q.startsWith('"') && q.endsWith('"')) ||
    (q.startsWith("'") && q.endsWith("'"))
  ) {
    q = q.slice(1, -1).trim()
  }
  return q
}

function looksLikeRepoPath(value: string) {
  const q = normalizePastedPath(value)
  if (!q) return false
  if (/^[a-zA-Z]:[\\/]/.test(q)) return true
  if (q.startsWith('\\\\') || q.startsWith('//')) return true
  if (q.startsWith('/') || q.startsWith('~/')) return true
  return q.includes('\\') && q.length >= 3
}

interface MenuToolbarProps {
  onOpenRepository: () => void
  onRepoSelect: (path: string) => void
  onRemoveRecentRepo: (path: string) => void
  onUpdateRecentRepo: (
    oldPath: string,
    newPath: string,
    newName: string
  ) => void | Promise<void>
  recentRepos: RecentRepo[]
  autoOpenEnabled: boolean
  onToggleAutoOpen: (enabled: boolean) => void
  loading: boolean
  repoInfo: RepoInfo | null
  onInitRepository?: (path: string, initialBranch?: string) => Promise<boolean>
  onCloneRepository?: (
    remoteUrl: string,
    destinationPath: string,
    branch?: string
  ) => Promise<boolean>
  onOpenProxyConfig?: () => void
  onOpenAiConfig?: () => void
  onOpenReliabilityPanel?: () => void
  isMultiRepo?: boolean
  onSelectSingleRepo?: () => void
  onSelectMultiRepo?: () => void
  isDark?: boolean
  onToggleDarkMode?: () => void
}

export function MenuToolbar({
  onOpenRepository,
  onRepoSelect,
  onRemoveRecentRepo,
  onUpdateRecentRepo,
  recentRepos,
  autoOpenEnabled,
  onToggleAutoOpen,
  loading,
  repoInfo,
  onInitRepository,
  onCloneRepository,
  onOpenProxyConfig,
  onOpenAiConfig,
  onOpenReliabilityPanel,
  isMultiRepo = false,
  onSelectSingleRepo,
  onSelectMultiRepo,
  isDark,
  onToggleDarkMode,
}: MenuToolbarProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    repo: RecentRepo
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const [recentDialogOpen, setRecentDialogOpen] = useState(false)
  const [recentSearch, setRecentSearch] = useState('')
  const [editTarget, setEditTarget] = useState<RecentRepo | null>(null)
  const [editName, setEditName] = useState('')
  const [editPath, setEditPath] = useState('')
  const [initDialogOpen, setInitDialogOpen] = useState(false)
  const [initRepoPath, setInitRepoPath] = useState('')
  const [initBranchName, setInitBranchName] = useState('main')
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)
  const [cloneRemoteUrl, setCloneRemoteUrl] = useState('')
  const [cloneTargetPath, setCloneTargetPath] = useState('')
  const [cloneBranchName, setCloneBranchName] = useState('')
  const [cloning, setCloning] = useState(false)
  const [cloneProgress, setCloneProgress] = useState<string[]>([])
  const cloneProgressRef = useRef<string[]>([])
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    if (!editTarget) return
    const closeEditFirst = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      setEditTarget(null)
    }
    document.addEventListener('keydown', closeEditFirst, true)
    return () => {
      document.removeEventListener('keydown', closeEditFirst, true)
    }
  }, [editTarget])

  useEffect(() => {
    if (!contextMenu) return
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      setContextMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', close, true)
      document.addEventListener('keydown', onKey, true)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', close, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [contextMenu])

  // 监听克隆进度事件
  useEffect(() => {
    if (!cloning) return
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('clone-progress', (event) => {
        cloneProgressRef.current = [...cloneProgressRef.current, event.payload]
        setCloneProgress([...cloneProgressRef.current])
      }).then((fn) => { unlisten = fn })
    })
    return () => { unlisten?.() }
  }, [cloning])

  const inlineRecentRepos = recentRepos.slice(0, INLINE_RECENT_REPO_LIMIT)

  const filteredRecentRepos = useMemo(() => {
    const q = recentSearch.trim().toLowerCase()
    if (!q) return recentRepos
    return recentRepos.filter((repo) => {
      return (
        repo.name.toLowerCase().includes(q) ||
        repo.path.toLowerCase().includes(q)
      )
    })
  }, [recentRepos, recentSearch])

  const openEdit = (repo: RecentRepo) => {
    setContextMenu(null)
    setEditTarget(repo)
    setEditName(repo.name)
    setEditPath(repo.path)
  }

  const pickEditFolder = async () => {
    const { open } = await import('@tauri-apps/api/dialog')
    const selected = await open({
      directory: true,
      title: '选择 Git 仓库目录',
    })
    if (typeof selected === 'string') {
      setEditPath(selected)
    }
  }

  const submitEdit = async () => {
    if (!editTarget) return
    const name = editName.trim()
    const path = editPath.trim()
    if (!name || !path) return
    await onUpdateRecentRepo(editTarget.path, path, name)
    setEditTarget(null)
  }

  const pickInitFolder = async () => {
    const { open } = await import('@tauri-apps/api/dialog')
    const selected = await open({
      directory: true,
      title: '选择仓库目录',
    })
    if (typeof selected === 'string') {
      setInitRepoPath(selected)
    }
  }

  const pickCloneFolder = async () => {
    const { open } = await import('@tauri-apps/api/dialog')
    const selected = await open({
      directory: true,
      title: '选择克隆目标目录',
    })
    if (typeof selected === 'string') {
      setCloneTargetPath(selected)
    }
  }

  const submitInitRepository = async () => {
    if (!onInitRepository) return
    const ok = await onInitRepository(initRepoPath, initBranchName)
    if (!ok) return
    setInitDialogOpen(false)
    setInitRepoPath('')
    setInitBranchName('main')
  }

  const submitCloneRepository = async () => {
    if (!onCloneRepository) return
    setCloning(true)
    setCloneProgress([])
    cloneProgressRef.current = []
    const ok = await onCloneRepository(cloneRemoteUrl, cloneTargetPath, cloneBranchName)
    setCloning(false)
    if (!ok) return
    setCloneDialogOpen(false)
    setCloneRemoteUrl('')
    setCloneTargetPath('')
    setCloneBranchName('')
    setCloneProgress([])
    cloneProgressRef.current = []
  }

  const selectRecentRepo = (path: string) => {
    onRepoSelect(path)
    setRecentDialogOpen(false)
    setRecentSearch('')
  }

  const typedRepoPath = looksLikeRepoPath(recentSearch)
    ? normalizePastedPath(recentSearch)
    : ''

  const openTypedRepoPath = () => {
    if (!typedRepoPath) return
    selectRecentRepo(typedRepoPath)
  }

  const pickAndOpenRepo = async () => {
    const { open } = await import('@tauri-apps/api/dialog')
    const selected = await open({
      directory: true,
      title: '选择 Git 仓库',
    })
    if (typeof selected === 'string') {
      selectRecentRepo(selected)
    }
  }

  const handleRecentSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const query = normalizePastedPath(recentSearch)
    if (!query) return

    const exact = recentRepos.find(
      (repo) =>
        repo.path.toLowerCase() === query.toLowerCase() ||
        repo.name.toLowerCase() === query.toLowerCase()
    )
    if (exact) {
      selectRecentRepo(exact.path)
      return
    }
    if (typedRepoPath) {
      openTypedRepoPath()
      return
    }
    if (filteredRecentRepos.length === 1) {
      selectRecentRepo(filteredRecentRepos[0].path)
    }
  }

  const openRecentRepoFolder = async (path: string) => {
    const { invoke } = await import('@tauri-apps/api/tauri')
    await invoke('open_folder', { path })
  }

  const removeRecentRepo = (path: string) => {
    if (!window.confirm('从最近列表中移除此仓库？')) return
    onRemoveRecentRepo(path)
  }

  const formatRecentTime = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '未知时间'
    const diffMs = Date.now() - date.getTime()
    const diffMinutes = Math.floor(diffMs / 60_000)
    if (diffMinutes < 1) return '刚刚'
    if (diffMinutes < 60) return `${diffMinutes}分钟前`
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}小时前`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}天前`
    return date.toLocaleDateString()
  }

  const renderRecentChip = (repo: RecentRepo) => {
    const isActive = Boolean(repoInfo?.path && repo.path === repoInfo.path)
    return (
      <Button
        key={repo.path}
        role="listitem"
        size="sm"
        variant="ghost"
        aria-current={isActive ? 'true' : undefined}
        onClick={() => selectRecentRepo(repo.path)}
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY, repo })
        }}
        disabled={loading}
        className={cn(
          'h-6 max-w-[150px] shrink-0 border px-2 text-xs',
          isActive
            ? 'border-primary/50 bg-primary/15 font-medium text-foreground shadow-sm hover:bg-primary/25'
            : 'border-transparent hover:bg-muted'
        )}
        title={repo.path}
      >
        <span className="truncate">{repo.name}</span>
      </Button>
    )
  }

  return (
    <div className="flex h-9 items-center gap-2 border-b bg-muted/25 px-3 text-sm">
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="flex h-4 w-4 items-center justify-center rounded-sm bg-primary">
          <span className="text-[10px] font-bold leading-none text-primary-foreground">G</span>
        </div>
        <span className="text-sm font-semibold tracking-tight">GitLite</span>
      </div>

      {/* 中间：最近仓库 — 顶部固定展示最近 5 个，完整列表进入弹窗 */}
      {recentRepos.length > 0 && (
        <div className="relative flex w-full min-w-0 flex-1 items-center gap-1.5 px-1">
          <Clock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          <div
            className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden"
            role="list"
          >
            {inlineRecentRepos.map((repo) => renderRecentChip(repo))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
              disabled={loading}
              onClick={() => setRecentDialogOpen(true)}
              title="查看和管理全部最近仓库"
            >
              管理({recentRepos.length})
            </Button>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          data-app-interactive-overlay=""
          className="fixed z-[200] min-w-[140px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{
            left: Math.min(
              contextMenu.x,
              typeof window !== 'undefined' ? window.innerWidth - 160 : contextMenu.x
            ),
            top: Math.min(
              contextMenu.y,
              typeof window !== 'undefined' ? window.innerHeight - 120 : contextMenu.y
            ),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() => {
              selectRecentRepo(contextMenu.repo.path)
              setContextMenu(null)
            }}
          >
            打开
          </button>
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() => openEdit(contextMenu.repo)}
          >
            编辑…
          </button>
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
            onClick={() => {
              removeRecentRepo(contextMenu.repo.path)
              setContextMenu(null)
            }}
          >
            删除
          </button>
        </div>
      )}

      <Dialog
        open={recentDialogOpen}
        onOpenChange={(open) => {
          setRecentDialogOpen(open)
          if (!open) setRecentSearch('')
        }}
      >
        <DialogContent className="max-h-[min(86vh,42rem)] max-w-3xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border/60 px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" aria-hidden />
              最近打开的仓库
            </DialogTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              顶部仅展示最近 {INLINE_RECENT_REPO_LIMIT} 个；这里可以搜索、管理列表，也可粘贴路径或浏览打开新仓库。
            </p>
          </DialogHeader>

          <div className="border-b border-border/60 px-5 py-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={recentSearch}
                  onChange={(e) => setRecentSearch(e.target.value)}
                  onKeyDown={handleRecentSearchKeyDown}
                  placeholder="搜索，或粘贴仓库路径后回车打开"
                  className="h-8 pl-8 text-sm"
                  spellCheck={false}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0"
                disabled={loading}
                onClick={() => void pickAndOpenRepo()}
              >
                浏览…
              </Button>
              {typedRepoPath && (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 shrink-0"
                  disabled={loading}
                  onClick={openTypedRepoPath}
                >
                  打开路径
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-[min(62vh,30rem)] overflow-y-auto px-5 py-3">
            {filteredRecentRepos.length === 0 ? (
              <div className="flex min-h-[10rem] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground">
                {typedRepoPath ? (
                  <>
                    <p>最近列表中没有这项，可以直接打开该路径：</p>
                    <p className="max-w-full truncate font-mono text-xs text-foreground" title={typedRepoPath}>
                      {typedRepoPath}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={loading}
                        onClick={openTypedRepoPath}
                      >
                        打开此路径
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={loading}
                        onClick={() => void pickAndOpenRepo()}
                      >
                        浏览选择…
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>没有匹配的最近仓库</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loading}
                      onClick={() => void pickAndOpenRepo()}
                    >
                      浏览打开新仓库
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                {typedRepoPath &&
                  !filteredRecentRepos.some(
                    (repo) => repo.path.toLowerCase() === typedRepoPath.toLowerCase()
                  ) && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-primary/35 bg-primary/5 px-3 py-2">
                      <div className="min-w-0 text-xs">
                        <div className="text-muted-foreground">打开尚未记录的路径</div>
                        <div className="truncate font-mono text-foreground" title={typedRepoPath}>
                          {typedRepoPath}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 shrink-0"
                        disabled={loading}
                        onClick={openTypedRepoPath}
                      >
                        打开
                      </Button>
                    </div>
                  )}
                {filteredRecentRepos.map((repo) => {
                  const isActive = Boolean(repoInfo?.path && repo.path === repoInfo.path)
                  return (
                    <div
                      key={repo.path}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                        isActive
                          ? 'border-primary/45 bg-primary/10'
                          : 'border-border/70 bg-background hover:bg-muted/35'
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => selectRecentRepo(repo.path)}
                        disabled={loading}
                        title={repo.path}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate text-sm font-medium text-foreground">
                            {repo.name}
                          </span>
                          {isActive && (
                            <span className="shrink-0 rounded-full border border-primary/35 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              当前
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="min-w-0 truncate font-mono" title={repo.path}>
                            {shortenPathMiddle(repo.path, 72)}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {formatRecentTime(repo.last_opened)}
                          </span>
                        </div>
                      </button>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={loading}
                          title="打开仓库"
                          onClick={() => selectRecentRepo(repo.path)}
                        >
                          <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="编辑"
                          onClick={() => openEdit(repo)}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="打开所在文件夹"
                          onClick={() => void openRecentRepoFolder(repo.path)}
                        >
                          <FolderPlus className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          disabled={loading}
                          title="从最近列表移除"
                          onClick={() => removeRecentRepo(repo.path)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑最近仓库</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="recent-edit-name">显示名称</Label>
              <Input
                id="recent-edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitEdit()
                }}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="recent-edit-path">仓库路径</Label>
              <div className="flex gap-2">
                <Input
                  id="recent-edit-path"
                  value={editPath}
                  onChange={(e) => setEditPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitEdit()
                  }}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void pickEditFolder()}
                >
                  浏览…
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                用于仓库搬家或纠正路径；需指向磁盘上的 Git 仓库根目录。
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditTarget(null)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => void submitEdit()}
              disabled={!editName.trim() || !editPath.trim()}
            >
              确定
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {(onSelectSingleRepo || onSelectMultiRepo) && (
          <div className="inline-flex rounded-full border border-border/70 bg-background p-0.5">
            <button
              type="button"
              onClick={() => onSelectSingleRepo?.()}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                !isMultiRepo
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              单仓库
            </button>
            <button
              type="button"
              onClick={() => onSelectMultiRepo?.()}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                isMultiRepo
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              多仓库
            </button>
          </div>
        )}

        {onToggleDarkMode && (
          <Button
            type="button"
            onClick={onToggleDarkMode}
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
          >
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenRepository}
          disabled={loading}
          className="h-7 w-7 p-0"
          title="打开仓库"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </Button>

        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              title="更多"
              aria-label="更多"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-1">
            {onInitRepository && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
                disabled={loading}
                onClick={() => {
                  setMoreOpen(false)
                  setInitDialogOpen(true)
                }}
              >
                <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
                初始化仓库
              </button>
            )}
            {onCloneRepository && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
                disabled={loading}
                onClick={() => {
                  setMoreOpen(false)
                  setCloneDialogOpen(true)
                }}
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                克隆仓库
              </button>
            )}
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={async () => {
                setMoreOpen(false)
                const { invoke } = await import('@tauri-apps/api/tauri')
                try {
                  await invoke('open_log_dir')
                } catch (err) {
                  console.error('打开日志失败', err)
                }
              }}
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              打开日志目录
            </button>
            {onOpenAiConfig && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => {
                  setMoreOpen(false)
                  onOpenAiConfig()
                }}
              >
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                AI 配置
              </button>
            )}
            {onOpenReliabilityPanel && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => {
                  setMoreOpen(false)
                  onOpenReliabilityPanel()
                }}
              >
                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                可靠性
              </button>
            )}
            {onOpenProxyConfig && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => {
                  setMoreOpen(false)
                  onOpenProxyConfig()
                }}
              >
                <Network className="h-3.5 w-3.5 text-muted-foreground" />
                代理
              </button>
            )}
            <div className="my-1 border-t border-border/60" />
            <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent">
              <input
                type="checkbox"
                checked={autoOpenEnabled}
                onChange={(e) => onToggleAutoOpen(e.target.checked)}
                className="h-3 w-3 rounded"
              />
              启动时自动打开
            </label>
          </PopoverContent>
        </Popover>
      </div>

      <Dialog open={initDialogOpen} onOpenChange={setInitDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>初始化本地仓库</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="init-repo-path">仓库目录</Label>
              <div className="flex gap-2">
                <Input
                  id="init-repo-path"
                  value={initRepoPath}
                  onChange={(e) => setInitRepoPath(e.target.value)}
                  className="font-mono text-xs"
                  spellCheck={false}
                  placeholder="选择一个空目录或现有目录"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void pickInitFolder()}
                >
                  浏览…
                </Button>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="init-branch-name">初始分支名（可选）</Label>
              <Input
                id="init-branch-name"
                value={initBranchName}
                onChange={(e) => setInitBranchName(e.target.value)}
                placeholder="main"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitInitRepository()
                }}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setInitDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void submitInitRepository()}
              disabled={loading || !initRepoPath.trim()}
            >
              初始化
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>克隆远程仓库</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="clone-remote-url">远程地址</Label>
              <Input
                id="clone-remote-url"
                value={cloneRemoteUrl}
                onChange={(e) => setCloneRemoteUrl(e.target.value)}
                placeholder="https://... 或 git@..."
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="clone-target-path">目标目录</Label>
              <div className="flex gap-2">
                <Input
                  id="clone-target-path"
                  value={cloneTargetPath}
                  onChange={(e) => setCloneTargetPath(e.target.value)}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void pickCloneFolder()}
                >
                  浏览…
                </Button>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="clone-branch-name">指定分支（可选）</Label>
              <Input
                id="clone-branch-name"
                value={cloneBranchName}
                onChange={(e) => setCloneBranchName(e.target.value)}
                placeholder="例如 main"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitCloneRepository()
                }}
              />
            </div>
          </div>
          {cloning && (
            <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-2 font-mono text-xs text-muted-foreground">
              {cloneProgress.length === 0 ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  正在启动克隆…
                </span>
              ) : (
                cloneProgress.map((line, i) => <div key={i}>{line}</div>)
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCloneDialogOpen(false)}
              disabled={cloning}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void submitCloneRepository()}
              disabled={cloning || loading || !cloneRemoteUrl.trim() || !cloneTargetPath.trim()}
            >
              {cloning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  克隆中…
                </>
              ) : (
                '克隆'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
