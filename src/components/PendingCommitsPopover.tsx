import { useEffect, useState, type ReactElement } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { CommitInfo } from '../types/git'
import { getClientCalendarOffsetEastMinutes } from '../utils/clientCalendarOffset'
import { formatTauriInvokeError } from '../utils/tauriError'

interface PendingCommitsPopoverProps {
  kind: 'outgoing' | 'incoming'
  repoPath?: string | null
  count: number
  children: ReactElement
  onCommitClick?: (commit: CommitInfo) => void
  align?: 'start' | 'center' | 'end'
}

export function PendingCommitsPopover({
  kind,
  repoPath,
  count,
  children,
  onCommitClick,
  align = 'start',
}: PendingCommitsPopoverProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commits, setCommits] = useState<CommitInfo[] | null>(null)

  useEffect(() => {
    if (!open || !repoPath || count <= 0) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const cmd = kind === 'outgoing' ? 'get_repo_outgoing_commits' : 'get_repo_incoming_commits'
    void invoke<CommitInfo[]>(cmd, {
      repoPath,
      clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
    })
      .then((list) => {
        if (!cancelled) setCommits(list)
      })
      .catch((e) => {
        if (!cancelled) {
          setCommits([])
          setError(formatTauriInvokeError(e, '加载失败'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, repoPath, kind, count])

  if (!repoPath || count <= 0) {
    return children
  }

  const title = kind === 'outgoing' ? '待推送的提交' : '待拉取的提交'
  const emptyHint =
    kind === 'outgoing' ? '暂无待推送提交（可能需要先刷新）' : '暂无待拉取提交（可能需要先获取）'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[min(28rem,calc(100vw-1.5rem))] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-b px-3 py-2">
          <p className="text-xs font-medium text-foreground">
            {title}
            <span className="ml-1.5 tabular-nums text-muted-foreground">({count})</span>
          </p>
          {onCommitClick && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">点击一条可查看改动</p>
          )}
        </div>
        {loading && !commits ? (
          <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            加载中…
          </div>
        ) : error ? (
          <div className="px-3 py-6 text-center text-xs text-destructive">{error}</div>
        ) : !commits || commits.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyHint}</div>
        ) : (
          <div className="max-h-64 overflow-auto divide-y divide-border/60">
            {commits.map((c) => {
              const rowClass =
                'flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40'
              const body = (
                <>
                  <span className="shrink-0 rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">
                    {c.short_id}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={c.message}>
                    {c.message}
                  </span>
                  <span className="hidden max-w-[5.5rem] shrink-0 truncate text-muted-foreground sm:inline">
                    {c.author}
                  </span>
                </>
              )
              if (onCommitClick) {
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={rowClass}
                    onClick={() => {
                      onCommitClick(c)
                      setOpen(false)
                    }}
                  >
                    {body}
                  </button>
                )
              }
              return (
                <div key={c.id} className={rowClass}>
                  {body}
                </div>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
