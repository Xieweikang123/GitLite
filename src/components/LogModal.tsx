import { useEffect } from 'react'
import { OperationLogList, type OperationLogEntry } from './OperationStatusToast'

interface LogModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  logs: OperationLogEntry[]
  isRunning: boolean
}

export function LogModal({ isOpen, onClose, title, logs, isRunning }: LogModalProps) {
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50" data-app-interactive-overlay="">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="关闭日志"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-log-title"
        className="fixed left-1/2 top-1/2 z-50 flex h-[min(70vh,36rem)] w-[min(92vw,48rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border bg-card shadow-lg"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 id="operation-log-title" className="truncate text-sm font-semibold">
              {title}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isRunning ? '操作进行中' : '已完成'} · {logs.length} 条日志
            </p>
          </div>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <OperationLogList
          logs={logs}
          isRunning={isRunning}
          className="m-3 min-h-0 flex-1 rounded-md"
        />
      </div>
    </div>
  )
}
