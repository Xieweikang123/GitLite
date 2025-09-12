import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select'
import { FolderOpen, Clock, Settings, GitBranch } from 'lucide-react'
import { RecentRepo } from '../types/git'

interface TopToolbarProps {
  onOpenRepository: () => void
  onRepoSelect: (path: string) => void
  onBranchSelect: (branchName: string) => void
  recentRepos: RecentRepo[]
  autoOpenEnabled: boolean
  onToggleAutoOpen: (enabled: boolean) => void
  loading: boolean
  repoInfo: any
}

export function TopToolbar({
  onOpenRepository,
  onRepoSelect,
  onBranchSelect,
  recentRepos,
  autoOpenEnabled,
  onToggleAutoOpen,
  loading,
  repoInfo
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

      {/* 中间：当前仓库信息和最近仓库 */}
      <div className="flex items-center gap-6">
        {/* 当前仓库信息和分支选择 */}
        {repoInfo && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <Select value={repoInfo.current_branch} onValueChange={onBranchSelect}>
                <SelectTrigger className="w-40 h-8 text-sm min-w-0">
                  <span className="truncate">{repoInfo.current_branch}</span>
                </SelectTrigger>
                <SelectContent className="w-48">
                  {repoInfo.branches.map((branch: any) => (
                    <SelectItem key={branch.name} value={branch.name} className="text-sm">
                      <span className="truncate">{branch.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">{repoInfo.commits.length} 提交</span>
            </div>
            <div className="text-xs text-muted-foreground max-w-xs truncate">
              {repoInfo.path}
            </div>
          </div>
        )}
        
        {/* 最近仓库 */}
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
      </div>

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
