import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns'
import {
  AlertCircle,
  BarChart3,
  Calendar,
  CalendarDays,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileStack,
  Flame,
  FolderTree,
  GitCompareArrows,
  Info,
  Loader2,
  RefreshCw,
  Users,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { cn } from '../lib/utils'
import type {
  AuthorCommitStat,
  AuthorLineStat,
  CommitInfo,
  DiffAggregateStats,
  FileTerritoryStat,
  PathTouchStat,
  TimeBucketStat,
} from '../types/git'

type ReportTab = 'authors' | 'timeline' | 'heatmap' | 'calendar' | 'lines' | 'paths' | 'territory'
type TimeGranularity = 'day' | 'week' | 'month'

const REPORT_TABS: { id: ReportTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'authors', label: '作者', Icon: Users },
  { id: 'timeline', label: '时间趋势', Icon: BarChart3 },
  { id: 'heatmap', label: '贡献热力', Icon: Flame },
  { id: 'calendar', label: '日历视图', Icon: Calendar },
  { id: 'lines', label: '增删行', Icon: GitCompareArrows },
  { id: 'paths', label: '文件热度', Icon: FileStack },
  { id: 'territory', label: '文件领地', Icon: FolderTree },
]

const HEAT_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/** 日历表头：完整「周一…周日」，避免单字「一、二、三」在部分字体下显示异常 */
const CALENDAR_WEEKDAY_HEADERS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

/** 超过该次数仍用最浓一档；1…N 逐级加深，保证「次数越多一定越深」 */
const COMMIT_HEAT_MAX_LEVEL = 16

function commitCountHeatLevel(count: number): number {
  if (count <= 0) return 0
  return Math.min(count, COMMIT_HEAT_MAX_LEVEL)
}

/**
 * 热力图色块背景：按次数单调加深（与日历同档）。
 * 使用固定档位避免「相对当月最大值」导致 1 次与 2 次落在同一桶。
 */
const HEATMAP_HEAT_BG: readonly string[] = [
  'bg-emerald-500/36 dark:bg-emerald-400/28',
  'bg-emerald-500/40 dark:bg-emerald-400/32',
  'bg-emerald-500/44 dark:bg-emerald-400/36',
  'bg-emerald-500/48 dark:bg-emerald-400/40',
  'bg-emerald-500/52 dark:bg-emerald-400/44',
  'bg-emerald-500/56 dark:bg-emerald-400/48',
  'bg-emerald-500/60 dark:bg-emerald-400/52',
  'bg-emerald-500/64 dark:bg-emerald-400/56',
  'bg-emerald-500/68 dark:bg-emerald-400/60',
  'bg-emerald-500/72 dark:bg-emerald-400/64',
  'bg-emerald-500/76 dark:bg-emerald-400/68',
  'bg-emerald-500/82 dark:bg-emerald-400/72',
  'bg-emerald-500/86 dark:bg-emerald-400/76',
  'bg-emerald-500/90 dark:bg-emerald-400/80',
  'bg-emerald-600/92 dark:bg-emerald-500/88',
  'bg-emerald-600 dark:bg-emerald-500',
]

function commitHeatmapBgClass(count: number): string {
  const lvl = commitCountHeatLevel(count)
  if (lvl === 0) return 'bg-muted/70 dark:bg-muted/50'
  return HEATMAP_HEAT_BG[lvl - 1]
}

