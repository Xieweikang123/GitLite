import { Button } from './ui/button'
import { Download, GitPullRequest, RefreshCw, CheckCircle, AlertCircle, Upload } from 'lucide-react'
import { cn } from '../lib/utils'
import { PendingCommitsPopover } from './PendingCommitsPopover'
import type { CommitInfo } from '../types/git'

export interface RemoteSyncBarProps {
  ahead?: number
  behind?: number
  /** 当前分支是否已设置上游；为 false 时 0/0 不表示「已与远端一致」 */
  hasUpstream?: boolean
  /** 是否存在 origin 远程；为 false 时禁用获取/拉取/推送 */
  hasOriginRemote?: boolean
  disabled?: boolean
  /** 刷新按钮图标是否显示加载旋转 */
  refreshSpinning?: boolean
  onFetchChanges?: () => void
  onPullChanges?: () => void
  onPushChanges?: () => void
  onRefresh?: () => void
  refreshTitle?: string
  /** comfortable：工作区；compact：提交记录卡片内 */
  density?: 'comfortable' | 'compact'
  className?: string
  repoPath?: string | null
  onPendingCommitClick?: (commit: CommitInfo) => void
}

export function RemoteSyncBar({
  ahead,
  behind,
  hasUpstream = true,
  hasOriginRemote = true,
  disabled = false,
  refreshSpinning = false,
  onFetchChanges,
  onPullChanges,
  onPushChanges,
  onRefresh,
  refreshTitle = '刷新远程状态',
  density = 'comfortable',
  className,
  repoPath,
  onPendingCommitClick,
}: RemoteSyncBarProps) {
  const aheadN = ahead ?? 0
  const behindN = behind ?? 0
  if (!onFetchChanges && !onPullChanges && !onPushChanges && !onRefresh) return null

  const compact = density === 'compact'
  const remoteDisabled = disabled || !hasOriginRemote
  const showUpstreamHint = hasOriginRemote && !hasUpstream && behindN === 0 && aheadN === 0
  const showSynced = hasOriginRemote && hasUpstream && behindN === 0 && aheadN === 0

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-md',
        compact
          ? 'gap-1 flex-wrap border-0 px-1 py-0.5'
          : 'border border-border bg-muted/30 p-3',
        className
      )}
    >
      <div
        className={cn(
          'flex items-center gap-3 min-w-0',
          compact ? 'text-xs' : 'text-sm'
        )}
      >
        {behindN > 0 && (
          <PendingCommitsPopover
            kind="incoming"
            repoPath={repoPath}
            count={behindN}
            onCommitClick={onPendingCommitClick}
          >
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-sm hover:bg-amber-500/10"
              title="点击查看待拉取的提交"
            >
              <AlertCircle
                className={cn(
                  'h-3.5 w-3.5 text-amber-600 dark:text-amber-400',
                  compact && 'shrink-0'
                )}
              />
              <span className="text-amber-700 dark:text-amber-300">
                <span className="font-medium">{behindN}</span> 待拉取
              </span>
            </button>
          </PendingCommitsPopover>
        )}
        {aheadN > 0 && (
          <PendingCommitsPopover
            kind="outgoing"
            repoPath={repoPath}
            count={aheadN}
            onCommitClick={onPendingCommitClick}
          >
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-sm hover:bg-blue-500/10"
              title="点击查看待推送的提交"
            >
              <CheckCircle
                className={cn(
                  'h-3.5 w-3.5 text-blue-600 dark:text-blue-400',
                  compact && 'shrink-0'
                )}
              />
              <span className="text-blue-700 dark:text-blue-300">
                <span className="font-medium">{aheadN}</span> 待推送
              </span>
            </button>
          </PendingCommitsPopover>
        )}
        {!hasOriginRemote && (
          <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
            <AlertCircle className={cn('h-3.5 w-3.5 shrink-0')} />
            <span title="仓库还没有名为 origin 的远程地址，无法获取、拉取或推送">未配置远程仓库</span>
          </div>
        )}
        {hasOriginRemote && showUpstreamHint && (
          <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
            <AlertCircle className={cn('h-3.5 w-3.5 shrink-0')} />
            <span
              title="新开的本地分支默认只在本机。第一次点「推送」会在远程创建同名分支并关联；关联后才能显示待拉取 / 待推送。"
            >
              {compact ? '未关联远程' : '还没有对应的远程分支'}
            </span>
          </div>
        )}
        {hasOriginRemote && showSynced && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CheckCircle className={cn('h-3.5 w-3.5', compact && 'shrink-0')} />
            <span>已同步</span>
          </div>
        )}
      </div>
      <div className={cn('flex items-center shrink-0', compact ? 'gap-1.5' : 'gap-2')}>
        {onFetchChanges && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onFetchChanges}
            disabled={remoteDisabled}
            className={cn('px-2 text-xs', compact ? 'h-6' : 'h-7')}
            title="获取远程仓库的最新信息（不合并到本地）"
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            获取
          </Button>
        )}
        {onPullChanges && behindN > 0 && (
          <Button
            size="sm"
            onClick={onPullChanges}
            disabled={remoteDisabled}
            className={cn('px-2 text-xs', compact ? 'h-6' : 'h-7')}
            title="拉取并合并远程更改到当前分支"
          >
            <GitPullRequest className="h-3.5 w-3.5 mr-1" />
            拉取 ({behindN})
          </Button>
        )}
        {onPullChanges && behindN === 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onPullChanges}
            disabled={remoteDisabled}
            className={cn('px-2 text-xs', compact ? 'h-6' : 'h-7')}
            title={
              hasUpstream
                ? '拉取远程更改（即使没有待拉取的提交）'
                : '当前分支还没有对应的远程分支，拉取可能没有目标；可先推送以创建并关联'
            }
          >
            <GitPullRequest className="h-3.5 w-3.5 mr-1" />
            拉取
          </Button>
        )}
        {onPushChanges && aheadN > 0 && (
          <Button
            size="sm"
            onClick={onPushChanges}
            disabled={remoteDisabled}
            className={cn('px-2 text-xs', compact ? 'h-6' : 'h-7')}
            title={
              hasUpstream
                ? '将本地提交推送到远程仓库'
                : '将本地提交推送到远程，并关联为当前分支的对应远程分支'
            }
          >
            <Upload className="h-3.5 w-3.5 mr-1" />
            推送 ({aheadN})
          </Button>
        )}
        {onPushChanges && aheadN === 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onPushChanges}
            disabled={remoteDisabled}
            className={cn('px-2 text-xs', compact ? 'h-6' : 'h-7')}
            title={
              hasUpstream
                ? '推送当前分支（即使没有待推送的提交）'
                : '首次推送会在远程创建同名分支并关联，之后即可正常拉取 / 推送'
            }
          >
            <Upload className="h-3.5 w-3.5 mr-1" />
            推送
          </Button>
        )}
        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={disabled}
            className={cn('p-0', compact ? 'h-6 w-6' : 'h-7 w-7')}
            title={refreshTitle}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshSpinning ? 'animate-spin' : ''}`} />
          </Button>
        )}
      </div>
    </div>
  )
}
