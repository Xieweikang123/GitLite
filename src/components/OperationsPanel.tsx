import { WorkspaceStatus } from './WorkspaceStatus'

interface OperationsPanelProps {
  repoInfo: any
  onRefresh: () => void
  onPushChanges?: () => void
  onGitDiagnostics?: () => void
}

// 轻量外壳：左侧操作区（提交/暂存/未跟踪），复用现有 WorkspaceStatus 能力
export function OperationsPanel({ repoInfo, onRefresh, onPushChanges, onGitDiagnostics }: OperationsPanelProps) {
  return (
    <div className="space-y-4">
      <WorkspaceStatus
        repoInfo={repoInfo}
        onRefresh={onRefresh}
        onPushChanges={onPushChanges}
        onGitDiagnostics={onGitDiagnostics}
      />
    </div>
  )
}


