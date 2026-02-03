import { useState, useCallback, useMemo, memo, useRef, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Search, Loader2, FileText, Plus, Edit, Trash2, GitBranch, Calendar } from 'lucide-react'
import { CommitInfo, FileChange } from '../types/git'
import { VSCodeDiff } from './CodeDiff'

interface UnifiedCommitViewProps {
  commits: CommitInfo[]
  onLoadMore?: () => void
  hasMore?: boolean
  loading?: boolean
  aheadCount?: number
  onGetCommitFiles: (commitId: string) => Promise<FileChange[]>
  onGetDiff: (commitId: string) => Promise<string>
  onGetSingleFileDiff: (commitId: string, filePath: string) => Promise<string>
  repoPath?: string
}

export function UnifiedCommitView({
  commits,
  onLoadMore,
  hasMore = false,
  loading = false,
  aheadCount = 0,
  onGetCommitFiles,
  onGetDiff,
  onGetSingleFileDiff,
  repoPath
}: UnifiedCommitViewProps) {
  const [searchTerm, setSearchTerm] = useState('')
  // 自定义日期范围，格式 YYYY-MM-DD，空字符串表示不限制
  const [dateRangeStart, setDateRangeStart] = useState('')
  const [dateRangeEnd, setDateRangeEnd] = useState('')
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null)
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const loadingTimeoutRef = useRef<number | null>(null)
  const currentLoadingFileRef = useRef<string | null>(null)
  const commitListScrollRef = useRef<HTMLDivElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const hasMoreRef = useRef(hasMore)
  const loadingRef = useRef(loading)
  const onLoadMoreRef = useRef(onLoadMore)
  hasMoreRef.current = hasMore
  loadingRef.current = loading
  onLoadMoreRef.current = onLoadMore

  // 滚动到底部自动加载更多
  useEffect(() => {
    if (!hasMore) return
    const root = commitListScrollRef.current
    const sentinel = loadMoreSentinelRef.current
    if (!root || !sentinel || !onLoadMoreRef.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        if (loadingRef.current || !hasMoreRef.current) return
        onLoadMoreRef.current?.()
      },
      { root, rootMargin: '100px', threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore])

  // 解析提交日期（后端格式 "YYYY-MM-DD HH:mm:ss"）为 Date，取当天 0 点便于比较
  const getCommitDate = useCallback((dateStr: string) => {
    const [datePart] = dateStr.split(' ')
    const [y, m, d] = (datePart || '').split('-').map(Number)
    if (!y || !m || !d) return null
    return new Date(y, m - 1, d)
  }, [])

  // 过滤提交 - 关键词 + 自定义日期范围
  const filteredCommits = useMemo(() => {
    return commits.filter(commit => {
      const commitDate = getCommitDate(commit.date)
      if (commitDate) {
        if (dateRangeStart) {
          const start = new Date(dateRangeStart + 'T00:00:00')
          if (commitDate < start) return false
        }
        if (dateRangeEnd) {
          const end = new Date(dateRangeEnd + 'T23:59:59.999')
          if (commitDate > end) return false
        }
      }
      if (!searchTerm.trim()) return true
      const term = searchTerm.toLowerCase()
      return commit.message.toLowerCase().includes(term) ||
             commit.author.toLowerCase().includes(term) ||
             commit.short_id.toLowerCase().includes(term)
    })
  }, [commits, searchTerm, dateRangeStart, dateRangeEnd, getCommitDate])

  // 计算待推送提交集合 - 使用 useMemo 优化
  const pendingPushIds = useMemo(() => {
    return new Set(commits.slice(0, aheadCount).map(c => c.id))
  }, [commits, aheadCount])

  // 处理提交选择 - 使用 useCallback 优化
  const handleCommitSelect = useCallback(async (commit: CommitInfo) => {
    // 如果已经是当前选中的提交，直接返回
    if (selectedCommit?.id === commit.id) return
    
    setSelectedCommit(commit)
    setSelectedFile(null)
    setDiff('')
    
    try {
      setLoadingFiles(true)
      const files = await onGetCommitFiles(commit.id)
      setCommitFiles(files)
    } catch (error) {
      console.error('❌ 获取提交文件失败:', error)
    } finally {
      setLoadingFiles(false)
    }
  }, [selectedCommit, onGetCommitFiles])

  // 处理文件选择 - 优化版本，立即显示加载状态
  const handleFileSelect = useCallback(async (filePath: string) => {
    // 如果已经是当前选中的文件，直接返回
    if (selectedFile === filePath) return
    
    // 清除之前的加载超时
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current)
    }
    
    // 立即更新选中状态和加载状态
    setSelectedFile(filePath)
    setLoadingDiff(true)
    currentLoadingFileRef.current = filePath
    
    if (!selectedCommit) {
      console.error('❌ 没有选中的提交')
      setLoadingDiff(false)
      return
    }
    
    try {
      const diffContent = await onGetSingleFileDiff(selectedCommit.id, filePath)
      
      // 只有当前文件仍然是选中的文件时才更新
      if (currentLoadingFileRef.current === filePath) {
        setDiff(diffContent || '')
        setLoadingDiff(false)
      }
    } catch (error) {
      console.error('❌ 获取文件差异失败:', error)
      if (currentLoadingFileRef.current === filePath) {
        setDiff('')
        setLoadingDiff(false)
      }
    }
  }, [selectedFile, selectedCommit, onGetSingleFileDiff])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
      }
    }
  }, [])

  // 获取状态图标 - 使用 useMemo 优化
  const getStatusIcon = useCallback((status: string) => {
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
  }, [])

  const getStatusColor = useCallback((status: string) => {
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
  }, [])

  const getStatusText = useCallback((status: string) => {
    switch (status) {
      case 'added': return '新增'
      case 'modified': return '修改'
      case 'deleted': return '删除'
      case 'renamed': return '重命名'
      default: return status
    }
  }, [])

  // 优化的文件项组件 - 使用更严格的 memo 比较
  const FileItem = memo(({ file, isSelected, onSelect, getStatusIcon, getStatusColor, getStatusText }: {
    file: FileChange
    isSelected: boolean
    onSelect: (filePath: string) => void
    getStatusIcon: (status: string) => React.ReactNode
    getStatusColor: (status: string) => string
    getStatusText: (status: string) => string
  }) => {
    const handleClick = useCallback(() => {
      onSelect(file.path)
    }, [onSelect, file.path])

    return (
      <div
        className={`border rounded p-2 cursor-pointer transition-colors ${
          isSelected
            ? 'bg-accent border-primary'
            : 'hover:bg-accent'
        }`}
        onClick={handleClick}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {getStatusIcon(file.status)}
              <span className="text-sm font-medium truncate">
                {file.path}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge 
                variant="outline" 
                className={`text-xs ${getStatusColor(file.status)}`}
              >
                {getStatusText(file.status)}
              </Badge>
              {(file.additions > 0 || file.deletions > 0) && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="text-green-600 dark:text-green-400">+{file.additions}</span>
                  <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
                </div>
              )}
            </div>
          </div>
          {isSelected && (
            <div className="ml-2">
              <div className="w-2 h-2 bg-primary rounded-full"></div>
            </div>
          )}
        </div>
      </div>
    )
  }, (prevProps, nextProps) => {
    // 自定义比较函数，只在关键属性变化时重新渲染
    return (
      prevProps.file.path === nextProps.file.path &&
      prevProps.file.status === nextProps.file.status &&
      prevProps.file.additions === nextProps.file.additions &&
      prevProps.file.deletions === nextProps.file.deletions &&
      prevProps.isSelected === nextProps.isSelected
    )
  })

  return (
    <div className="flex flex-col h-full gap-4 min-h-0">
      {/* 上方：提交记录单独一行，占大块高度 */}
      <div className="flex-shrink-0 min-h-0" style={{ height: '55%', maxHeight: '640px' }}>
        <Card className="h-full flex flex-col min-h-0">
          <CardHeader className="py-1 px-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm">提交记录</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3 text-muted-foreground shrink-0" />
                  <input
                    type="date"
                    value={dateRangeStart}
                    onChange={(e) => setDateRangeStart(e.target.value)}
                    className="h-7 text-xs border rounded-md px-2 bg-background text-foreground"
                    title="开始日期"
                  />
                  <span className="text-xs text-muted-foreground">至</span>
                  <input
                    type="date"
                    value={dateRangeEnd}
                    onChange={(e) => setDateRangeEnd(e.target.value)}
                    className="h-7 text-xs border rounded-md px-2 bg-background text-foreground"
                    title="结束日期"
                  />
                  {(dateRangeStart || dateRangeEnd) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setDateRangeStart('')
                        setDateRangeEnd('')
                      }}
                    >
                      清除
                    </Button>
                  )}
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="搜索提交..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-6 w-40 h-7 text-xs"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-hidden py-1 px-3">
            <div
              ref={commitListScrollRef}
              className="space-y-0.5 h-full overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent"
            >
              {filteredCommits.map((commit) => (
                <div
                  key={commit.id}
                  className={`border rounded p-1 cursor-pointer transition-colors ${
                    selectedCommit?.id === commit.id
                      ? 'bg-accent border-primary'
                      : 'hover:bg-accent'
                  }`}
                  onClick={() => handleCommitSelect(commit)}
                >
                  <div className="space-y-0.5">
                    {/* 提交信息 */}
                    <div className="flex items-start justify-between">
                      <p className="text-xs font-medium text-foreground line-clamp-1 flex-1 min-w-0 pr-1">
                        {commit.message}
                      </p>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {pendingPushIds.has(commit.id) && (
                          <Badge className="bg-blue-600 text-white hover:bg-blue-600/90 text-[10px] px-1 py-0">待推送</Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{commit.short_id}</Badge>
                      </div>
                    </div>
                    
                    {/* 作者和日期 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="font-medium">{commit.author}</span>
                        <span>•</span>
                        <span>{commit.date}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {hasMore && <div ref={loadMoreSentinelRef} className="h-2 flex-shrink-0" aria-hidden="true" />}
              {hasMore && (
                <div className="flex justify-center pt-2 border-t">
                  <Button
                    onClick={onLoadMore}
                    disabled={loading}
                    variant="outline"
                    className="flex items-center gap-1 h-7 text-xs"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        加载中...
                      </>
                    ) : (
                      '加载更多'
                    )}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 下方：文件变更 | 代码差异 两列 */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0" style={{ gridTemplateColumns: 'minmax(260px, 1fr) minmax(360px, 1.2fr)' }}>
        {/* 文件变更 */}
        <div className="flex flex-col min-h-0 min-w-0">
          <Card className="flex flex-col h-full min-h-0">
            <CardHeader className="py-1 flex-shrink-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                文件变更
                {commitFiles.length > 0 && ` (${commitFiles.length})`}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 py-1 overflow-hidden">
              {loadingFiles ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="ml-2">加载中...</span>
                </div>
              ) : commitFiles.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">
                    {selectedCommit ? '此提交没有文件变更' : '选择一个提交以查看文件变更'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1 h-full overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent">
                  {commitFiles.map((file) => (
                    <FileItem
                      key={file.path}
                      file={file}
                      isSelected={selectedFile === file.path}
                      onSelect={handleFileSelect}
                      getStatusIcon={getStatusIcon}
                      getStatusColor={getStatusColor}
                      getStatusText={getStatusText}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 代码差异 */}
        <div className="flex flex-col min-h-0 min-w-0">
          <Card className="flex flex-col h-full min-h-0">
            <CardHeader className="py-1 flex-shrink-0">
              <div className="flex items-center justify-between">
              {/* <CardTitle className="text-base">
                {selectedFile ? `差异: ${selectedFile}` : '代码差异'}
              </CardTitle> */}
              {/* {selectedFile && commitFiles.length > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const currentIndex = commitFiles.findIndex(f => f.path === selectedFile)
                      if (currentIndex > 0) {
                        handleFileSelect(commitFiles[currentIndex - 1].path)
                      }
                    }}
                    disabled={commitFiles.findIndex(f => f.path === selectedFile) === 0}
                  >
                    上一个文件
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const currentIndex = commitFiles.findIndex(f => f.path === selectedFile)
                      if (currentIndex < commitFiles.length - 1) {
                        handleFileSelect(commitFiles[currentIndex + 1].path)
                      }
                    }}
                    disabled={commitFiles.findIndex(f => f.path === selectedFile) === commitFiles.length - 1}
                  >
                    下一个文件
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {commitFiles.findIndex(f => f.path === selectedFile) + 1} / {commitFiles.length}
                  </span>
                </div>
              )} */}
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 py-1 overflow-hidden">
            {!selectedCommit ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">选择一个提交以查看差异</p>
              </div>
            ) : !selectedFile ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">选择一个文件以查看差异</p>
              </div>
            ) : loadingDiff ? (
              <div className="flex-1 overflow-hidden bg-white dark:bg-gray-900 relative min-h-0">
                {diff && (
                  <div className="h-full">
                    <VSCodeDiff
                      diff={diff}
                      filePath={selectedFile}
                      repoPath={repoPath || ''}
                    />
                  </div>
                )}
                <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">加载中...</span>
                  </div>
                </div>
              </div>
            ) : diff ? (
              <div className="flex-1 overflow-hidden bg-white dark:bg-gray-900 min-h-0">
                <VSCodeDiff
                  diff={diff}
                  filePath={selectedFile}
                  repoPath={repoPath || ''}
                />
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">无法加载文件差异</p>
              </div>
            )}
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  )
}
