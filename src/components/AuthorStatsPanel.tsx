import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { addDays, format, startOfWeek, subDays } from 'date-fns'
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  FileStack,
  Flame,
  GitCompareArrows,
  Info,
  Loader2,
  RefreshCw,
  Users,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import type {
  AuthorCommitStat,
  AuthorLineStat,
  DiffAggregateStats,
  PathTouchStat,
  TimeBucketStat,
} from '../types/git'

type ReportTab = 'authors' | 'timeline' | 'heatmap' | 'lines' | 'paths'
type TimeGranularity = 'day' | 'week' | 'month'

const REPORT_TABS: { id: ReportTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'authors', label: '作者', Icon: Users },
  { id: 'timeline', label: '时间趋势', Icon: BarChart3 },
  { id: 'heatmap', label: '贡献热力', Icon: Flame },
  { id: 'lines', label: '增删行', Icon: GitCompareArrows },
  { id: 'paths', label: '文件热度', Icon: FileStack },
]

const HEAT_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/** 按仓库 / 范围 / 维度区分；切换仓库再切回时可命中缓存，避免重复计算 */
const DIFF_AGGREGATE_PATH_LIMIT = 50
const statsResultCache = {
  authors: new Map<string, AuthorCommitStat[]>(),
  activity: new Map<string, TimeBucketStat[]>(),
  /** 热力图固定按日 */
  heatmap: new Map<string, TimeBucketStat[]>(),
  diff: new Map<string, DiffAggregateStats>(),
}

function cacheKeyScope(repo: string, scope: 'head' | 'all', rev: string | null | undefined) {
  return `${repo}|${scope}|${rev ?? ''}`
}

function cacheKeyActivity(
  repo: string,
  scope: 'head' | 'all',
  rev: string | null | undefined,
  gran: 'day' | 'week' | 'month'
) {
  return `${repo}|${scope}|${rev ?? ''}|${gran}`
}

function cacheKeyDiff(repo: string, scope: 'head' | 'all', rev: string | null | undefined, pathLimit: number) {
  return `${repo}|${scope}|${rev ?? ''}|p${pathLimit}`
}

interface AuthorStatsPanelProps {
  repoPath: string | undefined
  branchNames: string[]
  getAuthorCommitStats: (
    scope: 'head' | 'all',
    rev?: string | null
  ) => Promise<AuthorCommitStat[]>
  getCommitActivityStats: (
    granularity: 'day' | 'week' | 'month',
    scope: 'head' | 'all',
    rev?: string | null
  ) => Promise<TimeBucketStat[]>
  getDiffAggregateStats: (
    scope: 'head' | 'all',
    rev?: string | null,
    pathLimit?: number
  ) => Promise<DiffAggregateStats>
}

