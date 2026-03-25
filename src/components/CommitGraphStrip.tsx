import { useMemo } from 'react'
import { computeCommitGraph } from '../utils/commitGraphLayout'
import type { CommitInfo } from '../types/git'
import { cn } from '../lib/utils'

const LANE_W = 12
const ROW_H = 56

type Props = {
  commits: CommitInfo[]
  className?: string
}

/** 提交列表左侧的 DAG 连线（与每行固定高度对齐） */
export function CommitGraphStrip({ commits, className }: Props) {
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
      <svg
        width={width}
        height={h}
        className="pointer-events-none text-muted-foreground/80 dark:text-muted-foreground/70"
      >
        {edges.map((e, idx) => {
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
              stroke="currentColor"
              strokeWidth={1.25}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
        {commits.map((c, i) => {
          const lane = lanes[i] ?? 0
          const cx = (lane + 0.5) * LANE_W + 4
          const cy = (i + 0.5) * ROW_H
          return (
            <circle
              key={c.id}
              cx={cx}
              cy={cy}
              r={3.5}
              className="fill-background stroke-primary stroke-[1.5]"
            />
          )
        })}
      </svg>
    </div>
  )
}

export const COMMIT_GRAPH_ROW_HEIGHT = ROW_H
