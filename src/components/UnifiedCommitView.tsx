import { useState, useCallback, useMemo, memo, useRef, useEffect, type PointerEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Search, Loader2, FileText, Plus, Edit, Trash2, GitBranch, Calendar, GitCompare, Sparkles, ClipboardList } from 'lucide-react'
import { CommitInfo, FileChange } from '../types/git'
import { VSCodeDiff } from './CodeDiff'
import { RemoteSyncBar } from './RemoteSyncBar'
import { cn } from '../lib/utils'
import { invoke } from '@tauri-apps/api/tauri'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { CommitDatePickerButton } from './CommitDatePickerButton'
import { formatLocalYmd } from '../utils/dateYmd'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { formatTauriInvokeError } from '../utils/tauriError'

/** 提交页三栏宽度：提交列表 | 文件列表 | diff（与分隔条宽度一致） */
const PANES_STORAGE_KEY = 'gitlite:unifiedCommitView:panes'
const SPLITTER_PX = 6
const MIN_COMMIT_W = 200
const MIN_FILE_W = 160
const MIN_DIFF_W = 240
const MIN_RIGHT_EMPTY_W = 200
const DEFAULT_PANES = { commit: 304, file: 268 } as const

function loadPanes(): { commit: number; file: number } {
  if (typeof window === 'undefined') return { ...DEFAULT_PANES }
  try {
    const raw = localStorage.getItem(PANES_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PANES }
    const j = JSON.parse(raw) as { commit?: number; file?: number }
    const commit =
      typeof j.commit === 'number' && Number.isFinite(j.commit)
        ? Math.max(MIN_COMMIT_W, j.commit)
        : DEFAULT_PANES.commit
    const file =
      typeof j.file === 'number' && Number.isFinite(j.file)
        ? Math.max(MIN_FILE_W, j.file)
        : DEFAULT_PANES.file
    return { commit, file }
  } catch {
    return { ...DEFAULT_PANES }
  }
}

function savePanes(p: { commit: number; file: number }) {
  try {
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* 忽略隐私模式等写入失败 */
  }
}

function VerticalResizeHandle({
  onDrag,
  onDragEnd,
  className,
}: {
  onDrag: (deltaX: number) => void
  onDragEnd?: () => void
  className?: string
}) {
  const dragRef = useRef({ active: false, x: 0 })

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragRef.current = { active: true, x: e.clientX }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    const dx = e.clientX - dragRef.current.x
    dragRef.current.x = e.clientX
    if (dx !== 0) onDrag(dx)
  }

  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    dragRef.current.active = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* 已释放 */
    }
    onDragEnd?.()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整宽度"
      tabIndex={0}
      className={cn(
        'w-1.5 shrink-0 cursor-col-resize touch-none select-none rounded-full bg-border/70 hover:bg-primary/45',
        'active:bg-primary/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    />
  )
}

interface UnifiedCommitViewProps {
  commits: CommitInfo[]
  onLoadMore?: () => void
  hasMore?: boolean
  loading?: boolean
  searchLoading?: boolean
  isSearchMode?: boolean
  onSearchFullRepo?: (term: string) => void
  onClearSearchMode?: () => void
  aheadCount?: number
  behindCount?: number
  onFetchChanges?: () => void
  onPullChanges?: () => void
  onPushChanges?: () => void
  onRefreshRepo?: () => void
  /** 仓库级操作进行中（如切换分支），用于禁用同步按钮 */
  syncBusy?: boolean
  onGetCommitFiles: (commitId: string) => Promise<FileChange[]>
  onGetDiff: (commitId: string) => Promise<string>
  onGetSingleFileDiff: (commitId: string, filePath: string) => Promise<string>
  repoPath?: string
  /** 与路径一起用于在切换分支后重新统计提交总数 */
  currentBranch?: string
}

