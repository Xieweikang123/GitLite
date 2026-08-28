import { useState } from 'react'
import { Button } from './ui/button'
import { ChevronDown, Download, GitPullRequest, RefreshCw, CheckCircle, AlertCircle, Upload } from 'lucide-react'
import { cn } from '../lib/utils'
import { PendingCommitsPopover } from './PendingCommitsPopover'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import type { CommitInfo } from '../types/git'

export interface RemoteSyncBarProps {
  ahead?: number
  behind?: number
  /** 当前分支是否已设置上游；为 false 时 0/0 不表示「已与远端一致」 */
  hasUpstream?: boolean
  /** 是否存在 origin 远程；为 false 时禁用获取/拉取/推送 */
  hasOriginRemote?: boolean
  /** 是否展示「推送」按钮（提交卡片已把推送收进下拉时可关掉避免重复） */
  showPush?: boolean
  /** 为 false 时不显示待拉/待推/已同步（例如正在查看非检出分支） */
  showStatus?: boolean
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
  showPush = true,
  showStatus = true,
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
  const [remoteMenuOpen, setRemoteMenuOpen] = useState(false)
  const aheadN = ahead ?? 0
  const behindN = behind ?? 0
  if (!onFetchChanges && !onPullChanges && !onPushChanges && !onRefresh) return null

  const compact = density === 'compact'
  const remoteDisabled = disabled || !hasOriginRemote
  const showUpstreamHint = hasOriginRemote && !hasUpstream && behindN === 0 && aheadN === 0
  const showSynced = hasOriginRemote && hasUpstream && behindN === 0 && aheadN === 0

  const iconBtn = compact
    ? 'h-6 w-6 shrink-0 p-0'
    : 'h-7 px-2 text-xs'

