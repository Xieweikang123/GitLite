import { useMemo } from 'react'
import { computeCommitGraph, hashBranchNameToPaletteIndex, type GraphEdge } from '../utils/commitGraphLayout'
import type { CommitInfo } from '../types/git'
import { cn } from '../lib/utils'

/** 略宽车道，便于 2px+ 竖轨与节点不挤 */
const LANE_W = 12
export const ROW_H = 46

/** 竖轨 / 水平接驳描边宽度（类 SourceTree 的「轨道感」） */
const RAIL_STROKE_PX = 2.35

type VerticalRailSpan = { lane: number; y0: number; y1: number; pi: number }
type HorizontalRailSpan = { y: number; x0: number; x1: number; pi: number }

function laneCenterX(lane: number): number {
  return (lane + 0.5) * LANE_W + 4
}

function mergeYIntervals(intervals: { y0: number; y1: number }[]): { y0: number; y1: number }[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.y0 - b.y0)
  const out: { y0: number; y1: number }[] = []
  let cur = { ...sorted[0]! }
  for (let k = 1; k < sorted.length; k++) {
    const s = sorted[k]!
    if (s.y0 <= cur.y1 + 0.75) {
      cur.y1 = Math.max(cur.y1, s.y1)
    } else {
      out.push(cur)
      cur = { ...s }
    }
  }
  out.push(cur)
  return out
}

function resolveRowHeights(n: number, rowHeights: number[] | undefined): number[] {
  return Array.from({ length: n }, (_, i) => {
    const h = rowHeights?.[i]
    return typeof h === 'number' && h > 0 ? h : ROW_H
  })
}

function cumulativeCenterY(heights: number[], row: number): number {
  let top = 0
  for (let j = 0; j < row; j++) top += heights[j] ?? ROW_H
  return top + (heights[row] ?? ROW_H) / 2
}

function totalSvgHeight(heights: number[]): number {
  if (heights.length === 0) return 0
  return heights.reduce((a, b) => a + b, 0)
}

/** 柔和低饱和配色，接近 IDE 时间线观感（类名须为字面量） */
const GRAPH_PALETTE = [
  { stroke: 'stroke-sky-600/40 dark:stroke-sky-400/35', fill: 'fill-sky-500/50 dark:fill-sky-400/45' },
  { stroke: 'stroke-fuchsia-600/35 dark:stroke-fuchsia-400/30', fill: 'fill-fuchsia-500/45 dark:fill-fuchsia-400/40' },
  { stroke: 'stroke-amber-600/40 dark:stroke-amber-400/35', fill: 'fill-amber-500/50 dark:fill-amber-400/45' },
  { stroke: 'stroke-emerald-600/40 dark:stroke-emerald-400/35', fill: 'fill-emerald-500/50 dark:fill-emerald-400/45' },
  { stroke: 'stroke-rose-600/35 dark:stroke-rose-400/30', fill: 'fill-rose-500/45 dark:fill-rose-400/40' },
  { stroke: 'stroke-violet-600/40 dark:stroke-violet-400/35', fill: 'fill-violet-500/50 dark:fill-violet-400/45' },
  { stroke: 'stroke-cyan-600/40 dark:stroke-cyan-400/35', fill: 'fill-cyan-500/50 dark:fill-cyan-400/45' },
  { stroke: 'stroke-orange-600/35 dark:stroke-orange-400/30', fill: 'fill-orange-500/45 dark:fill-orange-400/40' },
  { stroke: 'stroke-lime-600/35 dark:stroke-lime-400/30', fill: 'fill-lime-500/45 dark:fill-lime-400/40' },
  { stroke: 'stroke-indigo-600/40 dark:stroke-indigo-400/35', fill: 'fill-indigo-500/50 dark:fill-indigo-400/45' },
] as const

const PALETTE_LEN = GRAPH_PALETTE.length

type Props = {
  commits: CommitInfo[]
  /** 提交 id → 用于选色的分支名（优先展示本地名）；有数据则按分支名稳定映射颜色 */
  branchColorKeyByCommitId?: Map<string, string>
  /**
   * 若与 branchNamesByCommitId 同时有效：左侧按「每个分支名一列」画贯穿竖轨（该分支在列表内出现的最上行 → 最下行）。
   * 否则回退为基于 parent_ids 的 DAG 车道图。
   */
  branchRailColumns?: readonly string[]
  /** 提交 id → 该提交所在分支名列表（与 branchRailColumns 同源） */
  branchNamesByCommitId?: ReadonlyMap<string, readonly string[]>
  /** 与左侧列表每行实际高度一致（像素），用于竖线与节点与文字行对齐 */
  rowHeights?: number[]
  className?: string
}

