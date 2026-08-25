import { useCallback, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { FileChange } from '../types/git'
import { FileText, Plus, Edit, Trash2, GitBranch } from 'lucide-react'
import { cn } from '../lib/utils'
import { splitRepoPath } from '../utils/splitRepoPath'

interface FileListProps {
  files: FileChange[]
  selectedFile: string | null
  onFileSelect: (filePath: string) => void
  loading?: boolean
}

export function FileList({ files, selectedFile, onFileSelect }: FileListProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedFile || !listRef.current) return
    let el: HTMLElement | null = null
    try {
      const escaped =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(selectedFile)
          : selectedFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      el = listRef.current.querySelector(`[data-file-path="${escaped}"]`)
    } catch {
      el = listRef.current.querySelector('[data-file-path]')
    }
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [selectedFile])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (files.length === 0) return
      const t = e.target
      if (t instanceof HTMLElement) {
        const tag = t.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return
      }
      const key = e.key
      if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End') return
      e.preventDefault()
      let idx = selectedFile ? files.findIndex((f) => f.path === selectedFile) : -1
      if (key === 'ArrowDown') {
        if (idx === -1) idx = 0
        else idx = Math.min(idx + 1, files.length - 1)
      } else if (key === 'ArrowUp') {
        if (idx === -1) idx = files.length - 1
        else idx = Math.max(idx - 1, 0)
      } else if (key === 'Home') idx = 0
      else if (key === 'End') idx = files.length - 1
      const next = files[idx]
      if (next && next.path !== selectedFile) onFileSelect(next.path)
    },
    [files, selectedFile, onFileSelect]
  )

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'added':
        return <Plus className="h-4 w-4 text-green-600 dark:text-green-400" />
      case 'modified':
        return <Edit className="h-4 w-4 text-blue-600 dark:text-blue-400" />
      case 'deleted':
        return <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
      case 'renamed':
        return <GitBranch className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
      default:
        return <FileText className="h-4 w-4 text-gray-600 dark:text-gray-400" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'added':
        return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700'
      case 'modified':
        return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700'
      case 'deleted':
        return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700'
      case 'renamed':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800/50 dark:text-gray-300 dark:border-gray-600'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'added':
        return '新增'
      case 'modified':
        return '修改'
      case 'deleted':
        return '删除'
      case 'renamed':
        return '重命名'
      default:
        return status
    }
  }

  if (files.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>文件变更</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">
            此提交没有文件变更
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          文件变更 ({files.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2.5 py-2">
        <div
          ref={listRef}
          tabIndex={0}
          role="listbox"
          aria-label="变更文件列表，↑/↓ 移动"
          onKeyDown={handleKeyDown}
          className="space-y-1 overflow-y-auto outline-none"
        >
          {files.map((file) => {
            const { dir, base } = splitRepoPath(file.path)
            return (
              <div
                key={file.path}
                data-file-path={file.path}
                role="option"
                aria-selected={selectedFile === file.path}
                className={cn(
                  'cursor-pointer rounded-md border px-2 py-1.5 transition-colors',
                  selectedFile === file.path
                    ? 'border-primary bg-accent shadow-sm ring-1 ring-primary/20'
                    : 'border-border/35 hover:border-border/50 hover:bg-accent/50'
                )}
                onClick={() => {
                  onFileSelect(file.path)
                  queueMicrotask(() => listRef.current?.focus())
                }}
                title={file.path}
              >
                <div className="flex gap-2">
                  <div className="shrink-0 pt-0.5">{getStatusIcon(file.status)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium leading-tight" title={file.path}>
                        {base}
                      </p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-flex whitespace-nowrap rounded border px-1 py-0.5 text-[10px] font-semibold leading-none',
                            getStatusColor(file.status)
                          )}
                        >
                          {getStatusText(file.status)}
                        </span>
                        {(file.additions > 0 || file.deletions > 0) && (
                          <span className="tabular-nums text-[11px]">
                            <span className="text-green-700 dark:text-green-400">+{file.additions}</span>
                            <span className="text-muted-foreground"> </span>
                            <span className="text-red-700 dark:text-red-400">-{file.deletions}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    {dir ? (
                      <p
                        className="mt-1 block min-h-[14px] truncate text-[11px] leading-snug text-muted-foreground"
                        title={file.path}
                      >
                        {dir}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
