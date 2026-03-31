import { useMemo } from 'react'
import { computeCommitGraph, hashBranchNameToPaletteIndex } from '../utils/commitGraphLayout'
import type { CommitInfo } from '../types/git'
import { cn } from '../lib/utils'

const LANE_W = 12
export const ROW_H = 56

/** 与 SourceTree 类似：不同分支/车道不同颜色（类名须为字面量） */
const GRAPH_PALETTE = [
  { stroke: 'stroke-sky-500 dark:stroke-sky-400', fill: 'fill-sky-500 dark:fill-sky-400' },
  { stroke: 'stroke-fuchsia-500 dark:stroke-fuchsia-400', fill: 'fill-fuchsia-500 dark:fill-fuchsia-400' },
  { stroke: 'stroke-amber-500 dark:stroke-amber-400', fill: 'fill-amber-500 dark:fill-amber-400' },
  { stroke: 'stroke-emerald-500 dark:stroke-emerald-400', fill: 'fill-emerald-500 dark:fill-emerald-400' },
  { stroke: 'stroke-rose-500 dark:stroke-rose-400', fill: 'fill-rose-500 dark:fill-rose-400' },
  { stroke: 'stroke-violet-500 dark:stroke-violet-400', fill: 'fill-violet-500 dark:fill-violet-400' },
  { stroke: 'stroke-cyan-500 dark:stroke-cyan-400', fill: 'fill-cyan-500 dark:fill-cyan-400' },
  { stroke: 'stroke-orange-500 dark:stroke-orange-400', fill: 'fill-orange-500 dark:fill-orange-400' },
  { stroke: 'stroke-lime-500 dark:stroke-lime-400', fill: 'fill-lime-500 dark:fill-lime-400' },
  { stroke: 'stroke-indigo-500 dark:stroke-indigo-400', fill: 'fill-indigo-500 dark:fill-indigo-400' },
] as const

const PALETTE_LEN = GRAPH_PALETTE.length

type Props = {
  commits: CommitInfo[]
  /** 提交 id → 用于选色的分支名（优先展示本地名）；有数据则按分支名稳定映射颜色 */
  branchColorKeyByCommitId?: Map<string, string>
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
export function CommitGraphStrip({ commits, branchColorKeyByCommitId, className }: Props) {
  const model = useMemo(() => computeCommitGraph(commits), [commits])
  const { maxLane, edges, lanes } = model
  const width = Math.max(1, maxLane + 1) * LANE_W + 8
  const h = commits.length * ROW_H

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
          const y1 = (e.fromRow + 0.5) * ROW_H
          const y2 = (e.toRow + 0.5) * ROW_H
          const mid = (y1 + y2) / 2
          const d = `M ${x1} ${y1} L ${x1} ${mid} L ${x2} ${mid} L ${x2} ${y2}`
          return (
            <path
              key={idx}
              d={d}
              fill="none"
              className={pal.stroke}
              strokeWidth={1.35}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
        {commits.map((c, i) => {
          const lane = lanes[i] ?? 0
          const pi = pickPaletteIndex(c, lane, branchColorKeyByCommitId)
          const pal = paletteAt(pi)
          const cx = (lane + 0.5) * LANE_W + 4
          const cy = (i + 0.5) * ROW_H
          return (
            <circle
              key={c.id}
              cx={cx}
              cy={cy}
              r={3.75}
              className={cn(pal.fill, pal.stroke, 'stroke-[1.5]')}
            />
          )
        })}
      </svg>
    </div>
  )
}

export const COMMIT_GRAPH_ROW_HEIGHT = ROW_H
