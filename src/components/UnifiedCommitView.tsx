import {
  useState,
  useCallback,
  useMemo,
  memo,
  useRef,
  useEffect,
  useLayoutEffect,
  type PointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Search,
  Loader2,
  FileText,
  Plus,
  Edit,
  Trash2,
  GitBranch,
  Calendar,
  GitCompare,
  Sparkles,
  ClipboardList,
  RotateCcw,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import {
  CommitInfo,
  FileChange,
  type GitResetMode,
  type BranchOnCommit,
  type CommitBranchLabels,
} from '../types/git'
import { VSCodeDiff } from './CodeDiff'
import { RemoteSyncBar } from './RemoteSyncBar'
import { cn } from '../lib/utils'
import { invoke } from '@tauri-apps/api/tauri'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { CommitDatePickerButton } from './CommitDatePickerButton'
import { formatLocalYmd } from '../utils/dateYmd'
import { branchBadgeClassName, formatBranchLabelShort } from '../utils/branchDisplayName'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Label } from './ui/label'
import { formatTauriInvokeError } from '../utils/tauriError'
import { splitRepoPath } from '../utils/splitRepoPath'
import { CommitGraphStrip, COMMIT_GRAPH_ROW_HEIGHT } from './CommitGraphStrip'

/** 提交页分栏：左侧提交列表宽度 list；右侧内「文件列表 | diff」中文件列宽度 file */
const PANES_STORAGE_KEY = 'gitlite:unifiedCommitView:panes'
const SPLITTER_PX = 6
const MIN_LIST_W = 240
const MIN_FILE_W = 160
const MIN_DIFF_W = 240
const DEFAULT_PANES = { list: 340, file: 240 } as const

/** 分支下拉框值为 `refs/heads/…`，界面文案只展示短名 */
function shortLocalBranchRef(ref: string | null | undefined): string {
  if (!ref) return ''
  return ref.replace(/^refs\/heads\//, '')
}

function loadPanes(): { list: number; file: number } {
  if (typeof window === 'undefined') return { ...DEFAULT_PANES }
  try {
    const raw = localStorage.getItem(PANES_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PANES }
    const j = JSON.parse(raw) as { list?: number; file?: number; commit?: number }
    if (typeof j.list === 'number' && Number.isFinite(j.list) && typeof j.file === 'number' && Number.isFinite(j.file)) {
      return {
        list: Math.max(MIN_LIST_W, j.list),
        file: Math.max(MIN_FILE_W, j.file),
      }
    }
    // 旧版：{ commit: 上区高度, file } 纵向布局 → 仅继承 file，列表宽用默认
    if (typeof j.commit === 'number' && typeof j.file === 'number' && Number.isFinite(j.file)) {
      const upgraded = {
        list: DEFAULT_PANES.list,
        file:
          j.commit === 304 && j.file === 268 ? DEFAULT_PANES.file : Math.max(MIN_FILE_W, j.file),
      }
      try {
        localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(upgraded))
      } catch {
        /* 忽略 */
      }
      return upgraded
    }
    return { ...DEFAULT_PANES }
  } catch {
    return { ...DEFAULT_PANES }
  }
}

function savePanes(p: { list: number; file: number }) {
  try {
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* 忽略隐私模式等写入失败 */
  }
}

const DIFF_PANEL_COLLAPSED_KEY = 'gitlite:unifiedCommitView:diffPanelCollapsed'

function loadDiffPanelCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(DIFF_PANEL_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function saveDiffPanelCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(DIFF_PANEL_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* 忽略 */
  }
}

const RIGHT_PANEL_COLLAPSED_KEY = 'gitlite:unifiedCommitView:rightPanelCollapsed'

function loadRightPanelCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(RIGHT_PANEL_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function saveRightPanelCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(RIGHT_PANEL_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* 忽略 */
  }
}

