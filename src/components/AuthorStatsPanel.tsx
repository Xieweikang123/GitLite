import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, startOfWeek, subDays } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
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
type TimeGranularity = 'week' | 'month'

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
  const [timeGran, setTimeGran] = useState<TimeGranularity>('week')

  const [authorRows, setAuthorRows] = useState<AuthorCommitStat[]>([])
  const [activityRows, setActivityRows] = useState<TimeBucketStat[]>([])
  const [heatmapDays, setHeatmapDays] = useState<TimeBucketStat[]>([])
  const [diffAgg, setDiffAgg] = useState<DiffAggregateStats | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 避免在「增删行」与「文件热度」之间切换时重复整库 diff */
  const diffCacheKeyRef = useRef<string>('')
  const diffDataRef = useRef<DiffAggregateStats | null>(null)

  useEffect(() => {
    diffCacheKeyRef.current = ''
    diffDataRef.current = null
    setDiffAgg(null)
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

  const runLoad = useCallback(async (force = false) => {
    if (!repoPath) return
    const diffKey = `${repoPath}|${scopeArgs.scope}|${scopeArgs.rev ?? ''}`
    if (
      !force &&
      (reportTab === 'lines' || reportTab === 'paths') &&
      diffCacheKeyRef.current === diffKey &&
      diffDataRef.current
    ) {
      return
    }

    setLoading(true)
    setError(null)
    try {
      if (reportTab === 'authors') {
        setAuthorRows([])
        const data = await getAuthorCommitStats(scopeArgs.scope, scopeArgs.rev)
        setAuthorRows(data)
      } else if (reportTab === 'timeline') {
        setActivityRows([])
        const data = await getCommitActivityStats(
          timeGran === 'week' ? 'week' : 'month',
          scopeArgs.scope,
          scopeArgs.rev
        )
        setActivityRows(data)
      } else if (reportTab === 'heatmap') {
        setHeatmapDays([])
        const data = await getCommitActivityStats(
          'day',
          scopeArgs.scope,
          scopeArgs.rev
        )
        setHeatmapDays(data)
      } else {
        setDiffAgg(null)
        diffDataRef.current = null
        const data = await getDiffAggregateStats(scopeArgs.scope, scopeArgs.rev, 50)
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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [
    repoPath,
    reportTab,
    timeGran,
    scopeArgs.scope,
    scopeArgs.rev,
    getAuthorCommitStats,
    getCommitActivityStats,
    getDiffAggregateStats,
  ])

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
    const cells: {
      key: string
      count: number
      w: number
      r: number
    }[] = []
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

  const heatScale = (count: number) => {
    if (count === 0) return 'bg-muted/60 dark:bg-muted/40'
    if (heatmapMax <= 0) return 'bg-primary/30'
    const t = count / heatmapMax
    if (t < 0.25) return 'bg-primary/35 dark:bg-primary/30'
    if (t < 0.5) return 'bg-primary/55 dark:bg-primary/45'
    if (t < 0.75) return 'bg-primary/75 dark:bg-primary/60'
    return 'bg-primary dark:bg-primary/85'
  }

  if (!repoPath) {
    return (
      <div className="flex flex-1 items-center justify-center py-12 text-center text-muted-foreground">
        请先打开一个 Git 仓库
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 py-2">
      <Card className="flex min-h-0 flex-1 flex-col border-border/80">
        <CardHeader className="space-y-3 px-4 pb-2 pt-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">统计与报表</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={loading}
              onClick={() => void handleRefresh()}
            >
              {loading ? '计算中…' : '刷新'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            时间线按作者时区显示日期；增删行与路径为「相对首父」的 diff，合并提交只计第一父级。
            仓库很大时遍历较慢，请耐心等待。
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex h-7 shrink-0 rounded-md border border-input bg-muted/45 p-0.5 dark:bg-muted/25"
              role="group"
            >
              <button
                type="button"
                className={cn(
                  'whitespace-nowrap rounded px-2.5 py-0.5 text-xs font-medium transition-colors',
                  statsScope === 'head'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setStatsScope('head')}
              >
                当前分支
              </button>
              <button
                type="button"
                className={cn(
                  'whitespace-nowrap rounded px-2.5 py-0.5 text-xs font-medium transition-colors',
                  statsScope === 'all'
                    ? 'bg-background text-foreground shadow-sm ring-1 ring-primary/40'
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
              <select
                className="h-7 max-w-[14rem] rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            )}
          </div>

          <div
            className="flex flex-wrap gap-1 rounded-lg border border-border/60 bg-muted/20 p-1 dark:bg-muted/10"
            role="tablist"
          >
            {(
              [
                ['authors', '作者'],
                ['timeline', '时间趋势'],
                ['heatmap', '贡献热力'],
                ['lines', '增删行'],
                ['paths', '文件热度'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={reportTab === id}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  reportTab === id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setReportTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {reportTab === 'timeline' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>粒度</span>
              <select
                className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                value={timeGran}
                onChange={(e) => setTimeGran(e.target.value as TimeGranularity)}
              >
                <option value="week">按周</option>
                <option value="month">按月</option>
              </select>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardHeader>

        <CardContent className="min-h-0 flex-1 overflow-auto px-2 pb-4 pt-0 sm:px-4">
          {reportTab === 'authors' && (
            <>
              {!loading && totalAuthorCommits === 0 && !error && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  选定范围内暂无提交。
                </p>
              )}
              {(loading || totalAuthorCommits > 0) && (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[440px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">作者</th>
                        <th className="hidden px-3 py-2 font-medium sm:table-cell">邮箱</th>
                        <th className="px-3 py-2 font-medium">提交次数</th>
                        <th className="hidden min-w-[120px] px-3 py-2 font-medium md:table-cell">
                          占比
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && authorRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-3 py-10 text-center text-muted-foreground"
                          >
                            正在遍历提交…
                          </td>
                        </tr>
                      ) : (
                        authorRows.map((row, i) => {
                          const pct =
                            totalAuthorCommits > 0
                              ? (row.commit_count / totalAuthorCommits) * 100
                              : 0
                          const barPct =
                            maxAuthorCount > 0
                              ? (row.commit_count / maxAuthorCount) * 100
                              : 0
                          return (
                            <tr
                              key={`${row.email || row.author}-${i}`}
                              className="border-b border-border/70 last:border-0 hover:bg-muted/30"
                            >
                              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                                {i + 1}
                              </td>
                              <td className="max-w-[10rem] truncate px-3 py-2 font-medium">
                                {row.author}
                              </td>
                              <td className="hidden max-w-[14rem] truncate px-3 py-2 font-mono text-xs text-muted-foreground sm:table-cell">
                                {row.email || '—'}
                              </td>
                              <td className="px-3 py-2 tabular-nums">{row.commit_count}</td>
                              <td className="hidden px-3 py-2 md:table-cell">
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 min-w-[72px] flex-1 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className="h-full rounded-full bg-primary/80"
                                      style={{ width: `${barPct}%` }}
                                    />
                                  </div>
                                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
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
                </div>
              )}
              {!loading && totalAuthorCommits > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  共 {totalAuthorCommits} 次提交，{authorRows.length} 位作者。
                </p>
              )}
            </>
          )}

          {reportTab === 'timeline' && (
            <>
              {loading && activityRows.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">正在统计…</p>
              )}
              {!loading && activityRows.length === 0 && !error && (
                <p className="py-10 text-center text-sm text-muted-foreground">暂无数据。</p>
              )}
              {activityRows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex max-w-full flex-nowrap gap-2 overflow-x-auto pb-2">
                    {activityRows.map((row) => (
                      <div
                        key={row.key}
                        className="flex min-w-[8rem] flex-1 flex-col gap-1 rounded-md border border-border/70 bg-muted/25 px-2 py-2"
                      >
                        <span className="truncate text-[10px] text-muted-foreground" title={row.key}>
                          {row.key}
                        </span>
                        <div className="flex items-end gap-2">
                          <div
                            className="w-full rounded-sm bg-primary/75"
                            style={{
                              height: `${8 + (activityMax > 0 ? (row.commit_count / activityMax) * 56 : 0)}px`,
                              minHeight: '8px',
                            }}
                          />
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            {row.commit_count}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    共 {activityRows.length} 个{timeGran === 'week' ? '周' : '月'}内有提交。
                  </p>
                </div>
              )}
            </>
          )}

          {reportTab === 'heatmap' && (
            <>
              {loading && heatmapDays.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">正在统计日提交…</p>
              )}
              {!loading && heatmapDays.length === 0 && !error && (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  统计范围内无提交记录；下方为最近一年日历格。
                </p>
              )}
              {!loading && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    最近约一年 · 周始于周一 · 颜色越深提交越多
                  </p>
                  <div
                    className="inline-grid gap-[3px] overflow-x-auto pb-2 pt-1"
                    style={{
                      gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(heatmapCells.length / 7))}, minmax(10px, 12px))`,
                      gridTemplateRows: 'repeat(7, 12px)',
                    }}
                  >
                    {heatmapCells.map((c) => (
                      <div
                        key={c.key}
                        title={`${c.key} · ${c.count} 次提交`}
                        className={cn(
                          'rounded-[2px] ring-1 ring-border/40',
                          heatScale(c.count)
                        )}
                        style={{
                          gridColumnStart: c.w + 1,
                          gridRowStart: c.r + 1,
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span>少</span>
                    <div className="flex gap-0.5">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className={cn(
                            'h-3 w-3 rounded-sm',
                            heatmapMax > 0
                              ? heatScale(Math.round((heatmapMax * i) / 4))
                              : 'bg-muted/60'
                          )}
                        />
                      ))}
                    </div>
                    <span>多</span>
                  </div>
                </div>
              )}
            </>
          )}

          {(reportTab === 'lines' || reportTab === 'paths') && (
            <>
              {loading && !diffAgg && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  正在 diff 全量历史（可能较慢）…
                </p>
              )}
              {diffAgg && reportTab === 'lines' && (
                <AuthorLinesTable rows={diffAgg.authors} loading={loading} />
              )}
              {diffAgg && reportTab === 'paths' && (
                <PathTouchesTable rows={diffAgg.paths} loading={loading} />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
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
    return <p className="py-8 text-center text-sm text-muted-foreground">暂无数据。</p>
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[480px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">作者</th>
            <th className="hidden px-3 py-2 font-medium sm:table-cell">邮箱</th>
            <th className="px-3 py-2 font-medium">+行</th>
            <th className="px-3 py-2 font-medium">−行</th>
            <th className="px-3 py-2 font-medium">净增减</th>
            <th className="px-3 py-2 font-medium">涉及提交</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const net = row.insertions - row.deletions
            const total = row.insertions + row.deletions
            const bar = maxDelta > 0 ? (total / maxDelta) * 100 : 0
            return (
              <tr key={`${row.email}-${row.author}-${i}`} className="border-b border-border/70 hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{i + 1}</td>
                <td className="max-w-[9rem] truncate px-3 py-2">{row.author}</td>
                <td className="hidden max-w-[12rem] truncate px-3 py-2 font-mono text-xs text-muted-foreground sm:table-cell">
                  {row.email || '—'}
                </td>
                <td className="px-3 py-2 tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{row.insertions}
                </td>
                <td className="px-3 py-2 tabular-nums text-rose-600 dark:text-rose-400">
                  −{row.deletions}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {net >= 0 ? '+' : ''}
                  {net}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 min-w-[48px] max-w-[120px] flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/80"
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
    </div>
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
    return <p className="py-8 text-center text-sm text-muted-foreground">暂无数据。</p>
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[360px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">路径</th>
            <th className="px-3 py-2 font-medium">触及次数</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.path} className="border-b border-border/70 font-mono text-xs hover:bg-muted/30">
              <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
              <td className="max-w-[min(48rem,80vw)] break-all px-3 py-2 text-[13px] text-foreground">
                {row.path}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 min-w-[64px] flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/75"
                      style={{
                        width: `${maxT > 0 ? (row.touch_count / maxT) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="shrink-0 tabular-nums text-[13px]">{row.touch_count}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
