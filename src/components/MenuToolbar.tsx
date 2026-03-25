import { useState, useEffect, useRef } from 'react'
import { Button } from './ui/button'
import { Clock, GitBranch, FileText, Settings, FolderOpen, Network } from 'lucide-react'
import { RecentRepo } from '../types/git'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

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
  onOpenProxyConfig?: () => void
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
  onOpenProxyConfig
}: MenuToolbarProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    repo: RecentRepo
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const [editTarget, setEditTarget] = useState<RecentRepo | null>(null)
  const [editName, setEditName] = useState('')
  const [editPath, setEditPath] = useState('')

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

  return (
    <div className="flex items-center justify-between bg-muted/30 border-b px-4 py-2 text-sm">
      {/* 左侧：应用信息 */}
      <div className="flex items-center gap-4">
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

      {/* 中间：最近仓库 */}
      {recentRepos.length > 0 && (
        <div className="flex items-center gap-2">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">最近:</span>
          <div className="flex gap-1">
            {recentRepos.slice(0, 3).map((repo) => (
              <Button
                key={repo.path}
                size="sm"
                variant="ghost"
                onClick={() => onRepoSelect(repo.path)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({ x: e.clientX, y: e.clientY, repo })
                }}
                disabled={loading}
                className="h-6 px-2 text-xs hover:bg-muted max-w-[140px]"
                title={repo.path}
              >
                <span className="truncate">{repo.name}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
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
              onRepoSelect(contextMenu.repo.path)
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
      <div className="flex items-center gap-2">
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
    </div>
  )
}