/** 日历有提交格：与 HEATMAP_HEAT_BG 档位一一对应，边框与 hover 同步加深 */
const CALENDAR_HEAT_SURFACE: readonly string[] = [
  'border border-solid border-emerald-500/46 bg-emerald-500/36 dark:border-emerald-400/40 dark:bg-emerald-400/28 dark:hover:bg-emerald-400/36',
  'border border-solid border-emerald-500/48 bg-emerald-500/40 dark:border-emerald-400/42 dark:bg-emerald-400/32 dark:hover:bg-emerald-400/40',
  'border border-solid border-emerald-500/50 bg-emerald-500/44 dark:border-emerald-400/44 dark:bg-emerald-400/36 dark:hover:bg-emerald-400/44',
  'border border-solid border-emerald-500/52 bg-emerald-500/48 dark:border-emerald-400/46 dark:bg-emerald-400/40 dark:hover:bg-emerald-400/48',
  'border border-solid border-emerald-500/54 bg-emerald-500/52 dark:border-emerald-400/48 dark:bg-emerald-400/44 dark:hover:bg-emerald-400/52',
  'border border-solid border-emerald-500/58 bg-emerald-500/56 dark:border-emerald-400/50 dark:bg-emerald-400/48 dark:hover:bg-emerald-400/56',
  'border border-solid border-emerald-500/62 bg-emerald-500/60 dark:border-emerald-400/52 dark:bg-emerald-400/52 dark:hover:bg-emerald-400/60',
  'border border-solid border-emerald-500/66 bg-emerald-500/64 dark:border-emerald-400/54 dark:bg-emerald-400/56 dark:hover:bg-emerald-400/64',
  'border border-solid border-emerald-500/70 bg-emerald-500/68 dark:border-emerald-400/56 dark:bg-emerald-400/60 dark:hover:bg-emerald-400/68',
  'border border-solid border-emerald-500/74 bg-emerald-500/72 dark:border-emerald-400/58 dark:bg-emerald-400/64 dark:hover:bg-emerald-400/72',
  'border border-solid border-emerald-500/78 bg-emerald-500/76 dark:border-emerald-400/60 dark:bg-emerald-400/68 dark:hover:bg-emerald-400/76',
  'border border-solid border-emerald-600/80 bg-emerald-500/82 dark:border-emerald-400/64 dark:bg-emerald-400/72 dark:hover:bg-emerald-400/80',
  'border border-solid border-emerald-600/82 bg-emerald-500/86 dark:border-emerald-400/68 dark:bg-emerald-400/76 dark:hover:bg-emerald-400/84',
  'border border-solid border-emerald-600/85 bg-emerald-500/90 dark:border-emerald-400/72 dark:bg-emerald-400/80 dark:hover:bg-emerald-400/88',
  'border border-solid border-emerald-600/88 bg-emerald-600/92 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] dark:border-emerald-400/78 dark:bg-emerald-500/88 dark:hover:bg-emerald-400/92',
  'border border-solid border-emerald-600/90 bg-emerald-600 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] dark:border-emerald-400/80 dark:bg-emerald-500 dark:hover:bg-emerald-400',
]

/** 日历格：无提交 = 虚线空槽；有提交 = 按次数单调加深的翠绿色阶（与贡献热力一致） */
function calendarDayCellClass(
  count: number,
  opts: { inMonth: boolean; isToday: boolean; isSelected: boolean }
): string {
  const { inMonth, isToday, isSelected } = opts
  if (!inMonth) {
    return cn(
      'relative flex min-h-[2.1rem] flex-col items-center justify-center rounded-lg border border-transparent',
      'pointer-events-none select-none opacity-45 sm:min-h-[2.35rem]',
      'bg-zinc-100/60 dark:bg-[#0f1115]/70 dark:opacity-[0.4]'
    )
  }
  const base = cn(
    'group relative flex min-h-[2.1rem] cursor-default flex-col items-center justify-center rounded-lg border px-0.5 py-1.5',
    'transition-all duration-150 sm:min-h-[2.35rem]',
    'hover:-translate-y-px hover:shadow-sm',
    'dark:hover:shadow-[0_2px_12px_rgba(0,0,0,0.5)]'
  )
  const lvl = commitCountHeatLevel(count)
  const surface = cn(
    count <= 0 &&
      cn(
        'ring-1 ring-inset ring-zinc-200/95',
        'border border-dashed border-zinc-400/75 bg-zinc-100/95',
        'dark:ring-white/[0.07] dark:border-zinc-500/55 dark:bg-[#0c0e14]',
        'dark:[background-image:linear-gradient(135deg,rgba(255,255,255,0.035)_0%,transparent_55%)]',
        'hover:border-zinc-500 hover:bg-zinc-200/90 dark:hover:border-zinc-400/45 dark:hover:bg-[#12151c]'
      ),
    count > 0 && lvl > 0 && CALENDAR_HEAT_SURFACE[lvl - 1]
  )
  const selected = isSelected
    ? 'z-[1] ring-2 ring-emerald-500/50 ring-offset-1 ring-offset-white dark:ring-emerald-400/60 dark:ring-offset-0 dark:shadow-[inset_0_0_0_1px_rgba(52,211,153,0.4)]'
    : ''
  const todayDot =
    isToday && inMonth
      ? "after:pointer-events-none after:absolute after:right-1.5 after:top-1.5 after:h-1 after:w-1 after:rounded-full after:bg-emerald-600 after:content-[''] dark:after:bg-emerald-300"
      : ''
  return cn(base, surface, selected, todayDot)
}

