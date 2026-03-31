import { Button } from './ui/button'
import { Download, GitPullRequest, RefreshCw, CheckCircle, AlertCircle, Upload } from 'lucide-react'
import { cn } from '../lib/utils'

export interface RemoteSyncBarProps {
  ahead?: number
  behind?: number
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
}

export function RemoteSyncBar({
  ahead,
  behind,
  disabled = false,
  refreshSpinning = false,
  onFetchChanges,
  onPullChanges,
  onPushChanges,
  onRefresh,
  refreshTitle = '刷新远程状态',
  density = 'comfortable',
  className
}: RemoteSyncBarProps) {
  const aheadN = ahead ?? 0
  const behindN = behind ?? 0
  if (!onFetchChanges && !onPullChanges && !onPushChanges && !onRefresh) return null

  const compact = density === 'compact'

  return (
    <div
      className={cn(
        'flex items-center justify-between bg-muted/30 rounded-md border border-border',
        compact ? 'gap-1.5 flex-wrap px-2 py-1' : 'p-3',
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
          <div className="flex items-center gap-1.5">
            <AlertCircle
              className={cn(
                'h-3.5 w-3.5 text-amber-600 dark:text-amber-400',
                compact && 'shrink-0'
              )}
            />
            <span className="text-amber-700 dark:text-amber-300">
              <span className="font-medium">{behindN}</span> 待拉取
            </span>
          </div>
        )}
        {aheadN > 0 && (
          <div className="flex items-center gap-1.5">
            <CheckCircle
              className={cn(
                'h-3.5 w-3.5 text-blue-600 dark:text-blue-400',
                compact && 'shrink-0'
              )}
            />
            <span className="text-blue-700 dark:text-blue-300">
              <span className="font-medium">{aheadN}</span> 待推送
            </span>
          </div>
        )}
        {behindN === 0 && aheadN === 0 && (
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
            disabled={disabled}
            className="h-7 px-2 text-xs"
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
            disabled={disabled}
            className="h-7 px-2 text-xs"
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
            disabled={disabled}
            className="h-7 px-2 text-xs"
            title="拉取远程更改（即使没有待拉取的提交）"
          >
            <GitPullRequest className="h-3.5 w-3.5 mr-1" />
            拉取
          </Button>
        )}
        {onPushChanges && aheadN > 0 && (
          <Button
            size="sm"
            onClick={onPushChanges}
            disabled={disabled}
            className="h-7 px-2 text-xs"
            title="将本地提交推送到远程仓库"
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
            disabled={disabled}
            className="h-7 px-2 text-xs"
            title="推送当前分支（即使没有待推送的提交）"
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
            className="h-7 w-7 p-0"
            title={refreshTitle}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshSpinning ? 'animate-spin' : ''}`} />
          </Button>
        )}
      </div>
    </div>
  )
}
