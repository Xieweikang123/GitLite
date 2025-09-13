import { Button } from './ui/button'
import { Clock, GitBranch, FileText, Settings, FolderOpen } from 'lucide-react'
import { RecentRepo } from '../types/git'

interface MenuToolbarProps {
  onOpenRepository: () => void
  onRepoSelect: (path: string) => void
  recentRepos: RecentRepo[]
  autoOpenEnabled: boolean
  onToggleAutoOpen: (enabled: boolean) => void
  loading: boolean
  repoInfo: any
}

export function MenuToolbar({
  onOpenRepository,
  onRepoSelect,
  recentRepos,
  autoOpenEnabled,
  onToggleAutoOpen,
  loading,
  repoInfo
}: MenuToolbarProps) {
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
            <span>•</span>
            <span>{repoInfo.commits.length} 提交</span>
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
                disabled={loading}
                className="h-6 px-2 text-xs hover:bg-muted"
              >
                {repo.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenRepository}
          disabled={loading}
          className="h-6 px-2 text-xs"
        >
          <FolderOpen className="h-3 w-3 mr-1" />
          打开仓库
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