function pickPaletteIndex(
  commit: CommitInfo,
  lane: number,
  branchColorKeyByCommitId: Map<string, string> | undefined
): number {
  const key = branchColorKeyByCommitId?.get(commit.id)
  if (key) {
    return hashBranchNameToPaletteIndex(key, PALETTE_LEN)
  }
  return lane % PALETTE_LEN
}

function paletteAt(i: number) {
  return GRAPH_PALETTE[i % PALETTE_LEN] ?? GRAPH_PALETTE[0]
}

/** 将边拆解为竖向区间（同车道同色合并），另返回跨车道水平接驳 */
function buildRailGeometry(
  edges: GraphEdge[],
  lanes: number[],
  heights: number[],
  commits: CommitInfo[],
  branchColorKeyByCommitId: Map<string, string> | undefined
): { verticals: VerticalRailSpan[]; horizontals: HorizontalRailSpan[] } {
  const verticalBuckets = new Map<string, { y0: number; y1: number }[]>()

  const bucketKey = (lane: number, pi: number) => `${lane}:${pi}`

  const pushVertical = (lane: number, ya: number, yb: number, pi: number) => {
    const y0 = Math.min(ya, yb)
    const y1 = Math.max(ya, yb)
    if (y1 - y0 < 0.25) return
    const k = bucketKey(lane, pi)
    const arr = verticalBuckets.get(k) ?? []
    arr.push({ y0, y1 })
    verticalBuckets.set(k, arr)
  }

  const horizontals: HorizontalRailSpan[] = []

  for (const e of edges) {
    const c = commits[e.fromRow]
    if (!c) continue
    const pi = pickPaletteIndex(c, lanes[e.fromRow] ?? 0, branchColorKeyByCommitId)
    const y1 = cumulativeCenterY(heights, e.fromRow)
    const y2 = cumulativeCenterY(heights, e.toRow)
    const mid = (y1 + y2) / 2
    const fl = e.fromLane
    const tl = e.toLane
    const x1 = laneCenterX(fl)
    const x2 = laneCenterX(tl)

    if (fl === tl) {
      pushVertical(fl, y1, y2, pi)
    } else {
      pushVertical(fl, y1, mid, pi)
      pushVertical(tl, mid, y2, pi)
      horizontals.push({
        y: mid,
        x0: Math.min(x1, x2),
        x1: Math.max(x1, x2),
        pi,
      })
    }
  }

  const verticals: VerticalRailSpan[] = []
  for (const [k, intervals] of verticalBuckets) {
    const [laneStr, piStr] = k.split(':')
    const lane = Number(laneStr)
    const pi = Number(piStr)
    if (Number.isNaN(lane) || Number.isNaN(pi)) continue
    for (const m of mergeYIntervals(intervals)) {
      verticals.push({ lane, y0: m.y0, y1: m.y1, pi })
    }
  }

  return { verticals, horizontals }
}

type BranchColumnVertical = { column: number; y0: number; y1: number; pi: number }

/** 每个分支名一列：竖线从「该分支在列表中首次出现行」连到「末次出现行」（中间无标签行仍穿过） */
function buildBranchColumnRails(
  branchRailColumns: readonly string[],
  commits: CommitInfo[],
  heights: number[],
  branchNamesByCommitId: ReadonlyMap<string, readonly string[]>
): BranchColumnVertical[] {
  const out: BranchColumnVertical[] = []
  for (let col = 0; col < branchRailColumns.length; col++) {
    const name = branchRailColumns[col]!
    let minRow = -1
    let maxRow = -1
    for (let i = 0; i < commits.length; i++) {
      const names = branchNamesByCommitId.get(commits[i]!.id)
      if (!names?.includes(name)) continue
      if (minRow < 0) minRow = i
      maxRow = i
    }
    if (minRow < 0 || maxRow < 0) continue
    const ya = cumulativeCenterY(heights, minRow)
    const yb = cumulativeCenterY(heights, maxRow)
    const y0 = Math.min(ya, yb)
    const y1 = Math.max(ya, yb)
    if (y1 - y0 < 0.5) continue
    const pi = hashBranchNameToPaletteIndex(name, PALETTE_LEN)
    out.push({ column: col, y0, y1, pi })
  }
  return out
}

