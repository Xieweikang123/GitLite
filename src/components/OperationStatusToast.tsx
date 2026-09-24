import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Check, FileText, Loader2, X } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

export type OperationLogLevel = 'INFO' | 'DEBUG' | 'WARN' | 'ERROR' | 'SUCCESS'

export interface OperationLogEntry {
  timestamp: string
  level: OperationLogLevel
  message: string
}

export type RemoteOpStatus = 'hidden' | 'running' | 'success' | 'error' | 'conflict'

function logLevelClassName(level: string): string {
  switch (level) {
    case 'ERROR':
      return 'text-destructive'
    case 'WARN':
      return 'text-amber-700 dark:text-amber-400'
    case 'SUCCESS':
      return 'text-emerald-700 dark:text-emerald-400'
    case 'DEBUG':
      return 'text-muted-foreground/70'
    default:
      return 'text-foreground/85'
  }
}

export function OperationLogList({
  logs,
  isRunning,
  emptyRunningLabel = '等待日志输出…',
  className,
}: {
  logs: OperationLogEntry[]
  isRunning?: boolean
  emptyRunningLabel?: string
  className?: string
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [logs, isRunning])

  return (
    <div
      ref={scrollerRef}
      className={cn(
        'overflow-y-auto rounded-md border border-border/70 bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed',
        className
      )}
    >
      {logs.length === 0 ? (
        <p className="text-muted-foreground">
          {isRunning ? emptyRunningLabel : '暂无日志'}
        </p>
      ) : (
        logs.map((log, index) => (
          <div key={`${log.timestamp}-${index}`} className="mb-0.5 break-all">
            <span className="text-muted-foreground">[{log.timestamp}]</span>
            <span className={cn('ml-1.5 font-semibold', logLevelClassName(log.level))}>
              [{log.level}]
            </span>
            <span className="ml-1.5 text-foreground/90">{log.message}</span>
          </div>
        ))
      )}
      {isRunning && (
        <p className="mt-1 text-muted-foreground">操作进行中…</p>
      )}
    </div>
  )
}

interface OperationStatusToastProps {
  title: string
  status: RemoteOpStatus
  summary?: string
  progress?: string | null
  logs: OperationLogEntry[]
  onDismiss: () => void
  onOpenLogs: () => void
  onOpenWorkspace?: () => void
}

const SUCCESS_DISMISS_MS = 4000

export function OperationStatusToast({
  title,
  status,
  summary,
  progress,
  logs,
  onDismiss,
  onOpenLogs,
  onOpenWorkspace,
}: OperationStatusToastProps) {
  const [hovered, setHovered] = useState(false)
  const latestLine = [...logs].reverse().find((l) => l.level !== 'DEBUG')

  useEffect(() => {
    if (status !== 'success' || hovered) return
    const timer = window.setTimeout(onDismiss, SUCCESS_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [status, hovered, onDismiss])

  useEffect(() => {
    if (status === 'hidden' || status === 'running') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onDismiss()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [status, onDismiss])

  if (status === 'hidden') return null

  const expanded = status === 'error' || status === 'conflict'

  // 卡片描边：保留状态色氛围，但用中性底色，避免整块染色发闷
  const tone =
    status === 'success'
      ? 'border-emerald-500/45 dark:border-emerald-400/30'
      : status === 'error'
        ? 'border-destructive/45 dark:border-destructive/35'
        : status === 'conflict'
          ? 'border-amber-500/50 dark:border-amber-400/35'
          : 'border-border dark:border-primary/30'

  // 图标徽章：状态色的唯一载体
  const badgeTone =
    status === 'success'
      ? 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400'
      : status === 'error'
        ? 'bg-destructive/15 text-destructive ring-destructive/25'
        : status === 'conflict'
          ? 'bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-400'
          : 'bg-primary/15 text-primary ring-primary/25'

  const StatusIcon =
    status === 'running'
      ? Loader2
      : status === 'success'
        ? Check
        : status === 'conflict'
          ? AlertTriangle
          : AlertCircle

  const primaryText = status === 'running' ? title : summary || title
  // 结果文案展示时，把操作名作为副标题补充上下文（相同则省略）
  const secondaryText =
    status !== 'running' && summary && summary !== title ? title : undefined

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-[4.75rem] z-[110] w-[min(92vw,32rem)] -translate-x-1/2 px-3"
      data-app-interactive-overlay=""
    >
      <div
        role={status === 'error' || status === 'conflict' ? 'alert' : 'status'}
        aria-live="polite"
        className={cn(
          'pointer-events-auto overflow-hidden rounded-xl border bg-card shadow-lg backdrop-blur-sm',
          'dark:bg-[#151821] dark:shadow-[0_10px_30px_-10px_rgba(0,0,0,0.85)]',
          expanded ? 'w-full' : 'mx-auto w-fit max-w-full',
          tone
        )}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="flex items-center gap-2.5 py-2 pl-2.5 pr-2">
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
              badgeTone
            )}
            aria-hidden
          >
            <StatusIcon
              className={cn('h-3.5 w-3.5', status === 'running' && 'animate-spin')}
            />
          </span>
          <div className={cn('min-w-0', expanded && 'flex-1')}>
            <p className="truncate text-sm font-medium text-foreground">{primaryText}</p>
            {secondaryText && (
              <p className="truncate text-xs text-muted-foreground">{secondaryText}</p>
            )}
            {status === 'running' && progress && (
              <p className="truncate text-xs text-muted-foreground">{progress}</p>
            )}
            {status === 'running' && latestLine && (
              <p
                className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80"
                title={latestLine.message}
              >
                {latestLine.message}
              </p>
            )}
            {status === 'running' && !latestLine && !progress && (
              <p className="truncate text-xs text-muted-foreground">正在与远程仓库通信…</p>
            )}
          </div>
          <div className="ml-1 flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={onOpenLogs}
            >
              <FileText className="mr-1 h-3.5 w-3.5" />
              日志
            </Button>
            {status !== 'running' && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="关闭"
                onClick={onDismiss}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border/60 bg-muted/25 p-2">
            <OperationLogList
              logs={logs}
              isRunning={false}
              className="max-h-40 border-0 bg-transparent px-1 py-0"
            />
            {status === 'conflict' && onOpenWorkspace && (
              <div className="flex justify-end pt-2">
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onOpenWorkspace}>
                  去工作区处理
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
