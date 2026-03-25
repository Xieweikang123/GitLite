import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { invoke } from '@tauri-apps/api/tauri'
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select'
import { FolderOpen, GitBranch, Moon, Sun, GitPullRequest, Download } from 'lucide-react'
import { BranchInfo } from '../types/git'
import { cn } from '../lib/utils'

interface TopToolbarProps {
  onOpenRepository: () => void
  onBranchSelect: (branchName: string) => void
  onOpenRemoteRepository?: () => void
  onPullChanges?: () => void
  onFetchChanges?: () => void
  loading: boolean
  repoInfo: any
  isDark: boolean
  onToggleDarkMode: () => void
}

export function TopToolbar({
  onOpenRepository,
  onBranchSelect,
  onOpenRemoteRepository,
  onPullChanges,
  onFetchChanges,
  loading,
  repoInfo,
  isDark,
  onToggleDarkMode
}: TopToolbarProps) {
  const handleOpenFolder = async () => {
    try {
      if (repoInfo?.path) {
        await invoke('open_folder', { path: repoInfo.path })
      }
    } catch (error) {
      console.error('无法打开文件夹:', error)
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
              <Select value={repoInfo.current_branch} onValueChange={onBranchSelect}>
                <SelectTrigger className="w-40 h-8 text-sm min-w-0">
                  <span className="truncate">{repoInfo.current_branch}</span>
                </SelectTrigger>
                <SelectContent
                  className={cn(
                    'w-auto min-w-[280px] max-w-[min(92vw,520px)] max-h-[min(70vh,400px)] p-1',
                    'overflow-y-auto overflow-x-hidden'
                  )}
                >
                  {(repoInfo.branches as BranchInfo[]).map((branch) => {
                    const isCheckout = branch.name === repoInfo.current_branch
                    return (
                      <SelectItem
                        key={branch.name}
                        value={branch.name}
                        className="items-start gap-2 py-2.5 px-3 text-sm"
                      >
                        <span
                          className={cn(
                            'min-w-0 flex-1 break-all text-left leading-snug',
                            isCheckout && 'font-medium'
                          )}
                        >
                          {branch.name}
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          {branch.is_current && (
                            <Badge
                              variant={isCheckout ? 'outline' : 'default'}
                              className={cn(
                                'text-[10px] px-1.5 py-0',
                                isCheckout &&
                                  'border-primary-foreground/40 bg-primary-foreground/15 text-primary-foreground'
                              )}
                            >
                              当前
                            </Badge>
                          )}
                          {branch.is_remote && (
                            <Badge
                              variant={isCheckout ? 'outline' : 'secondary'}
                              className={cn(
                                'text-[10px] px-1.5 py-0',
                                isCheckout &&
                                  'border-primary-foreground/40 bg-transparent text-primary-foreground'
                              )}
                            >
                              远程
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span
                className="text-muted-foreground cursor-default"
                title="当前已加载的最近提交条数，不是仓库总提交数。提交较多时请在「提交」标签页中继续向下滚动加载更多。"
              >
                最近 {repoInfo.commits.length} 条
              </span>
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
        
        {repoInfo && onFetchChanges && (
          <Button
            onClick={onFetchChanges}
            disabled={loading}
            variant="outline"
            className="flex items-center gap-2"
            title="获取远程仓库的最新信息（不合并）"
          >
            <Download className="h-4 w-4" />
            获取
          </Button>
        )}
        
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
        
        {/* 移除单独的“打开远程仓库”按钮，改为点击 GitBranch 图标触发 */}
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