/** 选中提交后：默认一行摘要不挤占下方；展开可看全文与完整元数据（区域限高可滚动） */
function CommitDetailStrip({ commit }: { commit: CommitInfo }) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [copiedFull, setCopiedFull] = useState(false)

  const copyFullHash = async () => {
    try {
      await navigator.clipboard.writeText(commit.id)
      setCopiedFull(true)
      window.setTimeout(() => setCopiedFull(false), 2000)
    } catch {
      /* 忽略剪贴板不可用 */
    }
  }

  const parents = commit.parent_ids ?? []
  const messageBody = (commit.message ?? '').trimEnd()
  const metaOneLine = [commit.short_id, commit.author, commit.date].filter(Boolean).join(' · ')

  return (
    <div className="shrink-0 border-b border-border/40 bg-muted/10 dark:bg-muted/5">
      <div className="flex items-start gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3">
        <div className="min-w-0 flex-1">
          <p
            className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight text-foreground"
            title={messageBody || undefined}
          >
            {messageBody || '（无提交说明）'}
          </p>
          <p
            className="mt-0.5 truncate text-[11px] text-muted-foreground"
            title={`${metaOneLine}${commit.email ? ` · ${commit.email}` : ''}`}
          >
            {metaOneLine}
            {commit.email ? (
              <span className="text-muted-foreground/80"> · {commit.email}</span>
            ) : null}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-0.5 px-1.5 text-xs text-muted-foreground hover:text-foreground sm:px-2"
          onClick={() => setDetailOpen((o) => !o)}
          aria-expanded={detailOpen}
          title={detailOpen ? '收起提交详情' : '展开完整说明与哈希、父提交等'}
        >
          {detailOpen ? '收起' : '详情'}
          {detailOpen ? (
            <ChevronUp className="h-3.5 w-3.5 opacity-80" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden />
          )}
        </Button>
      </div>
      {detailOpen && (
        <div className="max-h-[min(14rem,36vh)] overflow-y-auto overscroll-contain border-t border-border/50 bg-muted/25 px-2.5 py-2">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
            {messageBody || '（无提交说明）'}
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-y-1">
            <dt className="text-muted-foreground sm:pt-0.5">完整哈希</dt>
            <dd className="flex min-w-0 items-start gap-1">
              <span className="break-all font-mono text-[11px] leading-relaxed text-foreground" title={commit.id}>
                {commit.id}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => void copyFullHash()}
                title="复制完整哈希"
                aria-label="复制完整哈希"
              >
                {copiedFull ? (
                  <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                )}
              </Button>
            </dd>
            <dt className="text-muted-foreground">短哈希</dt>
            <dd className="font-mono text-[11px] text-foreground">{commit.short_id}</dd>
            <dt className="text-muted-foreground">作者</dt>
            <dd className="min-w-0 break-words text-foreground">
              <span>{commit.author}</span>
              {commit.email ? (
                <span className="text-muted-foreground"> &lt;{commit.email}&gt;</span>
              ) : null}
            </dd>
            <dt className="text-muted-foreground">日期</dt>
            <dd className="text-foreground">{commit.date}</dd>
            {parents.length > 0 && (
              <>
                <dt className="text-muted-foreground">父提交</dt>
                <dd
                  className="break-all font-mono text-[11px] leading-relaxed text-foreground"
                  title={parents.join(', ')}
                >
                  {parents.join(', ')}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  )
}

function VerticalResizeHandle({
  onDrag,
  onDragEnd,
  onDoubleClick,
  title: handleTitle,
  className,
}: {
  onDrag: (deltaX: number) => void
  onDragEnd?: () => void
  onDoubleClick?: () => void
  title?: string
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
      aria-label={handleTitle ?? '拖动调整宽度'}
      title={handleTitle}
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
      onDoubleClick={(e) => {
        e.preventDefault()
        onDoubleClick?.()
      }}
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
  /** 提交历史范围：当前分支 HEAD 或全部分支/远程/标签 */
  commitLogScope?: 'head' | 'all'
  onCommitLogScopeChange?: (scope: 'head' | 'all') => void
  /** 「当前分支」模式下查看的引用（本地分支名）；null 表示当前检出 HEAD */
  commitLogRev?: string | null
  onCommitLogRevChange?: (rev: string | null) => void
  /** 下拉可选分支名（通常为本地分支） */
  branchNames?: string[]
  aheadCount?: number
  /** 列表前部为「待拉取」提交时的条数（与 commits 中前置的 incoming 段一致） */
  incomingCommitCount?: number
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
  /** 当前 HEAD 提交短哈希（与列表项 short_id 对齐），用于标记检出位置 */
  headShortId?: string | null
  /** 将仓库重置到指定提交（git reset） */
  onResetToCommit?: (commitId: string, mode: GitResetMode) => Promise<void>
  /** 从指定提交创建分支（可选检出） */
  onCreateBranch?: (branchName: string, checkout: boolean, startPoint?: string) => Promise<boolean>
  /** 列表加载、搜索失败时的提示 */
  listError?: string | null
  hasUpstream?: boolean
  hasOriginRemote?: boolean
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
  commitLogScope = 'head',
  onCommitLogScopeChange,
  commitLogRev = null,
  onCommitLogRevChange,
  branchNames = [],
  aheadCount = 0,
  incomingCommitCount = 0,
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
  currentBranch,
  headShortId,
  onResetToCommit,
  onCreateBranch,
  listError,
  hasUpstream = true,
  hasOriginRemote = true
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
  /** AI 弹窗内：提交列表与完整对话分标签，避免两块内容纵向叠压、滚动嵌套错乱 */
  const [summaryDialogTab, setSummaryDialogTab] = useState<'list' | 'conversation'>('list')
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  /** 重置弹窗目标（可与列表选中项不同，例如仅右键未左键选中时） */
  const [resetTargetCommit, setResetTargetCommit] = useState<CommitInfo | null>(null)
  const [resetMode, setResetMode] = useState<GitResetMode>('mixed')
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const [resetDialogError, setResetDialogError] = useState<string | null>(null)
  const [createBranchDialogOpen, setCreateBranchDialogOpen] = useState(false)
  const [createBranchTargetCommit, setCreateBranchTargetCommit] = useState<CommitInfo | null>(null)
  const [newBranchName, setNewBranchName] = useState('')
  const [createBranchCheckout, setCreateBranchCheckout] = useState(true)
  const [createBranchSubmitting, setCreateBranchSubmitting] = useState(false)
  const [createBranchDialogError, setCreateBranchDialogError] = useState<string | null>(null)
  const [commitContextMenu, setCommitContextMenu] = useState<{
    x: number
    y: number
    commit: CommitInfo
  } | null>(null)
  const commitContextMenuRef = useRef<HTMLDivElement>(null)
  /** 行内「复制短哈希」反馈 */
  const [copiedCommitShortId, setCopiedCommitShortId] = useState<string | null>(null)
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
  const [branchLabelsByCommit, setBranchLabelsByCommit] = useState<
    Map<string, BranchOnCommit[]>
  >(() => new Map())
  /** 与左侧 CommitGraphStrip 行对齐：每行提交条高度（px） */
  const commitRowElsRef = useRef<(HTMLDivElement | null)[]>([])
  const [commitGraphRowHeights, setCommitGraphRowHeights] = useState<number[]>([])
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

  const [diffPanelCollapsed, setDiffPanelCollapsedState] = useState(loadDiffPanelCollapsed)
  const diffPanelCollapsedRef = useRef(diffPanelCollapsed)
  diffPanelCollapsedRef.current = diffPanelCollapsed

  const setDiffPanelCollapsed = useCallback((collapsed: boolean) => {
    setDiffPanelCollapsedState(collapsed)
    saveDiffPanelCollapsed(collapsed)
  }, [])

  const [rightPanelCollapsed, setRightPanelCollapsedState] = useState(loadRightPanelCollapsed)
  const rightPanelCollapsedRef = useRef(rightPanelCollapsed)
  rightPanelCollapsedRef.current = rightPanelCollapsed

  const setRightPanelCollapsed = useCallback((collapsed: boolean) => {
    setRightPanelCollapsedState(collapsed)
    saveRightPanelCollapsed(collapsed)
  }, [])

  const persistPanes = useCallback(() => {
    savePanes(panesRef.current)
  }, [])

  /**
   * 整块右栏折叠时不占宽度；否则差异区折叠时右侧仅需文件列最小宽度。
   */
  const rightPaneMinWidth = useCallback(() => {
    if (rightPanelCollapsedRef.current) return 0
    const s = SPLITTER_PX
    return diffPanelCollapsedRef.current ? MIN_FILE_W : MIN_FILE_W + s + MIN_DIFF_W
  }, [])

  /** 左右分栏：拖动以调整左侧提交列表宽度 */
  const onDragList = useCallback((dx: number) => {
    setPanes(({ list, file }) => {
      const root = rootRef.current
      if (!root) return { list: list + dx, file }
      const cw = root.clientWidth
      const s = SPLITTER_PX
      const minRight = rightPaneMinWidth()
      const maxList = Math.max(MIN_LIST_W, cw - s - minRight)
      const next = Math.max(MIN_LIST_W, Math.min(list + dx, maxList))
      return { list: next, file }
    })
  }, [rightPaneMinWidth])

  /** 双击列表与右侧之间的竖条：恢复默认列表宽度（并限制在当前窗口内） */
  const snapListColumnDefault = useCallback(() => {
    setPanes((prev) => {
      const root = rootRef.current
      if (!root) return prev
      const cw = root.clientWidth
      const s = SPLITTER_PX
      const minRight = rightPaneMinWidth()
      const maxList = Math.max(MIN_LIST_W, cw - s - minRight)
      const target = Math.max(MIN_LIST_W, Math.min(DEFAULT_PANES.list, maxList))
      const next = { list: target, file: prev.file }
      queueMicrotask(() => savePanes(next))
      return next
    })
  }, [rightPaneMinWidth])

  /** 右侧内：文件列与 diff 列之间的拖动（宽度相对于整个窗口计算） */
  const onDragInner = useCallback((dx: number) => {
    setPanes(({ list, file }) => {
      const root = rootRef.current
      if (!root) return { list, file: file + dx }
      const cw = root.clientWidth
      const s = SPLITTER_PX
      const rightW = cw - list - s
      if (rightW <= 0) return { list, file }
      const maxFile = Math.max(MIN_FILE_W, rightW - s - MIN_DIFF_W)
      const next = Math.max(MIN_FILE_W, Math.min(file + dx, maxFile))
      return { list, file: next }
    })
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const ro = new ResizeObserver(() => {
      setPanes(({ list: l, file: f }) => {
        const cw = root.clientWidth
        if (cw <= 0) return { list: l, file: f }
        const s = SPLITTER_PX

        if (rightPanelCollapsedRef.current) {
          const minRightFull = MIN_FILE_W + s + MIN_DIFF_W
          const maxList = Math.max(MIN_LIST_W, cw - s - minRightFull)
          const l2 = Math.max(MIN_LIST_W, Math.min(l, maxList))
          return { list: l2, file: Math.max(MIN_FILE_W, f) }
        }

        const diffCollapsed = diffPanelCollapsedRef.current
        const minRight = diffCollapsed ? MIN_FILE_W : MIN_FILE_W + s + MIN_DIFF_W
        const maxList = Math.max(MIN_LIST_W, cw - s - minRight)
        let l2 = Math.max(MIN_LIST_W, Math.min(l, maxList))
        if (selectedCommit) {
          const rightW = cw - l2 - s
          if (rightW <= 0) return { list: l2, file: f }
          if (diffCollapsed) {
            const f2 = Math.max(MIN_FILE_W, Math.min(f, rightW))
            return { list: l2, file: f2 }
          }
          const maxF = Math.max(MIN_FILE_W, rightW - s - MIN_DIFF_W)
          const f2 = Math.max(MIN_FILE_W, Math.min(f, maxF))
          return { list: l2, file: f2 }
        }
        return { list: l2, file: Math.max(MIN_FILE_W, f) }
      })
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [selectedCommit, diffPanelCollapsed, rightPanelCollapsed])

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
    invoke<number>('get_commit_count_head', {
      repoPath,
      scope: commitLogScope === 'all' ? 'all' : null,
      rev:
        commitLogScope === 'head' && commitLogRev && commitLogRev.trim()
          ? commitLogRev.trim()
          : null,
    })
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
  }, [repoPath, currentBranch, commitLogScope, commitLogRev])

  // 提交列表右键菜单：点击外部、滚动、Esc 关闭
  useEffect(() => {
    if (!commitContextMenu) return
    const close = () => setCommitContextMenu(null)
    const onPointerDown = (e: Event) => {
      const el = commitContextMenuRef.current
      const t = e.target
      if (el && t instanceof Node && !el.contains(t)) close()
    }
    const onScroll = () => close()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [commitContextMenu])

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
  const branchNamesSorted = useMemo(() => {
    if (branchNames.length === 0) return []
    const cur = currentBranch?.trim()
    const set = new Set(branchNames)
    const rest = branchNames
      .filter((n) => n !== cur)
      .sort((a, b) => a.localeCompare(b))
    if (cur && set.has(cur)) {
      return [cur, ...rest]
    }
    return [...branchNames].sort((a, b) => a.localeCompare(b))
  }, [branchNames, currentBranch])

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

  const branchLabelIdsKey = useMemo(
    () => filteredCommits.map((c) => c.id).join(','),
    [filteredCommits]
  )

  // 每个提交在哪些远程跟踪分支历史上（与后端一致，不重复列本地分支）
  useEffect(() => {
    if (!repoPath || filteredCommits.length === 0) {
      setBranchLabelsByCommit(new Map())
      return
    }
    const commitIds = filteredCommits.map((c) => c.id)
    let cancelled = false
    invoke<CommitBranchLabels[]>('get_commits_branch_labels', {
      repoPath,
      commitIds,
    })
      .then((rows) => {
        if (cancelled) return
        const m = new Map<string, BranchOnCommit[]>()
        for (const row of rows) {
          m.set(row.commit_id, row.branches)
        }
        setBranchLabelsByCommit(m)
      })
      .catch(() => {
        if (!cancelled) setBranchLabelsByCommit(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [repoPath, branchLabelIdsKey, currentBranch])

  /** 左侧连线图着色：优先当前分支对应的远程名，否则取列表中第一个分支名 */
  const graphBranchColorByCommit = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of filteredCommits) {
      const labels = branchLabelsByCommit.get(c.id)
      if (!labels?.length) continue
      const prefer =
        labels.find(
          (b) =>
            b.name === `origin/${currentBranch}` ||
            b.name === currentBranch ||
            b.name.endsWith(`/${currentBranch}`)
        ) ?? labels[0]
      m.set(c.id, prefer.name)
    }
    return m
  }, [filteredCommits, branchLabelsByCommit, currentBranch])

  useLayoutEffect(() => {
    const n = filteredCommits.length
    if (n === 0) {
      commitRowElsRef.current = []
      setCommitGraphRowHeights([])
      return
    }
    commitRowElsRef.current.length = n
    const measure = () => {
      const next: number[] = []
      for (let i = 0; i < n; i++) {
        const el = commitRowElsRef.current[i]
        next.push(
          el ? Math.round(el.getBoundingClientRect().height) : COMMIT_GRAPH_ROW_HEIGHT
        )
      }
      setCommitGraphRowHeights((prev) => {
        if (prev.length === next.length && prev.every((v, i) => v === next[i])) {
          return prev
        }
        return next
      })
    }
    measure()
    const ro = new ResizeObserver(() => {
      window.requestAnimationFrame(measure)
    })
    for (let i = 0; i < n; i++) {
      const el = commitRowElsRef.current[i]
      if (el) ro.observe(el)
    }
    return () => ro.disconnect()
  }, [filteredCommits, branchLabelIdsKey, branchLabelsByCommit])

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
    setSummaryDialogTab('list')
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
    setSummaryDialogTab('conversation')
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

  // 待拉取：列表最前 incomingCommitCount 条（与远端领先于 HEAD 的区间一致）
  const pendingPullIds = useMemo(() => {
    const n = Math.max(0, incomingCommitCount)
    if (n <= 0) return new Set<string>()
    return new Set(commits.slice(0, n).map((c) => c.id))
  }, [commits, incomingCommitCount])

  // 待推送：在本地历史段内取前 aheadCount 条（跳过前置的待拉取段）
  const pendingPushIds = useMemo(() => {
    const start = Math.max(0, incomingCommitCount)
    return new Set(commits.slice(start, start + aheadCount).map((c) => c.id))
  }, [commits, aheadCount, incomingCommitCount])

  /** 与 RepoInfo.head_short_id / 列表 short_id 对齐，用于标记当前检出提交 */
  const headShortNormalized = useMemo(
    () => headShortId?.trim().toLowerCase() ?? '',
    [headShortId]
  )
  const isCommitCheckedOut = useCallback(
    (c: CommitInfo) => {
      if (!headShortNormalized) return false
      return (
        c.short_id.toLowerCase() === headShortNormalized ||
        c.id.toLowerCase().startsWith(headShortNormalized)
      )
    },
    [headShortNormalized]
  )

  const copyCommitShortId = useCallback(async (commit: CommitInfo) => {
    try {
      await navigator.clipboard.writeText(commit.short_id)
      setCopiedCommitShortId(commit.id)
      window.setTimeout(() => {
        setCopiedCommitShortId((cur) => (cur === commit.id ? null : cur))
      }, 1500)
    } catch {
      /* 忽略剪贴板不可用 */
    }
  }, [])

  const openResetDialogForCommit = useCallback((commit: CommitInfo) => {
    setResetTargetCommit(commit)
    setResetMode('mixed')
    setResetDialogError(null)
    setResetDialogOpen(true)
  }, [])

  const openCreateBranchDialogForCommit = useCallback((commit: CommitInfo) => {
    setCreateBranchTargetCommit(commit)
    setNewBranchName('')
    setCreateBranchCheckout(true)
    setCreateBranchDialogError(null)
    setCreateBranchDialogOpen(true)
  }, [])

  const handleConfirmCreateBranch = useCallback(async () => {
    if (!onCreateBranch || !createBranchTargetCommit) return
    const name = newBranchName.trim()
    if (!name) {
      setCreateBranchDialogError('分支名不能为空')
      return
    }
    setCreateBranchDialogError(null)
    setCreateBranchSubmitting(true)
    try {
      const ok = await onCreateBranch(name, createBranchCheckout, createBranchTargetCommit.id)
      if (!ok) return
      setCreateBranchDialogOpen(false)
      setCreateBranchTargetCommit(null)
      setNewBranchName('')
    } catch (e) {
      setCreateBranchDialogError(formatTauriInvokeError(e, '创建分支失败'))
    } finally {
      setCreateBranchSubmitting(false)
    }
  }, [onCreateBranch, createBranchTargetCommit, newBranchName, createBranchCheckout])

  const handleConfirmReset = useCallback(async () => {
    if (!onResetToCommit || !resetTargetCommit) return
    setResetDialogError(null)
    setResetSubmitting(true)
    try {
      await onResetToCommit(resetTargetCommit.id, resetMode)
      setResetDialogOpen(false)
      setResetTargetCommit(null)
      setSelectedCommit(null)
      setCommitFiles([])
      setSelectedFile(null)
      setDiff('')
    } catch (e) {
      setResetDialogError(formatTauriInvokeError(e, '重置失败'))
    } finally {
      setResetSubmitting(false)
    }
  }, [onResetToCommit, resetTargetCommit, resetMode])

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

  // 文件项：首行文件名 + 状态/增删，次行目录路径，减少单行截断与卡片高度
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

    const { dir, base } = splitRepoPath(file.path)

    return (
      <div
        className={cn(
          'cursor-pointer rounded-md border px-2 py-1.5 transition-colors',
          isSelected
            ? 'border-primary bg-accent shadow-sm ring-1 ring-primary/20'
            : 'border-border/35 hover:border-border/50 hover:bg-accent/50'
        )}
        onClick={handleClick}
        title={file.path}
      >
        <div className="flex gap-2">
          <div className="shrink-0 pt-0.5">{getStatusIcon(file.status)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <p
                className="min-w-0 truncate text-sm font-medium leading-tight text-foreground"
                title={file.path}
              >
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
                className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground"
                title={file.path}
              >
                {dir}
              </p>
            ) : null}
          </div>
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
        style={rightPanelCollapsed ? undefined : { width: panes.list }}
        className={cn(
          'flex min-h-0 min-w-0 flex-col overflow-hidden',
          rightPanelCollapsed ? 'min-w-0 flex-1' : 'shrink-0'
        )}
      >
        <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border-border/45 bg-card shadow-none dark:border-white/[0.07] dark:bg-zinc-950/40">
          <CardHeader className="space-y-1.5 border-b border-border/35 bg-muted/15 px-2.5 py-2 sm:px-3 dark:bg-muted/5">
            {/* 标题单独一行，避免与多行筛选区并排时 items-center 把标题挤到日期行中间造成重叠 */}
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <CardTitle className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  提交记录
                </CardTitle>
                {onCommitLogScopeChange && (
                  <div
                    className="flex h-6 shrink-0 rounded-md border border-border/50 bg-background/70 p-0.5 dark:bg-background/40"
                    role="group"
                    aria-label="提交历史范围"
                  >
                    <button
                      type="button"
                      className={cn(
                        'whitespace-nowrap rounded px-2 py-0 text-xs font-medium transition-colors',
                        commitLogScope === 'head'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => onCommitLogScopeChange('head')}
                      title="仅当前检出分支（HEAD）的提交历史"
                    >
                      当前分支
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'whitespace-nowrap rounded px-2 py-0 text-xs font-medium transition-colors',
                        commitLogScope === 'all'
                          ? 'bg-background text-foreground shadow-sm ring-1 ring-primary/40'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => onCommitLogScopeChange('all')}
                      title="本地分支、远程跟踪与标签的合并历史"
                    >
                      全部分支
                    </button>
                  </div>
                )}
                {commitLogScope === 'head' &&
                  onCommitLogRevChange &&
                  branchNamesSorted.length > 0 && (
                    <select
                      className="h-6 max-w-[11rem] shrink rounded-md border border-input bg-background px-1.5 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={commitLogRev ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        onCommitLogRevChange(v === '' ? null : v)
                      }}
                      title="查看任意本地分支的提交历史（无需切换检出）"
                      aria-label="选择要查看的历史分支"
                    >
                      <option value="">当前检出</option>
                      {branchNamesSorted.map((name) => (
                        <option key={name} value={`refs/heads/${name}`}>
                          {name}
                        </option>
                      ))}
                    </select>
                  )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!rightPanelCollapsed ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setRightPanelCollapsed(true)}
                    title="隐藏右侧（提交摘要、文件列表、差异），仅保留本列表"
                  >
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    <span className="hidden sm:inline">仅列表</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 shrink-0 gap-1 px-2 text-xs"
                    onClick={() => setRightPanelCollapsed(false)}
                    title="恢复右侧提交详情与变更"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                    <span className="hidden sm:inline">显示详情</span>
                  </Button>
                )}
                {hasActiveFilters && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={clearAllFilters}
                  >
                    清空筛选
                  </Button>
                )}
              </div>
            </div>
            {commitLogScope === 'all' && (
              <details className="text-[10px] leading-tight text-muted-foreground">
                <summary className="cursor-pointer select-none list-none rounded-sm px-0 py-0 [&::-webkit-details-marker]:hidden hover:text-foreground">
                  <span className="font-medium text-foreground/85">全部分支</span>
                  <span className="opacity-90"> 提交旁标签仅显示远程跟踪分支</span>
                  <span className="text-primary/70"> · 展开说明</span>
                </summary>
                <p className="mt-0.5 pl-0 text-[10px] text-muted-foreground">
                  历史范围仍为各本地分支、远程跟踪与标签可达的合并历史；每条提交旁的分支名仅列远程跟踪（如 origin/…），避免与本地同名重复。
                </p>
              </details>
            )}
            <div className="flex min-w-0 flex-nowrap items-center gap-x-1 gap-y-0 overflow-x-auto overflow-y-hidden rounded-md border border-border/40 bg-background/55 py-0.5 pl-1 pr-0.5 scrollbar-thin scrollbar-thumb-muted-foreground/25 scrollbar-track-transparent dark:border-white/[0.06] dark:bg-background/25 dark:scrollbar-thumb-muted-foreground/30">
              <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-muted-foreground">
                <Calendar className="h-3 w-3 shrink-0" aria-hidden />
                日期
              </span>
              <div className="grid w-[9.5rem] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-0.5 sm:w-[10.5rem]">
                <CommitDatePickerButton
                  value={pendingStart}
                  onChange={setPendingStart}
                  placeholder="开始"
                  title="开始日期"
                  className="h-6 min-w-0 w-full max-w-none justify-start px-1.5 text-xs"
                />
                <span className="shrink-0 px-0 text-center text-[10px] text-muted-foreground">
                  至
                </span>
                <CommitDatePickerButton
                  value={pendingEnd}
                  onChange={setPendingEnd}
                  placeholder="结束"
                  title="结束日期"
                  className="h-6 min-w-0 w-full max-w-none justify-start px-1.5 text-xs"
                />
              </div>
              <span className="shrink-0 text-[10px] font-medium text-muted-foreground">关键词</span>
              <div className="relative min-h-6 min-w-[5rem] flex-1">
                  <Search className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="已加载列表内筛选，Enter"
                    value={pendingSearch}
                    onChange={(e) => setPendingSearch(e.target.value)}
                    className="h-6 w-full min-w-0 border-border/70 bg-background/80 py-0 pl-6 pr-1 text-xs"
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
                    variant="secondary"
                    size="sm"
                    className="h-6 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs"
                    disabled={searchLoading}
                    onClick={() => onSearchFullRepo?.(pendingSearch.trim())}
                    title="在整个仓库历史中搜索关键词"
                  >
                    {searchLoading ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 shrink-0 animate-spin" />
                        <span className="hidden sm:inline">搜索中</span>
                      </>
                    ) : (
                      '全库'
                    )}
                  </Button>
                )}
                {isSearchMode && (
                  <>
                    <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">全库</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 px-1.5 text-[10px] sm:text-xs"
                      onClick={() => {
                        setPendingSearch('')
                        onClearSearchMode?.()
                      }}
                    >
                      恢复
                    </Button>
                  </>
                )}
              <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-0.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-6 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs"
                    onClick={() => {
                      const ymd = formatLocalYmd(new Date())
                      setPendingStart(ymd)
                      setPendingEnd(ymd)
                      setAppliedStart(ymd)
                      setAppliedEnd(ymd)
                      setAppliedSearch(pendingSearch)
                    }}
                    title="开始与结束均设为今天并立即筛选"
                  >
                    今日
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-6 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs"
                    onClick={() => {
                      const end = new Date()
                      const start = new Date(end)
                      start.setDate(start.getDate() - 6)
                      setPendingStart(formatLocalYmd(start))
                      setPendingEnd(formatLocalYmd(end))
                    }}
                    title="含今日共 7 个自然日"
                  >
                    7天
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-6 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs"
                    disabled={!canApplyFilters}
                    onClick={applyFilters}
                    title="将当前日期与关键词应用到列表筛选"
                  >
                    查询
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                    disabled={filteredCommits.length === 0}
                    onClick={openCommitListDialog}
                    title="列出当前筛选下已加载的全部提交（时间升序），便于复制"
                    aria-label="提交列表"
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                  </Button>
              </div>
            </div>
            {listError && (
              <p className="mb-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {listError}
              </p>
            )}
            <RemoteSyncBar
              ahead={aheadCount}
              behind={behindCount}
              hasUpstream={hasUpstream}
              hasOriginRemote={hasOriginRemote}
              disabled={syncBusy}
              onFetchChanges={onFetchChanges}
              onPullChanges={onPullChanges}
              onPushChanges={onPushChanges}
              onRefresh={onRefreshRepo}
              refreshTitle="刷新仓库与提交列表"
              density="compact"
              className="mt-0 border-0 bg-transparent"
            />
            <p
              className="px-0.5 pb-0 pt-1 text-[10px] leading-snug text-muted-foreground/80 dark:text-muted-foreground/90"
              title={
                commitLogScope === 'all'
                  ? '「已加载」为当前列表条数，可继续加载。总数为所有本地分支、远程跟踪与标签可达的去重提交数（与 git log --all 类似）。'
                  : commitLogRev
                    ? `「已加载」为当前列表条数。所选分支「${shortLocalBranchRef(commitLogRev)}」的可达提交总数与 git rev-list --count ${commitLogRev} 一致。`
                    : '「已加载」为当前列表中的条数，可向下滚动继续加载。「当前分支」总数为 HEAD 可达提交数（与 git rev-list --count HEAD 一致），含合并带来的历史。'
              }
            >
              {isSearchMode ? (
                <>
                  全仓库搜索到 {commits.length} 条
                  {headCommitTotalLoading && ' · 统计分支总数中…'}
                  {!headCommitTotalLoading && headCommitTotal !== null && (
                    <>
                      {' '}
                      ·{' '}
                      {commitLogScope === 'all'
                        ? `全部引用共 ${headCommitTotal} 个提交`
                        : commitLogRev
                          ? `分支「${shortLocalBranchRef(commitLogRev)}」共 ${headCommitTotal} 个提交`
                          : `当前分支共 ${headCommitTotal} 个提交`}
                    </>
                  )}
                  {headShortNormalized && (
                    <>
                      {' '}
                      · 当前检出{' '}
                      <span className="font-mono text-foreground" title="工作区基于此提交（HEAD）">
                        HEAD {headShortId?.trim()}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <>
                  已加载 {commits.length} 条
                  {hasMore && '（列表可继续下拉加载）'}
                  {headCommitTotalLoading && ' · 统计分支总数中…'}
                  {!headCommitTotalLoading && headCommitTotal !== null && (
                    <>
                      {' '}
                      ·{' '}
                      {commitLogScope === 'all'
                        ? `全部引用共 ${headCommitTotal} 个提交`
                        : commitLogRev
                          ? `分支「${shortLocalBranchRef(commitLogRev)}」共 ${headCommitTotal} 个提交`
                          : `当前分支共 ${headCommitTotal} 个提交`}
                    </>
                  )}
                  {filteredCommits.length !== commits.length && (
                    <> · 筛选后显示 {filteredCommits.length} 条</>
                  )}
                  {headShortNormalized && (
                    <>
                      {' '}
                      · 当前检出{' '}
                      <span className="font-mono text-foreground" title="工作区基于此提交（HEAD）">
                        HEAD {headShortId?.trim()}
                      </span>
                    </>
                  )}
                </>
              )}
            </p>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
            <div
              ref={commitListScrollRef}
              className="h-full min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-400/30 scrollbar-track-transparent dark:scrollbar-thumb-zinc-600/35"
            >
              {filteredCommits.length === 0 ? (
                <div className="flex min-h-[10rem] flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                  <GitBranch className="h-10 w-10 text-muted-foreground/35" aria-hidden />
                  <p className="text-xs font-medium text-muted-foreground">暂无提交</p>
                  <p className="max-w-[14rem] text-[11px] leading-relaxed text-muted-foreground/75">
                    尚无记录，或当前日期与关键词筛选结果为空。可调整筛选或拉取远程历史后重试。
                  </p>
                </div>
              ) : (
              <div className="flex min-w-0 flex-row items-stretch">
                <CommitGraphStrip
                  className="border-r border-border/35 bg-muted/20 pl-0.5 pr-0.5 dark:bg-muted/10"
                  commits={filteredCommits}
                  branchColorKeyByCommitId={graphBranchColorByCommit}
                  rowHeights={
                    commitGraphRowHeights.length === filteredCommits.length
                      ? commitGraphRowHeights
                      : undefined
                  }
                />
                <div className="flex min-w-0 flex-1 flex-col">
              {filteredCommits.map((commit, i) => {
                const atHead = isCommitCheckedOut(commit)
                const branchLabels = branchLabelsByCommit.get(commit.id)
                /** 宽屏一行可排更多标签；仅作上限，窄屏仍由 flex-wrap 换行 */
                const maxBranchBadges = 20
                const shownBranches = branchLabels?.slice(0, maxBranchBadges)
                const moreBranchCount =
                  branchLabels && branchLabels.length > maxBranchBadges
                    ? branchLabels.length - maxBranchBadges
                    : 0
                const allBranchesTitle =
                  branchLabels && branchLabels.length > 0
                    ? branchLabels
                        .map((b) => `${b.is_remote ? '远程' : '本地'} ${b.name}`)
                        .join('\n')
                    : undefined
                const isRowSelected = selectedCommit?.id === commit.id

                return (
                <div
                  key={commit.id}
                  ref={(el) => {
                    commitRowElsRef.current[i] = el
                  }}
                  className={cn(
                    'group relative flex min-h-[2.65rem] shrink-0 cursor-pointer flex-col justify-center border-b border-border/25 transition-colors duration-100 last:border-b-0',
                    atHead &&
                      'bg-emerald-500/[0.07] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-emerald-500/85 before:content-[""] dark:bg-emerald-500/[0.09] dark:before:bg-emerald-400/80',
                    !atHead && isRowSelected && 'bg-primary/[0.09] ring-1 ring-inset ring-primary/18 dark:bg-primary/[0.12]',
                    atHead &&
                      isRowSelected &&
                      'bg-emerald-500/[0.11] ring-1 ring-inset ring-emerald-500/25 dark:bg-emerald-500/[0.13]',
                    !isRowSelected && 'hover:bg-muted/35 dark:hover:bg-muted/15'
                  )}
                  onClick={() => handleCommitSelect(commit)}
                  onContextMenu={(e) => {
                    if (!onResetToCommit && !onCreateBranch) return
                    e.preventDefault()
                    e.stopPropagation()
                    setCommitContextMenu({ x: e.clientX, y: e.clientY, commit })
                  }}
                >
                  <div className="relative min-h-0 pr-1 pl-3 pt-1 pb-1 sm:pr-2">
                    {/* 悬停操作：复制哈希 / 重置（与右键菜单一致） */}
                    <div className="pointer-events-none absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="复制短哈希"
                        aria-label="复制短哈希"
                        onClick={(e) => {
                          e.stopPropagation()
                          void copyCommitShortId(commit)
                        }}
                      >
                        {copiedCommitShortId === commit.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                        ) : (
                          <Copy className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </Button>
                      {onResetToCommit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-40"
                          disabled={syncBusy || atHead}
                          title={
                            atHead
                              ? '工作区已在此提交'
                              : '重置到此提交…'
                          }
                          aria-label="重置到此提交"
                          onClick={(e) => {
                            e.stopPropagation()
                            openResetDialogForCommit(commit)
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      )}
                    </div>

                    <div className="min-w-0 space-y-0.5 pr-[4.25rem]">
                      <div className="flex items-start gap-2">
                        <p
                          className="line-clamp-1 min-w-0 flex-1 text-[13px] font-medium leading-tight tracking-tight text-foreground/95"
                          title={commit.message}
                        >
                          {commit.message}
                        </p>
                        <span className="mt-px shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/90">
                          {commit.short_id}
                        </span>
                      </div>

                      <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                        <span className="min-w-0 truncate">{commit.author}</span>
                        <span className="shrink-0 opacity-40">·</span>
                        <span className="shrink-0 tabular-nums opacity-90">{commit.date}</span>
                      </div>

                      {(atHead ||
                        (shownBranches && shownBranches.length > 0) ||
                        moreBranchCount > 0 ||
                        pendingPullIds.has(commit.id) ||
                        pendingPushIds.has(commit.id)) && (
                        <div className="flex min-w-0 flex-wrap items-center gap-0.5 pt-0.5">
                          {atHead && (
                            <span
                              className="inline-flex shrink-0 items-center rounded border border-emerald-500/35 bg-emerald-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300/95"
                              title="当前工作区检出（HEAD）"
                            >
                              HEAD
                            </span>
                          )}
                          {shownBranches?.map((b) => (
                            <Badge
                              key={`${b.name}-${b.is_remote ? 'r' : 'l'}`}
                              variant="outline"
                              className={cn(
                                'h-4 max-w-[9rem] shrink-0 border-border/50 bg-background/40 px-1 py-0 text-[9px] font-medium leading-none',
                                branchBadgeClassName(b.name)
                              )}
                              title={
                                b.is_remote ? `远程分支：${b.name}` : `本地分支：${b.name}`
                              }
                            >
                              {formatBranchLabelShort(b.name)}
                            </Badge>
                          ))}
                          {moreBranchCount > 0 && (
                            <span
                              className="shrink-0 text-[9px] text-muted-foreground"
                              title={allBranchesTitle}
                            >
                              +{moreBranchCount}
                            </span>
                          )}
                          {pendingPullIds.has(commit.id) && (
                            <span
                              className="inline-flex shrink-0 rounded border border-amber-500/30 bg-amber-500/12 px-1 py-px text-[9px] font-medium text-amber-900 dark:text-amber-200/95"
                              title="远程已有、本地尚未拉取合并的提交"
                            >
                              待拉取
                            </span>
                          )}
                          {pendingPushIds.has(commit.id) && (
                            <span className="inline-flex shrink-0 rounded border border-blue-500/30 bg-blue-500/12 px-1 py-px text-[9px] font-medium text-blue-900 dark:text-blue-200/95">
                              待推送
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                )
              })}
                </div>
              </div>
              )}
                {hasMore && (
                  <div ref={loadMoreSentinelRef} className="h-2 shrink-0" aria-hidden="true" />
                )}
                {hasMore && (
                  <div className="flex justify-center border-t border-border/30 bg-muted/5 py-1.5 dark:bg-transparent">
                    <Button
                      onClick={onLoadMore}
                      disabled={loading}
                      variant="ghost"
                      className="flex h-7 items-center gap-1.5 px-3 text-xs text-muted-foreground hover:text-foreground"
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
      {!rightPanelCollapsed && (
        <>
      <VerticalResizeHandle
        onDrag={onDragList}
        onDragEnd={persistPanes}
        onDoubleClick={snapListColumnDefault}
        title="拖动调整左侧提交列表宽度；双击恢复为默认宽度"
      />
      {/* 右侧：与提交列表等高；未选为占位，选中为详情 + 文件 | diff */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!selectedCommit ? (
          <Card className="flex h-full min-h-0 flex-1 flex-col border-border/80">
            <CardContent className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center text-muted-foreground">
              <GitCompare className="h-14 w-14 shrink-0 opacity-40" />
              <p className="text-sm font-medium text-foreground">选择提交查看变更</p>
                <p className="max-w-sm text-xs leading-relaxed opacity-80">
                  在左侧提交记录中点击任意一条，右侧将显示该提交的说明与文件列表。可拖动中间竖条调整列表宽度。在提交项上右键可选择「从此提交创建分支」或「重置到此提交」。
                </p>
              </CardContent>
            </Card>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <CommitDetailStrip commit={selectedCommit} />
            <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
            {/* 文件变更 */}
            <div
              style={diffPanelCollapsed ? undefined : { width: panes.file }}
              className={cn(
                'flex min-h-0 flex-col overflow-hidden',
                diffPanelCollapsed ? 'min-w-0 flex-1' : 'shrink-0'
              )}
            >
              <Card className="flex h-full min-h-0 flex-col border-border/45 dark:border-white/[0.07]">
                <CardHeader className="flex-shrink-0 border-b border-border/35 py-2 pl-2.5 pr-2 sm:pl-3">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                      <FileText className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                      <span className="truncate">文件变更</span>
                      {commitFiles.length > 0 && (
                        <span className="shrink-0 font-normal text-muted-foreground">
                          ({commitFiles.length})
                        </span>
                      )}
                    </CardTitle>
                    {diffPanelCollapsed && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 gap-1 px-2 text-xs"
                        onClick={() => setDiffPanelCollapsed(false)}
                        title="展开右侧代码差异面板"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                        显示差异
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 overflow-hidden px-2 py-1.5 sm:px-2.5">
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

            {!diffPanelCollapsed && (
              <>
            <VerticalResizeHandle
              onDrag={onDragInner}
              onDragEnd={persistPanes}
              title="拖动调整文件列表与差异区宽度"
            />

            {/* 代码差异 */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <Card className="flex h-full min-h-0 flex-col border-border/80">
                <CardHeader className="flex-shrink-0 py-1 sm:pr-2">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <CardTitle
                      className="min-w-0 flex-1 truncate text-base"
                      title={selectedFile || undefined}
                    >
                      {selectedFile ? selectedFile : '代码差异'}
                    </CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 gap-0.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setDiffPanelCollapsed(true)}
                      title="收起代码差异区，便于查看提交记录与文件列表"
                    >
                      收起差异
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </Button>
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
                  ) : (
                    /* 固定同一套 DOM，避免 loading 切换时卸载/重挂 Monaco（否则会闪一帧深色画布像「黑框」） */
                    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-gray-900">
                      {diff ? (
                        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                          <VSCodeDiff
                            diff={diff}
                            filePath={selectedFile}
                            repoPath={repoPath || ''}
                          />
                        </div>
                      ) : !loadingDiff ? (
                        <div className="flex flex-1 flex-col items-center justify-center py-8">
                          <p className="text-muted-foreground">无法加载文件差异</p>
                        </div>
                      ) : null}
                      {loadingDiff && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                          <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-sm">加载中...</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
              </>
            )}
            </div>
          </div>
        )}
      </div>
        </>
      )}

      {commitContextMenu &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={commitContextMenuRef}
            role="menu"
            data-app-interactive-overlay=""
            className="fixed z-[200] min-w-[11rem] rounded-lg border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg shadow-black/20 outline-none backdrop-blur-sm dark:border-white/[0.08] dark:shadow-black/50"
            style={{
              left: Math.min(Math.max(6, commitContextMenu.x), window.innerWidth - 220),
              top: Math.min(
                Math.max(6, commitContextMenu.y),
                window.innerHeight - (onCreateBranch && onResetToCommit ? 104 : 56)
              ),
            }}
          >
            {onCreateBranch && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm text-foreground hover:bg-accent"
                title="从该提交创建新分支"
                onClick={() => {
                  openCreateBranchDialogForCommit(commitContextMenu.commit)
                  setCommitContextMenu(null)
                }}
              >
                <GitBranch className="h-3.5 w-3.5 shrink-0" />
                从此提交创建分支
              </button>
            )}
            {onResetToCommit && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={syncBusy || isCommitCheckedOut(commitContextMenu.commit)}
                title={
                  isCommitCheckedOut(commitContextMenu.commit)
                    ? '工作区已在此提交'
                    : '将分支重置到该提交（与 git reset 一致）'
                }
                onClick={() => {
                  openResetDialogForCommit(commitContextMenu.commit)
                  setCommitContextMenu(null)
                }}
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                重置到此提交
              </button>
            )}
          </div>,
          document.body
        )}

      <Dialog
        open={summaryOpen}
        onOpenChange={(open) => {
          setSummaryOpen(open)
          if (!open) {
            setCommitListCopied(false)
            setSummaryConversationMessages(null)
            setSummaryDialogTab('list')
          }
        }}
      >
        <DialogContent
          className={cn(
            'flex max-h-[85vh] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl',
            // 明确高度，让 flex 子项 min-h-0 + overflow 生效，避免内容叠成一层
            'h-[min(85vh,800px)]'
          )}
        >
          <DialogHeader className="shrink-0 border-b border-border/60 bg-background px-6 pb-3 pt-6 pr-12">
            <DialogTitle>
              {summaryIncludeAi ? '提交记录 · AI 总结' : '提交记录 · 列表'}
            </DialogTitle>
            <p className="pt-1 text-xs text-muted-foreground">
              当前筛选下、列表中已加载 {filteredCommits.length} 条（时间升序排列）。若需更长历史请先下拉「加载更多」。
            </p>
          </DialogHeader>

          {summaryIncludeAi ? (
            <div className="flex shrink-0 gap-1 border-b border-border bg-background px-6 py-2">
              <button
                type="button"
                onClick={() => setSummaryDialogTab('list')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  summaryDialogTab === 'list'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                提交列表
              </button>
              <button
                type="button"
                onClick={() => setSummaryDialogTab('conversation')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  summaryDialogTab === 'conversation'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                完整对话
              </button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-hidden bg-background">
            {(!summaryIncludeAi || summaryDialogTab === 'list') && (
              <div className="h-full min-h-0 overflow-y-auto overscroll-contain px-6 pb-6 pt-4">
                <div className="relative z-0 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">全部提交（可复制）</p>
                      <p className="text-xs text-muted-foreground">
                        每行格式：序号 · 日期 · 短哈希 · 作者 · 说明。可全选复制。
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
                    className={cn(
                      'box-border min-h-[min(50vh,420px)] w-full resize-y rounded-md border border-input bg-muted px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      summaryIncludeAi ? 'max-h-[min(58vh,480px)]' : 'max-h-[min(65vh,560px)]'
                    )}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>

                {!summaryIncludeAi ? (
                  <div className="mt-6 border-t border-border pt-5">
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
                ) : null}
              </div>
            )}

            {summaryIncludeAi && summaryDialogTab === 'conversation' && (
              <div
                ref={aiSummaryScrollRef}
                className="h-full min-h-0 overflow-y-auto overscroll-contain px-6 pb-6 pt-4"
              >
                <p className="mb-2 text-sm font-medium">完整对话</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  发往模型的系统提示、用户消息与助手回复（流式）。用户侧长列表见「提交列表」标签。
                </p>
                <div className="space-y-4 rounded-md border border-border bg-muted p-3">
                  {summaryConversationMessages?.map((m, idx) => (
                    <div key={`${m.role}-${idx}`} className="space-y-1.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {m.role === 'system' ? '系统' : m.role === 'user' ? '用户' : m.role}
                      </div>
                      {m.role === 'user' ? (
                        <div className="rounded-md border border-border bg-background px-3 py-2 text-xs leading-relaxed text-foreground">
                          <p>以下为当前筛选范围内的提交记录。</p>
                          <p className="mt-1.5 text-muted-foreground">
                            完整条目与「提交列表」标签内文本一致（共 {filteredCommits.length}{' '}
                            条），此处不重复展开。
                          </p>
                        </div>
                      ) : (
                        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background px-3 py-2 font-sans text-xs leading-relaxed">
                          {m.content}
                        </pre>
                      )}
                    </div>
                  ))}
                  <div className="space-y-2 border-t border-border pt-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      助手
                    </div>
                    {summaryLoading && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        <span>正在流式生成…</span>
                      </div>
                    )}
                    {summaryError && (
                      <p className="whitespace-pre-wrap text-xs text-destructive">{summaryError}</p>
                    )}
                    {summaryText ? (
                      <div className="whitespace-pre-wrap rounded-md border border-primary/30 bg-background px-3 py-2 text-xs leading-relaxed">
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
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetDialogOpen}
        onOpenChange={(open) => {
          setResetDialogOpen(open)
          if (!open) {
            setResetDialogError(null)
            setResetTargetCommit(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>重置到该提交</DialogTitle>
          </DialogHeader>
          {resetTargetCommit && (
            <div className="space-y-4 text-sm">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <p className="font-mono text-xs text-muted-foreground">{resetTargetCommit.short_id}</p>
                <p className="mt-1 line-clamp-2 text-foreground" title={resetTargetCommit.message}>
                  {resetTargetCommit.message.split('\n')[0]}
                </p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                与命令行 <span className="font-mono">git reset</span> 一致。硬重置会丢弃未提交的本地修改，请谨慎选择。
              </p>
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="reset-mode"
                    id="reset-soft"
                    checked={resetMode === 'soft'}
                    onChange={() => setResetMode('soft')}
                    className="mt-1"
                  />
                  <div className="min-w-0">
                    <Label htmlFor="reset-soft" className="cursor-pointer font-medium">
                      软重置（--soft）
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      只移动 HEAD，暂存区与工作区不变；提交记录「撤销」但改动仍保留在暂存区。
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="reset-mode"
                    id="reset-mixed"
                    checked={resetMode === 'mixed'}
                    onChange={() => setResetMode('mixed')}
                    className="mt-1"
                  />
                  <div className="min-w-0">
                    <Label htmlFor="reset-mixed" className="cursor-pointer font-medium">
                      混合重置（--mixed，默认）
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      移动 HEAD 并取消暂存；工作区文件保留为未暂存修改。
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                  <input
                    type="radio"
                    name="reset-mode"
                    id="reset-hard"
                    checked={resetMode === 'hard'}
                    onChange={() => setResetMode('hard')}
                    className="mt-1"
                  />
                  <div className="min-w-0">
                    <Label htmlFor="reset-hard" className="cursor-pointer font-medium text-destructive">
                      硬重置（--hard）
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      HEAD、暂存区与工作区均与目标提交一致；本地未提交修改将丢失。
                    </p>
                  </div>
                </div>
              </div>
              {resetDialogError && (
                <p className="whitespace-pre-wrap text-xs text-destructive">{resetDialogError}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setResetDialogOpen(false)}
                  disabled={resetSubmitting}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={resetMode === 'hard' ? 'destructive' : 'default'}
                  onClick={() => void handleConfirmReset()}
                  disabled={resetSubmitting}
                >
                  {resetSubmitting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      执行中…
                    </span>
                  ) : (
                    '确认重置'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={createBranchDialogOpen}
        onOpenChange={(open) => {
          setCreateBranchDialogOpen(open)
          if (!open) {
            setCreateBranchDialogError(null)
            setCreateBranchTargetCommit(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>从该提交创建分支</DialogTitle>
          </DialogHeader>
          {createBranchTargetCommit && (
            <div className="space-y-4 text-sm">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <p className="font-mono text-xs text-muted-foreground">{createBranchTargetCommit.short_id}</p>
                <p className="mt-1 line-clamp-2 text-foreground" title={createBranchTargetCommit.message}>
                  {createBranchTargetCommit.message.split('\n')[0]}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="context-new-branch-name">分支名</Label>
                <Input
                  id="context-new-branch-name"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="例如 feature/login"
                  autoFocus
                  disabled={createBranchSubmitting}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleConfirmCreateBranch()
                  }}
                />
              </div>
              <label
                htmlFor="context-create-branch-checkout"
                className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="text-sm font-normal text-foreground">创建后切换到新分支</span>
                <input
                  id="context-create-branch-checkout"
                  type="checkbox"
                  checked={createBranchCheckout}
                  onChange={(e) => setCreateBranchCheckout(e.target.checked)}
                  disabled={createBranchSubmitting}
                />
              </label>
              {createBranchDialogError && (
                <p className="whitespace-pre-wrap text-xs text-destructive">{createBranchDialogError}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateBranchDialogOpen(false)}
                  disabled={createBranchSubmitting}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleConfirmCreateBranch()}
                  disabled={createBranchSubmitting || !newBranchName.trim()}
                >
                  {createBranchSubmitting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      创建中…
                    </span>
                  ) : (
                    '创建分支'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
