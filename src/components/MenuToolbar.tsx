import { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react'
import { Button } from './ui/button'
import {
  Clock,
  GitBranch,
  FileText,
  Settings,
  FolderOpen,
  FolderPlus,
  Download,
  Network,
  Sparkles,
  ChevronDown,
} from 'lucide-react'
import { RecentRepo } from '../types/git'
import { cn } from '../lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

/** 与 `gap-1` 一致 */
const RECENT_CHIP_GAP_PX = 4

function maxVisibleRecentRepos(
  chipWidths: number[],
  containerWidth: number,
  moreBtnWidth: number
): number {
  const n = chipWidths.length
  if (n === 0 || containerWidth <= 0) return 0
  const g = RECENT_CHIP_GAP_PX
  for (let k = n; k >= 0; k--) {
    let w = 0
    for (let i = 0; i < k; i++) {
      w += chipWidths[i] + (i > 0 ? g : 0)
    }
    if (k < n) w += g + moreBtnWidth
    if (w <= containerWidth) return k
  }
  return 0
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
  repoInfo: any
  onInitRepository?: (path: string, initialBranch?: string) => Promise<boolean>
  onCloneRepository?: (
    remoteUrl: string,
    destinationPath: string,
    branch?: string
  ) => Promise<boolean>
  onOpenProxyConfig?: () => void
  onOpenAiConfig?: () => void
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
  onOpenAiConfig
}: MenuToolbarProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    repo: RecentRepo
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const [overflowOpen, setOverflowOpen] = useState(false)
  const [itemWidths, setItemWidths] = useState<number[]>([])
  const [moreBtnWidth, setMoreBtnWidth] = useState(80)
  const [inlineWidth, setInlineWidth] = useState(0)
  const measureRef = useRef<HTMLDivElement>(null)
  const inlineRowRef = useRef<HTMLDivElement>(null)
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

  useLayoutEffect(() => {
    const root = measureRef.current
    if (!root || recentRepos.length === 0) {
      setItemWidths([])
      return
    }
    const chips = root.querySelectorAll<HTMLElement>('[data-recent-chip-measure]')
    const moreEl = root.querySelector<HTMLElement>('[data-recent-more-measure]')
    setItemWidths(Array.from(chips).map((c) => c.offsetWidth))
    setMoreBtnWidth(moreEl?.offsetWidth ?? 80)
  }, [recentRepos])

  useEffect(() => {
    const el = inlineRowRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setInlineWidth(el.clientWidth)
    })
    ro.observe(el)
    setInlineWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const visibleCount = useMemo(() => {
    const n = recentRepos.length
    if (n === 0) return 0
    if (itemWidths.length !== n) return n
    if (inlineWidth <= 0) return n
    return maxVisibleRecentRepos(itemWidths, inlineWidth, moreBtnWidth)
  }, [recentRepos.length, itemWidths, inlineWidth, moreBtnWidth])

  const overflowRepos = useMemo(() => {
    if (visibleCount >= recentRepos.length) return []
    return recentRepos.slice(visibleCount)
  }, [recentRepos, visibleCount])

  const openEdit = (repo: RecentRepo) => {
    setContextMenu(null)
    setOverflowOpen(false)
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
    const ok = await onCloneRepository(cloneRemoteUrl, cloneTargetPath, cloneBranchName)
    if (!ok) return
    setCloneDialogOpen(false)
    setCloneRemoteUrl('')
    setCloneTargetPath('')
    setCloneBranchName('')
  }

  const selectRecentRepo = (path: string) => {
    onRepoSelect(path)
    setOverflowOpen(false)
  }

  const renderRecentChip = (repo: RecentRepo, measure?: boolean) => {
    const isActive = Boolean(repoInfo?.path && repo.path === repoInfo.path)
    return (
      <Button
        key={repo.path}
        role="listitem"
        size="sm"
        variant="ghost"
        data-recent-chip-measure={measure ? '' : undefined}
        aria-current={isActive ? 'true' : undefined}
        onClick={measure ? undefined : () => selectRecentRepo(repo.path)}
        onContextMenu={
          measure
            ? undefined
            : (e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, repo })
              }
        }
        disabled={measure ? false : loading}
        tabIndex={measure ? -1 : undefined}
        className={cn(
          'h-6 shrink-0 px-2 text-xs max-w-[180px] border',
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
    <div className="flex min-h-[2.5rem] items-center gap-2 bg-muted/30 border-b px-4 py-2 text-sm">
      {/* 左侧：应用信息 */}
      <div className="flex shrink-0 items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-primary rounded-sm flex items-center justify-center">
            <span className="text-primary-foreground text-xs font-bold">G</span>
          </div>
          <span className="font-medium">GitLite</span>
        </div>
        
        {/* 当前仓库信息 */}
        {repoInfo && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            <span>{repoInfo.current_branch}</span>
            {typeof repoInfo.ahead === 'number' && repoInfo.ahead > 0 && (
              <>
                <span>•</span>
                <span className="text-blue-600">{repoInfo.ahead} 待推送</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* 中间：最近仓库 — 一行内尽量平铺，其余收入「更多」 */}
      {recentRepos.length > 0 && (
        <div className="relative flex w-full min-w-0 flex-1 items-center gap-1.5 px-1">
          <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-muted-foreground">最近:</span>
          <div
            ref={inlineRowRef}
            className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden"
            role="list"
          >
            {recentRepos
              .slice(0, visibleCount)
              .map((repo) => renderRecentChip(repo))}
            {overflowRepos.length > 0 && (
              <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 shrink-0 gap-0.5 px-2 text-xs"
                    disabled={loading}
                    aria-expanded={overflowOpen}
                    aria-haspopup="dialog"
                    title={`还有 ${overflowRepos.length} 个仓库`}
                  >
                    更多({overflowRepos.length})
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  side="bottom"
                  sideOffset={6}
                  className="z-[120] w-[min(22rem,calc(100vw-2rem))] max-h-[min(18rem,55vh)] overflow-y-auto p-1"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <div className="flex flex-col gap-0.5" role="list">
                    {overflowRepos.map((repo) => {
                      const isActive = Boolean(
                        repoInfo?.path && repo.path === repoInfo.path
                      )
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
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              repo,
                            })
                          }}
                          disabled={loading}
                          className={cn(
                            'h-auto min-h-8 w-full justify-start border px-2 py-1.5 text-xs font-normal',
                            isActive
                              ? 'border-primary/50 bg-primary/15 font-medium text-foreground shadow-sm hover:bg-primary/25'
                              : 'border-transparent hover:bg-muted'
                          )}
                          title={repo.path}
                        >
                          <span className="truncate text-left">{repo.name}</span>
                        </Button>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div
            ref={measureRef}
            className="pointer-events-none fixed left-0 top-0 z-[-1] flex gap-1 opacity-0"
            aria-hidden
          >
            {recentRepos.map((repo) => renderRecentChip(repo, true))}
            <Button
              type="button"
              data-recent-more-measure
              variant="outline"
              size="sm"
              tabIndex={-1}
              className="h-6 shrink-0 gap-0.5 px-2 text-xs"
              aria-hidden
            >
              更多({recentRepos.length})
              <ChevronDown className="h-3 w-3 opacity-50" />
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
              if (window.confirm('从最近列表中移除此仓库？')) {
                onRemoveRecentRepo(contextMenu.repo.path)
              }
              setContextMenu(null)
            }}
          >
            删除
          </button>
        </div>
      )}

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

      {/* 右侧：操作按钮（打开仓库在主工具栏，此处仅保留快捷功能） */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenRepository}
          disabled={loading}
          className="h-6 w-6 p-0"
          title="打开仓库"
        >
          <FolderOpen className="h-3 w-3" />
        </Button>

        {onInitRepository && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setInitDialogOpen(true)}
            disabled={loading}
            title="初始化新仓库"
          >
            <FolderPlus className="h-3 w-3 mr-1" />
            Init
          </Button>
        )}

        {onCloneRepository && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setCloneDialogOpen(true)}
            disabled={loading}
            title="克隆远程仓库"
          >
            <Download className="h-3 w-3 mr-1" />
            Clone
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={async () => {
            const { invoke } = await import('@tauri-apps/api/tauri')
            try {
              await invoke('open_log_dir')
            } catch (err) {
              console.error('打开日志失败', err)
            }
          }}
        >
          <FileText className="h-3 w-3 mr-1" />
          日志
        </Button>

        {onOpenAiConfig && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenAiConfig}
            className="h-6 px-2 text-xs"
          >
            <Sparkles className="h-3 w-3 mr-1" />
            AI
          </Button>
        )}

        {onOpenProxyConfig && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenProxyConfig}
            className="h-6 px-2 text-xs"
          >
            <Network className="h-3 w-3 mr-1" />
            代理
          </Button>
        )}

        <div className="flex items-center gap-1">
          <Settings className="h-3 w-3 text-muted-foreground" />
          <label className="flex items-center gap-1 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={autoOpenEnabled}
              onChange={(e) => onToggleAutoOpen(e.target.checked)}
              className="rounded w-3 h-3"
            />
            自动打开
          </label>
        </div>
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
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCloneDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void submitCloneRepository()}
              disabled={loading || !cloneRemoteUrl.trim() || !cloneTargetPath.trim()}
            >
              克隆
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
