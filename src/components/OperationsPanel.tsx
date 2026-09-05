import { WorkspaceStatus } from './WorkspaceStatus'
import type { CommitInfo, RepoInfo, WorkspaceGitActions } from '../types/git'

interface OperationsPanelProps {
  repoInfo: RepoInfo | null
  onRefresh: () => void
  onPushChanges?: () => void
  onPullChanges?: () => void
  onFetchChanges?: () => void
  /** 来自 useGit 时传入，提交/同步与元数据刷新走统一封装 */
  gitActions?: WorkspaceGitActions
  onJumpToCommit?: (commit: CommitInfo) => void
  autoRefresh?: boolean
  onRegisterManualRefresh?: (fn: (() => Promise<void>) | null) => void
  onOpenCommitsTab?: () => void
  onOpenFilesTab?: () => void
  /** 远程拉取/推送进行中，禁用同步条按钮 */
  remoteBusy?: boolean
}

// 轻量外壳：左侧操作区（提交/暂存/未跟踪），复用现有 WorkspaceStatus 能力
export function OperationsPanel({
  repoInfo,
  onRefresh,
  onPushChanges,
  onPullChanges,
  onFetchChanges,
  gitActions,
  onJumpToCommit,
  autoRefresh,
  onRegisterManualRefresh,
  onOpenCommitsTab,
  onOpenFilesTab,
  remoteBusy,
}: OperationsPanelProps) {
  return (
    <div className="space-y-4">
      <WorkspaceStatus
        repoInfo={repoInfo}
        onRefresh={onRefresh}
        onPushChanges={onPushChanges}
        onPullChanges={onPullChanges}
        onFetchChanges={onFetchChanges}
        gitActions={gitActions}
        onJumpToCommit={onJumpToCommit}
        autoRefresh={autoRefresh}
        onRegisterManualRefresh={onRegisterManualRefresh}
        onOpenCommitsTab={onOpenCommitsTab}
        onOpenFilesTab={onOpenFilesTab}
        remoteBusy={remoteBusy}
      />
    </div>
  )
}


