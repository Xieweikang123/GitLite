import { invoke } from '@tauri-apps/api/tauri'
import { GitBranch, Network, RotateCcw, Timer } from 'lucide-react'
import type { ReactNode } from 'react'
import { BranchSwitcher } from './BranchSwitcher'
import { Button } from './ui/button'
import { BranchInfo, BranchSyncOverview, CommitInfo, type RepoInfo } from '../types/git'
import { PendingCommitsPopover } from './PendingCommitsPopover'

interface TopToolbarProps {
  onBranchSelect: (branchName: string) => void
  onCreateBranch?: (branchName: string, checkout: boolean, startPoint?: string) => Promise<boolean>
  onDeleteBranch?: (branchName: string, force: boolean) => Promise<boolean>
  onRenameBranch?: (oldName: string, newName: string) => Promise<boolean>
  onMergeBranch?: (sourceBranch: string, ffOnly: boolean) => Promise<boolean>
  onFetchRemoteOverview?: () => Promise<BranchSyncOverview[]>
  onOpenRemoteRepository?: () => void
  onOpenRemoteManage?: () => void
  onPendingCommitClick?: (commit: CommitInfo) => void
  loading: boolean
  repoInfo: RepoInfo | null
  children?: ReactNode
  onManualRefresh?: () => void | Promise<void>
  refreshing?: boolean
  autoRefresh?: boolean
  onToggleAutoRefresh?: (value: boolean) => void
}

/** 与 WorkspaceStatus 的刷新周期保持一致，仅用于提示文案 */
const AUTO_REFRESH_INTERVAL_SEC = 10

export function TopToolbar({
  onBranchSelect,
  onCreateBranch,
  onDeleteBranch,
  onRenameBranch,
  onMergeBranch,
  onFetchRemoteOverview,
  onOpenRemoteRepository,
  onOpenRemoteManage,
  onPendingCommitClick,
  loading,
  repoInfo,
  children,
  onManualRefresh,
  refreshing,
  autoRefresh,
  onToggleAutoRefresh,
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
    <div className="flex min-h-9 shrink-0 items-center gap-2 border-b bg-card px-3 py-1">
      {repoInfo && (
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
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
              onFetchRemoteOverview={onFetchRemoteOverview}
            />
            {onOpenRemoteRepository && repoInfo.remote_url && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                title="在浏览器中打开远程仓库"
                onClick={onOpenRemoteRepository}
              >
                <GitBranch className="h-4 w-4" />
              </Button>
            )}
            {onOpenRemoteManage && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                title="管理远程仓库地址，以及当前分支对应的远程分支"
                disabled={loading}
                onClick={onOpenRemoteManage}
              >
                <Network className="h-4 w-4" />
              </Button>
            )}
          </div>
            {(typeof repoInfo.ahead === 'number' && repoInfo.ahead > 0) ||
            (typeof repoInfo.behind === 'number' && repoInfo.behind > 0) ? (
              <div className="hidden items-center gap-1.5 sm:flex">
                {typeof repoInfo.ahead === 'number' && repoInfo.ahead > 0 && (
                  <PendingCommitsPopover
                    kind="outgoing"
                    repoPath={repoInfo.path}
                    count={repoInfo.ahead}
                    onCommitClick={onPendingCommitClick}
                  >
                    <button
                      type="button"
                      className="rounded bg-blue-600/10 px-1.5 py-0.5 text-[11px] text-blue-700 hover:bg-blue-600/20 dark:text-blue-300"
                      title="点击查看待推送的提交"
                    >
                      {repoInfo.ahead} 待推送
                    </button>
                  </PendingCommitsPopover>
                )}
                {typeof repoInfo.behind === 'number' && repoInfo.behind > 0 && (
                  <PendingCommitsPopover
                    kind="incoming"
                    repoPath={repoInfo.path}
                    count={repoInfo.behind}
                    onCommitClick={onPendingCommitClick}
                  >
                    <button
                      type="button"
                      className="rounded bg-amber-600/10 px-1.5 py-0.5 text-[11px] text-amber-700 hover:bg-amber-600/20 dark:text-amber-300"
                      title="点击查看待拉取的提交"
                    >
                      {repoInfo.behind} 待拉取
                    </button>
                  </PendingCommitsPopover>
                )}
              </div>
            ) : null}
          <button
            type="button"
            className="min-w-0 max-w-[min(22rem,32vw)] truncate text-left text-xs text-muted-foreground hover:text-foreground hover:underline"
            title={`${repoInfo.path}\n\n点击打开本地文件夹`}
            onClick={() => void handleOpenFolder()}
          >
            {repoInfo.path}
          </button>
        </div>
      )}

      {children ? (
        <div className={repoInfo ? 'ml-1 border-l border-border/60 pl-2.5' : undefined}>
          {children}
        </div>
      ) : null}

      {(onManualRefresh || onToggleAutoRefresh) && (
        <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title={refreshing ? '正在刷新…' : '手动刷新'}
            disabled={!repoInfo || refreshing || loading}
            onClick={() => void onManualRefresh?.()}
          >
            <RotateCcw className={`h-4 w-4${refreshing ? ' animate-spin' : ''}`} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`h-8 w-8 shrink-0 ${
              autoRefresh
                ? 'text-blue-600 hover:text-blue-600 dark:text-blue-400'
                : 'text-muted-foreground'
            }`}
            title={
              autoRefresh
                ? `自动刷新已开启：每 ${AUTO_REFRESH_INTERVAL_SEC}s 在后台静默刷新，无全屏加载遮罩；点击关闭`
                : `自动刷新已关闭；点击开启（每 ${AUTO_REFRESH_INTERVAL_SEC}s 后台静默刷新）`
            }
            disabled={!repoInfo}
            onClick={() => onToggleAutoRefresh?.(!autoRefresh)}
          >
            <Timer className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
