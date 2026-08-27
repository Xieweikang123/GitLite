import { invoke } from '@tauri-apps/api/tauri'
import { GitBranch, GitPullRequest, Moon, Network, Sun } from 'lucide-react'
import { BranchSwitcher } from './BranchSwitcher'
import { Button } from './ui/button'
import { BranchInfo, CommitInfo } from '../types/git'

interface TopToolbarProps {
  onBranchSelect: (branchName: string) => void
  onCreateBranch?: (branchName: string, checkout: boolean, startPoint?: string) => Promise<boolean>
  onDeleteBranch?: (branchName: string, force: boolean) => Promise<boolean>
  onRenameBranch?: (oldName: string, newName: string) => Promise<boolean>
  onMergeBranch?: (sourceBranch: string, ffOnly: boolean) => Promise<boolean>
  onOpenRemoteRepository?: () => void
  onOpenRemoteManage?: () => void
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
  onOpenRemoteManage,
  onPullChanges,
  loading,
  repoInfo,
  isDark,
  onToggleDarkMode,
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

  const branches = (repoInfo?.branches ?? []) as BranchInfo[]
  const commits = (repoInfo?.commits ?? []) as CommitInfo[]

  return (
    <div className="flex items-center justify-between bg-card border-b px-6 py-3">
      <div className="flex-shrink-0">
        <h1 className="text-lg font-bold text-foreground">GitLite</h1>
        <p className="text-xs text-muted-foreground">轻量级 Git GUI 客户端</p>
      </div>

      <div className="flex items-center gap-6">
        {repoInfo && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <GitBranch
                className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-foreground"
                onClick={onOpenRemoteRepository}
              />
              {onOpenRemoteManage && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  title="管理远程仓库地址，以及当前分支对应的远程分支"
                  disabled={loading}
                  onClick={onOpenRemoteManage}
                >
                  <Network className="h-4 w-4" />
                </Button>
              )}
              <BranchSwitcher
                branches={branches}
                currentBranch={repoInfo.current_branch}
                headShortId={repoInfo.head_short_id}
                commits={commits}
                loading={loading}
                onBranchSelect={onBranchSelect}
                onCreateBranch={onCreateBranch}
                onDeleteBranch={onDeleteBranch}
                onRenameBranch={onRenameBranch}
                onMergeBranch={onMergeBranch}
              />
            </div>
            <div className="flex items-center gap-3 text-sm">
              {typeof repoInfo.ahead === 'number' && repoInfo.ahead > 0 && (
                <span className="text-xs rounded bg-blue-600/10 text-blue-600 px-2 py-0.5">
                  {repoInfo.ahead} 待推送
                </span>
              )}
              {typeof repoInfo.behind === 'number' && repoInfo.behind > 0 && (
                <span className="text-xs rounded bg-amber-600/10 text-amber-600 px-2 py-0.5">
                  {repoInfo.behind} 待拉取
                </span>
              )}
            </div>
            <div
              className="text-xs text-muted-foreground max-w-[280px] truncate cursor-pointer hover:text-foreground hover:underline transition-colors"
              title={`${repoInfo.path}\n\n点击打开本地文件夹`}
              onClick={() => void handleOpenFolder()}
            >
              {repoInfo.path}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={onToggleDarkMode}
          variant="outline"
          size="icon"
          className="h-9 w-9"
          title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
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
    </div>
  )
}