export function UnifiedCommitView({
  commits,
  onLoadMore,
  hasMore = false,
  loading = false,
  searchLoading = false,
  isSearchMode = false,
  onSearchFullRepo,
  onClearSearchMode,
  aheadCount = 0,
  behindCount,
  onFetchChanges,
  onPullChanges,
  onPushChanges,
  onRefreshRepo,
  syncBusy = false,
  onGetCommitFiles,
  onGetDiff,
  onGetSingleFileDiff,
  repoPath,
  currentBranch
}: UnifiedCommitViewProps) {
  /** 筛选栏输入（待「查询」应用） */
  const [pendingStart, setPendingStart] = useState('')
  const [pendingEnd, setPendingEnd] = useState('')
  const [pendingSearch, setPendingSearch] = useState('')
  /** 已应用到列表的筛选条件 */
  const [appliedStart, setAppliedStart] = useState('')
  const [appliedEnd, setAppliedEnd] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [headCommitTotal, setHeadCommitTotal] = useState<number | null>(null)
  const [headCommitTotalLoading, setHeadCommitTotalLoading] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  /** 弹窗内是否展示并请求 AI 总结（仅「提交列表」打开时为 false，可随后在弹窗内点「生成 AI 总结」） */
  const [summaryIncludeAi, setSummaryIncludeAi] = useState(true)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryText, setSummaryText] = useState('')
  const [summaryError, setSummaryError] = useState<string | null>(null)
  /** 与后端一致的 system / user 全文（助手为流式 summaryText） */
  const [summaryConversationMessages, setSummaryConversationMessages] = useState<
    { role: string; content: string }[] | null
  >(null)
  const [commitListCopied, setCommitListCopied] = useState(false)
  const aiSummaryBusyRef = useRef(false)
  /** 流式 chunk 缓冲：打破 React 18 批处理，否则会等到本轮事件结束才单次渲染，看起来像「无实时输出」 */
  const aiSummaryStreamBufRef = useRef('')
  const aiSummaryStreamRafRef = useRef<number | null>(null)
  const aiSummaryScrollRef = useRef<HTMLDivElement>(null)

  const scheduleAiSummaryStreamFlush = useCallback(() => {
    if (aiSummaryStreamRafRef.current != null) return
    aiSummaryStreamRafRef.current = window.requestAnimationFrame(() => {
      aiSummaryStreamRafRef.current = null
      const add = aiSummaryStreamBufRef.current
      aiSummaryStreamBufRef.current = ''
      if (add.length > 0) {
        setSummaryText((prev) => prev + add)
      }
      if (aiSummaryStreamBufRef.current.length > 0) {
        scheduleAiSummaryStreamFlush()
      }
    })
  }, [])
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

  const [panes, setPanes] = useState(loadPanes)
  const panesRef = useRef(panes)
  panesRef.current = panes
  const rootRef = useRef<HTMLDivElement>(null)

  const persistPanes = useCallback(() => {
    savePanes(panesRef.current)
  }, [])

  const onDragOuter = useCallback(
    (dx: number) => {
      setPanes(({ commit, file }) => {
        const root = rootRef.current
        if (!root) return { commit: commit + dx, file }
        const cw = root.clientWidth
        const s = SPLITTER_PX
        const maxCommit = selectedCommit
          ? cw - file - MIN_DIFF_W - s * 2
          : cw - MIN_RIGHT_EMPTY_W - s
        const cappedMax = Math.max(MIN_COMMIT_W, maxCommit)
        const next = Math.max(MIN_COMMIT_W, Math.min(commit + dx, cappedMax))
        return { commit: next, file }
      })
    },
    [selectedCommit]
  )

  const onDragInner = useCallback((dx: number) => {
    setPanes(({ commit, file }) => {
      const root = rootRef.current
      if (!root) return { commit, file: file + dx }
      const cw = root.clientWidth
      const s = SPLITTER_PX
      const maxFile = cw - commit - MIN_DIFF_W - s * 2
      const cappedMax = Math.max(MIN_FILE_W, maxFile)
      const next = Math.max(MIN_FILE_W, Math.min(file + dx, cappedMax))
      return { commit, file: next }
    })
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const ro = new ResizeObserver(() => {
      setPanes(({ commit, file }) => {
        const cw = root.clientWidth
        if (cw <= 0) return { commit, file }
        const s = SPLITTER_PX
        let c = commit
        let f = file
        const maxC = selectedCommit
          ? cw - f - MIN_DIFF_W - s * 2
          : cw - MIN_RIGHT_EMPTY_W - s
        c = Math.max(MIN_COMMIT_W, Math.min(c, Math.max(MIN_COMMIT_W, maxC)))
        if (selectedCommit) {
          const maxF = cw - c - MIN_DIFF_W - s * 2
          f = Math.max(MIN_FILE_W, Math.min(f, Math.max(MIN_FILE_W, maxF)))
        }
        return { commit: c, file: f }
      })
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [selectedCommit])

  // 当前分支 HEAD 历史提交总数（切换仓库/分支时重新查询）
  useEffect(() => {
    if (!repoPath) {
      setHeadCommitTotal(null)
      setHeadCommitTotalLoading(false)
      return
    }
    let cancelled = false
    setHeadCommitTotal(null)
    setHeadCommitTotalLoading(true)
    invoke<number>('get_commit_count_head', { repoPath })
      .then((n) => {
        if (!cancelled) {
          setHeadCommitTotal(n)
          setHeadCommitTotalLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHeadCommitTotal(null)
          setHeadCommitTotalLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [repoPath, currentBranch])

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

  // 全仓库搜索模式下清空关键词时退出搜索模式
  useEffect(() => {
    if (isSearchMode && !pendingSearch.trim()) {
      onClearSearchMode?.()
    }
  }, [isSearchMode, pendingSearch, onClearSearchMode])

  // 过滤提交 - 非搜索模式下按关键词过滤；始终按自定义日期范围过滤
  const hasActiveFilters = useMemo(
    () =>
      !!(
        pendingStart ||
        pendingEnd ||
        pendingSearch.trim() ||
        appliedStart ||
        appliedEnd ||
        appliedSearch.trim() ||
        isSearchMode
      ),
    [
      pendingStart,
      pendingEnd,
      pendingSearch,
      appliedStart,
      appliedEnd,
      appliedSearch,
      isSearchMode,
    ]
  )

  const canApplyFilters = useMemo(
    () =>
      pendingStart !== appliedStart ||
      pendingEnd !== appliedEnd ||
      pendingSearch !== appliedSearch,
    [
      pendingStart,
      pendingEnd,
      pendingSearch,
      appliedStart,
      appliedEnd,
      appliedSearch,
    ]
  )

  const applyFilters = useCallback(() => {
    setAppliedStart(pendingStart)
    setAppliedEnd(pendingEnd)
    setAppliedSearch(pendingSearch)
  }, [pendingStart, pendingEnd, pendingSearch])

  const clearAllFilters = useCallback(() => {
    setPendingStart('')
    setPendingEnd('')
    setPendingSearch('')
    setAppliedStart('')
    setAppliedEnd('')
    setAppliedSearch('')
    onClearSearchMode?.()
  }, [onClearSearchMode])

  const filteredCommits = useMemo(() => {
    return commits.filter(commit => {
      const commitDate = getCommitDate(commit.date)
      if (commitDate) {
        if (appliedStart) {
          const start = new Date(appliedStart + 'T00:00:00')
          if (commitDate < start) return false
        }
        if (appliedEnd) {
          const end = new Date(appliedEnd + 'T23:59:59.999')
          if (commitDate > end) return false
        }
      }
      if (isSearchMode || !appliedSearch.trim()) return true
      const term = appliedSearch.toLowerCase()
      return commit.message.toLowerCase().includes(term) ||
             commit.author.toLowerCase().includes(term) ||
             commit.short_id.toLowerCase().includes(term)
    })
  }, [
    commits,
    appliedSearch,
    appliedStart,
    appliedEnd,
    getCommitDate,
    isSearchMode,
  ])

  /** 与后端总结一致：按日期时间升序（字符串可比） */
  const commitsSortedForCopy = useMemo(() => {
    return [...filteredCommits].sort((a, b) => a.date.localeCompare(b.date))
  }, [filteredCommits])

  const commitsListPlainText = useMemo(() => {
    return commitsSortedForCopy
      .map((c, i) => `${i + 1}. ${c.date} | ${c.short_id} | ${c.author} | ${c.message}`)
      .join('\n')
  }, [commitsSortedForCopy])

  const copyCommitListToClipboard = useCallback(async () => {
    if (!commitsListPlainText) return
    try {
      await navigator.clipboard.writeText(commitsListPlainText)
      setCommitListCopied(true)
      window.setTimeout(() => setCommitListCopied(false), 2000)
    } catch {
      /* 剪贴板不可用等 */
    }
  }, [commitsListPlainText])

  const openCommitListDialog = useCallback(() => {
    if (filteredCommits.length === 0) return
    setSummaryIncludeAi(false)
    setSummaryOpen(true)
    setSummaryLoading(false)
    setSummaryText('')
    setSummaryError(null)
    setSummaryConversationMessages(null)
  }, [filteredCommits])

  const handleAiSummarize = useCallback(async () => {
    if (filteredCommits.length === 0 || aiSummaryBusyRef.current) return
    aiSummaryBusyRef.current = true
    if (aiSummaryStreamRafRef.current != null) {
      cancelAnimationFrame(aiSummaryStreamRafRef.current)
      aiSummaryStreamRafRef.current = null
    }
    aiSummaryStreamBufRef.current = ''
    setSummaryIncludeAi(true)
    setSummaryOpen(true)
    setSummaryLoading(true)
    setSummaryError(null)
    setSummaryText('')
    setSummaryConversationMessages(null)

    const payload = filteredCommits.map((c) => ({
      short_id: c.short_id,
      message: c.message,
      author: c.author,
      date: c.date,
    }))

    let unlistenChunk: UnlistenFn | undefined
    let unlistenConv: UnlistenFn | undefined
    let chunkRecvCount = 0
    let chunkRecvChars = 0
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    try {
      console.log('[ai-summary] invoke start', { commits: payload.length, t0 })
      unlistenConv = await listen<{ messages?: { role: string; content: string }[] }>(
        'ai-summary-conversation',
        (event) => {
          const msgs = event.payload?.messages
          if (Array.isArray(msgs) && msgs.length > 0) {
            console.log('[ai-summary] conversation event', {
              messages: msgs.length,
              systemLen: msgs[0]?.content?.length,
              userLen: msgs[1]?.content?.length,
            })
            setSummaryConversationMessages(msgs)
          }
        }
      )
      unlistenChunk = await listen<{ text?: string }>('ai-summary-chunk', (event) => {
        const p = event.payload
        const t = typeof p?.text === 'string' ? p.text : ''
        if (t.length > 0) {
          chunkRecvCount += 1
          chunkRecvChars += t.length
          if (chunkRecvCount <= 5 || chunkRecvCount % 40 === 0) {
            const dt =
              typeof performance !== 'undefined' ? (performance.now() - t0).toFixed(0) : '?'
            console.log('[ai-summary] chunk', {
              n: chunkRecvCount,
              len: t.length,
              totalChars: chunkRecvChars,
              ms: dt,
              sample: t.length > 48 ? `${t.slice(0, 48)}…` : t,
            })
          }
          aiSummaryStreamBufRef.current += t
          scheduleAiSummaryStreamFlush()
        } else if (p != null && typeof p === 'object' && 'text' in p && (p as { text?: unknown }).text != null) {
          console.warn('[ai-summary] chunk payload.text 非字符串', p)
        }
      })
      await invoke('summarize_commits_ai_stream', { commits: payload })
      const t1 = typeof performance !== 'undefined' ? performance.now() : 0
      console.log('[ai-summary] invoke resolved', {
        chunks: chunkRecvCount,
        totalChars: chunkRecvChars,
        ms: t1 && t0 ? (t1 - t0).toFixed(0) : undefined,
      })
    } catch (e) {
      console.error('[ai-summary] invoke error', e)
      setSummaryError(formatTauriInvokeError(e, '生成总结失败'))
    } finally {
      if (unlistenConv) unlistenConv()
      if (unlistenChunk) unlistenChunk()
      if (aiSummaryStreamRafRef.current != null) {
        cancelAnimationFrame(aiSummaryStreamRafRef.current)
        aiSummaryStreamRafRef.current = null
      }
      const tail = aiSummaryStreamBufRef.current
      aiSummaryStreamBufRef.current = ''
      if (tail.length > 0) {
        setSummaryText((prev) => prev + tail)
      }
      console.log('[ai-summary] finally', {
        tailFlushLen: tail.length,
        chunkRecvCount,
        chunkRecvChars,
      })
      setSummaryLoading(false)
      aiSummaryBusyRef.current = false
    }
  }, [filteredCommits, scheduleAiSummaryStreamFlush])

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

  // 对话区：系统/用户展示后或流式输出时滚到底部
  useEffect(() => {
    if (!summaryText && !summaryConversationMessages?.length) return
    const el = aiSummaryScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [summaryText, summaryConversationMessages])

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
              <span className="text-sm font-medium truncate" title={file.path}>
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
    <div
      ref={rootRef}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-row overflow-hidden"
    >
      <div
        style={{ width: panes.commit }}
        className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden"
      >
        <Card className="flex h-full min-h-0 flex-col border-border/80">
          <CardHeader className="py-1 px-3 space-y-1">
            {/* 标题单独一行，避免与多行筛选区并排时 items-center 把标题挤到日期行中间造成重叠 */}
            <div className="flex items-center justify-between gap-2 min-w-0">
              <CardTitle className="text-sm shrink-0">提交记录</CardTitle>
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={clearAllFilters}
                >
                  清空筛选
                </Button>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <Calendar className="h-3 w-3 shrink-0 text-muted-foreground" />
                <CommitDatePickerButton
                  value={pendingStart}
                  onChange={setPendingStart}
                  placeholder="开始日期"
                  title="开始日期（点击打开日历，确定后写入待查询条件）"
                />
                <span className="shrink-0 text-xs text-muted-foreground">至</span>
                <CommitDatePickerButton
                  value={pendingEnd}
                  onChange={setPendingEnd}
                  placeholder="结束日期"
                  title="结束日期（点击打开日历，确定后写入待查询条件）"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => {
                    const ymd = formatLocalYmd(new Date())
                    setPendingStart(ymd)
                    setPendingEnd(ymd)
                    setAppliedStart(ymd)
                    setAppliedEnd(ymd)
                    setAppliedSearch(pendingSearch)
                  }}
                >
                  今日
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => {
                    const end = new Date()
                    const start = new Date(end)
                    start.setDate(start.getDate() - 6)
                    setPendingStart(formatLocalYmd(start))
                    setPendingEnd(formatLocalYmd(end))
                  }}
                  title="含今日共 7 个自然日"
                >
                  最近7天
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 shrink-0 px-3 text-xs"
                  disabled={!canApplyFilters}
                  onClick={applyFilters}
                  title="将当前日期与关键词应用到列表筛选"
                >
                  查询
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2 text-xs"
                  disabled={filteredCommits.length === 0}
                  onClick={openCommitListDialog}
                  title="打开弹窗，列出当前筛选下已加载的全部提交（时间升序），便于复制"
                >
                  <ClipboardList className="h-3 w-3" />
                  提交列表
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2 text-xs"
                  disabled={filteredCommits.length === 0 || summaryLoading}
                  onClick={handleAiSummarize}
                  title="根据左侧当前筛选后的提交记录（含已加载列表）生成中文总结，需先在菜单「AI」中启用模型"
                >
                  {summaryLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  AI 总结
                </Button>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <div className="relative min-w-0 flex-1 basis-[8rem] sm:basis-auto sm:flex-none sm:w-40">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="搜索提交..."
                    value={pendingSearch}
                    onChange={(e) => setPendingSearch(e.target.value)}
                    className="h-7 w-full min-w-0 pl-6 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canApplyFilters) {
                        e.preventDefault()
                        applyFilters()
                      }
                    }}
                  />
                </div>
                {pendingSearch.trim() && !isSearchMode && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    disabled={searchLoading}
                    onClick={() => onSearchFullRepo?.(pendingSearch.trim())}
                  >
                    {searchLoading ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        搜索中...
                      </>
                    ) : (
                      '在全仓库中搜索'
                    )}
                  </Button>
                )}
                {isSearchMode && (
                  <>
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                      全仓库结果
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 text-xs"
                      onClick={() => {
                        setPendingSearch('')
                        onClearSearchMode?.()
                      }}
                    >
                      恢复列表
                    </Button>
                  </>
                )}
              </div>
            </div>
            <RemoteSyncBar
              ahead={aheadCount}
              behind={behindCount}
              disabled={syncBusy}
              onFetchChanges={onFetchChanges}
              onPullChanges={onPullChanges}
              onPushChanges={onPushChanges}
              onRefresh={onRefreshRepo}
              refreshTitle="刷新仓库与提交列表"
              density="compact"
            />
            <p
              className="text-[11px] text-muted-foreground leading-snug px-0.5 pb-0.5"
              title="「已加载」为当前列表中的条数，可向下滚动继续加载。「当前分支」总数为 HEAD 可达提交数（与 git rev-list --count HEAD 一致），含合并带来的历史。"
            >
              {isSearchMode ? (
                <>
                  全仓库搜索到 {commits.length} 条
                  {headCommitTotalLoading && ' · 统计分支总数中…'}
                  {!headCommitTotalLoading && headCommitTotal !== null && (
                    <> · 当前分支共 {headCommitTotal} 个提交</>
                  )}
                </>
              ) : (
                <>
                  已加载 {commits.length} 条
                  {hasMore && '（列表可继续下拉加载）'}
                  {headCommitTotalLoading && ' · 统计分支总数中…'}
                  {!headCommitTotalLoading && headCommitTotal !== null && (
                    <> · 当前分支共 {headCommitTotal} 个提交</>
                  )}
                  {filteredCommits.length !== commits.length && (
                    <> · 筛选后显示 {filteredCommits.length} 条</>
                  )}
                </>
              )}
            </p>
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
                      <p
                        className="text-xs font-medium text-foreground line-clamp-2 flex-1 min-w-0 pr-1"
                        title={commit.message}
                      >
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

      <VerticalResizeHandle onDrag={onDragOuter} onDragEnd={persistPanes} />

      {/* 右侧：未选提交时为一块说明；选中后为 文件变更 | 代码差异 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!selectedCommit ? (
          <Card className="flex h-full min-h-0 flex-1 flex-col border-border/80">
            <CardContent className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center text-muted-foreground">
              <GitCompare className="h-14 w-14 shrink-0 opacity-40" />
              <p className="text-sm font-medium text-foreground">选择提交查看变更</p>
              <p className="max-w-sm text-xs leading-relaxed opacity-80">
                在左侧提交记录中点击任意一条，即可查看该提交的文件列表与代码差异。
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
            {/* 文件变更 */}
            <div
              style={{ width: panes.file }}
              className="flex min-h-0 shrink-0 flex-col overflow-hidden"
            >
              <Card className="flex h-full min-h-0 flex-col border-border/80">
                <CardHeader className="flex-shrink-0 py-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4" />
                    文件变更
                    {commitFiles.length > 0 && ` (${commitFiles.length})`}
                  </CardTitle>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 overflow-hidden py-1">
                  {loadingFiles ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="ml-2">加载中...</span>
                    </div>
                  ) : commitFiles.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="text-muted-foreground">此提交没有文件变更</p>
                    </div>
                  ) : (
                    <div className="scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent h-full space-y-1 overflow-y-auto">
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

            <VerticalResizeHandle onDrag={onDragInner} onDragEnd={persistPanes} />

            {/* 代码差异 */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <Card className="flex h-full min-h-0 flex-col border-border/80">
                <CardHeader className="flex-shrink-0 py-1">
                  <div className="flex min-w-0 items-center justify-between">
                    <CardTitle className="truncate text-base" title={selectedFile || undefined}>
                      {selectedFile ? selectedFile : '代码差异'}
                    </CardTitle>
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
                <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden py-1">
                  {!loadingFiles && commitFiles.length === 0 ? (
                    <div className="flex h-full min-h-[120px] flex-col items-center justify-center text-muted-foreground">
                      <FileText className="mb-2 h-10 w-10 opacity-40" />
                      <p className="text-xs opacity-90">该提交没有可展示的差异</p>
                    </div>
                  ) : !selectedFile ? (
                    <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-muted-foreground">
                      <FileText className="mb-3 h-12 w-12 opacity-40" />
                      <p className="mb-1 text-sm font-medium">选择文件查看差异</p>
                      <p className="text-xs opacity-80">在「文件变更」列表中点击要查看的文件</p>
                    </div>
                  ) : loadingDiff ? (
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-gray-900">
                {diff && (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <VSCodeDiff
                      diff={diff}
                      filePath={selectedFile}
                      repoPath={repoPath || ''}
                    />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">加载中...</span>
                  </div>
                </div>
              </div>
            ) : diff ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-gray-900">
                <VSCodeDiff
                  diff={diff}
                  filePath={selectedFile}
                  repoPath={repoPath || ''}
                />
              </div>
                  ) : (
                    <div className="py-8 text-center">
                      <p className="text-muted-foreground">无法加载文件差异</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={summaryOpen}
        onOpenChange={(open) => {
          setSummaryOpen(open)
          if (!open) {
            setCommitListCopied(false)
            setSummaryConversationMessages(null)
          }
        }}
      >
        <DialogContent className="flex max-h-[min(92vh,800px)] min-h-0 max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="shrink-0 px-6 pb-2 pt-6">
            <DialogTitle>
              {summaryIncludeAi ? '提交记录 · AI 总结' : '提交记录 · 列表'}
            </DialogTitle>
            <p className="pt-1 text-xs text-muted-foreground">
              当前筛选下、列表中已加载 {filteredCommits.length} 条（时间升序排列）。若需更长历史请先下拉「加载更多」。
            </p>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 pb-6">
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
              <div className="flex shrink-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">全部提交（可复制）</p>
                  <p className="text-xs text-muted-foreground">
                    每行格式：序号 · 日期 · 短哈希 · 作者 · 说明。可在框内 Ctrl+A 全选复制。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  disabled={!commitsListPlainText}
                  onClick={copyCommitListToClipboard}
                >
                  {commitListCopied ? '已复制' : '复制全部'}
                </Button>
              </div>
              <textarea
                readOnly
                value={commitsListPlainText}
                spellCheck={false}
                className="min-h-0 w-full flex-1 resize-y overflow-auto rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>

            {summaryIncludeAi ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border pt-4">
                <p className="mb-2 shrink-0 text-sm font-medium">完整对话</p>
                <p className="mb-3 shrink-0 text-xs text-muted-foreground">
                  以下为发往模型的系统提示、用户消息及助手回复（与菜单「AI」中配置的接口一致）。
                </p>
                <div
                  ref={aiSummaryScrollRef}
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md border border-border/80 bg-muted/30 p-3 text-sm"
                >
                  {summaryConversationMessages?.map((m, idx) => (
                    <div key={`${m.role}-${idx}`} className="space-y-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {m.role === 'system' ? '系统' : m.role === 'user' ? '用户' : m.role}
                      </div>
                      <pre className="max-h-[min(28vh,240px)] overflow-y-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-background/80 px-2.5 py-2 font-sans text-xs leading-relaxed text-foreground">
                        {m.content}
                      </pre>
                    </div>
                  ))}
                  <div className="space-y-1 border-t border-border/60 pt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      助手
                    </div>
                    {summaryLoading && (
                      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        <span>正在流式生成…</span>
                      </div>
                    )}
                    {summaryError && (
                      <p className="whitespace-pre-wrap text-xs text-destructive">{summaryError}</p>
                    )}
                    {summaryText ? (
                      <div className="whitespace-pre-wrap rounded border border-primary/25 bg-background/90 px-2.5 py-2 text-xs leading-relaxed">
                        {summaryText}
                      </div>
                    ) : null}
                    {!summaryLoading &&
                    !summaryError &&
                    !summaryText &&
                    summaryConversationMessages &&
                    summaryConversationMessages.length > 0 ? (
                      <p className="text-xs text-muted-foreground">暂无助手回复</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="shrink-0 border-t border-border pt-4">
                <p className="mb-2 text-xs text-muted-foreground">
                  未请求 AI。需要时点击下方按钮（将使用菜单「AI」中的模型配置）。
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1"
                  disabled={filteredCommits.length === 0 || summaryLoading}
                  onClick={handleAiSummarize}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  生成 AI 总结
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