export function AuthorStatsPanel({
  repoPath,
  branchNames,
  getAuthorCommitStats,
  getCommitActivityStats,
  getDiffAggregateStats,
}: AuthorStatsPanelProps) {
  const [statsScope, setStatsScope] = useState<'head' | 'all'>('head')
  const [statsRev, setStatsRev] = useState<string | null>(null)
  const [reportTab, setReportTab] = useState<ReportTab>('authors')
  const [timeGran, setTimeGran] = useState<TimeGranularity>('day')

  const [authorRows, setAuthorRows] = useState<AuthorCommitStat[]>([])
  const [activityRows, setActivityRows] = useState<TimeBucketStat[]>([])
  const [heatmapDays, setHeatmapDays] = useState<TimeBucketStat[]>([])
  const [diffAgg, setDiffAgg] = useState<DiffAggregateStats | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** diff 聚合统计进度（与 Tauri 事件 diff-aggregate-progress 同步） */
  const [diffProgress, setDiffProgress] = useState<{ current: number; total: number } | null>(null)
  const diffCacheKeyRef = useRef<string>('')
  const diffDataRef = useRef<DiffAggregateStats | null>(null)

  useEffect(() => {
    diffCacheKeyRef.current = ''
    diffDataRef.current = null
    setDiffAgg(null)
    setDiffProgress(null)
  }, [repoPath])

  useEffect(() => {
    if (reportTab !== 'lines' && reportTab !== 'paths') {
      setDiffProgress(null)
    }
  }, [reportTab])

  useEffect(() => {
    if (!repoPath) return
    let cancelled = false
    let unlisten: UnlistenFn | undefined
    void (async () => {
      const u = await listen<{
        repo_path?: string
        current?: number
        total?: number
        phase?: string
      }>('diff-aggregate-progress', (event) => {
        const p = event.payload
        if (!p || p.repo_path !== repoPath) return
        setDiffProgress({
          current: p.current ?? 0,
          total: p.total ?? 0,
        })
      })
      if (cancelled) {
        u()
        return
      }
      unlisten = u
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [repoPath])

  const branchNamesSorted = useMemo(
    () => [...branchNames].sort((a, b) => a.localeCompare(b)),
    [branchNames]
  )

  const scopeArgs = useMemo(
    () => ({
      scope: statsScope,
      rev: statsScope === 'head' ? statsRev : null,
    }),
    [statsScope, statsRev]
  )

  const runLoad = useCallback(
    async (force = false) => {
      if (!repoPath) return
      const diffKey = `${repoPath}|${scopeArgs.scope}|${scopeArgs.rev ?? ''}`
      const scope = scopeArgs.scope
      const rev = scopeArgs.rev

      if (
        !force &&
        (reportTab === 'lines' || reportTab === 'paths') &&
        diffCacheKeyRef.current === diffKey &&
        diffDataRef.current
      ) {
        return
      }

      if (!force) {
        if (reportTab === 'authors') {
          const k = cacheKeyScope(repoPath, scope, rev)
          const hit = statsResultCache.authors.get(k)
          if (hit) {
            setAuthorRows(hit)
            setError(null)
            return
          }
        } else if (reportTab === 'timeline') {
          const k = cacheKeyActivity(repoPath, scope, rev, timeGran)
          const hit = statsResultCache.activity.get(k)
          if (hit) {
            setActivityRows(hit)
            setError(null)
            return
          }
        } else if (reportTab === 'heatmap') {
          const k = cacheKeyActivity(repoPath, scope, rev, 'day')
          const hit = statsResultCache.heatmap.get(k)
          if (hit) {
            setHeatmapDays(hit)
            setError(null)
            return
          }
        } else {
          const kDiff = cacheKeyDiff(repoPath, scope, rev, DIFF_AGGREGATE_PATH_LIMIT)
          const hit = statsResultCache.diff.get(kDiff)
          if (hit) {
            setDiffAgg(hit)
            diffDataRef.current = hit
            diffCacheKeyRef.current = diffKey
            setError(null)
            return
          }
        }
      }

      setLoading(true)
      setError(null)
      try {
        if (reportTab === 'authors') {
          setAuthorRows([])
          const data = await getAuthorCommitStats(scope, rev)
          const k = cacheKeyScope(repoPath, scope, rev)
          statsResultCache.authors.set(k, data)
          setAuthorRows(data)
        } else if (reportTab === 'timeline') {
          setActivityRows([])
          const data = await getCommitActivityStats(timeGran, scope, rev)
          const k = cacheKeyActivity(repoPath, scope, rev, timeGran)
          statsResultCache.activity.set(k, data)
          setActivityRows(data)
        } else if (reportTab === 'heatmap') {
          setHeatmapDays([])
          const data = await getCommitActivityStats('day', scope, rev)
          const k = cacheKeyActivity(repoPath, scope, rev, 'day')
          statsResultCache.heatmap.set(k, data)
          setHeatmapDays(data)
        } else {
          setDiffAgg(null)
          diffDataRef.current = null
          setDiffProgress({ current: 0, total: 0 })
          const data = await getDiffAggregateStats(scope, rev, DIFF_AGGREGATE_PATH_LIMIT)
          const kDiff = cacheKeyDiff(repoPath, scope, rev, DIFF_AGGREGATE_PATH_LIMIT)
          statsResultCache.diff.set(kDiff, data)
          diffCacheKeyRef.current = diffKey
          diffDataRef.current = data
          setDiffAgg(data)
        }
      } catch (e) {
        setAuthorRows([])
        setActivityRows([])
        setHeatmapDays([])
        setDiffAgg(null)
        diffDataRef.current = null
        diffCacheKeyRef.current = ''
        setDiffProgress(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
        if (reportTab === 'lines' || reportTab === 'paths') {
          setDiffProgress(null)
        }
      }
    },
    [
      repoPath,
      reportTab,
      timeGran,
      scopeArgs.scope,
      scopeArgs.rev,
      getAuthorCommitStats,
      getCommitActivityStats,
      getDiffAggregateStats,
    ]
  )

  useEffect(() => {
    void runLoad(false)
  }, [runLoad])

  const handleRefresh = useCallback(() => {
    diffCacheKeyRef.current = ''
    diffDataRef.current = null
    void runLoad(true)
  }, [runLoad])

  const totalAuthorCommits = useMemo(
    () => authorRows.reduce((s, r) => s + r.commit_count, 0),
    [authorRows]
  )
  const maxAuthorCount = authorRows[0]?.commit_count ?? 0

  const activityMax = useMemo(
    () => activityRows.reduce((m, r) => Math.max(m, r.commit_count), 0),
    [activityRows]
  )

  const heatmapMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of heatmapDays) {
      m.set(d.key, d.commit_count)
    }
    return m
  }, [heatmapDays])

  const heatmapMax = useMemo(() => {
    let x = 0
    for (const v of heatmapMap.values()) x = Math.max(x, v)
    return x
  }, [heatmapMap])

  const heatmapCells = useMemo(() => {
    const end = new Date()
    const gridStart = startOfWeek(subDays(end, 364), { weekStartsOn: 1 })
    const cells: { key: string; count: number; w: number; r: number }[] = []
    for (let i = 0; ; i++) {
      const day = addDays(gridStart, i)
      if (day > end) break
      const w = Math.floor(i / 7)
      const r = i % 7
      const key = format(day, 'yyyy-MM-dd')
      cells.push({
        key,
        count: heatmapMap.get(key) ?? 0,
        w,
        r,
      })
    }
    return cells
  }, [heatmapMap])

  const weekColumns = Math.max(1, Math.ceil(heatmapCells.length / 7))

  const heatScale = (count: number) => {
    if (count === 0) return 'bg-muted/70 dark:bg-muted/50'
    if (heatmapMax <= 0) return 'bg-emerald-500/35 dark:bg-emerald-400/30'
    const t = count / heatmapMax
    if (t < 0.25) return 'bg-emerald-500/40 dark:bg-emerald-400/35'
    if (t < 0.5) return 'bg-emerald-500/60 dark:bg-emerald-400/50'
    if (t < 0.75) return 'bg-emerald-500/80 dark:bg-emerald-400/65'
    return 'bg-emerald-600 dark:bg-emerald-500'
  }

  if (!repoPath) {
    return (
      <div className="flex min-h-[18rem] flex-1 items-center justify-center px-4 py-8">
        <div className="max-w-sm rounded-xl border border-dashed border-border bg-muted/30 px-8 py-10 text-center">
          <BarChart3 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" aria-hidden />
          <p className="text-sm font-medium text-foreground">尚未打开仓库</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            请从菜单打开或选择最近的 Git 仓库后查看统计报表。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 pb-3 pt-1 sm:px-0">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border-border/70 shadow-sm">
        <CardHeader className="space-y-4 border-b border-border/60 bg-muted/20 px-4 pb-4 pt-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-lg font-semibold tracking-tight">统计与报表</CardTitle>
              <CardDescription className="max-w-2xl text-xs leading-relaxed sm:text-sm">
                基于当前历史范围聚合；增删行与路径为相对「首父」的 diff。
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 gap-1.5 px-3"
              disabled={loading}
              onClick={() => void handleRefresh()}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              <span>{loading ? '计算中…' : '刷新'}</span>
            </Button>
          </div>

          <details className="group rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs text-muted-foreground [&_summary]:cursor-pointer [&_summary]:list-none [&_summary]:outline-none [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex items-center gap-2 font-medium text-foreground/80">
              <Info className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden />
              <span>数据说明</span>
              <span className="text-[10px] text-muted-foreground group-open:opacity-0 sm:text-xs">
                （点击展开）
              </span>
            </summary>
            <p className="mt-2 border-t border-border/40 pt-2 leading-relaxed text-muted-foreground">
              时间线与热力图按提交作者时区换算日期。合并提交的 diff 仅相对第一父提交；全量 diff 在大型仓库可能较慢，可稍后重试。
              各 Tab 的统计结果会在内存中按「仓库 + 范围」做缓存，切换仓库再打开同一仓库时可立即复用；若刚有新的提交或需最新数据，请点「刷新」。
            </p>
          </details>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div
              className="inline-flex h-9 shrink-0 rounded-lg border border-input bg-background p-0.5 shadow-sm"
              role="group"
              aria-label="统计范围"
            >
              <button
                type="button"
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-all',
                  statsScope === 'head'
                    ? 'bg-primary/10 text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setStatsScope('head')}
              >
                当前分支
              </button>
              <button
                type="button"
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-all',
                  statsScope === 'all'
                    ? 'bg-primary/10 text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => {
                  setStatsScope('all')
                  setStatsRev(null)
                }}
              >
                全部分支
              </button>
            </div>

            {statsScope === 'head' && branchNamesSorted.length > 0 && (
              <div className="flex min-w-0 items-center gap-2">
                <span className="hidden text-xs text-muted-foreground sm:inline">分支</span>
                <select
                  className="h-9 max-w-[min(100%,16rem)] flex-1 rounded-lg border border-input bg-background px-3 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={statsRev ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setStatsRev(v === '' ? null : v)
                  }}
                  aria-label="选择分支历史"
                >
                  <option value="">当前检出（HEAD）</option>
                  {branchNamesSorted.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {reportTab === 'timeline' && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">粒度</span>
                <div className="inline-flex rounded-lg border border-input bg-background p-0.5 shadow-sm">
                  {(['day', 'week', 'month'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                        timeGran === g
                          ? 'bg-muted text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => setTimeGran(g)}
                    >
                      {g === 'day' ? '按日' : g === 'week' ? '按周' : '按月'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div
            className="-mx-1 flex gap-0.5 overflow-x-auto pb-0.5 pt-0.5 [scrollbar-width:thin]"
            role="tablist"
            aria-label="报表类型"
          >
            {REPORT_TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={reportTab === id}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:text-sm',
                  reportTab === id
                    ? 'bg-primary/12 text-primary shadow-sm ring-1 ring-primary/25'
                    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                )}
                onClick={() => setReportTab(id)}
              >
                <Icon className="h-3.5 w-3.5 opacity-90 sm:h-4 sm:w-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              role="alert"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
        </CardHeader>

        <CardContent className="min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6">
          {reportTab === 'authors' && (
            <AuthorsSection
              loading={loading}
              error={!!error}
              rows={authorRows}
              totalAuthorCommits={totalAuthorCommits}
              maxAuthorCount={maxAuthorCount}
            />
          )}

          {reportTab === 'timeline' && (
            <TimelineSection
              loading={loading}
              error={!!error}
              rows={activityRows}
              activityMax={activityMax}
              timeGran={timeGran}
            />
          )}

          {reportTab === 'heatmap' && (
            <HeatmapSection
              loading={loading}
              error={!!error}
              heatmapDays={heatmapDays}
              heatmapCells={heatmapCells}
              heatmapMax={heatmapMax}
              weekColumns={weekColumns}
              heatScale={heatScale}
            />
          )}

          {(reportTab === 'lines' || reportTab === 'paths') && (
            <DiffSection
              reportTab={reportTab}
              loading={loading}
              diffAgg={diffAgg}
              diffProgress={diffProgress}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatTableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 shadow-sm">
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

function AuthorsSection({
  loading,
  error,
  rows,
  totalAuthorCommits,
  maxAuthorCount,
}: {
  loading: boolean
  error: boolean
  rows: AuthorCommitStat[]
  totalAuthorCommits: number
  maxAuthorCount: number
}) {
  if (!loading && totalAuthorCommits === 0 && !error) {
    return (
      <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 py-12 text-center">
        <Users className="h-8 w-8 text-muted-foreground/50" aria-hidden />
        <p className="text-sm text-muted-foreground">选定范围内暂无提交</p>
      </div>
    )
  }

  return (
    <>
      {!loading && totalAuthorCommits > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            共 {totalAuthorCommits} 次提交
          </span>
          <span className="inline-flex items-center rounded-full border border-border/80 bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
            {rows.length} 位作者
          </span>
        </div>
      )}

      {(loading || totalAuthorCommits > 0) && (
        <StatTableShell>
          <table className="w-full min-w-[440px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/45 text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">作者</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">邮箱</th>
                <th className="px-4 py-3 font-medium">提交次数</th>
                <th className="hidden min-w-[8rem] px-4 py-3 font-medium md:table-cell">占比</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-14 text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      正在遍历提交…
                    </span>
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => {
                  const pct =
                    totalAuthorCommits > 0 ? (row.commit_count / totalAuthorCommits) * 100 : 0
                  const barPct =
                    maxAuthorCount > 0 ? (row.commit_count / maxAuthorCount) * 100 : 0
                  return (
                    <tr
                      key={`${row.email || row.author}-${i}`}
                      className={cn(
                        'border-b border-border/60 transition-colors last:border-0',
                        i % 2 === 0 ? 'bg-background' : 'bg-muted/15',
                        'hover:bg-muted/35'
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{i + 1}</td>
                      <td className="max-w-[12rem] truncate px-4 py-2.5 font-medium">{row.author}</td>
                      <td className="hidden max-w-[16rem] truncate px-4 py-2.5 font-mono text-xs text-muted-foreground sm:table-cell">
                        {row.email || '—'}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{row.commit_count}</td>
                      <td className="hidden px-4 py-2.5 md:table-cell">
                        <div className="flex items-center gap-3">
                          <div className="h-2 min-w-[5rem] flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary"
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                          <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                            {pct < 10 ? pct.toFixed(1) : Math.round(pct)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </StatTableShell>
      )}
    </>
  )
}

function TimelineSection({
  loading,
  error,
  rows,
  activityMax,
  timeGran,
}: {
  loading: boolean
  error: boolean
  rows: TimeBucketStat[]
  activityMax: number
  timeGran: TimeGranularity
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ active: false, startX: 0, startScroll: 0 })
  const [pointerDragging, setPointerDragging] = useState(false)

  const onBarScrollPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    /* 触摸设备保留系统横向滑动，仅用指针（鼠标/触控板）拖动滚动 */
    if (e.pointerType === 'touch') return
    if (e.button !== 0) return
    const el = scrollerRef.current
    if (!el) return
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
    }
    el.setPointerCapture(e.pointerId)
    setPointerDragging(true)
  }, [])

  const onBarScrollPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    const el = scrollerRef.current
    if (!el) return
    const dx = e.clientX - dragRef.current.startX
    el.scrollLeft = dragRef.current.startScroll - dx
  }, [])

  const onBarScrollPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    dragRef.current.active = false
    setPointerDragging(false)
    const el = scrollerRef.current
    if (el) {
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* 已释放或 pointerId 无效 */
      }
    }
  }, [])

  const onBarScrollLostCapture = useCallback(() => {
    dragRef.current.active = false
    setPointerDragging(false)
  }, [])

  /** 默认将滚动条停在「最近时间」一侧（通常为图表右端） */
  useEffect(() => {
    if (loading || rows.length === 0) return
    const el = scrollerRef.current
    if (!el) return
    const focusLatest = () => {
      el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth)
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(focusLatest)
    })
    return () => cancelAnimationFrame(id)
  }, [rows, loading, timeGran])

  if (loading && rows.length === 0) {
    return (
      <div className="flex min-h-[14rem] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        正在统计…
      </div>
    )
  }

  if (!loading && rows.length === 0 && !error) {
    return (
      <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 py-12">
        <CalendarDays className="h-8 w-8 text-muted-foreground/50" aria-hidden />
        <p className="text-sm text-muted-foreground">该范围内暂无分桶数据</p>
      </div>
    )
  }

  const maxH = 140

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-gradient-to-b from-muted/40 to-muted/15 p-4 sm:p-5">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            共 {rows.length}{' '}
            {timeGran === 'day' ? '个日期' : timeGran === 'week' ? '个自然周' : '个月'}
            有提交
          </span>
          <span className="max-w-full text-[10px] leading-relaxed text-muted-foreground/90 sm:text-xs">
            · 图表区可拖动横移；触屏请横向滑动
          </span>
        </div>
        <div
          ref={scrollerRef}
          role="region"
          aria-label="时间趋势柱状图，可拖动横向滚动"
          className={cn(
            'flex max-w-full select-none items-end gap-1 overflow-x-auto pb-1 pt-3 [scrollbar-width:thin] sm:gap-1.5',
            pointerDragging ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing'
          )}
          onPointerDown={onBarScrollPointerDown}
          onPointerMove={onBarScrollPointerMove}
          onPointerUp={onBarScrollPointerUp}
          onPointerCancel={onBarScrollPointerUp}
          onLostPointerCapture={onBarScrollLostCapture}
        >
          {rows.map((row) => {
            const h =
              activityMax > 0
                ? Math.max(6, (row.commit_count / activityMax) * maxH)
                : 6
            const labelShort =
              timeGran === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(row.key)
                ? row.key.slice(5)
                : row.key
            return (
              <div
                key={row.key}
                className={cn(
                  'flex shrink-0 flex-col items-center gap-1.5 sm:gap-2',
                  timeGran === 'day' ? 'min-w-[1.85rem] max-w-[2.75rem]' : 'min-w-[3rem] max-w-[5rem]'
                )}
              >
                <span className="text-[10px] font-semibold tabular-nums text-foreground sm:text-xs">
                  {row.commit_count}
                </span>
                <div className="flex h-[148px] w-full flex-col justify-end">
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-primary/55 via-primary/75 to-primary shadow-sm ring-1 ring-primary/15 transition-[height]"
                    style={{ height: `${h}px` }}
                    title={`${row.key}: ${row.commit_count} 次提交`}
                  />
                </div>
                <span
                  className={cn(
                    'line-clamp-3 w-full text-center leading-tight text-muted-foreground',
                    timeGran === 'day' ? 'text-[8px] sm:text-[9px]' : 'text-[10px]'
                  )}
                  title={row.key}
                >
                  {labelShort}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function HeatmapSection({
  loading,
  error,
  heatmapDays,
  heatmapCells,
  heatmapMax,
  weekColumns,
  heatScale,
}: {
  loading: boolean
  error: boolean
  heatmapDays: TimeBucketStat[]
  heatmapCells: { key: string; count: number; w: number; r: number }[]
  heatmapMax: number
  weekColumns: number
  heatScale: (count: number) => string
}) {
  if (loading && heatmapDays.length === 0) {
    return (
      <div className="flex min-h-[14rem] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        正在统计每日提交…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!loading && heatmapDays.length === 0 && !error && (
        <p className="text-center text-xs text-muted-foreground">
          当前范围内无提交记录；下方为最近约一年日历（仍可按日展示空档）。
        </p>
      )}

      {!loading && (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <Flame className="h-3.5 w-3.5 text-orange-500/90" aria-hidden />
              贡献热力
            </div>
            <span className="text-[11px] text-muted-foreground">周一 ← 列表示周，行表示星期</span>
          </div>

          <div className="flex min-w-0 gap-2 sm:gap-3">
            <div
              className="grid shrink-0 gap-[3px] text-[10px] text-muted-foreground sm:gap-1 sm:text-[11px]"
              style={{ gridTemplateRows: 'repeat(7, 11px)' }}
              aria-hidden
            >
              {HEAT_WEEKDAYS.map((d) => (
                <div key={d} className="flex items-center pr-0.5">
                  {d}
                </div>
              ))}
            </div>
            <div className="min-w-0 flex-1 overflow-x-auto pb-1 pt-0.5 [scrollbar-width:thin]">
              <div
                className="inline-grid gap-[3px] sm:gap-1"
                style={{
                  gridTemplateColumns: `repeat(${weekColumns}, minmax(11px, 13px))`,
                  gridTemplateRows: 'repeat(7, 11px)',
                }}
              >
                {heatmapCells.map((c) => (
                  <div
                    key={c.key}
                    title={`${c.key} · ${c.count} 次提交`}
                    className={cn(
                      'rounded-sm ring-1 ring-black/5 dark:ring-white/10',
                      heatScale(c.count)
                    )}
                    style={{
                      gridColumnStart: c.w + 1,
                      gridRowStart: c.r + 1,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-border/50 pt-3 text-[10px] text-muted-foreground sm:text-xs">
            <span>较少</span>
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={cn(
                    'h-3.5 w-3.5 rounded-sm sm:h-4 sm:w-4',
                    heatmapMax > 0
                      ? heatScale(Math.round((heatmapMax * i) / 4))
                      : 'bg-muted/70'
                  )}
                />
              ))}
            </div>
            <span>较多</span>
          </div>
        </div>
      )}
    </div>
  )
}

function DiffSection({
  reportTab,
  loading,
  diffAgg,
  diffProgress,
}: {
  reportTab: 'lines' | 'paths'
  loading: boolean
  diffAgg: DiffAggregateStats | null
  diffProgress: { current: number; total: number } | null
}) {
  const pct =
    diffProgress != null && diffProgress.total > 0
      ? Math.min(100, Math.round((diffProgress.current / diffProgress.total) * 100))
      : null

  if (loading && !diffAgg) {
    return (
      <div className="flex min-h-[14rem] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/15 px-6 py-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary/70" aria-hidden />
        <p className="max-w-sm text-sm text-muted-foreground">
          正在对历史提交逐条 diff，大型仓库可能需要数十秒…
        </p>
        {diffProgress != null && diffProgress.total > 0 ? (
          <div className="w-full max-w-md space-y-2">
            <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span>处理进度</span>
              <span className="tabular-nums font-medium text-foreground">
                {diffProgress.current} / {diffProgress.total} 个提交
                {pct != null ? ` · ${pct}%` : ''}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary/75 to-primary transition-[width] duration-150 ease-out"
                style={{ width: pct != null ? `${pct}%` : '0%' }}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">正在统计提交总数并建立 diff…</p>
        )}
      </div>
    )
  }

  if (diffAgg && reportTab === 'lines') {
    return <AuthorLinesTable rows={diffAgg.authors} loading={loading} />
  }
  if (diffAgg && reportTab === 'paths') {
    return <PathTouchesTable rows={diffAgg.paths} loading={loading} />
  }

  return null
}

function AuthorLinesTable({
  rows,
  loading,
}: {
  rows: AuthorLineStat[]
  loading: boolean
}) {
  const maxDelta = useMemo(() => {
    let m = 0
    for (const r of rows) {
      m = Math.max(m, r.insertions + r.deletions)
    }
    return m
  }, [rows])

  if (!loading && rows.length === 0) {
    return (
      <div className="flex min-h-[10rem] items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
        暂无数据
      </div>
    )
  }

  return (
    <StatTableShell>
      <table className="w-full min-w-[480px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/45 text-xs text-muted-foreground">
            <th className="px-4 py-3 font-medium">#</th>
            <th className="px-4 py-3 font-medium">作者</th>
            <th className="hidden px-4 py-3 font-medium sm:table-cell">邮箱</th>
            <th className="px-4 py-3 font-medium">+行</th>
            <th className="px-4 py-3 font-medium">−行</th>
            <th className="px-4 py-3 font-medium">净增减</th>
            <th className="px-4 py-3 font-medium">涉及提交</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const net = row.insertions - row.deletions
            const total = row.insertions + row.deletions
            const bar = maxDelta > 0 ? (total / maxDelta) * 100 : 0
            return (
              <tr
                key={`${row.email}-${row.author}-${i}`}
                className={cn(
                  'border-b border-border/60 last:border-0',
                  i % 2 === 0 ? 'bg-background' : 'bg-muted/15',
                  'hover:bg-muted/35'
                )}
              >
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{i + 1}</td>
                <td className="max-w-[9rem] truncate px-4 py-2.5">{row.author}</td>
                <td className="hidden max-w-[12rem] truncate px-4 py-2.5 font-mono text-xs text-muted-foreground sm:table-cell">
                  {row.email || '—'}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{row.insertions}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-rose-600 dark:text-rose-400">
                  −{row.deletions}
                </td>
                <td className="px-4 py-2.5 tabular-nums">
                  {net >= 0 ? '+' : ''}
                  {net}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 min-w-[3rem] max-w-[7rem] flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary"
                        style={{ width: `${bar}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-muted-foreground">{row.commit_count}</span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </StatTableShell>
  )
}

function PathTouchesTable({
  rows,
  loading,
}: {
  rows: PathTouchStat[]
  loading: boolean
}) {
  const maxT = rows[0]?.touch_count ?? 0
  if (!loading && rows.length === 0) {
    return (
      <div className="flex min-h-[10rem] items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
        暂无数据
      </div>
    )
  }
  return (
    <StatTableShell>
      <table className="w-full min-w-[360px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/45 text-xs text-muted-foreground">
            <th className="px-4 py-3 font-medium">#</th>
            <th className="px-4 py-3 font-medium">路径</th>
            <th className="px-4 py-3 font-medium">触及次数</th>
          </tr>
        </thead>
        <tbody className="font-mono text-xs">
          {rows.map((row, i) => (
            <tr
              key={row.path}
              className={cn(
                'border-b border-border/60 last:border-0',
                i % 2 === 0 ? 'bg-background' : 'bg-muted/15',
                'hover:bg-muted/35'
              )}
            >
              <td className="px-4 py-2.5 align-top text-[11px] text-muted-foreground">{i + 1}</td>
              <td className="max-w-[min(48rem,85vw)] break-all px-4 py-2.5 align-top text-[13px] text-foreground">
                {row.path}
              </td>
              <td className="px-4 py-2.5 align-middle">
                <div className="flex items-center gap-2">
                  <div className="h-2 min-w-[4rem] flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-500/80 to-amber-600 dark:from-amber-400/70 dark:to-amber-500"
                      style={{
                        width: `${maxT > 0 ? (row.touch_count / maxT) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="shrink-0 tabular-nums text-[13px] text-foreground">{row.touch_count}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </StatTableShell>
  )
}
