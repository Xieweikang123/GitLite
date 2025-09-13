import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select'
import { FolderOpen, GitBranch, ExternalLink } from 'lucide-react'

interface TopToolbarProps {
  onOpenRepository: () => void
  onBranchSelect: (branchName: string) => void
  onOpenRemoteRepository?: () => void
  loading: boolean
  repoInfo: any
}

export function TopToolbar({
  onOpenRepository,
  onBranchSelect,
  onOpenRemoteRepository,
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

      {/* 中间：当前仓库信息 */}
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
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">{repoInfo.commits.length} 提交</span>
              {typeof repoInfo.ahead === 'number' && repoInfo.ahead > 0 && (
                <span className="text-xs rounded bg-blue-600/10 text-blue-600 px-2 py-0.5">{repoInfo.ahead} 待推送</span>
              )}
              {typeof repoInfo.behind === 'number' && repoInfo.behind > 0 && (
                <span className="text-xs rounded bg-amber-600/10 text-amber-600 px-2 py-0.5">{repoInfo.behind} 待拉取</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground max-w-xs truncate">
              {repoInfo.path}
            </div>
          </div>
        )}
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-3">
        {repoInfo?.remote_url && onOpenRemoteRepository && (
          <Button
            onClick={onOpenRemoteRepository}
            variant="outline"
            className="flex items-center gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            打开远程仓库
          </Button>
        )}
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