function primaryBranchColumnIndex(
  commit: CommitInfo,
  branchRailColumns: readonly string[],
  branchColorKeyByCommitId: Map<string, string> | undefined,
  branchNamesByCommitId: ReadonlyMap<string, readonly string[]>
): number {
  const prefer = branchColorKeyByCommitId?.get(commit.id)
  if (prefer) {
    const i = branchRailColumns.indexOf(prefer)
    if (i >= 0) return i
  }
  const list = branchNamesByCommitId.get(commit.id)
  if (list?.length) {
    for (let j = 0; j < branchRailColumns.length; j++) {
      if (list.includes(branchRailColumns[j]!)) return j
    }
  }
  return 0
}

/** 提交列表左侧：分支模式为「每分支一竖轨」；否则为 DAG 竖轨 + 水平接驳 + 节点 */
export function CommitGraphStrip({
  commits,
  branchColorKeyByCommitId,
  branchRailColumns,
  branchNamesByCommitId,
  rowHeights,
  className,
}: Props) {
  const model = useMemo(() => computeCommitGraph(commits), [commits])
  const { maxLane, edges, lanes } = model

  const branchMode =
    Boolean(
      branchRailColumns &&
        branchRailColumns.length > 0 &&
        branchNamesByCommitId &&
        branchNamesByCommitId.size > 0
    )

  const columnCount = branchMode
    ? Math.max(1, branchRailColumns!.length)
    : Math.max(1, maxLane + 1)
  const width = columnCount * LANE_W + 8

  const heights = useMemo(
    () => resolveRowHeights(commits.length, rowHeights),
    [commits.length, rowHeights]
  )
  const h = totalSvgHeight(heights)

  const dagRails = useMemo(
    () => buildRailGeometry(edges, lanes, heights, commits, branchColorKeyByCommitId),
    [edges, lanes, heights, commits, branchColorKeyByCommitId]
  )

  const branchRails = useMemo(() => {
    if (!branchMode || !branchRailColumns || !branchNamesByCommitId) return []
    return buildBranchColumnRails(branchRailColumns, commits, heights, branchNamesByCommitId)
  }, [branchMode, branchRailColumns, branchNamesByCommitId, commits, heights])

  if (commits.length === 0) return null

  return (
    <div
      className={cn('relative shrink-0 select-none', className)}
      style={{ width }}
      aria-hidden
    >
      <svg width={width} height={h} className="pointer-events-none">
        <g className="commit-graph-rails">
          {branchMode
            ? branchRails.map((v, idx) => {
                const pal = paletteAt(v.pi)
                const cx = laneCenterX(v.column)
                return (
                  <line
                    key={`br-${v.column}-${v.pi}-${idx}`}
                    x1={cx}
                    y1={v.y0}
                    x2={cx}
                    y2={v.y1}
                    fill="none"
                    className={pal.stroke}
                    strokeWidth={RAIL_STROKE_PX}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )
              })
            : dagRails.verticals.map((v, idx) => {
                const pal = paletteAt(v.pi)
                const cx = laneCenterX(v.lane)
                return (
                  <line
                    key={`v-${v.lane}-${v.pi}-${idx}`}
                    x1={cx}
                    y1={v.y0}
                    x2={cx}
                    y2={v.y1}
                    fill="none"
                    className={pal.stroke}
                    strokeWidth={RAIL_STROKE_PX}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )
              })}
          {!branchMode &&
            dagRails.horizontals.map((hSeg, idx) => {
              const pal = paletteAt(hSeg.pi)
              return (
                <line
                  key={`h-${hSeg.y}-${hSeg.pi}-${idx}`}
                  x1={hSeg.x0}
                  y1={hSeg.y}
                  x2={hSeg.x1}
                  y2={hSeg.y}
                  fill="none"
                  className={pal.stroke}
                  strokeWidth={RAIL_STROKE_PX}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
        </g>
        {commits.map((c, i) => {
          const lane = branchMode
            ? primaryBranchColumnIndex(
                c,
                branchRailColumns!,
                branchColorKeyByCommitId,
                branchNamesByCommitId!
              )
            : lanes[i] ?? 0
          const pi = pickPaletteIndex(c, lane, branchColorKeyByCommitId)
          const pal = paletteAt(pi)
          const cx = laneCenterX(lane)
          const cy = cumulativeCenterY(heights, i)
          return (
            <circle
              key={c.id}
              cx={cx}
              cy={cy}
              r={3.45}
              className={cn(
                pal.fill,
                'stroke-background/85 dark:stroke-zinc-950/85',
                'stroke-[1.25px]'
              )}
            />
          )
        })}
      </svg>
    </div>
  )
}

export const COMMIT_GRAPH_ROW_HEIGHT = ROW_H
