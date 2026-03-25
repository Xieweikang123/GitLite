/**
 * 根据「新→旧」排序的提交列表与 parent_ids 计算分支图车道与边（仅连接列表内可见的提交）。
 */

export type GraphEdge = {
  fromRow: number
  toRow: number
  fromLane: number
  toLane: number
}

export type CommitGraphModel = {
  lanes: number[]
  maxLane: number
  edges: GraphEdge[]
}

const hasParents = (c: { parent_ids?: string[] }): c is { parent_ids: string[] } =>
  Array.isArray(c.parent_ids)

export function computeCommitGraph(
  commits: { id: string; parent_ids?: string[] }[]
): CommitGraphModel {
  const n = commits.length
  if (n === 0) {
    return { lanes: [], maxLane: 0, edges: [] }
  }

  const idToRow = new Map(commits.map((c, i) => [c.id, i]))
  const lanes = new Array(n).fill(0)

  // 从最旧到最新分配车道（新提交继承首父车道）
  for (let i = n - 1; i >= 0; i--) {
    const c = commits[i]
    const pids = hasParents(c) ? c.parent_ids : []
    const orderedParentRows = pids
      .map((pid) => idToRow.get(pid))
      .filter((r): r is number => r !== undefined && r > i)

    if (orderedParentRows.length === 0) {
      lanes[i] = i === n - 1 ? 0 : lanes[i + 1] ?? 0
      continue
    }
    const p0 = orderedParentRows[0]
    lanes[i] = lanes[p0]
  }

  const edges: GraphEdge[] = []
  for (let i = 0; i < n; i++) {
    const c = commits[i]
    const pids = hasParents(c) ? c.parent_ids : []
    const orderedParentRows = pids
      .map((pid) => idToRow.get(pid))
      .filter((r): r is number => r !== undefined && r > i)

    for (const pr of orderedParentRows) {
      edges.push({
        fromRow: i,
        toRow: pr,
        fromLane: lanes[i],
        toLane: lanes[pr],
      })
    }
  }

  const maxLane = lanes.length ? Math.max(...lanes) : 0
  return { lanes, maxLane, edges }
}
