import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, FileText, Loader2, X } from 'lucide-react'
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
  const tone =
    status === 'success'
      ? 'border-emerald-500/25 bg-emerald-500/10'
      : status === 'error'
        ? 'border-destructive/25 bg-destructive/10'
        : status === 'conflict'
          ? 'border-amber-500/30 bg-amber-500/10'
          : 'border-border bg-card/95'

  const titleColor =
    status === 'success'
      ? 'text-emerald-800 dark:text-emerald-300'
      : status === 'error'
        ? 'text-destructive'
        : status === 'conflict'
          ? 'text-amber-800 dark:text-amber-300'
          : 'text-foreground'

  const StatusIcon =
    status === 'running'
      ? Loader2
      : status === 'success'
        ? CheckCircle
        : AlertCircle

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-[4.75rem] z-[110] w-[min(92vw,32rem)] -translate-x-1/2 px-3"
      data-app-interactive-overlay=""
    >
      <div
        role={status === 'error' || status === 'conflict' ? 'alert' : 'status'}
        aria-live="polite"
        className={cn(
          'pointer-events-auto rounded-lg border p-3 shadow-lg backdrop-blur-sm',
          tone
        )}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="flex items-start gap-2">
          <StatusIcon
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0',
              titleColor,
              status === 'running' && 'animate-spin'
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className={cn('text-sm font-medium', titleColor)}>
              {status === 'running' ? title : summary || title}
            </p>
            {status === 'running' && latestLine && (
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={latestLine.message}>
                {latestLine.message}
              </p>
            )}
            {status === 'running' && !latestLine && (
              <p className="mt-0.5 text-xs text-muted-foreground">正在与远程仓库通信…</p>
            )}
            {(status === 'error' || status === 'conflict') && summary && (
              <p className="mt-0.5 text-xs text-muted-foreground">{title}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
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
                className="h-7 w-7"
                title="关闭"
                onClick={onDismiss}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-2 space-y-2">
            <OperationLogList logs={logs} isRunning={false} className="max-h-40" />
            {status === 'conflict' && onOpenWorkspace && (
              <div className="flex justify-end">
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