  return (
    <div
      className={cn(
        'flex items-center rounded-md',
        compact
          ? 'shrink-0 gap-1'
          : 'justify-between gap-2 py-1',
        className
      )}
    >
      <div
        className={cn(
          'flex min-w-0 items-center',
          compact ? 'gap-1 text-[11px]' : 'gap-3 text-sm'
        )}
      >
        {showStatus && behindN > 0 && (
          <PendingCommitsPopover
            kind="incoming"
            repoPath={repoPath}
            count={behindN}
            onCommitClick={onPendingCommitClick}
          >
            <button
              type="button"
              className="flex items-center gap-1 rounded-sm hover:bg-amber-500/10"
              title="点击查看待拉取的提交"
            >
              <AlertCircle
                className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
              />
              <span className="whitespace-nowrap text-amber-700 dark:text-amber-300">
                <span className="font-medium">{behindN}</span>
                {compact ? '' : ' 待拉取'}
              </span>
            </button>
          </PendingCommitsPopover>
        )}
        {showStatus && aheadN > 0 && (
          <PendingCommitsPopover
            kind="outgoing"
            repoPath={repoPath}
            count={aheadN}
            onCommitClick={onPendingCommitClick}
          >
            <button
              type="button"
              className="flex items-center gap-1 rounded-sm hover:bg-blue-500/10"
              title="点击查看待推送的提交"
            >
              <CheckCircle
                className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400"
              />
              <span className="whitespace-nowrap text-blue-700 dark:text-blue-300">
                <span className="font-medium">{aheadN}</span>
                {compact ? '' : ' 待推送'}
              </span>
            </button>
          </PendingCommitsPopover>
        )}
        {showStatus && !hasOriginRemote && (
          <div
            className="flex items-center gap-1 text-amber-700 dark:text-amber-300"
            title="仓库还没有名为 origin 的远程地址，无法获取、拉取或推送"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className={cn(compact && 'sr-only')}>未配置远程仓库</span>
          </div>
        )}
        {showStatus && hasOriginRemote && showUpstreamHint && (
          <div
            className="flex items-center gap-1 text-amber-700 dark:text-amber-300"
            title="新开的本地分支默认只在本机。第一次点「推送」会在远程创建同名分支并关联；关联后才能显示待拉取 / 待推送。"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className={cn(compact && 'sr-only')}>
              {compact ? '未关联远程' : '还没有对应的远程分支'}
            </span>
          </div>
        )}
        {showStatus && hasOriginRemote && showSynced && (
          <div
            className="flex items-center gap-1 text-muted-foreground"
            title="已与远程同步"
          >
            <CheckCircle className="h-3.5 w-3.5 shrink-0" />
            {!compact && <span>已同步</span>}
          </div>
        )}
      </div>
      <div className={cn('flex shrink-0 items-center', compact ? 'gap-0.5' : 'gap-2')}>
        {compact && onFetchChanges && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onFetchChanges}
            disabled={remoteDisabled}
            className={iconBtn}
            title="获取远程仓库的最新信息（不合并到本地）"
            aria-label="获取"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        )}
        {!compact && onPullChanges ? (
          <div className="flex shrink-0 items-center">
            <Button
              size="sm"
              onClick={onPullChanges}
              disabled={remoteDisabled}
              variant={behindN > 0 ? 'default' : 'ghost'}
              className={cn(iconBtn, 'rounded-r-none')}
              title={
                hasUpstream
                  ? `拉取并合并远程更改到当前分支${behindN > 0 ? `（${behindN}）` : ''}`
                  : '拉取远程更改（即使没有待拉取的提交）'
              }
              aria-label={behindN > 0 ? `拉取 ${behindN}` : '拉取'}
            >
              <GitPullRequest className="mr-1 h-3.5 w-3.5" />
              {behindN > 0 ? `拉取 (${behindN})` : '拉取'}
            </Button>
            {(onFetchChanges || !hasUpstream) && (
              <Popover open={remoteMenuOpen} onOpenChange={setRemoteMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    aria-label="更多远程操作"
                    title="更多同步操作"
                    variant={behindN > 0 ? 'default' : 'ghost'}
                    disabled={remoteDisabled}
                    className="h-7 w-6 shrink-0 rounded-l-none p-0"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60 p-1">
                  {onFetchChanges && (
                    <button
                      type="button"
                      className="pointer-events-auto flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50"
                      disabled={remoteDisabled}
                      onClick={() => {
                        setRemoteMenuOpen(false)
                        onFetchChanges()
                      }}
                    >
                      <Download className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>
                        获取
                        <span className="block font-normal text-xs text-muted-foreground">
                          仅下载远端最新信息，不改动本地文件
                        </span>
                      </span>
                    </button>
                  )}
                  {!hasUpstream && (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      当前分支还没有对应的远程分支，拉取可能没有目标；可先推送以创建并关联。
                    </p>
                  )}
                </PopoverContent>
              </Popover>
            )}
          </div>
        ) : null}
        {!compact && !onPullChanges && onFetchChanges && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onFetchChanges}
            disabled={remoteDisabled}
            className={iconBtn}
            title="获取远程仓库的最新信息（不合并到本地）"
            aria-label="获取"
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            获取
          </Button>
        )}
        {compact && onPullChanges && behindN > 0 && (
          <Button
            size="sm"
            onClick={onPullChanges}
            disabled={remoteDisabled}
            className={iconBtn}
            title={`拉取并合并远程更改到当前分支（${behindN}）`}
            aria-label={`拉取 ${behindN}`}
          >
            <GitPullRequest className={cn('h-3.5 w-3.5', !compact && 'mr-1')} />
            {!compact && `拉取 (${behindN})`}
          </Button>
        )}
        {compact && onPullChanges && behindN === 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onPullChanges}
            disabled={remoteDisabled}
            className={iconBtn}
            title={
              hasUpstream
                ? '拉取远程更改（即使没有待拉取的提交）'
                : '当前分支还没有对应的远程分支，拉取可能没有目标；可先推送以创建并关联'
            }
            aria-label="拉取"
          >
            <GitPullRequest className={cn('h-3.5 w-3.5', !compact && 'mr-1')} />
            {!compact && '拉取'}
          </Button>
        )}
        {showPush && onPushChanges && aheadN > 0 && (
          <Button
            size="sm"
            onClick={onPushChanges}
            disabled={remoteDisabled}
            className={iconBtn}
            title={
              hasUpstream
                ? `将本地提交推送到远程仓库（${aheadN}）`
                : `将本地提交推送到远程，并关联为当前分支的对应远程分支（${aheadN}）`
            }
            aria-label={`推送 ${aheadN}`}
          >
            <Upload className={cn('h-3.5 w-3.5', !compact && 'mr-1')} />
            {!compact && `推送 (${aheadN})`}
          </Button>
        )}
        {showPush && onPushChanges && aheadN === 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onPushChanges}
            disabled={remoteDisabled}
            className={iconBtn}
            title={
              hasUpstream
                ? '推送当前分支（即使没有待推送的提交）'
                : '首次推送会在远程创建同名分支并关联，之后即可正常拉取 / 推送'
            }
            aria-label="推送"
          >
            <Upload className={cn('h-3.5 w-3.5', !compact && 'mr-1')} />
            {!compact && '推送'}
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
            aria-label="刷新"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshSpinning ? 'animate-spin' : ''}`} />
          </Button>
        )}
      </div>
    </div>
  )
}