/** 按仓库 / 范围 / 维度区分；切换仓库再切回时可命中缓存，避免重复计算 */
const DIFF_AGGREGATE_PATH_LIMIT = 50
/** 文件领地：返回的文件路径条数上限（与后端默认一致） */
const TERRITORY_FILE_LIMIT = 120
const statsResultCache = {
  authors: new Map<string, AuthorCommitStat[]>(),
  activity: new Map<string, TimeBucketStat[]>(),
  /** 热力图固定按日 */
  heatmap: new Map<string, TimeBucketStat[]>(),
  diff: new Map<string, DiffAggregateStats>(),
  territory: new Map<string, FileTerritoryStat[]>(),
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

function cacheKeyFileTerritory(
  repo: string,
  scope: 'head' | 'all',
  rev: string | null | undefined,
  limit: number
) {
  return `${repo}|${scope}|${rev ?? ''}|fileTerritory|l${limit}`
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
  getFileTerritoryStats: (
    scope: 'head' | 'all',
    rev?: string | null,
    fileLimit?: number
  ) => Promise<FileTerritoryStat[]>
  getCommitsForActivityBucket: (
    granularity: 'day' | 'week' | 'month',
    bucketKey: string,
    scope: 'head' | 'all',
    rev?: string | null
  ) => Promise<CommitInfo[]>
}

export function AuthorStatsPanel({
  repoPath,
  branchNames,
  getAuthorCommitStats,
  getCommitActivityStats,
  getCommitsForActivityBucket,
  getDiffAggregateStats,
  getFileTerritoryStats,
}: AuthorStatsPanelProps) {
  const [statsScope, setStatsScope] = useState<'head' | 'all'>('head')
  const [statsRev, setStatsRev] = useState<string | null>(null)
  const [reportTab, setReportTab] = useState<ReportTab>('authors')
  const [timeGran, setTimeGran] = useState<TimeGranularity>('day')
  /** 日历 Tab 当前展示的月份（自然月首日） */
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()))

  const [authorRows, setAuthorRows] = useState<AuthorCommitStat[]>([])
  const [activityRows, setActivityRows] = useState<TimeBucketStat[]>([])
  const [heatmapDays, setHeatmapDays] = useState<TimeBucketStat[]>([])
  const [diffAgg, setDiffAgg] = useState<DiffAggregateStats | null>(null)
  const [territoryRows, setTerritoryRows] = useState<FileTerritoryStat[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 图表点击联动：按分桶列出提交 */
  const [drillOpen, setDrillOpen] = useState(false)
  const [drillTitle, setDrillTitle] = useState('')
  const [drillCommits, setDrillCommits] = useState<CommitInfo[]>([])
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError] = useState<string | null>(null)
  /** diff 聚合统计进度（与 Tauri 事件 diff-aggregate-progress 同步） */
  const [diffProgress, setDiffProgress] = useState<{ current: number; total: number } | null>(null)
  const diffCacheKeyRef = useRef<string>('')
  const diffDataRef = useRef<DiffAggregateStats | null>(null)

  useEffect(() => {
    diffCacheKeyRef.current = ''
    diffDataRef.current = null
    setDiffAgg(null)
    setTerritoryRows([])
    setDiffProgress(null)
    setCalendarMonth(startOfMonth(new Date()))
    setDrillOpen(false)
  }, [repoPath])

  useEffect(() => {
    if (reportTab !== 'lines' && reportTab !== 'paths' && reportTab !== 'territory') {
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

  const openActivityDrill = useCallback(
    async (gran: 'day' | 'week' | 'month', bucketKey: string, title: string) => {
      setDrillOpen(true)
      setDrillTitle(title)
      setDrillLoading(true)
      setDrillError(null)
      setDrillCommits([])
      try {
        const list = await getCommitsForActivityBucket(
          gran,
          bucketKey,
          scopeArgs.scope,
          scopeArgs.rev
        )
        setDrillCommits(list)
      } catch (e) {
        setDrillError(e instanceof Error ? e.message : String(e))
      } finally {
        setDrillLoading(false)
      }
    },
    [getCommitsForActivityBucket, scopeArgs.scope, scopeArgs.rev]
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
        } else if (reportTab === 'heatmap' || reportTab === 'calendar') {
          const k = cacheKeyActivity(repoPath, scope, rev, 'day')
          const hit = statsResultCache.heatmap.get(k)
          if (hit) {
            setHeatmapDays(hit)
            setError(null)
            return
          }
        } else if (reportTab === 'territory') {
          const k = cacheKeyFileTerritory(repoPath, scope, rev, TERRITORY_FILE_LIMIT)
          const hit = statsResultCache.territory.get(k)
          if (hit) {
            setTerritoryRows(hit)
            setError(null)
            return
          }
        } else if (reportTab === 'lines' || reportTab === 'paths') {
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
        } else if (reportTab === 'heatmap' || reportTab === 'calendar') {
          setHeatmapDays([])
          const data = await getCommitActivityStats('day', scope, rev)
          const k = cacheKeyActivity(repoPath, scope, rev, 'day')
          statsResultCache.heatmap.set(k, data)
          setHeatmapDays(data)
        } else if (reportTab === 'territory') {
          setTerritoryRows([])
          setDiffProgress({ current: 0, total: 0 })
          const data = await getFileTerritoryStats(scope, rev, TERRITORY_FILE_LIMIT)
          const k = cacheKeyFileTerritory(repoPath, scope, rev, TERRITORY_FILE_LIMIT)
          statsResultCache.territory.set(k, data)
          setTerritoryRows(data)
        } else if (reportTab === 'lines' || reportTab === 'paths') {
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
        setTerritoryRows([])
        setDiffAgg(null)
        diffDataRef.current = null
        diffCacheKeyRef.current = ''
        setDiffProgress(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
        if (reportTab === 'lines' || reportTab === 'paths' || reportTab === 'territory') {
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
      getFileTerritoryStats,
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

  const heatScale = (count: number) => commitHeatmapBgClass(count)

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
    <div className="flex min-h-0 flex-1 flex-col gap-1 pb-2 pt-0.5 sm:px-0">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border-border/70 shadow-sm">
        <CardHeader className="space-y-1.5 border-b border-border/60 bg-muted/20 px-3 py-2 sm:px-4 sm:py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="min-w-0 flex-1 space-y-0">
              <CardTitle className="text-base font-semibold leading-tight tracking-tight">
                统计与报表
              </CardTitle>
              <CardDescription className="mt-0.5 line-clamp-2 max-w-2xl text-[11px] leading-snug text-muted-foreground sm:line-clamp-1 sm:text-xs">
                基于当前历史范围聚合；增删行、文件热度与文件领地为相对「首父」的 diff。
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1 px-2.5 text-xs"
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

          <details className="group text-[11px] text-muted-foreground [&_summary]:cursor-pointer [&_summary]:list-none [&_summary]:outline-none [&_summary::-webkit-details-marker]:hidden">
            <summary className="inline-flex items-center gap-1 rounded-md py-0.5 font-medium text-foreground/75 hover:text-foreground">
              <Info className="h-3 w-3 shrink-0 text-primary/75" aria-hidden />
              <span>数据说明</span>
              <span className="text-[10px] font-normal text-muted-foreground/90 group-open:hidden">
                （展开）
              </span>
            </summary>
            <p className="mt-1.5 border-l-2 border-primary/25 pl-2.5 text-[11px] leading-relaxed text-muted-foreground">
              时间线、热力图与日历视图按提交作者时区换算日期。合并提交的 diff 仅相对第一父提交；全量 diff 在大型仓库可能较慢，可稍后重试。
              各 Tab 的统计结果会在内存中按「仓库 + 范围」做缓存，切换仓库再打开同一仓库时可立即复用；若刚有新的提交或需最新数据，请点「刷新」。
            </p>
          </details>

          <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
            <div
              className="inline-flex h-8 shrink-0 rounded-md border border-input bg-background p-0.5 shadow-sm"
              role="group"
              aria-label="统计范围"
            >
              <button
                type="button"
                className={cn(
                  'rounded px-2.5 py-0.5 text-[11px] font-medium transition-all sm:text-xs',
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
                  'rounded px-2.5 py-0.5 text-[11px] font-medium transition-all sm:text-xs',
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
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="hidden text-[11px] text-muted-foreground sm:inline sm:text-xs">分支</span>
                <select
                  className="h-8 max-w-[min(100%,16rem)] flex-1 rounded-md border border-input bg-background px-2 text-[11px] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-xs"
                  value={statsRev ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setStatsRev(v === '' ? null : v)
                  }}
                  aria-label="选择分支历史"
                >
                  <option value="">当前检出（HEAD）</option>
                  {branchNamesSorted.map((name) => (
                    <option key={name} value={`refs/heads/${name}`}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {reportTab === 'timeline' && (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground sm:text-xs">粒度</span>
                <div className="inline-flex h-8 rounded-md border border-input bg-background p-0.5 shadow-sm">
                  {(['day', 'week', 'month'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      className={cn(
                        'rounded px-2 py-0.5 text-[11px] font-medium transition-all sm:text-xs',
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
            className="-mx-0.5 flex gap-0.5 overflow-x-auto pb-px pt-px [scrollbar-width:thin]"
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
                  'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors sm:gap-1.5 sm:px-2.5 sm:text-xs',
                  reportTab === id
                    ? 'bg-primary/12 text-primary shadow-sm ring-1 ring-primary/25'
                    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                )}
                onClick={() => setReportTab(id)}
              >
                <Icon className="h-3 w-3 shrink-0 opacity-90 sm:h-3.5 sm:w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div
              className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive sm:text-sm"
              role="alert"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
        </CardHeader>

        <CardContent
          className={cn(
            'min-h-0 flex-1 px-3 sm:px-4',
            /* 日历：避免比视口略高 1～2px 时出现无意义纵向滚动条；其它报表仍允许纵向滚动 */
            reportTab === 'calendar'
              ? 'flex flex-col overflow-hidden py-2 sm:py-3'
              : 'overflow-auto py-3 sm:py-4'
          )}
        >
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
              onBucketClick={(row) => {
                if (row.commit_count <= 0) return
                void openActivityDrill(
                  timeGran,
                  row.key,
                  `${row.key} · ${row.commit_count} 次提交`
                )
              }}
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
              onDayClick={(dayKey, count) => {
                void openActivityDrill('day', dayKey, `${dayKey} · ${count} 次提交`)
              }}
            />
          )}

          {reportTab === 'calendar' && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <CalendarSection
                loading={loading}
                error={!!error}
                heatmapDays={heatmapDays}
                heatmapMap={heatmapMap}
                calendarMonth={calendarMonth}
                onCalendarMonthChange={setCalendarMonth}
                onDayDrill={(dayKey, count) => {
                  void openActivityDrill('day', dayKey, `${dayKey} · ${count} 次提交`)
                }}
              />
            </div>
          )}

          {reportTab === 'territory' && (
            <TerritorySection loading={loading} rows={territoryRows} diffProgress={diffProgress} />
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

      <Dialog open={drillOpen} onOpenChange={setDrillOpen}>
        <DialogContent className="max-h-[min(90vh,40rem)] max-w-lg gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border/60 px-5 py-4 text-left">
            <DialogTitle className="pr-7 text-base leading-snug">{drillTitle}</DialogTitle>
            <p className="mt-1 text-[11px] text-muted-foreground">
              与上方统计相同的历史范围与作者时区分桶；列表按时间由新到旧。
            </p>
          </DialogHeader>
          <div className="max-h-[min(60vh,26rem)] overflow-y-auto px-5 py-3">
            {drillLoading && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                正在加载提交…
              </div>
            )}
            {drillError && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {drillError}
              </p>
            )}
            {!drillLoading && !drillError && drillCommits.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">该分桶内无提交</p>
            )}
            {!drillLoading &&
              !drillError &&
              drillCommits.map((c) => (
                <div
                  key={c.id}
                  className="border-b border-border/50 py-2.5 last:border-0"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[11px] font-semibold text-primary">{c.short_id}</span>
                    <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
                      {c.message || '（无说明）'}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                    <span>{c.author}</span>
                    <span className="tabular-nums">{c.date}</span>
                  </div>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>
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
  onBucketClick,
}: {
  loading: boolean
  error: boolean
  rows: TimeBucketStat[]
  activityMax: number
  timeGran: TimeGranularity
  onBucketClick?: (row: TimeBucketStat) => void
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ active: false, startX: 0, startScroll: 0 })
  const [pointerDragging, setPointerDragging] = useState(false)

  const onBarScrollPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    /* 触摸设备保留系统横向滑动，仅用指针（鼠标/触控板）拖动滚动 */
    if (e.pointerType === 'touch') return
    if (e.button !== 0) return
    /* 点击柱形查看提交时，不要误触发起横向拖动 */
    if ((e.target as HTMLElement).closest('[data-timeline-bucket]')) return
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
            · 点击柱形查看该时段提交；空白处可拖动横移
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
                data-timeline-bucket
                role={onBucketClick && row.commit_count > 0 ? 'button' : undefined}
                tabIndex={onBucketClick && row.commit_count > 0 ? 0 : undefined}
                className={cn(
                  'flex shrink-0 flex-col items-center gap-1.5 sm:gap-2',
                  timeGran === 'day' ? 'min-w-[1.85rem] max-w-[2.75rem]' : 'min-w-[3rem] max-w-[5rem]',
                  onBucketClick && row.commit_count > 0 && 'cursor-pointer rounded-md outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring'
                )}
                title={`${row.key}: ${row.commit_count} 次提交`}
                onClick={() => onBucketClick?.(row)}
                onKeyDown={(e) => {
                  if (!onBucketClick || row.commit_count <= 0) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onBucketClick(row)
                  }
                }}
              >
                <span className="text-[10px] font-semibold tabular-nums text-foreground sm:text-xs">
                  {row.commit_count}
                </span>
                <div className="flex h-[148px] w-full flex-col justify-end">
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-primary/55 via-primary/75 to-primary shadow-sm ring-1 ring-primary/15 transition-[height]"
                    style={{ height: `${h}px` }}
                  />
                </div>
                <span
                  className={cn(
                    'line-clamp-3 w-full text-center leading-tight text-muted-foreground',
                    timeGran === 'day' ? 'text-[8px] sm:text-[9px]' : 'text-[10px]'
                  )}
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
  onDayClick,
}: {
  loading: boolean
  error: boolean
  heatmapDays: TimeBucketStat[]
  heatmapCells: { key: string; count: number; w: number; r: number }[]
  heatmapMax: number
  weekColumns: number
  heatScale: (count: number) => string
  onDayClick?: (dayKey: string, count: number) => void
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
            <span className="text-[11px] text-muted-foreground">
              周一 ← 列表示周，行表示星期 · 有提交时点击色块查看当日提交
            </span>
          </div>

          <div className="flex min-w-0 gap-2 sm:gap-3">
            <div
              className="grid shrink-0 gap-[3px] text-[10px] text-muted-foreground sm:gap-1 sm:text-[11px]"
              style={{ gridTemplateRows: 'repeat(7, 12px)' }}
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
                  // 列宽与行高一致，避免 minmax(11px,13px) 与 11px 行高形成横向拉长的矩形
                  gridTemplateColumns: `repeat(${weekColumns}, 12px)`,
                  gridTemplateRows: 'repeat(7, 12px)',
                }}
              >
                {heatmapCells.map((c) => {
                  const title = `${c.key} · ${c.count} 次提交`
                  const interactive = c.count > 0 && onDayClick
                  const cellClass = cn(
                    'rounded-sm ring-1 ring-black/5 dark:ring-white/10',
                    heatScale(c.count),
                    interactive &&
                      'cursor-pointer transition hover:ring-2 hover:ring-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )
                  return interactive ? (
                    <button
                      key={c.key}
                      type="button"
                      title={title}
                      aria-label={title}
                      className={cellClass}
                      style={{
                        gridColumnStart: c.w + 1,
                        gridRowStart: c.r + 1,
                      }}
                      onClick={() => onDayClick(c.key, c.count)}
                    />
                  ) : (
                    <div
                      key={c.key}
                      title={title}
                      className={cellClass}
                      style={{
                        gridColumnStart: c.w + 1,
                        gridRowStart: c.r + 1,
                      }}
                    />
                  )
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-border/50 pt-3 text-[10px] text-muted-foreground sm:text-xs">
            <span>较少</span>
            <div className="flex gap-1">
              {[0, 4, 8, 12, 16].map((c) => (
                <div
                  key={c}
                  className={cn(
                    'h-3.5 w-3.5 rounded-sm sm:h-4 sm:w-4',
                    heatmapMax > 0 ? heatScale(c) : 'bg-muted/70'
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

function CalendarSection({
  loading,
  error,
  heatmapDays,
  heatmapMap,
  calendarMonth,
  onCalendarMonthChange,
  onDayDrill,
}: {
  loading: boolean
  error: boolean
  heatmapDays: TimeBucketStat[]
  heatmapMap: Map<string, number>
  calendarMonth: Date
  onCalendarMonthChange: (d: Date) => void
  /** 选中某日且该日有提交时，打开提交列表（与热力图联动逻辑一致） */
  onDayDrill?: (dayKey: string, count: number) => void
}) {
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null)

  useEffect(() => {
    setSelectedDateKey(null)
  }, [calendarMonth])

  const gridDays = useMemo(() => {
    const mStart = startOfMonth(calendarMonth)
    const mEnd = endOfMonth(calendarMonth)
    const gridStart = startOfWeek(mStart, { weekStartsOn: 1 })
    const gridEnd = endOfWeek(mEnd, { weekStartsOn: 1 })
    const out: Date[] = []
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
      out.push(d)
    }
    return out
  }, [calendarMonth])

  const monthStats = useMemo(() => {
    let total = 0
    let active = 0
    let peak = 0
    const mStart = startOfMonth(calendarMonth)
    const mEnd = endOfMonth(calendarMonth)
    for (let d = mStart; d <= mEnd; d = addDays(d, 1)) {
      const key = format(d, 'yyyy-MM-dd')
      const c = heatmapMap.get(key) ?? 0
      total += c
      if (c > 0) active++
      if (c > peak) peak = c
    }
    return { total, active, peak }
  }, [calendarMonth, heatmapMap])

  if (loading && heatmapDays.length === 0) {
    return (
      <div
        className="flex min-h-[12rem] items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-500 dark:border-white/[0.06] dark:bg-[#151821] dark:text-[#8b93a7]"
        aria-busy
      >
        <Loader2 className="h-5 w-5 shrink-0 animate-spin opacity-80" aria-hidden />
        正在统计每日提交…
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-xl dark:bg-[#0f1115] dark:p-1">
      {!loading && heatmapDays.length === 0 && !error && (
        <p className="shrink-0 text-center text-[11px] text-zinc-500 dark:text-[#8b93a7] sm:text-xs">
          当前范围内无提交记录；日历仍展示各日，无提交不显示次数。
        </p>
      )}

      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border p-4 sm:p-5',
          'border-zinc-200/90 bg-white dark:border-white/[0.06] dark:bg-[#151821]'
        )}
        role="region"
        aria-label="提交日历"
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-[15px] font-semibold leading-snug tracking-tight text-zinc-900 dark:text-white">
              提交日历
            </h2>
            <p className="text-[13px] text-zinc-500 dark:text-[#8b93a7]">{format(calendarMonth, 'yyyy年M月')}</p>
            {!loading && (
              <p className="pt-1 text-[12px] leading-relaxed text-zinc-600 dark:text-[#8b93a7]">
                <span className="font-medium tabular-nums text-zinc-900 dark:text-white">{monthStats.total}</span>
                次提交 · 活跃
                <span className="mx-0.5 font-medium tabular-nums text-zinc-900 dark:text-white">{monthStats.active}</span>
                天 · 峰值
                <span className="ml-0.5 font-medium tabular-nums text-zinc-900 dark:text-white">{monthStats.peak}</span>
                次
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-zinc-200/80 bg-zinc-50/90 p-0.5 dark:border-white/[0.06] dark:bg-[#1b1f2a]">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-zinc-500 hover:bg-zinc-200/80 dark:text-[#8b93a7] dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
              aria-label="上一月"
              onClick={() => onCalendarMonthChange(startOfMonth(addMonths(calendarMonth, -1)))}
            >
              <ChevronLeft className="h-3.5 w-3.5 opacity-90" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-zinc-500 hover:bg-zinc-200/80 dark:text-[#8b93a7] dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
              onClick={() => onCalendarMonthChange(startOfMonth(new Date()))}
            >
              本月
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-zinc-500 hover:bg-zinc-200/80 dark:text-[#8b93a7] dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
              aria-label="下一月"
              onClick={() => onCalendarMonthChange(startOfMonth(addMonths(calendarMonth, 1)))}
            >
              <ChevronRight className="h-3.5 w-3.5 opacity-90" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-7 gap-2 sm:gap-2.5">
          {CALENDAR_WEEKDAY_HEADERS.map((wd) => (
            <div
              key={wd}
              className="select-none pb-0.5 text-center text-[10px] font-medium tracking-wide text-zinc-400 dark:text-[#8b93a7] sm:text-[11px]"
            >
              {wd}
            </div>
          ))}
        </div>

        <div
          className="grid grid-cols-7 gap-2 sm:gap-2.5 [grid-auto-rows:2.1rem] sm:[grid-auto-rows:2.35rem]"
          role="grid"
          aria-label={`${format(calendarMonth, 'yyyy年M月')} 提交日历`}
        >
          {gridDays.map((day) => {
            const key = format(day, 'yyyy-MM-dd')
            const count = heatmapMap.get(key) ?? 0
            const inMonth = isSameMonth(day, calendarMonth)
            const today = isToday(day)
            const heatLevel = commitCountHeatLevel(count)
            const isSelected = selectedDateKey === key && inMonth
            const cellClass = calendarDayCellClass(count, {
              inMonth,
              isToday: today,
              isSelected,
            })
            const title =
              count > 0 ? `${key} · ${count} 次提交` : `${key} · 无提交`

            const inner = (
              <>
                <span
                  className={cn(
                    'text-[13px] tabular-nums leading-none',
                    !inMonth && 'font-medium text-zinc-400 dark:text-zinc-600',
                    inMonth &&
                      count > 0 &&
                      heatLevel < 15 &&
                      'font-semibold text-zinc-900 dark:text-white',
                    inMonth && count > 0 && heatLevel >= 15 && 'font-semibold text-white',
                    inMonth &&
                      count <= 0 &&
                      'font-medium text-zinc-400 dark:text-zinc-500'
                  )}
                >
                  {format(day, 'd')}
                </span>
                {count > 0 && (
                  <span className="mt-1 flex flex-col items-center gap-0.5">
                    <span
                      className={cn(
                        'h-1 w-1 rounded-full',
                        heatLevel >= 15
                          ? 'bg-white shadow-[0_0_6px_rgba(255,255,255,0.55)]'
                          : 'bg-emerald-700 shadow-[0_0_6px_rgba(16,185,129,0.45)] dark:bg-emerald-200'
                      )}
                      aria-hidden
                    />
                    <span
                      className={cn(
                        'text-[9px] font-semibold tabular-nums leading-none',
                        heatLevel >= 15
                          ? 'text-emerald-50'
                          : 'text-emerald-900 dark:text-emerald-100'
                      )}
                    >
                      {count}
                    </span>
                  </span>
                )}
              </>
            )

            if (!inMonth) {
              return (
                <div key={key} role="gridcell" className={cellClass} title={title}>
                  {inner}
                </div>
              )
            }

            return (
              <button
                key={key}
                type="button"
                role="gridcell"
                title={title}
                aria-label={title}
                aria-current={today ? 'date' : undefined}
                aria-pressed={isSelected}
                onClick={() => {
                  const next = selectedDateKey === key ? null : key
                  setSelectedDateKey(next)
                  if (count > 0 && next !== null && onDayDrill) {
                    onDayDrill(key, count)
                  }
                }}
                className={cn(
                  cellClass,
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:focus-visible:ring-emerald-400/45'
                )}
              >
                {inner}
              </button>
            )
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-200 pt-3 dark:border-white/[0.06]">
          <span className="text-[10px] font-medium text-zinc-500 dark:text-[#8b93a7]">活跃度</span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] text-zinc-400 dark:text-zinc-600">低</span>
            <span
              className="h-2 w-2 rounded-[3px] border border-dashed border-zinc-400/75 bg-zinc-100 ring-1 ring-inset ring-zinc-200/95 dark:border-zinc-500/55 dark:bg-[#0c0e14] dark:ring-white/[0.07]"
              title="0 次"
            />
            <span
              className="h-2 w-2 rounded-[3px] border border-emerald-500/50 bg-emerald-500/40 dark:border-emerald-400/42 dark:bg-emerald-400/35"
              title="1 次"
            />
            <span
              className="h-2 w-2 rounded-[3px] border border-emerald-500/60 bg-emerald-500/62 dark:border-emerald-400/52 dark:bg-emerald-400/52"
              title="2–3 次"
            />
            <span
              className="h-2 w-2 rounded-[3px] border border-emerald-600/85 bg-emerald-600 dark:border-emerald-400/75 dark:bg-emerald-500"
              title="4 次及以上"
            />
            <span className="text-[9px] text-zinc-400 dark:text-zinc-600">高</span>
          </div>
          <span className="text-[9px] text-zinc-400 dark:text-zinc-600">按次数分档，非相对排名</span>
        </div>
      </div>
    </div>
  )
}

type TerritorySortKey = 'primary' | 'share' | 'total'

function TerritorySection({
  loading,
  rows,
  diffProgress,
}: {
  loading: boolean
  rows: FileTerritoryStat[]
  diffProgress: { current: number; total: number } | null
}) {
  const [sortKey, setSortKey] = useState<TerritorySortKey>('share')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const pct =
    diffProgress != null && diffProgress.total > 0
      ? Math.min(100, Math.round((diffProgress.current / diffProgress.total) * 100))
      : null

  const sortedRows = useMemo(() => {
    const list = [...rows]
    list.sort((a, b) => {
      let va = 0
      let vb = 0
      if (sortKey === 'share') {
        va = a.primary_share
        vb = b.primary_share
      } else if (sortKey === 'primary') {
        va = a.primary_commits
        vb = b.primary_commits
      } else {
        va = a.total_commits
        vb = b.total_commits
      }
      const cmp = va - vb
      if (cmp !== 0) {
        return sortDir === 'desc' ? -cmp : cmp
      }
      return a.path.localeCompare(b.path)
    })
    return list
  }, [rows, sortKey, sortDir])

  const toggleSort = useCallback((key: TerritorySortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }, [sortKey])

  if (loading && rows.length === 0) {
    return (
      <div className="flex min-h-[14rem] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/15 px-6 py-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary/70" aria-hidden />
        <p className="max-w-sm text-sm text-muted-foreground">
          正在按文件聚合作者提交次数，大型仓库可能需要数十秒…
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

  if (!loading && rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">该范围内暂无文件数据</p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        每个具体文件路径一行：统计在首父 diff 中该路径出现的提交次数；主要维护者取次数最多的作者（并列时按姓名排序）。
        「总提交」指历史上改过该文件的提交条数（各作者次数之和）。仅展示总提交数最高的前 {TERRITORY_FILE_LIMIT} 个文件。默认按占比降序排列；点击「TA 提交」「占比」「总提交」表头可切换排序。
      </p>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full min-w-[28rem] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-border/60 bg-muted/20 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5">文件路径</th>
              <th className="px-3 py-2.5">主要维护者</th>
              <th className="px-3 py-2.5 text-right tabular-nums" aria-sort={sortKey === 'primary' ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}>
                <button
                  type="button"
                  aria-label="按 TA 提交排序"
                  className="inline-flex w-full items-center justify-end gap-0.5 rounded px-0.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                  onClick={() => toggleSort('primary')}
                >
                  TA 提交
                  {sortKey === 'primary' ? (
                    sortDir === 'desc' ? (
                      <ChevronDown className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                    ) : (
                      <ChevronUp className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 shrink-0 opacity-45" aria-hidden />
                  )}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right tabular-nums" aria-sort={sortKey === 'share' ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}>
                <button
                  type="button"
                  aria-label="按占比排序"
                  className="inline-flex w-full items-center justify-end gap-0.5 rounded px-0.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                  onClick={() => toggleSort('share')}
                >
                  占比
                  {sortKey === 'share' ? (
                    sortDir === 'desc' ? (
                      <ChevronDown className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                    ) : (
                      <ChevronUp className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 shrink-0 opacity-45" aria-hidden />
                  )}
                </button>
              </th>
              <th className="px-3 py-2.5 text-right tabular-nums" aria-sort={sortKey === 'total' ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}>
                <button
                  type="button"
                  aria-label="按总提交排序"
                  className="inline-flex w-full items-center justify-end gap-0.5 rounded px-0.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                  onClick={() => toggleSort('total')}
                >
                  总提交
                  {sortKey === 'total' ? (
                    sortDir === 'desc' ? (
                      <ChevronDown className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                    ) : (
                      <ChevronUp className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 shrink-0 opacity-45" aria-hidden />
                  )}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr
                key={r.path}
                className="border-b border-border/40 last:border-0 hover:bg-muted/30"
              >
                <td className="max-w-[min(100%,28rem)] truncate px-3 py-2 font-mono text-[12px] text-foreground" title={r.path}>
                  {r.path}
                </td>
                <td className="px-3 py-2">
                  <span className="font-medium text-foreground">{r.primary_author}</span>
                  {r.primary_email.trim() ? (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{r.primary_email}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-foreground">{r.primary_commits}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {(r.primary_share * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.total_commits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
