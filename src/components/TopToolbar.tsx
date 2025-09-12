import React from 'react'
import { Button } from './ui/button'
import { FolderOpen, Clock, Settings } from 'lucide-react'
import { RecentRepo } from '../types/git'

interface TopToolbarProps {
  onOpenRepository: () => void
  onRepoSelect: (path: string) => void
  recentRepos: RecentRepo[]
  autoOpenEnabled: boolean
  onToggleAutoOpen: (enabled: boolean) => void
  loading: boolean
}

export function TopToolbar({
  onOpenRepository,
  onRepoSelect,
  recentRepos,
  autoOpenEnabled,
  onToggleAutoOpen,
  loading
}: TopToolbarProps) {
  return (
    <div className="flex items-center justify-between bg-card border-b px-6 py-3">
      {/* 左侧：应用标题 */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">GitLite</h1>
        <p className="text-sm text-muted-foreground">
          轻量级 Git GUI 客户端
        </p>
      </div>

      {/* 中间：最近仓库 */}
      {recentRepos.length > 0 && (
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">最近:</span>
          <div className="flex gap-2">
            {recentRepos.slice(0, 3).map((repo) => (
              <Button
                key={repo.path}
                size="sm"
                variant="outline"
                onClick={() => onRepoSelect(repo.path)}
                disabled={loading}
                className="h-8 px-3 text-xs"
              >
                {repo.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Settings className="h-4 w-4" />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoOpenEnabled}
              onChange={(e) => onToggleAutoOpen(e.target.checked)}
              className="rounded"
            />
            自动打开
          </label>
        </div>
        
        <Button
          onClick={onOpenRepository}
          disabled={loading}
          className="flex items-center gap-2"
        >
          <FolderOpen className="h-4 w-4" />
          {loading ? '打开中...' : '打开仓库'}
        </Button>
      </div>
    </div>
  )
}
