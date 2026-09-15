import { useState } from 'react'
import { Button } from './ui/button'
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle,
  ChevronDown,
  DownloadCloud,
  RotateCw,
} from 'lucide-react'
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
              className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1 hover:bg-amber-500/10"
              title={`有 ${behindN} 个提交在远端但本地还没有，点击查看`}
            >
              <AlertCircle
                className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
              />
              {!compact && (
                <span className="whitespace-nowrap text-amber-700 dark:text-amber-300">
                  <span className="font-medium">{behindN}</span> 待拉取
                </span>
              )}
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
              className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1 hover:bg-blue-500/10"
              title={`有 ${aheadN} 个本地提交还没上传到远端，点击查看`}
            >
              <CheckCircle
                className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400"
              />
              {!compact && (
                <span className="whitespace-nowrap text-blue-700 dark:text-blue-300">
                  <span className="font-medium">{aheadN}</span> 待推送
                </span>
              )}
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
      <div className={cn('flex shrink-0 items-center', compact ? 'gap-1.5' : 'gap-2')}>
        {compact && onFetchChanges && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onFetchChanges}
            disabled={remoteDisabled}
            className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
            title="获取：只下载远端最新信息到本地缓存，不改动工作区文件（不合并到本地）"
            aria-label="获取远端信息"
          >
            <DownloadCloud className="h-3.5 w-3.5" />
            获取
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
                  ? `拉取：把远端的新提交下载并合并进当前分支${behindN > 0 ? `（有 ${behindN} 个待拉取）` : '（当前没有待拉取的提交）'}`
                  : '拉取：当前分支还没有对应的远程分支，拉取可能没有目标；可先推送以创建并关联'
              }
              aria-label={behindN > 0 ? `拉取 ${behindN}` : '拉取'}
            >
              <ArrowDownToLine className="mr-1 h-3.5 w-3.5" />
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
                <PopoverContent align="end" className="w-72 p-1">
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
                      <DownloadCloud className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>
                        获取
                        <span className="block font-normal text-xs text-muted-foreground">
                          只下载远端最新信息到本地缓存，不改动工作区文件
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
            title="获取：只下载远端最新信息到本地缓存，不改动工作区文件"
            aria-label="获取远端信息"
          >
            <DownloadCloud className="mr-1 h-3.5 w-3.5" />
            获取
          </Button>
        )}
        {compact && onPullChanges && (
          <Button
            size="sm"
            variant={behindN > 0 ? 'default' : 'ghost'}
            onClick={onPullChanges}
            disabled={remoteDisabled}
            className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
            title={
              hasUpstream
                ? `拉取：把远端的新提交下载并合并进当前分支${behindN > 0 ? `（有 ${behindN} 个待拉取）` : '（当前没有待拉取的提交）'}`
                : '拉取：当前分支还没有对应的远程分支，拉取可能没有目标；可先推送以创建并关联'
            }
            aria-label={behindN > 0 ? `拉取 ${behindN} 个提交` : '拉取'}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            拉取
            {behindN > 0 && (
              <span className="rounded bg-primary-foreground/20 px-1 text-[10px] font-semibold leading-4">
                {behindN}
              </span>
            )}
          </Button>
        )}
        {showPush && onPushChanges && (
          <Button
            size="sm"
            variant={aheadN > 0 ? 'default' : 'ghost'}
            onClick={onPushChanges}
            disabled={remoteDisabled}
            className={cn('shrink-0', compact ? 'h-6 gap-1 px-1.5 text-[11px]' : iconBtn)}
            title={
              aheadN > 0
                ? hasUpstream
                  ? `推送：把本地 ${aheadN} 个提交上传到远程仓库`
                  : `推送：把本地 ${aheadN} 个提交上传到远程，并关联为当前分支的对应远程分支`
                : hasUpstream
                  ? '推送：当前分支已与远端同步，没有需要上传的提交'
                  : '推送：首次推送会在远程创建同名分支并关联，之后即可正常拉取 / 推送'
            }
            aria-label={aheadN > 0 ? `推送 ${aheadN} 个提交` : '推送'}
          >
            <ArrowUpFromLine className={cn('h-3.5 w-3.5', !compact && 'mr-1')} />
            推送
            {aheadN > 0 && (
              <span className="rounded bg-primary-foreground/20 px-1 text-[10px] font-semibold leading-4">
                {aheadN}
              </span>
            )}
          </Button>
        )}
        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={disabled}
            className={cn('shrink-0', compact ? 'h-6 gap-1 px-1.5 text-[11px]' : 'h-7 px-2')}
            title={`${refreshTitle}：重新读取本地仓库状态（不联网；联网请用「获取」）`}
            aria-label="刷新本地仓库状态"
          >
            <RotateCw className={`h-3.5 w-3.5 ${refreshSpinning ? 'animate-spin' : ''}`} />
            {compact && '刷新'}
          </Button>
        )}
      </div>
    </div>
  )
}
