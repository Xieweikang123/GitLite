import { WorkspaceStatus } from './WorkspaceStatus'
import type { CommitInfo, WorkspaceGitActions } from '../types/git'

interface OperationsPanelProps {
  repoInfo: any
  onRefresh: () => void
  onPushChanges?: () => void
  onPullChanges?: () => void
  onFetchChanges?: () => void
  /** 来自 useGit 时传入，提交/同步与元数据刷新走统一封装 */
  gitActions?: WorkspaceGitActions
  onJumpToCommit?: (commit: CommitInfo) => void
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
      />
    </div>
  )
}


