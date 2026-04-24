import { useMemo } from 'react'
import { computeCommitGraph, hashBranchNameToPaletteIndex, type GraphEdge } from '../utils/commitGraphLayout'
import type { CommitInfo } from '../types/git'
import { cn } from '../lib/utils'

/** 略宽车道，便于 2px+ 竖轨与节点不挤 */
const LANE_W = 12
export const ROW_H = 46

/** 竖轨 / 水平接驳描边宽度（类 SourceTree 的「轨道感」） */
const RAIL_STROKE_PX = 2.35
/** 分支「接出」折线略细，避免与竖轨抢视觉 */
const FORK_STROKE_PX = 1.85

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

/** 行矩形顶边 y（与列表行 div 上沿对齐，避免竖轨用行中心时被看成「错一行」） */
function cumulativeTopY(heights: number[], row: number): number {
  let top = 0
  for (let j = 0; j < row; j++) top += heights[j] ?? ROW_H
  return top
}

/** 行矩形底边 y（不含下一行） */
function cumulativeBottomY(heights: number[], row: number): number {
  return cumulativeTopY(heights, row) + (heights[row] ?? ROW_H)
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
  /** 当前由竖线筛选选中的分支名（高亮该竖轨） */
  selectedGraphBranchRail?: string | null
  /** 点击某条分支竖线时回调（由父级切换「仅看该分支」筛选） */
  onGraphBranchRailClick?: (branchName: string) => void
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

type BranchColumnVertical = {
  column: number
  branchName: string
  y0: number
  y1: number
  pi: number
}

/** 列内透明命中区宽度（便于点到细竖线） */
const RAIL_HIT_PAD_PX = 6

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
    // 竖轨贯穿整行高度：起点对齐首条提交行顶，终点对齐末条提交行底（圆点仍在行中心）
    const y0 = cumulativeTopY(heights, minRow)
    const y1 = cumulativeBottomY(heights, maxRow)
    if (y1 - y0 < 0.5) continue
    const pi = hashBranchNameToPaletteIndex(name, PALETTE_LEN)
    out.push({ column: col, branchName: name, y0, y1, pi })
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

type BranchForkPath = {
  key: string
  d: string
  pi: number
  branchName: string
}

/**
 * 方案 B：子提交带分支 B，且按 parent_ids 顺序第一个「在本列表内且标签不含 B」的父提交存在时，
 * 从父的主列画 L 形折线接到 B 列子提交中心，表示本页内可见的「接出」关系。
 */
function buildBranchForkPaths(
  commits: CommitInfo[],
  heights: number[],
  branchRailColumns: readonly string[],
  branchNamesByCommitId: ReadonlyMap<string, readonly string[]>,
  branchColorKeyByCommitId: Map<string, string> | undefined
): BranchForkPath[] {
  const n = commits.length
  const idToRow = new Map(commits.map((c, idx) => [c.id, idx]))
  const out: BranchForkPath[] = []
  let seq = 0

  for (let i = 0; i < n; i++) {
    const child = commits[i]!
    const childNames = branchNamesByCommitId.get(child.id)
    if (!childNames?.length) continue
    const pids = child.parent_ids
    if (!Array.isArray(pids) || pids.length === 0) continue

    const branchesOnChild = [...new Set(childNames)].filter((b) => branchRailColumns.includes(b))
    for (const b of branchesOnChild) {
      const colB = branchRailColumns.indexOf(b)
      if (colB < 0) continue

      let parentRow = -1
      for (const pid of pids) {
        const pr = idToRow.get(pid)
        if (pr === undefined) continue
        const parentNames = branchNamesByCommitId.get(pid)
        if (parentNames?.includes(b)) continue
        parentRow = pr
        break
      }
      if (parentRow < 0) continue

      const parent = commits[parentRow]!
      const xP = laneCenterX(
        primaryBranchColumnIndex(
          parent,
          branchRailColumns,
          branchColorKeyByCommitId,
          branchNamesByCommitId
        )
      )
      const yP = cumulativeCenterY(heights, parentRow)
      const xB = laneCenterX(colB)
      const yB = cumulativeCenterY(heights, i)

      if (Math.abs(xP - xB) < 0.75 && Math.abs(yP - yB) < 0.75) continue

      const midY = (yP + yB) / 2
      const d =
        Math.abs(xP - xB) < 0.5
          ? `M ${xP} ${yP} L ${xP} ${yB}`
          : `M ${xP} ${yP} L ${xP} ${midY} L ${xB} ${midY} L ${xB} ${yB}`

      const pi = hashBranchNameToPaletteIndex(b, PALETTE_LEN)
      out.push({
        key: `fork-${i}-${b}-${seq++}`,
        d,
        pi,
        branchName: b,
      })
    }
  }
  return out
}

/** 提交列表左侧：分支模式为「每分支一竖轨」；否则为 DAG 竖轨 + 水平接驳 + 节点 */
export function CommitGraphStrip({
  commits,
  branchColorKeyByCommitId,
  branchRailColumns,
  branchNamesByCommitId,
  rowHeights,
  selectedGraphBranchRail,
  onGraphBranchRailClick,
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

  const branchForkPaths = useMemo(() => {
    if (!branchMode || !branchRailColumns || !branchNamesByCommitId) return []
    return buildBranchForkPaths(
      commits,
      heights,
      branchRailColumns,
      branchNamesByCommitId,
      branchColorKeyByCommitId
    )
  }, [branchMode, branchRailColumns, branchNamesByCommitId, commits, heights, branchColorKeyByCommitId])

  const railClickable = Boolean(branchMode && onGraphBranchRailClick)
  /** 正在按分支筛选：弱化其它竖轨，突出当前分支列 */
  const branchRailFilterActive = Boolean(branchMode && selectedGraphBranchRail)

  if (commits.length === 0) return null

  return (
    <div
      className={cn('relative shrink-0 select-none', className)}
      style={{ width }}
      aria-hidden={!railClickable}
    >
      <svg
        width={width}
        height={h}
        className={cn(!railClickable && 'pointer-events-none')}
      >
        <g className={cn('commit-graph-rails', railClickable && 'pointer-events-none')}>
          {branchMode &&
            branchForkPaths.map((fp) => {
              const pal = paletteAt(fp.pi)
              const selected = selectedGraphBranchRail === fp.branchName
              return (
                <path
                  key={fp.key}
                  d={fp.d}
                  fill="none"
                  className={cn(
                    pal.stroke,
                    branchRailFilterActive &&
                      (selected ? 'opacity-100' : 'opacity-[0.32] dark:opacity-[0.38]')
                  )}
                  strokeWidth={FORK_STROKE_PX}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          {branchMode
            ? branchRails.map((v, idx) => {
                const pal = paletteAt(v.pi)
                const cx = laneCenterX(v.column)
                const selected = selectedGraphBranchRail === v.branchName
                const sw =
                  branchRailFilterActive && selected
                    ? RAIL_STROKE_PX + 1.75
                    : RAIL_STROKE_PX
                return (
                  <line
                    key={`br-${v.column}-${v.pi}-${idx}`}
                    x1={cx}
                    y1={v.y0}
                    x2={cx}
                    y2={v.y1}
                    fill="none"
                    className={cn(
                      pal.stroke,
                      branchRailFilterActive &&
                        (selected
                          ? 'opacity-100'
                          : 'opacity-[0.28] dark:opacity-[0.34]')
                    )}
                    strokeWidth={sw}
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
        <g className={cn(railClickable && 'pointer-events-none')}>
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
        </g>
        {railClickable &&
          branchRails.map((v, idx) => {
            const cx = laneCenterX(v.column)
            const w = RAIL_HIT_PAD_PX * 2 + RAIL_STROKE_PX
            return (
              <rect
                key={`br-hit-${v.branchName}-${idx}`}
                x={cx - w / 2}
                y={v.y0}
                width={w}
                height={Math.max(v.y1 - v.y0, 8)}
                fill="transparent"
                className="cursor-pointer hover:fill-foreground/[0.06] dark:hover:fill-foreground/[0.08]"
                onClick={(e) => {
                  e.stopPropagation()
                  onGraphBranchRailClick?.(v.branchName)
                }}
              >
                <title>{`仅看「${v.branchName}」提交（再点一次清除）`}</title>
              </rect>
            )
          })}
      </svg>
    </div>
  )
}

export const COMMIT_GRAPH_ROW_HEIGHT = ROW_H
