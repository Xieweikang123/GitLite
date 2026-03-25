import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { ChevronDown, ChevronRight, File, Folder, Loader2, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import { formatTauriInvokeError } from '../utils/tauriError'

type TreeNode = {
  name: string
  fullPath: string
  children: TreeNode[]
  isFile: boolean
}

function insertPath(root: TreeNode, segments: string[]): void {
  if (segments.length === 0) return
  const [head, ...rest] = segments
  let child = root.children.find((c) => c.name === head)
  if (!child) {
    const fullPath = root.fullPath ? `${root.fullPath}/${head}` : head
    const isFile = rest.length === 0
    child = {
      name: head,
      fullPath,
      children: [],
      isFile,
    }
    root.children.push(child)
  }
  if (rest.length > 0) {
    insertPath(child, rest)
  }
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1
    return a.name.localeCompare(b.name)
  })
  for (const c of node.children) {
    if (!c.isFile) sortTree(c)
  }
}

function buildTreeFromPaths(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', fullPath: '', children: [], isFile: false }
  for (const p of paths) {
    const segments = p.split('/').filter(Boolean)
    if (segments.length === 0) continue
    insertPath(root, segments)
  }
  sortTree(root)
  return root
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
}) {
  const pad = depth * 12
  if (node.isFile) {
    return (
      <div
        key={node.fullPath}
        className="flex min-h-7 items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-muted/60"
        style={{ paddingLeft: pad + 4 }}
      >
        <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-foreground" title={node.fullPath}>
          {node.name}
        </span>
      </div>
    )
  }

  const isOpen = expanded.has(node.fullPath) || depth === 0

  return (
    <div key={node.fullPath || 'root'}>
      {depth > 0 && (
        <button
          type="button"
          className={cn(
            'flex min-h-7 w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/60'
          )}
          style={{ paddingLeft: pad + 4 }}
          onClick={() => onToggle(node.fullPath)}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <Folder className="h-3.5 w-3.5 shrink-0 text-amber-600/90 dark:text-amber-400/90" />
          <span className="truncate font-medium">{node.name || '仓库根'}</span>
        </button>
      )}
      {isOpen &&
        node.children.map((ch) => (
          <TreeRow
            key={ch.fullPath}
            node={ch}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </div>
  )
}

type Props = {
  repoPath: string
}

/** 展示当前 HEAD 提交树中的文件路径（目录可折叠） */
export function RepoFileTree({ repoPath }: Props) {
  const [paths, setPaths] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await invoke<string[]>('get_head_file_paths', {
        repoPath,
        maxEntries: 8000,
      })
      setPaths(list)
    } catch (e) {
      setError(formatTauriInvokeError(e, '加载文件树失败'))
      setPaths([])
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  useEffect(() => {
    void load()
  }, [load])

  const tree = useMemo(() => buildTreeFromPaths(paths), [paths])
  const pathsKey = useMemo(() => paths.join('\0'), [paths])

  const onToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  // 每次重新加载路径列表后，展开根下第一层目录（不递归整棵树）
  useEffect(() => {
    if (paths.length === 0) return
    setExpanded(() => {
      const next = new Set<string>([''])
      for (const c of tree.children) {
        if (!c.isFile) next.add(c.fullPath)
      }
      return next
    })
  }, [pathsKey, tree])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">文件树（HEAD）</p>
          <p className="truncate text-[11px] text-muted-foreground" title={repoPath}>
            {paths.length} 个文件
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1 px-2 text-xs"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          刷新
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2 scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent">
        {error && (
          <p className="px-2 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        {loading && paths.length === 0 && !error && (
          <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取…
          </div>
        )}
        {!loading && paths.length === 0 && !error && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">当前 HEAD 无文件或空仓库</p>
        )}
        {paths.length > 0 && (
          <TreeRow node={tree} depth={0} expanded={expanded} onToggle={onToggle} />
        )}
      </div>
    </div>
  )
}
