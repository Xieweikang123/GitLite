import { useMemo } from 'react'
import { computeCommitGraph, hashBranchNameToPaletteIndex } from '../utils/commitGraphLayout'
import type { CommitInfo } from '../types/git'
import { cn } from '../lib/utils'

const LANE_W = 11
export const ROW_H = 46

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

/** 提交列表左侧 DAG：连线与节点按分支名（或车道）映射多色 */
export function CommitGraphStrip({ commits, branchColorKeyByCommitId, rowHeights, className }: Props) {
  const model = useMemo(() => computeCommitGraph(commits), [commits])
  const { maxLane, edges, lanes } = model
  const width = Math.max(1, maxLane + 1) * LANE_W + 8
  const heights = useMemo(
    () => resolveRowHeights(commits.length, rowHeights),
    [commits.length, rowHeights]
  )
  const h = totalSvgHeight(heights)

  if (commits.length === 0) return null

  return (
    <div
      className={cn('relative shrink-0 select-none', className)}
      style={{ width }}
      aria-hidden
    >
      <svg width={width} height={h} className="pointer-events-none">
        {edges.map((e, idx) => {
          const c = commits[e.fromRow]
          if (!c) return null
          const pi = pickPaletteIndex(c, lanes[e.fromRow] ?? 0, branchColorKeyByCommitId)
          const pal = paletteAt(pi)
          const x1 = (e.fromLane + 0.5) * LANE_W + 4
          const x2 = (e.toLane + 0.5) * LANE_W + 4
          const y1 = cumulativeCenterY(heights, e.fromRow)
          const y2 = cumulativeCenterY(heights, e.toRow)
          const mid = (y1 + y2) / 2
          const d = `M ${x1} ${y1} L ${x1} ${mid} L ${x2} ${mid} L ${x2} ${y2}`
          return (
            <path
              key={idx}
              d={d}
              fill="none"
              className={pal.stroke}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
        {commits.map((c, i) => {
          const lane = lanes[i] ?? 0
          const pi = pickPaletteIndex(c, lane, branchColorKeyByCommitId)
          const pal = paletteAt(pi)
          const cx = (lane + 0.5) * LANE_W + 4
          const cy = cumulativeCenterY(heights, i)
          return (
            <circle
              key={c.id}
              cx={cx}
              cy={cy}
              r={3.1}
              className={cn(
                pal.fill,
                'stroke-background/80 dark:stroke-zinc-950/80',
                'stroke-[1px]'
              )}
            />
          )
        })}
      </svg>
    </div>
  )
}

export const COMMIT_GRAPH_ROW_HEIGHT = ROW_H
