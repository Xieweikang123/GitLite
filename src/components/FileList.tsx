import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { FileChange } from '../types/git'
import { FileText, Plus, Edit, Trash2, GitBranch } from 'lucide-react'
import { cn } from '../lib/utils'
import { splitRepoPath } from '../utils/splitRepoPath'
import {
  FileChangeFilterBar,
  countFileChangeStatuses,
  filterFileChanges,
  isFileFilterActive,
  type FileStatusFilter,
} from './FileChangeFilterBar'

interface FileListProps {
  files: FileChange[]
  selectedFile: string | null
  onFileSelect: (filePath: string) => void
  loading?: boolean
}

export function FileList({ files, selectedFile, onFileSelect }: FileListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [fileQuery, setFileQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<FileStatusFilter>('all')

  const visibleFiles = useMemo(
    () => filterFileChanges(files, fileQuery, statusFilter),
    [files, fileQuery, statusFilter]
  )
  const statusBuckets = useMemo(() => countFileChangeStatuses(files), [files])
  const filterActive = isFileFilterActive(fileQuery, statusFilter)

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
      if (visibleFiles.length === 0) return
      const t = e.target
      if (t instanceof HTMLElement) {
        const tag = t.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return
      }
      const key = e.key
      if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End') return
      e.preventDefault()
      let idx = selectedFile ? visibleFiles.findIndex((f) => f.path === selectedFile) : -1
      if (key === 'ArrowDown') {
        if (idx === -1) idx = 0
        else idx = Math.min(idx + 1, visibleFiles.length - 1)
      } else if (key === 'ArrowUp') {
        if (idx === -1) idx = visibleFiles.length - 1
        else idx = Math.max(idx - 1, 0)
      } else if (key === 'Home') idx = 0
      else if (key === 'End') idx = visibleFiles.length - 1
      const next = visibleFiles[idx]
      if (next && next.path !== selectedFile) onFileSelect(next.path)
    },
    [visibleFiles, selectedFile, onFileSelect]
  )

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'added':
        return <Plus className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
      case 'modified':
        return <Edit className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
      case 'deleted':
        return <Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
      case 'renamed':
        return <GitBranch className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />
      default:
        return <FileText className="h-3.5 w-3.5 text-gray-600 dark:text-gray-400" />
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
          文件变更 (
            {filterActive ? `${visibleFiles.length}/${files.length}` : files.length}
          )
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col px-2.5 py-2">
        <FileChangeFilterBar
          query={fileQuery}
          onQueryChange={setFileQuery}
          status={statusFilter}
          onStatusChange={setStatusFilter}
          buckets={statusBuckets}
        />
        <div
          ref={listRef}
          tabIndex={0}
          role="listbox"
          aria-label="变更文件列表，↑/↓ 移动"
          onKeyDown={handleKeyDown}
          className="min-h-0 flex-1 space-y-px overflow-y-auto outline-none"
        >
          {visibleFiles.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              没有匹配的文件变更
            </p>
          ) : (
            visibleFiles.map((file) => {
              const { dir, base } = splitRepoPath(file.path)
              return (
              <div
                key={file.path}
                data-file-path={file.path}
                role="option"
                aria-selected={selectedFile === file.path}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 transition-colors',
                  selectedFile === file.path
                    ? 'bg-accent ring-1 ring-inset ring-primary/25'
                    : 'hover:bg-accent/55'
                )}
                onClick={() => {
                  onFileSelect(file.path)
                  queueMicrotask(() => listRef.current?.focus())
                }}
                title={file.path}
              >
                <div className="shrink-0">{getStatusIcon(file.status)}</div>
                <p className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight" title={file.path}>
                  {base}
                  {dir ? (
                    <span className="ml-1.5 font-normal text-[11px] text-muted-foreground">
                      {dir}
                    </span>
                  ) : null}
                </p>
                {(file.additions > 0 || file.deletions > 0) && (
                  <span className="shrink-0 tabular-nums text-[11px]">
                    <span className="text-green-700 dark:text-green-400">+{file.additions}</span>
                    <span className="text-muted-foreground"> </span>
                    <span className="text-red-700 dark:text-red-400">-{file.deletions}</span>
                  </span>
                )}
              </div>
              )
            })
          )}
        </div>
      </CardContent>
    </Card>
  )
}
