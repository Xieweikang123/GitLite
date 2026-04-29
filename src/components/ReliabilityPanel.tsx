import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { AlertTriangle, FileSearch, Loader2, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { cn, shortenPathMiddle } from '../lib/utils'
import type { OperationLogRecord, AutoSnapshotConfig } from '../types/git'
import { Switch } from './ui/switch'
import { Label } from './ui/label'

interface ReliabilityPanelProps {
  isOpen: boolean
  onClose: () => void
  repoPath: string | null
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '未知时间'
  return date.toLocaleString()
}

function operationLabel(type: string) {
  switch (type) {
    case 'checkout':
      return '切换分支'
    case 'merge':
      return '合并'
    case 'pull':
      return '拉取'
    case 'reset-hard':
      return '硬重置'
    case 'rebase':
      return 'Rebase'
    case 'discard':
      return '丢弃更改'
    case 'restore-silent-stash':
      return '恢复静默贮藏'
    case 'auto-snapshot':
      return '定时快照'
    default:
      return type
  }
}

export function ReliabilityPanel({ isOpen, onClose, repoPath }: ReliabilityPanelProps) {
  const [logs, setLogs] = useState<OperationLogRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffTitle, setDiffTitle] = useState('')
  const [diffText, setDiffText] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null)
  const [snapshotConfig, setSnapshotConfig] = useState<AutoSnapshotConfig>({ enabled: false, interval_minutes: 10 })
  const [snapshotSaving, setSnapshotSaving] = useState(false)
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null)
  const [snapshotManualBusy, setSnapshotManualBusy] = useState(false)

  const loadLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await invoke<OperationLogRecord[]>('get_operation_logs', { limit: 120 })
      setLogs(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      void loadLogs()
      invoke<AutoSnapshotConfig>('get_auto_snapshot_config').then(setSnapshotConfig).catch(() => {})
    }
  }, [isOpen, loadLogs])

  const operationTypes = useMemo(() => {
    return Array.from(new Set(logs.map((l) => l.operation_type))).sort()
  }, [logs])

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase()
    return logs.filter((log) => {
      if (typeFilter && log.operation_type !== typeFilter) return false
      if (!q) return true
      return (
        log.repo_path.toLowerCase().includes(q) ||
        log.branch.toLowerCase().includes(q) ||
        log.operation_type.toLowerCase().includes(q) ||
        (log.silent_stash_name ?? '').toLowerCase().includes(q)
      )
    })
  }, [logs, query, typeFilter])

  const openDiff = async (log: OperationLogRecord) => {
    if (!log.silent_stash_id) return
    setDiffOpen(true)
    setDiffTitle(log.silent_stash_name || log.silent_stash_id)
    setDiffLoading(true)
    setDiffText('')
    try {
      const text = await invoke<string>('get_silent_stash_diff', { stashId: log.silent_stash_id })
      setDiffText(text || '该静默贮藏没有 tracked patch；可能只包含未跟踪文件备份。')
    } catch (e) {
      setDiffText(e instanceof Error ? e.message : String(e))
    } finally {
      setDiffLoading(false)
    }
  }

  const restore = async (log: OperationLogRecord) => {
    if (!log.silent_stash_id) return
    if (!window.confirm('恢复会把静默贮藏中的改动应用回仓库，请确认当前工作区状态适合恢复。继续？')) {
      return
    }
    setRestoreBusyId(log.silent_stash_id)
    try {
      await invoke('restore_silent_stash', { stashId: log.silent_stash_id })
      await loadLogs()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRestoreBusyId(null)
    }
  }

  const saveSnapshotConfig = async (next: AutoSnapshotConfig) => {
    setSnapshotSaving(true)
    setSnapshotStatus(null)
    try {
      await invoke('save_auto_snapshot_config', { config: next })
      setSnapshotConfig(next)
      setSnapshotStatus('已保存')
      setTimeout(() => setSnapshotStatus(null), 2000)
    } catch (e) {
      setSnapshotStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setSnapshotSaving(false)
    }
  }

  const triggerSnapshotNow = async () => {
    setSnapshotManualBusy(true)
    setSnapshotStatus(null)
    try {
      const msg = await invoke<string>('trigger_auto_snapshot_now')
      setSnapshotStatus(msg)
      await loadLogs()
    } catch (e) {
      setSnapshotStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setSnapshotManualBusy(false)
    }
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[min(88vh,44rem)] max-w-5xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border/60 px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
              可靠性与操作证据链
            </DialogTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              展示 Git 写操作、高危操作前自动生成的静默贮藏，以及失败后的建议。
            </p>
          </DialogHeader>

          <div className="border-b border-border/60 px-5 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">定时自动快照</span>
              <div className="flex items-center gap-2">
                {snapshotStatus && (
                  <span className="text-xs text-muted-foreground">{snapshotStatus}</span>
                )}
                <Switch
                  checked={snapshotConfig.enabled}
                  disabled={snapshotSaving}
                  onCheckedChange={(checked) => {
                    const next = { ...snapshotConfig, enabled: checked }
                    void saveSnapshotConfig(next)
                  }}
                />
              </div>
            </div>
            {snapshotConfig.enabled && (
              <div className="mt-2 flex items-center gap-3">
                <Label className="text-xs text-muted-foreground">间隔</Label>
                <select
                  value={snapshotConfig.interval_minutes}
                  onChange={(e) => {
                    const next = { ...snapshotConfig, interval_minutes: Number(e.target.value) }
                    void saveSnapshotConfig(next)
                  }}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value={5}>5 分钟</option>
                  <option value={10}>10 分钟</option>
                  <option value={15}>15 分钟</option>
                  <option value={30}>30 分钟</option>
                  <option value={60}>1 小时</option>
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={snapshotManualBusy || !repoPath}
                  onClick={() => void triggerSnapshotNow()}
                >
                  {snapshotManualBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  立即快照
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 border-b border-border/60 px-5 py-3 sm:flex-row sm:items-center">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索仓库、分支、操作或静默贮藏"
              className="h-8 text-sm"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              aria-label="筛选操作类型"
            >
              <option value="">全部操作</option>
              {operationTypes.map((type) => (
                <option key={type} value={type}>
                  {operationLabel(type)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1 text-xs"
              disabled={loading}
              onClick={() => void loadLogs()}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              刷新
            </Button>
          </div>

          <div className="max-h-[min(64vh,31rem)] overflow-y-auto px-5 py-3">
            {error && (
              <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
            {loading && logs.length === 0 ? (
              <div className="flex min-h-[12rem] items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在读取操作日志…
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="flex min-h-[12rem] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
                暂无匹配的 Git 写操作记录
              </div>
            ) : (
              <div className="space-y-2">
                {filteredLogs.map((log) => {
                  const ok = log.status === 'success'
                  return (
                    <div key={log.id} className="rounded-lg border border-border/70 bg-background px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                            ok
                              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                          )}
                        >
                          {ok ? '成功' : '失败'}
                        </span>
                        {log.is_high_risk && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="h-3 w-3" />
                            高危
                          </span>
                        )}
                        <span className="text-sm font-medium text-foreground">{operationLabel(log.operation_type)}</span>
                        <span className="text-xs text-muted-foreground">{formatTime(log.timestamp)}</span>
                        <span className="text-xs text-muted-foreground">{log.duration_ms} ms</span>
                        <span className="text-xs text-muted-foreground">{log.affected_files} 个文件</span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-mono" title={log.repo_path}>
                          {shortenPathMiddle(log.repo_path, 82)}
                        </span>
                        <span>分支: {log.branch || 'unknown'}</span>
                        {log.silent_stash_name && <span>备份: {log.silent_stash_name}</span>}
                      </div>

                      {log.error_detail && (
                        <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                          {log.error_detail}
                        </p>
                      )}
                      {log.suggestion && (
                        <p className="mt-1.5 text-xs text-muted-foreground">{log.suggestion}</p>
                      )}

                      {log.silent_stash_id && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => void openDiff(log)}
                          >
                            <FileSearch className="h-3.5 w-3.5" />
                            查看差异
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            disabled={restoreBusyId === log.silent_stash_id}
                            onClick={() => void restore(log)}
                          >
                            {restoreBusyId === log.silent_stash_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            恢复
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={diffOpen} onOpenChange={(open) => setDiffOpen(open)}>
        <DialogContent className="max-h-[min(86vh,42rem)] max-w-4xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border/60 px-5 py-4 text-left">
            <DialogTitle className="pr-8 text-base">{diffTitle}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[min(70vh,34rem)] overflow-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100">
            {diffLoading ? (
              <span className="inline-flex items-center gap-2 text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在读取差异…
              </span>
            ) : (
              <pre className="whitespace-pre-wrap break-words">{diffText}</pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
