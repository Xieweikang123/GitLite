import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { ChevronDown, ChevronRight, File, Folder, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import { formatTauriInvokeError } from '../utils/tauriError'
import { MonacoReadonly } from './MonacoReadonly'
import { getMonacoLanguageFromPath } from '../utils/monacoLanguage'

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
  selectedFilePath,
  onFileClick,
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  selectedFilePath: string | null
  onFileClick: (path: string) => void
}) {
  const pad = depth * 12
  if (node.isFile) {
    const selected = selectedFilePath === node.fullPath
    return (
      <button
        type="button"
        key={node.fullPath}
        className={cn(
          'flex min-h-7 w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/60',
          selected && 'bg-muted/80 ring-1 ring-border/80'
        )}
        style={{ paddingLeft: pad + 4 }}
        onClick={() => onFileClick(node.fullPath)}
        title={node.fullPath}
      >
        <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-foreground">{node.name}</span>
      </button>
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
            selectedFilePath={selectedFilePath}
            onFileClick={onFileClick}
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
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const editorWrapRef = useRef<HTMLDivElement>(null)
  const [editorViewportH, setEditorViewportH] = useState(240)

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

  const openFileInPreview = useCallback(
    async (filePath: string) => {
      setPreviewPath(filePath)
      setPreviewLoading(true)
      setPreviewError(null)
      setPreviewContent('')
      try {
        const text = await invoke<string>('get_head_or_worktree_file_text', {
          repoPath,
          filePath,
        })
        setPreviewContent(text)
      } catch (e) {
        setPreviewError(formatTauriInvokeError(e, '加载文件失败'))
      } finally {
        setPreviewLoading(false)
      }
    },
    [repoPath]
  )

  const closePreview = useCallback(() => {
    setPreviewPath(null)
    setPreviewContent('')
    setPreviewError(null)
  }, [])

  useEffect(() => {
    if (!previewPath) return
    const el = editorWrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setEditorViewportH(Math.max(120, Math.floor(el.clientHeight)))
    })
    ro.observe(el)
    setEditorViewportH(Math.max(120, Math.floor(el.clientHeight)))
    return () => ro.disconnect()
  }, [previewPath])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/80 bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">文件树（HEAD）</p>
          <p className="truncate text-[11px] text-muted-foreground" title={repoPath}>
            {paths.length} 个文件 · 点击文件在右侧预览
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
      <div className="flex min-h-0 flex-1 flex-row">
        <div
          className={cn(
            'min-h-0 overflow-y-auto px-1 py-2 scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent',
            previewPath ? 'min-w-0 flex-[1_1_38%] border-r border-border/60' : 'min-w-0 flex-1'
          )}
        >
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
            <TreeRow
              node={tree}
              depth={0}
              expanded={expanded}
              onToggle={onToggle}
              selectedFilePath={previewPath}
              onFileClick={openFileInPreview}
            />
          )}
        </div>

        {previewPath && (
          <div className="flex min-h-0 min-w-0 flex-[1_1_62%] flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-2 py-1.5">
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={previewPath}>
                {previewPath}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1 px-2 text-xs"
                onClick={closePreview}
                aria-label="关闭预览"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div ref={editorWrapRef} className="min-h-0 flex-1 overflow-hidden px-1 pb-2 pt-1">
              {previewLoading && (
                <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载…
                </div>
              )}
              {previewError && (
                <p className="px-2 py-2 text-xs text-destructive" role="alert">
                  {previewError}
                </p>
              )}
              {!previewLoading && !previewError && previewPath && (
                <MonacoReadonly
                  code={previewContent}
                  language={getMonacoLanguageFromPath(previewPath)}
                  className="h-full min-h-0"
                  maxViewportHeightPx={editorViewportH}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
