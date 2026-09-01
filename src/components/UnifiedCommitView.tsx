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
  Info,
  X,
  ArrowDown,
  ArrowUp,
  GitPullRequest,
} from 'lucide-react'
import {
  CommitInfo,
  FileChange,
  type GitResetMode,
  type BranchOnCommit,
  type BranchInfo,
  type BranchRefTip,
  type CommitBranchLabels,
  type BranchSyncStatus,
} from '../types/git'
import { VSCodeDiff } from './CodeDiff'
import { RemoteSyncBar } from './RemoteSyncBar'
import { cn } from '../lib/utils'
import { invoke } from '@tauri-apps/api/tauri'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { CommitDatePickerButton } from './CommitDatePickerButton'
import { formatLocalYmd } from '../utils/dateYmd'
import {
  branchBadgeClassName,
  branchRevSpec,
  formatBranchLabelShort,
  refsSameBranchLine,
  shortBranchRef,
} from '../utils/branchDisplayName'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Label } from './ui/label'
import { formatTauriInvokeError } from '../utils/tauriError'
import { splitRepoPath } from '../utils/splitRepoPath'
import {
  FileChangeFilterBar,
  countFileChangeStatuses,
  filterFileChanges,
  isFileFilterActive,
  type FileStatusFilter,
} from './FileChangeFilterBar'
import { CommitGraphStrip, COMMIT_GRAPH_ROW_HEIGHT } from './CommitGraphStrip'
import { SimpleSelect } from './SimpleSelect'

/** 提交页分栏：左侧提交列表宽度 list；右侧内「文件列表 | diff」中文件列宽度 file */
const PANES_STORAGE_KEY = 'gitlite:unifiedCommitView:panes'
const SPLITTER_PX = 6
const MIN_LIST_W = 240
const MIN_FILE_W = 160
const MIN_DIFF_W = 240
const DEFAULT_PANES = { list: 340, file: 240 } as const

/** 左侧「每分支一竖线」最多占多少列，避免极多远程分支时图过宽 */
const MAX_BRANCH_RAIL_COLS = 40

/** 行内 tip 徽章点击时，对齐到左侧竖线所用的远程跟踪名 */
function resolveGraphRailName(name: string, rails: readonly string[]): string {
  if (rails.includes(name)) return name
  if (!name.includes('/')) {
    const origin = `origin/${name}`
    if (rails.includes(origin)) return origin
    const hit = rails.find((r) => r.endsWith(`/${name}`))
    if (hit) return hit
  }
  return name
}

function tipMatchesGraphRail(tip: BranchOnCommit, rail: string): boolean {
  if (tip.name === rail) return true
  if (!tip.is_remote && (rail === `origin/${tip.name}` || rail.endsWith(`/${tip.name}`))) {
    return true
  }
  if (tip.is_remote && !rail.includes('/') && tip.name.endsWith(`/${rail}`)) {
    return true
  }
  return false
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
            className="line-clamp-1 text-sm font-semibold leading-snug tracking-tight text-foreground"
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
  /** 「当前分支」模式下查看的引用；null 表示当前检出 HEAD */
  commitLogRev?: string | null
  onCommitLogRevChange?: (rev: string | null) => void
  /** 下拉可选分支（含本地与远程跟踪） */
  branches?: BranchInfo[]
  aheadCount?: number
  /** 列表前部为「待拉取」提交时的条数（与 commits 中前置的 incoming 段一致） */
  incomingCommitCount?: number
  behindCount?: number
  onFetchChanges?: () => void
  onPullChanges?: () => void
  onPushChanges?: () => void
  onRefreshRepo?: () => void
  /** 将下拉中的非检出本地分支快进到上游（不切换工作区） */
  onFastForwardViewedBranch?: (branchName: string) => Promise<boolean>
  /** 切换到该分支并拉取（本地与远程已分叉时） */
  onCheckoutAndPullViewedBranch?: (branchName: string) => Promise<boolean>
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
  /** 在当前分支应用指定提交（git cherry-pick） */
  onCherryPickCommit?: (commitId: string) => Promise<boolean>
  /** 反做指定提交（git revert） */
  onRevertCommit?: (commitId: string) => Promise<boolean>
  /** 将当前分支 rebase 到指定提交（git rebase <onto>） */
  onRebaseToCommit?: (ontoCommitId: string) => Promise<boolean>
  /** 列表加载、搜索失败时的提示 */
  listError?: string | null
  hasUpstream?: boolean
  hasOriginRemote?: boolean
  /** 外部请求：切换到提交页后选中某条提交（例如统计报表联动） */
  jumpToCommitRequest?: { commit: CommitInfo; seq: number } | null
  /** 外部请求已完成消费（用于上层清理请求，避免重复消费） */
  onJumpToCommitConsumed?: (payload: { seq: number; commitId: string }) => void
  /** 外部跳转进行中时临时关闭 IO 自动补载，避免定位后被后续列表变化覆盖 */
  suspendAutoLoadMore?: boolean
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
  branches = [],
  aheadCount = 0,
  incomingCommitCount = 0,
  behindCount,
  onFetchChanges,
  onPullChanges,
  onPushChanges,
  onRefreshRepo,
  onFastForwardViewedBranch,
  onCheckoutAndPullViewedBranch,
  syncBusy = false,
  onGetCommitFiles,
  onGetDiff,
  onGetSingleFileDiff,
  repoPath,
  currentBranch,
  headShortId,
  onResetToCommit,
  onCreateBranch,
  onCherryPickCommit,
  onRevertCommit,
  onRebaseToCommit,
  listError,
  hasUpstream = true,
  hasOriginRemote = true,
  jumpToCommitRequest = null,
  onJumpToCommitConsumed,
  suspendAutoLoadMore = false,
}: UnifiedCommitViewProps) {
  /** 筛选栏输入；关键词短延迟后生效，日期立即生效 */
  const [pendingStart, setPendingStart] = useState('')
  const [pendingEnd, setPendingEnd] = useState('')
  const [pendingSearch, setPendingSearch] = useState('')
  const [dateFilterOpen, setDateFilterOpen] = useState(false)
  /** 已应用到列表的筛选条件 */
  const [appliedStart, setAppliedStart] = useState('')
  const [appliedEnd, setAppliedEnd] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  /** 点击左侧某条分支竖线：列表仅保留带该分支名的提交（与日期/关键词筛选叠加；再点同竖线清除） */
  const [graphRailBranchFilter, setGraphRailBranchFilter] = useState<string | null>(null)
  const [headCommitTotal, setHeadCommitTotal] = useState<number | null>(null)
  const [headCommitTotalLoading, setHeadCommitTotalLoading] = useState(false)
  const [viewedBranchSync, setViewedBranchSync] = useState<BranchSyncStatus | null>(null)
  const [viewedSyncNonce, setViewedSyncNonce] = useState(0)
  const [viewedPullDialogOpen, setViewedPullDialogOpen] = useState(false)
  const [viewedPullSubmitting, setViewedPullSubmitting] = useState(false)
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
  const [cherryPickDialogOpen, setCherryPickDialogOpen] = useState(false)
  const [cherryPickTargetCommit, setCherryPickTargetCommit] = useState<CommitInfo | null>(null)
  const [cherryPickSubmitting, setCherryPickSubmitting] = useState(false)
  const [cherryPickDialogError, setCherryPickDialogError] = useState<string | null>(null)
  const [revertDialogOpen, setRevertDialogOpen] = useState(false)
  const [revertTargetCommit, setRevertTargetCommit] = useState<CommitInfo | null>(null)
  const [revertSubmitting, setRevertSubmitting] = useState(false)
  const [revertDialogError, setRevertDialogError] = useState<string | null>(null)
  const [rebaseDialogOpen, setRebaseDialogOpen] = useState(false)
  const [rebaseTargetCommit, setRebaseTargetCommit] = useState<CommitInfo | null>(null)
  const [rebaseSubmitting, setRebaseSubmitting] = useState(false)
  const [rebaseDialogError, setRebaseDialogError] = useState<string | null>(null)
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
  const selectedCommitRef = useRef<CommitInfo | null>(null)
  selectedCommitRef.current = selectedCommit
  /** 为 false 时跳过「选中后把行滚到视口中央」；手动点列表行时关闭，跳转/布局变化后仍可对齐 */
  const scrollSelectedCommitAfterLayoutRef = useRef(true)
  type JumpRuntimeState = {
    seq: number
    targetId: string
    filtersCleared: boolean
    selectIssued: boolean
    firstScrollDone: boolean
    recalibrated: boolean
    pendingRecalibration: boolean
    stableFrames: number
    geometrySigAtLastScroll: string
    lastObservedGeometrySig: string
    postScrollSettled: boolean
  }
  const activeJumpRef = useRef<JumpRuntimeState | null>(null)
  const consumedJumpSeqRef = useRef<number>(0)
  const [jumpLayoutPass, setJumpLayoutPass] = useState(0)
  const jumpWaitLogKeyRef = useRef<string>('')
  const appendJumpLog = useCallback(
    (message: string, level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' = 'DEBUG') => {
      void invoke('append_gitlite_log', {
        level,
        message: `[jump][UnifiedCommitView] ${message}`,
      }).catch(() => {
        /* 忽略日志写入失败 */
      })
    },
    []
  )
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [fileStatusFilter, setFileStatusFilter] = useState<FileStatusFilter>('all')
  const visibleCommitFiles = useMemo(
    () => filterFileChanges(commitFiles, fileQuery, fileStatusFilter),
    [commitFiles, fileQuery, fileStatusFilter]
  )
  const fileStatusBuckets = useMemo(
    () => countFileChangeStatuses(commitFiles),
    [commitFiles]
  )
  const fileFilterActive = isFileFilterActive(fileQuery, fileStatusFilter)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const loadingTimeoutRef = useRef<number | null>(null)
  const currentLoadingFileRef = useRef<string | null>(null)
  const commitListScrollRef = useRef<HTMLDivElement>(null)
  const fileListScrollRef = useRef<HTMLDivElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const [branchLabelsByCommit, setBranchLabelsByCommit] = useState<
    Map<string, BranchOnCommit[]>
  >(() => new Map())
  /** 本地/远程引用 tip 所在提交（用于行内徽章，区别于竖线用的祖先标签） */
  const [branchTipsByCommit, setBranchTipsByCommit] = useState<
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
    if (collapsed) return
    // 展开时立刻给右栏留宽，避免仅列表时 list 仍是整窗宽度、详情被挤成 0
    setPanes((prev) => {
      const root = rootRef.current
      if (!root) return prev
      const cw = root.clientWidth
      if (cw <= 0) return prev
      const s = SPLITTER_PX
      const minRight = diffPanelCollapsedRef.current
        ? MIN_FILE_W
        : MIN_FILE_W + s + MIN_DIFF_W
      const maxList = Math.max(MIN_LIST_W, cw - s - minRight)
      const list = Math.max(MIN_LIST_W, Math.min(prev.list, maxList))
      if (list === prev.list) return prev
      const next = { list, file: prev.file }
      queueMicrotask(() => savePanes(next))
      return next
    })
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

  useEffect(() => {
    setGraphRailBranchFilter(null)
  }, [repoPath, commitLogScope, commitLogRev])

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
    if (suspendAutoLoadMore) return
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
  }, [hasMore, suspendAutoLoadMore])

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
  const branchesSorted = useMemo(() => {
    if (branches.length === 0) return []
    const cur = currentBranch?.trim()
    const locals = branches.filter((b) => !b.is_remote)
    const remotes = branches
      .filter((b) => b.is_remote)
      .sort((a, b) => a.name.localeCompare(b.name))
    const restLocals = locals
      .filter((b) => b.name !== cur)
      .sort((a, b) => a.name.localeCompare(b.name))
    const current = cur ? locals.find((b) => b.name === cur) : undefined
    if (current) {
      return [current, ...restLocals, ...remotes]
    }
    return [
      ...[...locals].sort((a, b) => a.name.localeCompare(b.name)),
      ...remotes,
    ]
  }, [branches, currentBranch])

  /** 与「当前检出」本地分支对应的 ref；分离 HEAD 时为 null（不显示分支历史下拉） */
  const checkoutHeadRef = useMemo(() => {
    const cur = currentBranch?.trim()
    if (!cur || cur === 'detached') return null
    if (!branchesSorted.some((b) => !b.is_remote && b.name === cur)) return null
    return branchRevSpec(cur, false)
  }, [currentBranch, branchesSorted])

  /**
   * 「当前分支」正在查看的短名：下拉选中的引用，或当前检出分支。
   * 全部分支模式下为 null，图仍按所有远程跟踪画竖轨。
   */
  const historyFocusBranch = useMemo(() => {
    if (commitLogScope !== 'head') return null
    const fromRev = shortBranchRef(commitLogRev)
    if (fromRev) return fromRev
    const cur = currentBranch?.trim()
    if (!cur || cur === 'detached') return null
    return cur
  }, [commitLogScope, commitLogRev, currentBranch])

  /** 全部分支才按竖线筛选列表；当前分支列表本身已是该引用历史 */
  const railFilterEnabled = commitLogScope === 'all'

  /** 下拉选中的本地分支（非当前检出、非远程跟踪） */
  const viewedOtherLocalBranch = useMemo(() => {
    if (commitLogScope !== 'head') return null
    const rev = commitLogRev?.trim()
    if (!rev || rev.startsWith('refs/remotes/')) return null
    const name = shortBranchRef(rev)
    if (!name) return null
    return branches.some((b) => !b.is_remote && b.name === name) ? name : null
  }, [commitLogScope, commitLogRev, branches])

  const bumpViewedSync = useCallback(() => {
    setViewedSyncNonce((n) => n + 1)
  }, [])

  const handleFetchForView = useCallback(() => {
    const result = onFetchChanges?.() as unknown
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void Promise.resolve(result).finally(bumpViewedSync)
    } else {
      window.setTimeout(bumpViewedSync, 600)
    }
  }, [onFetchChanges, bumpViewedSync])

  const handleRefreshForView = useCallback(() => {
    const result = onRefreshRepo?.() as unknown
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void Promise.resolve(result).finally(bumpViewedSync)
    } else {
      window.setTimeout(bumpViewedSync, 600)
    }
  }, [onRefreshRepo, bumpViewedSync])

  const confirmViewedBranchPull = useCallback(async () => {
    if (!viewedOtherLocalBranch) return
    const diverged = (viewedBranchSync?.ahead ?? 0) > 0
    setViewedPullSubmitting(true)
    try {
      const ok = diverged
        ? await onCheckoutAndPullViewedBranch?.(viewedOtherLocalBranch)
        : await onFastForwardViewedBranch?.(viewedOtherLocalBranch)
      if (ok) {
        setViewedPullDialogOpen(false)
        bumpViewedSync()
      }
    } finally {
      setViewedPullSubmitting(false)
    }
  }, [
    viewedOtherLocalBranch,
    viewedBranchSync?.ahead,
    onCheckoutAndPullViewedBranch,
    onFastForwardViewedBranch,
    bumpViewedSync,
  ])

  useEffect(() => {
    if (!repoPath || !viewedOtherLocalBranch) {
      setViewedBranchSync(null)
      return
    }
    let cancelled = false
    invoke<BranchSyncStatus>('get_branch_sync_status', {
      repoPath,
      branch: viewedOtherLocalBranch,
    })
      .then((s) => {
        if (!cancelled) setViewedBranchSync(s)
      })
      .catch(() => {
        if (!cancelled) setViewedBranchSync(null)
      })
    return () => {
      cancelled = true
    }
  }, [repoPath, viewedOtherLocalBranch, viewedSyncNonce, commits[0]?.id])

  /** 无 commitLogRev 时下列表展示为当前检出分支，语义仍为 HEAD（含上游待拉取合并展示） */
  const commitLogBranchSelectValue = useMemo(() => {
    const rev = commitLogRev?.trim()
    if (rev) return rev
    if (checkoutHeadRef) return checkoutHeadRef
    const first = branchesSorted[0]
    return first ? branchRevSpec(first.name, first.is_remote) : ''
  }, [commitLogRev, checkoutHeadRef, branchesSorted])

  /** 旧版把远程跟踪误写成 refs/heads/origin/…，自动改成正确引用以免空列表 */
  useEffect(() => {
    const rev = commitLogRev?.trim()
    if (!rev || !onCommitLogRevChange) return
    if (!rev.startsWith('refs/heads/')) return
    const short = rev.slice('refs/heads/'.length)
    const remote = branches.find((b) => b.is_remote && b.name === short)
    if (remote) {
      onCommitLogRevChange(branchRevSpec(remote.name, true))
    }
  }, [commitLogRev, branches, onCommitLogRevChange])

  const hasActiveFilters = useMemo(
    () =>
      !!(
        pendingStart ||
        pendingEnd ||
        pendingSearch.trim() ||
        appliedStart ||
        appliedEnd ||
        appliedSearch.trim() ||
        isSearchMode ||
        (railFilterEnabled && graphRailBranchFilter)
      ),
    [
      pendingStart,
      pendingEnd,
      pendingSearch,
      appliedStart,
      appliedEnd,
      appliedSearch,
      isSearchMode,
      railFilterEnabled,
      graphRailBranchFilter,
    ]
  )

  const applyFilters = useCallback(() => {
    setAppliedStart(pendingStart)
    setAppliedEnd(pendingEnd)
    setAppliedSearch(pendingSearch)
  }, [pendingStart, pendingEnd, pendingSearch])

  useEffect(() => {
    const id = window.setTimeout(() => {
      setAppliedSearch(pendingSearch)
    }, 280)
    return () => window.clearTimeout(id)
  }, [pendingSearch])

  const clearAllFilters = useCallback(() => {
    setPendingStart('')
    setPendingEnd('')
    setPendingSearch('')
    setAppliedStart('')
    setAppliedEnd('')
    setAppliedSearch('')
    setGraphRailBranchFilter(null)
    onClearSearchMode?.()
  }, [onClearSearchMode])

  const applyDateRange = useCallback((start: string, end: string) => {
    setPendingStart(start)
    setPendingEnd(end)
    setAppliedStart(start)
    setAppliedEnd(end)
  }, [])

  const dateFilterActive = !!(pendingStart || pendingEnd)
  const dateFilterLabel = useMemo(() => {
    const fmt = (ymd: string) => ymd.replace(/-/g, '/')
    if (pendingStart && pendingEnd) {
      if (pendingStart === pendingEnd) return fmt(pendingStart)
      return `${fmt(pendingStart)} – ${fmt(pendingEnd)}`
    }
    if (pendingStart) return `${fmt(pendingStart)} 起`
    if (pendingEnd) return `至 ${fmt(pendingEnd)}`
    return '时间'
  }, [pendingStart, pendingEnd])

  const browsingNonCheckout =
    commitLogScope === 'head' && !!commitLogRev?.trim()

  const localBranchesForLog = useMemo(
    () => branchesSorted.filter((b) => !b.is_remote),
    [branchesSorted]
  )
  const remoteBranchesForLog = useMemo(
    () => branchesSorted.filter((b) => b.is_remote),
    [branchesSorted]
  )

  const branchLogSelectGroups = useMemo(() => {
    const groups: { label: string; options: { value: string; label: string }[] }[] = []
    if (localBranchesForLog.length > 0) {
      groups.push({
        label: '本地',
        options: localBranchesForLog.map((b) => {
          const spec = branchRevSpec(b.name, false)
          const isCheckout = spec === checkoutHeadRef
          return {
            value: spec,
            label: isCheckout ? `${b.name}（检出）` : b.name,
          }
        }),
      })
    }
    if (remoteBranchesForLog.length > 0) {
      groups.push({
        label: '远程',
        options: remoteBranchesForLog.map((b) => ({
          value: branchRevSpec(b.name, true),
          label: b.name,
        })),
      })
    }
    return groups
  }, [localBranchesForLog, remoteBranchesForLog, checkoutHeadRef])

  const commitListCountLabel = isSearchMode
    ? `搜索 ${commits.length}`
    : `${commits.length}${hasMore ? '+' : ''}`

  const commitListTotalLabel = headCommitTotalLoading
    ? '统计中…'
    : headCommitTotal == null
      ? null
      : commitLogScope === 'all'
        ? `全部 ${headCommitTotal}`
        : commitLogRev
          ? `${shortBranchRef(commitLogRev)} ${headCommitTotal}`
          : `当前分支 ${headCommitTotal}`

  const commitListMetaTitle =
    commitLogScope === 'all'
      ? '「已加载」为当前列表条数，可继续加载。总数为所有本地分支、远程跟踪与标签可达的去重提交数（与 git log --all 类似）。'
      : commitLogRev
        ? `「已加载」为当前列表条数。所选分支「${shortBranchRef(commitLogRev)}」的可达提交总数与 git rev-list --count ${commitLogRev} 一致。`
        : '「已加载」为当前列表中的条数，可向下滚动继续加载。「当前分支」总数为 HEAD 可达提交数（与 git rev-list --count HEAD 一致），含合并带来的历史。'

  const onGraphBranchRailClick = useCallback((branchName: string) => {
    setGraphRailBranchFilter((prev) => (prev === branchName ? null : branchName))
  }, [])

  const filteredCommits = useMemo(() => {
    return commits.filter((commit) => {
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
      if (!isSearchMode && appliedSearch.trim()) {
        const term = appliedSearch.toLowerCase()
        const ok =
          commit.message.toLowerCase().includes(term) ||
          commit.author.toLowerCase().includes(term) ||
          commit.short_id.toLowerCase().includes(term)
        if (!ok) return false
      }
      if (railFilterEnabled && graphRailBranchFilter) {
        const labels = branchLabelsByCommit.get(commit.id)
        if (!labels?.some((b) => b.name === graphRailBranchFilter)) return false
      }
      return true
    })
  }, [
    commits,
    appliedSearch,
    appliedStart,
    appliedEnd,
    getCommitDate,
    isSearchMode,
    railFilterEnabled,
    graphRailBranchFilter,
    branchLabelsByCommit,
  ])

  const scrollCommitRowIntoView = useCallback(
    (commitId: string) => {
      const root = commitListScrollRef.current
      if (!root) return false
      const row = root.querySelector<HTMLDivElement>(`[data-commit-id="${commitId}"]`)
      if (!row) return false
      const align = () => {
        const rootRect = root.getBoundingClientRect()
        const rowRect = row.getBoundingClientRect()
        const rowTopInRoot = rowRect.top - rootRect.top + root.scrollTop
        const targetTop = Math.max(0, rowTopInRoot - (root.clientHeight - rowRect.height) / 2)
        root.scrollTop = targetTop
      }
      align()
      window.requestAnimationFrame(align)
      return true
    },
    []
  )

  const getJumpPositionMetrics = useCallback((commitId: string) => {
    const root = commitListScrollRef.current
    if (!root) return null
    const row = root.querySelector<HTMLDivElement>(`[data-commit-id="${commitId}"]`)
    if (!row) return null
    const rootRect = root.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const rowTopInRoot = rowRect.top - rootRect.top
    const rowBottomInRoot = rowRect.bottom - rootRect.top
    return {
      rowTopInRoot: Math.round(rowTopInRoot),
      rowBottomInRoot: Math.round(rowBottomInRoot),
      rowHeight: Math.round(rowRect.height),
      rootHeight: Math.round(root.clientHeight),
      scrollTop: Math.round(root.scrollTop),
    }
  }, [])

  const branchLabelIdsKey = useMemo(
    () => filteredCommits.map((c) => c.id).join(','),
    [filteredCommits]
  )

  /** 当前列表每一行是否都已拿到分支标签（避免列表变长后整图竖线先按残缺数据重排再等请求） */
  const branchLabelsCompleteForVisibleCommits = useMemo(() => {
    if (filteredCommits.length === 0) return true
    return filteredCommits.every((c) => branchLabelsByCommit.has(c.id))
  }, [filteredCommits, branchLabelsByCommit])

  // 每个提交在哪些远程跟踪分支历史上（仅「全部分支」需要竖轨；当前分支用 DAG，避免其它远程把图拉偏）
  useEffect(() => {
    if (!repoPath || filteredCommits.length === 0 || commitLogScope !== 'all') {
      setBranchLabelsByCommit(new Map())
      return
    }
    const commitIds = filteredCommits.map((c) => c.id)
    const idSet = new Set(commitIds)
    let cancelled = false
    invoke<CommitBranchLabels[]>('get_commits_branch_labels', {
      repoPath,
      commitIds,
    })
      .then((rows) => {
        if (cancelled) return
        setBranchLabelsByCommit((prev) => {
          const next = new Map(prev)
          for (const row of rows) {
            if (idSet.has(row.commit_id)) {
              next.set(row.commit_id, row.branches)
            }
          }
          for (const key of [...next.keys()]) {
            if (!idSet.has(key)) next.delete(key)
          }
          return next
        })
      })
      .catch(() => {
        if (!cancelled) setBranchLabelsByCommit(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [repoPath, branchLabelIdsKey, currentBranch, commitLogScope])

  const branchTipRefreshKey = `${repoPath ?? ''}|${currentBranch ?? ''}|${commits.length}|${commits[0]?.id ?? ''}|${aheadCount}|${behindCount}`

  /** 各引用当前指向的提交（origin/master 等只出现在 tip 那一行） */
  useEffect(() => {
    if (!repoPath) {
      setBranchTipsByCommit(new Map())
      return
    }
    let cancelled = false
    invoke<BranchRefTip[]>('get_branch_ref_tips', { repoPath })
      .then((tips) => {
        if (cancelled) return
        const next = new Map<string, BranchOnCommit[]>()
        for (const t of tips) {
          const list = next.get(t.commit_id) ?? []
          list.push({ name: t.name, is_remote: Boolean(t.is_remote) })
          next.set(t.commit_id, list)
        }
        for (const list of next.values()) {
          list.sort(
            (a, b) =>
              Number(a.is_remote) - Number(b.is_remote) || a.name.localeCompare(b.name)
          )
        }
        setBranchTipsByCommit(next)
      })
      .catch(() => {
        if (!cancelled) setBranchTipsByCommit(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [branchTipRefreshKey, repoPath])

  /** 左侧连线图着色：当前分支整列同色；全部分支优先正在查看/检出对应的远程名 */
  const graphBranchColorByCommit = useMemo(() => {
    const m = new Map<string, string>()
    if (historyFocusBranch) {
      for (const c of filteredCommits) {
        m.set(c.id, historyFocusBranch)
      }
      return m
    }
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
  }, [filteredCommits, branchLabelsByCommit, currentBranch, historyFocusBranch])

  /** 左侧「每分支一竖线」：提交 → 分支名列表（当前分支模式只保留正在查看的那条线） */
  const branchNamesByCommitIdForGraph = useMemo(() => {
    const m = new Map<string, readonly string[]>()
    const focus = historyFocusBranch
    for (const c of filteredCommits) {
      const labels = branchLabelsByCommit.get(c.id)
      if (labels === undefined) continue
      const names = labels.map((b) => b.name)
      m.set(c.id, focus ? names.filter((n) => refsSameBranchLine(n, focus)) : names)
    }
    return m
  }, [filteredCommits, branchLabelsByCommit, historyFocusBranch])

  /**
   * 分支竖轨模式须「当前列表每一行都已写入标签结果」（含空数组），否则 frozen 列 +
   * 残缺行映射会让 buildBranchColumnRails 只在少数行上命中，出现「多条竖线挤在最底一行」的假图。
   */
  const graphBranchModeReady =
    filteredCommits.length > 0 &&
    branchLabelsCompleteForVisibleCommits &&
    branchNamesByCommitIdForGraph.size === filteredCommits.length

  /**
   * 当前列表内出现过的分支名 → 列顺序（未做「竖线筛选」下的稳定重排）。
   * 主序：竖线在列表中的「跨度」倒序；同跨度再按当前分支 / 本地 / 远程，最后按名字。
   */
  const branchRailColumnsBase = useMemo(() => {
    const set = new Set<string>()
    for (const c of filteredCommits) {
      const labels = branchLabelsByCommit.get(c.id)
      if (!labels) continue
      for (const b of labels) set.add(b.name)
    }
    const names = [...set].filter((n) =>
      historyFocusBranch ? refsSameBranchLine(n, historyFocusBranch) : true
    )
    if (names.length === 0) return [] as string[]

    const rank = (n: string) => {
      if (historyFocusBranch && refsSameBranchLine(n, historyFocusBranch)) return 0
      if (n === currentBranch || n === `origin/${currentBranch}`) return 0
      if (n.endsWith(`/${currentBranch}`)) return 0
      if (!n.includes('/')) return 1
      return 2
    }

    const railSpanRows = (branchName: string): number => {
      let minI = -1
      let maxI = -1
      for (let i = 0; i < filteredCommits.length; i++) {
        const labels = branchLabelsByCommit.get(filteredCommits[i]!.id)
        if (!labels?.some((x) => x.name === branchName)) continue
        if (minI < 0) minI = i
        maxI = i
      }
      if (minI < 0) return 0
      return maxI - minI
    }

    names.sort((a, b) => {
      const sa = railSpanRows(a)
      const sb = railSpanRows(b)
      if (sa !== sb) return sb - sa
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      return a.localeCompare(b)
    })
    return names.slice(0, MAX_BRANCH_RAIL_COLS)
  }, [filteredCommits, branchLabelsByCommit, currentBranch, historyFocusBranch])

  /** 未开启「竖线筛选」时的列顺序快照，用于开启筛选后保持左右列不重排（仅隐藏无提交的分支列） */
  const branchRailOrderBeforeGraphFilterRef = useRef<string[]>([])

  useLayoutEffect(() => {
    if (
      !graphRailBranchFilter &&
      branchRailColumnsBase.length > 0 &&
      branchLabelsCompleteForVisibleCommits
    ) {
      branchRailOrderBeforeGraphFilterRef.current = [...branchRailColumnsBase]
    }
  }, [graphRailBranchFilter, branchRailColumnsBase, branchLabelsCompleteForVisibleCommits])

  const branchRailColumns = useMemo(() => {
    if (graphRailBranchFilter) {
      const frozen = branchRailOrderBeforeGraphFilterRef.current
      if (!frozen.length) {
        return branchRailColumnsBase
      }
      const inView = new Set(branchRailColumnsBase)
      const ordered: string[] = []
      for (const n of frozen) {
        if (inView.has(n)) ordered.push(n)
      }
      for (const n of branchRailColumnsBase) {
        if (!ordered.includes(n)) ordered.push(n)
      }
      return ordered.slice(0, MAX_BRANCH_RAIL_COLS)
    }
    if (
      !branchLabelsCompleteForVisibleCommits &&
      branchRailOrderBeforeGraphFilterRef.current.length > 0
    ) {
      const base = branchRailColumnsBase
      const frozen = branchRailOrderBeforeGraphFilterRef.current
      const inBase = new Set(base)
      const ordered: string[] = []
      for (const n of frozen) {
        if (inBase.has(n)) ordered.push(n)
      }
      for (const n of base) {
        if (!ordered.includes(n)) ordered.push(n)
      }
      return ordered.slice(0, MAX_BRANCH_RAIL_COLS)
    }
    return branchRailColumnsBase
  }, [
    graphRailBranchFilter,
    branchRailColumnsBase,
    branchLabelsCompleteForVisibleCommits,
  ])

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

  // 提交列表在「前面插入 incoming」「loadMore 追加」或行高变化后，若不重算 scrollTop，会出现先对准再偏掉。
  // 跳转全程由下方 useLayoutEffect 独占滚动，避免与本 effect 打架。
  const commitListLayoutSig = `${commits.length}:${incomingCommitCount}:${commitGraphRowHeights.join(',')}`
  useEffect(() => {
    if (!selectedCommit) return
    if (activeJumpRef.current) return
    if (!scrollSelectedCommitAfterLayoutRef.current) {
      scrollSelectedCommitAfterLayoutRef.current = true
      return
    }
    scrollCommitRowIntoView(selectedCommit.id)
  }, [selectedCommit, scrollCommitRowIntoView, commitListLayoutSig])

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

  const openCherryPickDialogForCommit = useCallback((commit: CommitInfo) => {
    setCherryPickTargetCommit(commit)
    setCherryPickDialogError(null)
    setCherryPickDialogOpen(true)
  }, [])

  const openRevertDialogForCommit = useCallback((commit: CommitInfo) => {
    setRevertTargetCommit(commit)
    setRevertDialogError(null)
    setRevertDialogOpen(true)
  }, [])

  const openRebaseDialogForCommit = useCallback((commit: CommitInfo) => {
    setRebaseTargetCommit(commit)
    setRebaseDialogError(null)
    setRebaseDialogOpen(true)
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

  const handleConfirmCherryPick = useCallback(async () => {
    if (!onCherryPickCommit || !cherryPickTargetCommit) return
    setCherryPickDialogError(null)
    setCherryPickSubmitting(true)
    try {
      const ok = await onCherryPickCommit(cherryPickTargetCommit.id)
      if (!ok) return
      setCherryPickDialogOpen(false)
      setCherryPickTargetCommit(null)
      setSelectedCommit(null)
      setCommitFiles([])
      setSelectedFile(null)
      setDiff('')
    } catch (e) {
      setCherryPickDialogError(formatTauriInvokeError(e, 'Cherry-pick 失败'))
    } finally {
      setCherryPickSubmitting(false)
    }
  }, [onCherryPickCommit, cherryPickTargetCommit])

  const handleConfirmRevert = useCallback(async () => {
    if (!onRevertCommit || !revertTargetCommit) return
    setRevertDialogError(null)
    setRevertSubmitting(true)
    try {
      const ok = await onRevertCommit(revertTargetCommit.id)
      if (!ok) return
      setRevertDialogOpen(false)
      setRevertTargetCommit(null)
      setSelectedCommit(null)
      setCommitFiles([])
      setSelectedFile(null)
      setDiff('')
    } catch (e) {
      setRevertDialogError(formatTauriInvokeError(e, 'Revert 失败'))
    } finally {
      setRevertSubmitting(false)
    }
  }, [onRevertCommit, revertTargetCommit])

  const handleConfirmRebase = useCallback(async () => {
    if (!onRebaseToCommit || !rebaseTargetCommit) return
    setRebaseDialogError(null)
    setRebaseSubmitting(true)
    try {
      const ok = await onRebaseToCommit(rebaseTargetCommit.id)
      if (!ok) return
      setRebaseDialogOpen(false)
      setRebaseTargetCommit(null)
      setSelectedCommit(null)
      setCommitFiles([])
      setSelectedFile(null)
      setDiff('')
    } catch (e) {
      setRebaseDialogError(formatTauriInvokeError(e, 'Rebase 失败'))
    } finally {
      setRebaseSubmitting(false)
    }
  }, [onRebaseToCommit, rebaseTargetCommit])

  // 处理提交选择 - 使用 useCallback 优化
  const handleCommitSelect = useCallback(
    async (commit: CommitInfo, options?: { scrollIntoView?: boolean }) => {
    // 仅列表时点提交 = 要看详情（与多库弹窗一致），先展开右栏
    if (rightPanelCollapsedRef.current) {
      setRightPanelCollapsed(false)
    }

    // 如果已经是当前选中的提交，直接返回（右栏已在上方展开）
    if (selectedCommitRef.current?.id === commit.id) return

    scrollSelectedCommitAfterLayoutRef.current = options?.scrollIntoView !== false

    setSelectedCommit(commit)
    setSelectedFile(null)
    setDiff('')
    setFileQuery('')
    setFileStatusFilter('all')

    try {
      setLoadingFiles(true)
      const files = await onGetCommitFiles(commit.id)
      setCommitFiles(files)
    } catch (error) {
      console.error('❌ 获取提交文件失败:', error)
    } finally {
      setLoadingFiles(false)
    }
  },
  [onGetCommitFiles, setRightPanelCollapsed])

  const filteredCommitIdsKey = useMemo(
    () => filteredCommits.map((c) => c.id).join(','),
    [filteredCommits]
  )
  const commitRowHeightsKey = useMemo(
    () => commitGraphRowHeights.join(','),
    [commitGraphRowHeights]
  )

  useEffect(() => {
    if (!jumpToCommitRequest) {
      const prev = activeJumpRef.current
      if (prev) {
        appendJumpLog(`request cleared before consume seq=${prev.seq} commitId=${prev.targetId}`, 'WARN')
      }
      activeJumpRef.current = null
      jumpWaitLogKeyRef.current = ''
      return
    }
    if (jumpToCommitRequest.seq <= consumedJumpSeqRef.current) return
    const cur = activeJumpRef.current
    if (cur?.seq === jumpToCommitRequest.seq) return
    activeJumpRef.current = {
      seq: jumpToCommitRequest.seq,
      targetId: jumpToCommitRequest.commit.id,
      filtersCleared: false,
      selectIssued: false,
      firstScrollDone: false,
      recalibrated: false,
      pendingRecalibration: false,
      stableFrames: 0,
      geometrySigAtLastScroll: '',
      lastObservedGeometrySig: '',
      postScrollSettled: false,
    }
    jumpWaitLogKeyRef.current = ''
    appendJumpLog(
      `request received seq=${jumpToCommitRequest.seq} commitId=${jumpToCommitRequest.commit.id} filteredLen=${filteredCommits.length} commitsLen=${commits.length}`
    )
  }, [jumpToCommitRequest, appendJumpLog, filteredCommits.length, commits.length])

  useLayoutEffect(() => {
    const logWait = (key: string, message: string) => {
      if (jumpWaitLogKeyRef.current === key) return
      jumpWaitLogKeyRef.current = key
      appendJumpLog(message)
    }
    const runtime = activeJumpRef.current
    if (!runtime) return
    if (jumpToCommitRequest?.seq !== runtime.seq) return
    const targetId = runtime.targetId
    const targetInCommits = commits.some((c) => c.id === targetId)
    if (!targetInCommits) {
      logWait(
        `wait-commits-${runtime.seq}-${targetId}`,
        `wait target in commits seq=${runtime.seq} commitId=${targetId} commitsLen=${commits.length}`
      )
      return
    }

    const targetInFiltered = filteredCommits.some((c) => c.id === targetId)
    if (!targetInFiltered) {
      if (!runtime.filtersCleared) {
        runtime.filtersCleared = true
        appendJumpLog(
          `clear filters for target visibility seq=${runtime.seq} commitId=${targetId}`
        )
        setPendingStart('')
        setPendingEnd('')
        setPendingSearch('')
        setAppliedStart('')
        setAppliedEnd('')
        setAppliedSearch('')
        onClearSearchMode?.()
      }
      logWait(
        `wait-filtered-${runtime.seq}-${targetId}`,
        `wait target in filtered seq=${runtime.seq} commitId=${targetId} filteredLen=${filteredCommits.length}`
      )
      return
    }

    if (selectedCommitRef.current?.id !== targetId) {
      if (runtime.selectIssued) return
      runtime.selectIssued = true
      appendJumpLog(
        `select target commit seq=${runtime.seq} commitId=${targetId} currentSelected=${selectedCommitRef.current?.id ?? 'null'}`
      )
      const targetCommit =
        filteredCommits.find((c) => c.id === targetId) ?? jumpToCommitRequest.commit
      void handleCommitSelect(targetCommit)
      return
    }

    const root = commitListScrollRef.current
    if (!root) {
      logWait(
        `wait-root-${runtime.seq}-${targetId}`,
        `wait commit list root seq=${runtime.seq} commitId=${targetId}`
      )
      return
    }
    const row = root.querySelector<HTMLDivElement>(`[data-commit-id="${targetId}"]`)
    if (!row) {
      logWait(
        `wait-row-${runtime.seq}-${targetId}`,
        `wait row mount seq=${runtime.seq} commitId=${targetId} filteredLen=${filteredCommits.length}`
      )
      return
    }

    const geometrySig = [
      filteredCommitIdsKey,
      commitRowHeightsKey,
      row.offsetTop,
      row.offsetHeight,
      root.clientHeight,
      panes.list,
      panes.file,
      diffPanelCollapsed ? 1 : 0,
      rightPanelCollapsed ? 1 : 0,
    ].join('|')

    if (!runtime.firstScrollDone) {
      if (commitGraphRowHeights.length !== filteredCommits.length) {
        logWait(
          `wait-heights-${runtime.seq}-${targetId}-${commitGraphRowHeights.length}-${filteredCommits.length}`,
          `wait row heights ready seq=${runtime.seq} commitId=${targetId} heights=${commitGraphRowHeights.length} filtered=${filteredCommits.length}`
        )
        return
      }
      if (runtime.lastObservedGeometrySig !== geometrySig) {
        runtime.lastObservedGeometrySig = geometrySig
        logWait(
          `wait-geometry-${runtime.seq}-${targetId}-${geometrySig}`,
          `wait geometry settle seq=${runtime.seq} commitId=${targetId} geometrySig=${geometrySig}`
        )
        window.requestAnimationFrame(() => {
          setJumpLayoutPass((n) => n + 1)
        })
        return
      }
      scrollCommitRowIntoView(targetId)
      runtime.firstScrollDone = true
      runtime.geometrySigAtLastScroll = geometrySig
      runtime.lastObservedGeometrySig = geometrySig
      runtime.pendingRecalibration = false
      runtime.stableFrames = 0
      runtime.postScrollSettled = false
      jumpWaitLogKeyRef.current = ''
      const m = getJumpPositionMetrics(targetId)
      const pos = m
        ? ` rowTop=${m.rowTopInRoot} rowBottom=${m.rowBottomInRoot} rowH=${m.rowHeight} rootH=${m.rootHeight} scrollTop=${m.scrollTop}`
        : ' rowMetrics=missing'
      appendJumpLog(
        `first scroll seq=${runtime.seq} commitId=${targetId} geometrySig=${geometrySig}${pos}`
      )
      window.requestAnimationFrame(() => {
        setJumpLayoutPass((n) => n + 1)
      })
      return
    }

    if (geometrySig !== runtime.lastObservedGeometrySig) {
      runtime.lastObservedGeometrySig = geometrySig
      runtime.stableFrames = 0
      if (geometrySig !== runtime.geometrySigAtLastScroll && !runtime.recalibrated) {
        runtime.pendingRecalibration = true
      }
      logWait(
        `wait-post-shift-${runtime.seq}-${targetId}-${geometrySig}`,
        `wait layout drift settle seq=${runtime.seq} commitId=${targetId} geometrySig=${geometrySig} recalibrated=${runtime.recalibrated ? 1 : 0}`
      )
      window.requestAnimationFrame(() => {
        setJumpLayoutPass((n) => n + 1)
      })
      return
    }

    runtime.stableFrames += 1

    if (runtime.pendingRecalibration && !runtime.recalibrated && runtime.stableFrames >= 2) {
      runtime.recalibrated = true
      runtime.pendingRecalibration = false
      runtime.stableFrames = 0
      runtime.postScrollSettled = false
      runtime.geometrySigAtLastScroll = geometrySig
      runtime.lastObservedGeometrySig = geometrySig
      scrollCommitRowIntoView(targetId)
      jumpWaitLogKeyRef.current = ''
      const m = getJumpPositionMetrics(targetId)
      const pos = m
        ? ` rowTop=${m.rowTopInRoot} rowBottom=${m.rowBottomInRoot} rowH=${m.rowHeight} rootH=${m.rootHeight} scrollTop=${m.scrollTop}`
        : ' rowMetrics=missing'
      appendJumpLog(
        `recalibrate after settle seq=${runtime.seq} commitId=${targetId} geometrySig=${geometrySig}${pos}`
      )
      window.requestAnimationFrame(() => {
        setJumpLayoutPass((n) => n + 1)
      })
      return
    }

    if (runtime.stableFrames < 2) {
      logWait(
        `wait-post-settle-${runtime.seq}-${targetId}-${geometrySig}-${runtime.stableFrames}`,
        `wait post-scroll settle seq=${runtime.seq} commitId=${targetId} geometrySig=${geometrySig} stableFrames=${runtime.stableFrames}`
      )
      window.requestAnimationFrame(() => {
        setJumpLayoutPass((n) => n + 1)
      })
      return
    }

    consumedJumpSeqRef.current = runtime.seq
    activeJumpRef.current = null
    jumpWaitLogKeyRef.current = ''
    const m = getJumpPositionMetrics(targetId)
    const pos = m
      ? ` rowTop=${m.rowTopInRoot} rowBottom=${m.rowBottomInRoot} rowH=${m.rowHeight} rootH=${m.rootHeight} scrollTop=${m.scrollTop}`
      : ' rowMetrics=missing'
    appendJumpLog(
      `consumed seq=${runtime.seq} commitId=${targetId} geometrySig=${geometrySig}${pos}`
    )
    onJumpToCommitConsumed?.({ seq: runtime.seq, commitId: targetId })
  }, [
    jumpToCommitRequest,
    commits,
    filteredCommits,
    filteredCommitIdsKey,
    commitRowHeightsKey,
    commitGraphRowHeights.length,
    handleCommitSelect,
    onClearSearchMode,
    onJumpToCommitConsumed,
    panes.list,
    panes.file,
    diffPanelCollapsed,
    rightPanelCollapsed,
    jumpLayoutPass,
    scrollCommitRowIntoView,
    getJumpPositionMetrics,
    appendJumpLog,
  ])

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
    // 保持焦点在文件列表容器内，便于连续键盘移动
    queueMicrotask(() => fileListScrollRef.current?.focus())
    
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

  // 键盘：文件列表内 ArrowUp/Down 移动选中，自动滚动到可见
  useEffect(() => {
    if (!selectedFile) return
    const root = fileListScrollRef.current
    if (!root) return
    // data-file-path 可能含特殊字符，用 querySelector 转义
    let el: HTMLElement | null = null
    try {
      const escaped =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(selectedFile)
          : selectedFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      el = root.querySelector(`[data-file-path="${escaped}"]`)
    } catch {
      el = root.querySelector('[data-file-path]')
    }
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedFile])

  const isTypingTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (target.isContentEditable) return true
    return false
  }, [])

  const handleCommitListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isTypingTarget(e.target)) return
      if (filteredCommits.length === 0) return
      const key = e.key
      if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End') return
      e.preventDefault()
      const curId = selectedCommitRef.current?.id ?? null
      let idx = curId ? filteredCommits.findIndex((c) => c.id === curId) : -1
      if (key === 'ArrowDown') {
        if (idx === -1) idx = 0
        else idx = Math.min(idx + 1, filteredCommits.length - 1)
      } else if (key === 'ArrowUp') {
        if (idx === -1) idx = filteredCommits.length - 1
        else idx = Math.max(idx - 1, 0)
      } else if (key === 'Home') {
        idx = 0
      } else if (key === 'End') {
        idx = filteredCommits.length - 1
      }
      const next = filteredCommits[idx]
      if (next && next.id !== curId) {
        void handleCommitSelect(next)
      }
    },
    [filteredCommits, handleCommitSelect, isTypingTarget]
  )

  const handleFileListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isTypingTarget(e.target)) return
      if (visibleCommitFiles.length === 0) return
      const key = e.key
      if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End' && key !== 'Enter') return
      e.preventDefault()
      const curPath = selectedFile ?? null
      let idx = curPath ? visibleCommitFiles.findIndex((f) => f.path === curPath) : -1
      if (key === 'ArrowDown') {
        if (idx === -1) idx = 0
        else idx = Math.min(idx + 1, visibleCommitFiles.length - 1)
        const next = visibleCommitFiles[idx]
        if (next) void handleFileSelect(next.path)
      } else if (key === 'ArrowUp') {
        if (idx === -1) idx = visibleCommitFiles.length - 1
        else idx = Math.max(idx - 1, 0)
        const next = visibleCommitFiles[idx]
        if (next) void handleFileSelect(next.path)
      } else if (key === 'Home') {
        const next = visibleCommitFiles[0]
        if (next) void handleFileSelect(next.path)
      } else if (key === 'End') {
        const next = visibleCommitFiles[visibleCommitFiles.length - 1]
        if (next) void handleFileSelect(next.path)
      } else if (key === 'Enter') {
        if (curPath) void handleFileSelect(curPath)
      }
    },
    [visibleCommitFiles, selectedFile, handleFileSelect, isTypingTarget]
  )

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
  }, [])

  // 文件项：文件名为主、目录为辅；状态靠图标颜色区分，避免每行再占一块徽章
  const FileItem = memo(({ file, isSelected, onSelect, getStatusIcon }: {
    file: FileChange
    isSelected: boolean
    onSelect: (filePath: string) => void
    getStatusIcon: (status: string) => React.ReactNode
  }) => {
    const handleClick = useCallback(() => {
      onSelect(file.path)
    }, [onSelect, file.path])

    const { dir, base } = splitRepoPath(file.path)

    return (
      <div
        data-file-path={file.path}
        role="option"
        aria-selected={isSelected}
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 transition-colors',
          isSelected
            ? 'bg-accent ring-1 ring-inset ring-primary/25'
            : 'hover:bg-accent/55'
        )}
        onClick={handleClick}
        title={file.path}
      >
        <div className="shrink-0">{getStatusIcon(file.status)}</div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-medium text-foreground" title={file.path}>
            {base}
            {dir ? (
              <span className="ml-1.5 font-normal text-[11px] text-muted-foreground">
                {dir}
              </span>
            ) : null}
          </p>
        </div>
        {(file.additions > 0 || file.deletions > 0) && (
          <span className="shrink-0 tabular-nums text-[11px]">
            <span className="text-green-700 dark:text-green-400">+{file.additions}</span>
            <span className="text-muted-foreground"> </span>
            <span className="text-red-700 dark:text-red-400">-{file.deletions}</span>
          </span>
        )}
      </div>
    )
  }, (prevProps, nextProps) => {
    return (
      prevProps.file.path === nextProps.file.path &&
      prevProps.file.status === nextProps.file.status &&
      prevProps.file.additions === nextProps.file.additions &&
      prevProps.file.deletions === nextProps.file.deletions &&
      prevProps.isSelected === nextProps.isSelected
    )
  })

  const commitContextMenuItemCount = [
    onCreateBranch,
    onResetToCommit,
    onCherryPickCommit,
    onRevertCommit,
    onRebaseToCommit,
  ].filter(Boolean).length
  const commitContextMenuViewportMargin = Math.max(
    56,
    commitContextMenuItemCount * 48 + 20
  )

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
          <CardHeader className="flex flex-col gap-1.5 space-y-0 border-b border-border/35 bg-muted/15 px-2.5 py-2 sm:px-3 dark:bg-muted/5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
                      title="只看一条分支的提交历史；默认跟随上方工具栏的检出分支"
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
                {commitLogScope === 'all' && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                        title="关于全部分支"
                        aria-label="关于全部分支"
                      >
                        <Info className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="max-w-xs p-3 text-xs leading-relaxed text-muted-foreground" align="start">
                      历史范围为各本地分支、远程跟踪与标签可达的合并历史。提交旁徽章为引用当前指向的提交（本地
                      master、远程 origin/master 等）；虚线边框为远程跟踪。
                    </PopoverContent>
                  </Popover>
                )}
                {commitLogScope === 'head' &&
                  onCommitLogRevChange &&
                  branchesSorted.length > 0 &&
                  checkoutHeadRef != null && (
                    <div
                      className={cn(
                        'flex h-6 min-w-0 max-w-[18rem] shrink items-center gap-1 rounded-md border bg-background px-1.5',
                        browsingNonCheckout
                          ? 'border-primary/40'
                          : 'border-input'
                      )}
                      title="浏览某条分支的历史，不会切换工作区。要改检出请用上方工具栏的分支选择器。"
                    >
                      <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {browsingNonCheckout ? '浏览' : '跟随'}
                      </span>
                      <SimpleSelect
                        size="inline"
                        className="min-w-0 flex-1"
                        value={commitLogBranchSelectValue}
                        onValueChange={(v) => {
                          if (checkoutHeadRef && v === checkoutHeadRef) {
                            onCommitLogRevChange(null)
                          } else {
                            onCommitLogRevChange(v)
                          }
                        }}
                        groups={branchLogSelectGroups}
                        contentClassName="min-w-[10rem] max-w-[18rem]"
                        aria-label="选择要查看历史的分支（不切换检出）"
                      />
                    </div>
                  )}
                {browsingNonCheckout && onCommitLogRevChange ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => onCommitLogRevChange(null)}
                    title={
                      currentBranch
                        ? `回到检出分支 ${currentBranch} 的历史`
                        : '回到当前检出的历史'
                    }
                  >
                    回到检出
                  </Button>
                ) : null}
                {viewedOtherLocalBranch && viewedBranchSync ? (
                  <span className="flex min-w-0 max-w-[14rem] shrink-0 items-center gap-1">
                    {viewedBranchSync.has_upstream ? (
                      <>
                        {viewedBranchSync.behind > 0 ? (
                          <button
                            type="button"
                            className="inline-flex h-6 max-w-full items-center gap-0.5 truncate rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-200"
                            title={
                              viewedBranchSync.upstream_name
                                ? `本地 ${viewedOtherLocalBranch} 比 ${viewedBranchSync.upstream_name} 落后 ${viewedBranchSync.behind} 个提交${viewedBranchSync.upstream_short_id ? `（远程 ${viewedBranchSync.upstream_short_id}）` : ''}。点击查看远程历史；可用右侧「获取」更新远程信息。`
                                : `落后远程 ${viewedBranchSync.behind} 个提交`
                            }
                            onClick={() => {
                              const up = viewedBranchSync.upstream_name?.trim()
                              if (up && onCommitLogRevChange) {
                                onCommitLogRevChange(branchRevSpec(up, true))
                              }
                            }}
                          >
                            <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />
                            落后 {viewedBranchSync.behind}
                          </button>
                        ) : null}
                        {viewedBranchSync.behind > 0 &&
                        (onFastForwardViewedBranch || onCheckoutAndPullViewedBranch) ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 shrink-0 gap-0.5 px-1.5 text-[11px] text-amber-800 hover:text-amber-900 dark:text-amber-200"
                            disabled={syncBusy || viewedPullSubmitting}
                            title={
                              viewedBranchSync.ahead > 0
                                ? `本地 ${viewedOtherLocalBranch} 与远程已分叉，需先切换再拉取`
                                : `快进本地 ${viewedOtherLocalBranch}（不切换当前检出）`
                            }
                            onClick={() => setViewedPullDialogOpen(true)}
                          >
                            <GitPullRequest className="h-3 w-3" aria-hidden />
                            拉取
                          </Button>
                        ) : null}
                        {viewedBranchSync.ahead > 0 ? (
                          <span
                            className="inline-flex h-6 max-w-full items-center gap-0.5 truncate rounded-md border border-sky-500/35 bg-sky-500/10 px-1.5 text-[11px] font-medium text-sky-800 dark:text-sky-200"
                            title={
                              viewedBranchSync.upstream_name
                                ? `本地 ${viewedOtherLocalBranch} 比 ${viewedBranchSync.upstream_name} 超前 ${viewedBranchSync.ahead} 个提交`
                                : `超前远程 ${viewedBranchSync.ahead} 个提交`
                            }
                          >
                            <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
                            超前 {viewedBranchSync.ahead}
                          </span>
                        ) : null}
                        {viewedBranchSync.ahead === 0 && viewedBranchSync.behind === 0 ? (
                          <span
                            className="inline-flex h-6 items-center gap-0.5 rounded-md px-1 text-[11px] text-muted-foreground"
                            title={
                              viewedBranchSync.upstream_name
                                ? `与 ${viewedBranchSync.upstream_name} 一致`
                                : '已与远程同步'
                            }
                          >
                            已同步
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span
                        className="inline-flex h-6 items-center truncate rounded-md px-1 text-[11px] text-amber-700 dark:text-amber-300"
                        title="这条本地分支还没有对应的远程跟踪，无法比较是否落后"
                      >
                        无远程跟踪
                      </span>
                    )}
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {hasActiveFilters && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 gap-0.5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={clearAllFilters}
                    title="清空日期、关键词与分支筛选"
                  >
                    <X className="h-3 w-3" aria-hidden />
                    清空
                  </Button>
                )}
                {!rightPanelCollapsed ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground sm:w-auto sm:gap-1 sm:px-2"
                    onClick={() => setRightPanelCollapsed(true)}
                    title="隐藏右侧（提交摘要、文件列表、差异），仅保留本列表"
                    aria-label="仅列表"
                  >
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    <span className="hidden sm:inline">仅列表</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 w-6 shrink-0 p-0 sm:w-auto sm:gap-1 sm:px-2 sm:text-xs"
                    onClick={() => setRightPanelCollapsed(false)}
                    title="恢复右侧提交详情与变更"
                    aria-label="显示详情"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                    <span className="hidden sm:inline">显示详情</span>
                  </Button>
                )}
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-1.5">
              <div className="relative w-full min-w-[8rem] max-w-[16rem] shrink">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="筛选已加载的提交"
                  value={pendingSearch}
                  onChange={(e) => setPendingSearch(e.target.value)}
                  aria-label="按关键词筛选已加载的提交"
                  className="h-6 w-full min-w-0 border-border/70 bg-background py-0 pl-7 pr-2 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
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
                  className="h-6 shrink-0 px-2 text-xs"
                  disabled={searchLoading}
                  onClick={() => onSearchFullRepo?.(pendingSearch.trim())}
                  title="在整个仓库历史中搜索关键词"
                >
                  {searchLoading ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  ) : (
                    '全库'
                  )}
                </Button>
              )}
              {isSearchMode && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-xs"
                  onClick={() => {
                    setPendingSearch('')
                    onClearSearchMode?.()
                  }}
                  title="退出全库搜索，回到当前列表"
                >
                  恢复列表
                </Button>
              )}
              <div className="flex h-6 shrink-0 items-center">
              <Popover open={dateFilterOpen} onOpenChange={setDateFilterOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant={dateFilterActive ? 'secondary' : 'outline'}
                    size="sm"
                    className={cn(
                      'h-6 max-w-[12rem] shrink-0 gap-1 px-1.5 text-xs font-normal',
                      dateFilterActive && 'rounded-r-none border-r-0'
                    )}
                    title="按提交日期筛选"
                    aria-label="按日期筛选"
                  >
                    <Calendar className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{dateFilterLabel}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto p-3"
                  align="start"
                  onInteractOutside={(event) => {
                    const target = event.target as HTMLElement | null
                    if (target?.closest('[data-commit-date-picker]')) {
                      event.preventDefault()
                    }
                  }}
                >
                  <div className="flex flex-col gap-2.5">
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => {
                          applyDateRange('', '')
                          setDateFilterOpen(false)
                        }}
                      >
                        全部
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => {
                          const ymd = formatLocalYmd(new Date())
                          applyDateRange(ymd, ymd)
                          setDateFilterOpen(false)
                        }}
                      >
                        今日
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => {
                          const end = new Date()
                          const start = new Date(end)
                          start.setDate(start.getDate() - 6)
                          applyDateRange(formatLocalYmd(start), formatLocalYmd(end))
                          setDateFilterOpen(false)
                        }}
                      >
                        近 7 天
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => {
                          const end = new Date()
                          const start = new Date(end)
                          start.setDate(start.getDate() - 29)
                          applyDateRange(formatLocalYmd(start), formatLocalYmd(end))
                          setDateFilterOpen(false)
                        }}
                      >
                        近 30 天
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <CommitDatePickerButton
                        value={pendingStart}
                        onChange={(ymd) => {
                          setPendingStart(ymd)
                          setAppliedStart(ymd)
                        }}
                        placeholder="开始"
                        title="开始日期"
                        className="h-6 w-[7.25rem] max-w-none justify-start px-1.5 text-xs"
                      />
                      <span className="shrink-0 text-[10px] text-muted-foreground/70">–</span>
                      <CommitDatePickerButton
                        value={pendingEnd}
                        onChange={(ymd) => {
                          setPendingEnd(ymd)
                          setAppliedEnd(ymd)
                        }}
                        placeholder="结束"
                        title="结束日期"
                        className="h-6 w-[7.25rem] max-w-none justify-start px-1.5 text-xs"
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              {dateFilterActive ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-6 w-6 shrink-0 rounded-l-none"
                  title="清除日期筛选"
                  aria-label="清除日期筛选"
                  onClick={() => applyDateRange('', '')}
                >
                  <X className="h-3 w-3" aria-hidden />
                </Button>
              ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                disabled={filteredCommits.length === 0}
                onClick={openCommitListDialog}
                title="列出当前筛选下已加载的全部提交（时间升序），便于复制"
                aria-label="提交列表"
              >
                <ClipboardList className="h-3.5 w-3.5" />
              </Button>
            </div>

            {listError && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {listError}
              </p>
            )}

            <div className="flex min-w-0 items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                <p
                  className="min-w-0 truncate text-[10px] leading-none text-muted-foreground"
                  title={commitListMetaTitle}
                >
                  {commitListCountLabel}
                  {commitListTotalLabel ? ` · ${commitListTotalLabel}` : ''}
                  {!isSearchMode && filteredCommits.length !== commits.length
                    ? ` · 显示 ${filteredCommits.length}`
                    : ''}
                  {!commitLogRev && headShortNormalized ? ` · ${headShortId?.trim()}` : ''}
                </p>
                {railFilterEnabled && graphRailBranchFilter ? (
                  <button
                    type="button"
                    className="max-w-[8rem] shrink-0 truncate font-mono text-[10px] text-foreground underline decoration-dotted underline-offset-2 hover:text-primary"
                    title={`${graphRailBranchFilter}\n点击清除分支筛选`}
                    onClick={() => setGraphRailBranchFilter(null)}
                  >
                    {graphRailBranchFilter}
                  </button>
                ) : null}
              </div>
              <RemoteSyncBar
                ahead={viewedOtherLocalBranch ? 0 : aheadCount}
                behind={viewedOtherLocalBranch ? 0 : behindCount}
                hasUpstream={viewedOtherLocalBranch ? true : hasUpstream}
                hasOriginRemote={hasOriginRemote}
                showStatus={!viewedOtherLocalBranch}
                disabled={syncBusy}
                onFetchChanges={onFetchChanges ? handleFetchForView : undefined}
                onPullChanges={
                  viewedOtherLocalBranch ? undefined : onPullChanges
                }
                onPushChanges={
                  viewedOtherLocalBranch ? undefined : onPushChanges
                }
                onRefresh={onRefreshRepo ? handleRefreshForView : undefined}
                refreshTitle="刷新仓库与提交列表"
                density="compact"
                className="ml-auto shrink-0 border-0 bg-transparent p-0"
                repoPath={repoPath}
                onPendingCommitClick={(commit) => {
                  void handleCommitSelect(commit, { scrollIntoView: true })
                }}
              />
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
            <div
              ref={commitListScrollRef}
              tabIndex={0}
              role="listbox"
              aria-label="提交列表，↑/↓ 移动，Home/End 跳转"
              onKeyDown={handleCommitListKeyDown}
              className="h-full min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-400/30 scrollbar-track-transparent outline-none dark:scrollbar-thumb-zinc-600/35"
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
                  branchRailColumns={
                    railFilterEnabled &&
                    graphBranchModeReady &&
                    branchRailColumns.length > 0
                      ? branchRailColumns
                      : undefined
                  }
                  branchNamesByCommitId={
                    railFilterEnabled &&
                    graphBranchModeReady &&
                    branchNamesByCommitIdForGraph.size > 0
                      ? branchNamesByCommitIdForGraph
                      : undefined
                  }
                  selectedGraphBranchRail={railFilterEnabled ? graphRailBranchFilter : null}
                  onGraphBranchRailClick={
                    railFilterEnabled ? onGraphBranchRailClick : undefined
                  }
                  rowHeights={
                    commitGraphRowHeights.length === filteredCommits.length
                      ? commitGraphRowHeights
                      : undefined
                  }
                />
                <div className="flex min-w-0 flex-1 flex-col">
              {filteredCommits.map((commit, i) => {
                const atHead = isCommitCheckedOut(commit)
                const branchTips = branchTipsByCommit.get(commit.id)
                /** 引用与说明同一行，标签过多会挤掉标题，上限收紧 */
                const maxBranchBadges = 8
                const allBranchesTitle =
                  branchTips && branchTips.length > 0
                    ? branchTips
                        .map((b) => `${b.is_remote ? '远程' : '本地'} ${b.name}`)
                        .join('\n')
                    : undefined

                /**
                 * 行内只显示引用 tip（远端/本地当前指向的提交）。按竖线筛选时突出匹配徽章。
                 */
                let shownBranches: typeof branchTips
                let moreBranchCount = 0
                let moreBranchTitle: string | undefined = allBranchesTitle
                if (railFilterEnabled && graphRailBranchFilter && branchTips?.length) {
                  const hit = branchTips.filter((b) =>
                    tipMatchesGraphRail(b, graphRailBranchFilter)
                  )
                  if (hit.length > 0) {
                    shownBranches = hit
                    const hiddenOthers = branchTips.length - hit.length
                    if (hiddenOthers > 0) {
                      moreBranchCount = hiddenOthers
                      moreBranchTitle = `另有 ${hiddenOthers} 个其它引用指向此提交\n\n${allBranchesTitle ?? ''}`
                    }
                  } else {
                    shownBranches = branchTips.slice(0, maxBranchBadges)
                    moreBranchCount =
                      branchTips.length > maxBranchBadges
                        ? branchTips.length - maxBranchBadges
                        : 0
                  }
                } else {
                  shownBranches = branchTips?.slice(0, maxBranchBadges)
                  moreBranchCount =
                    branchTips && branchTips.length > maxBranchBadges
                      ? branchTips.length - maxBranchBadges
                      : 0
                }
                const isRowSelected = selectedCommit?.id === commit.id

                return (
                <div
                  key={commit.id}
                  id={`commit-row-${commit.id}`}
                  data-commit-id={commit.id}
                  role="option"
                  aria-selected={isRowSelected}
                  ref={(el) => {
                    commitRowElsRef.current[i] = el
                  }}
                  className={cn(
                    'group relative flex min-h-[2.25rem] shrink-0 cursor-pointer flex-col justify-center border-b border-border/20 transition-colors duration-100 last:border-b-0',
                    atHead &&
                      'bg-emerald-500/[0.07] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-emerald-500/85 before:content-[""] dark:bg-emerald-500/[0.09] dark:before:bg-emerald-400/80',
                    !atHead && isRowSelected && 'bg-primary/[0.09] ring-1 ring-inset ring-primary/18 dark:bg-primary/[0.12]',
                    atHead &&
                      isRowSelected &&
                      'bg-emerald-500/[0.11] ring-1 ring-inset ring-emerald-500/25 dark:bg-emerald-500/[0.13]',
                    !isRowSelected && 'hover:bg-muted/35 dark:hover:bg-muted/15'
                  )}
                  onClick={() => {
                    void handleCommitSelect(commit, { scrollIntoView: false })
                    // 保持焦点在列表容器内，便于随后用方向键继续移动
                    commitListScrollRef.current?.focus()
                  }}
                  onContextMenu={(e) => {
                    // 始终阻止系统默认菜单，避免“默认菜单”覆盖自定义菜单
                    e.preventDefault()
                    e.stopPropagation()
                    if (
                      !onResetToCommit &&
                      !onCreateBranch &&
                      !onCherryPickCommit &&
                      !onRevertCommit &&
                      !onRebaseToCommit
                    ) {
                      return
                    }
                    setCommitContextMenu({ x: e.clientX, y: e.clientY, commit })
                  }}
                >
                  <div className="relative min-h-0 py-[0.35rem] pl-3 pr-1 sm:pr-1.5">
                    {/* 悬停操作：复制哈希 / 重置（与右键菜单一致） */}
                    <div className="pointer-events-none absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-background/85 opacity-0 ring-1 ring-border/40 backdrop-blur-[2px] transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 dark:bg-zinc-900/80">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
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
                          className="h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-40"
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

                    <div className="min-w-0 space-y-0.5 pr-9">
                      <div className="flex w-fit max-w-full min-w-0 items-center gap-1.5">
                          {atHead && (
                            <span
                              className="inline-flex h-4 shrink-0 items-center rounded border border-emerald-500/35 bg-emerald-500/15 px-1 text-[9px] font-semibold uppercase leading-none tracking-wide text-emerald-800 dark:text-emerald-300/95"
                              title="当前工作区检出（HEAD）"
                            >
                              HEAD
                            </span>
                          )}
                          {shownBranches?.map((b) => {
                            const railName = resolveGraphRailName(b.name, branchRailColumns)
                            const railActive =
                              railFilterEnabled &&
                              !!graphRailBranchFilter &&
                              tipMatchesGraphRail(b, graphRailBranchFilter)
                            const label = formatBranchLabelShort(b.name)
                            return (
                            <Badge
                              key={`${b.name}-${b.is_remote ? 'r' : 'l'}`}
                              variant="outline"
                              role={railFilterEnabled ? 'button' : undefined}
                              tabIndex={railFilterEnabled ? 0 : undefined}
                              className={cn(
                                'h-4 min-w-0 max-w-[7.5rem] shrink-0 justify-center border-border/50 bg-background/40 px-1 py-0 text-[9px] font-medium leading-none',
                                railFilterEnabled && 'cursor-pointer select-none hover:bg-muted/50',
                                branchBadgeClassName(b.name),
                                b.is_remote && 'border-dashed',
                                /* Badge 默认带 ring-offset-2，叠 inset ring 易发白；焦点与选中均取消 offset */
                                'focus:outline-none focus:ring-1 focus:ring-offset-0 focus-visible:ring-offset-0',
                                'focus:ring-emerald-600/40 dark:focus:ring-emerald-400/35',
                                railActive &&
                                  'shadow-[inset_0_0_0_1px] shadow-emerald-700/45 dark:shadow-emerald-400/40'
                              )}
                              title={
                                railFilterEnabled
                                  ? `${b.is_remote ? '远程跟踪' : '本地分支'}：${b.name}（当前指向此提交）\n点击：仅看此分支（与左侧竖线相同；再点此徽章或竖线可清除）`
                                  : `${b.is_remote ? '远程跟踪' : '本地分支'}：${b.name}（当前指向此提交）`
                              }
                              onClick={
                                railFilterEnabled
                                  ? (e) => {
                                      e.stopPropagation()
                                      onGraphBranchRailClick(railName)
                                    }
                                  : undefined
                              }
                              onKeyDown={
                                railFilterEnabled
                                  ? (e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        onGraphBranchRailClick(railName)
                                      }
                                    }
                                  : undefined
                              }
                            >
                              <span className="min-w-0 truncate">{label}</span>
                            </Badge>
                            )
                          })}
                          {moreBranchCount > 0 && (
                            <span
                              className="shrink-0 text-[9px] text-muted-foreground"
                              title={moreBranchTitle}
                            >
                              +{moreBranchCount}
                            </span>
                          )}
                          {pendingPullIds.has(commit.id) && (
                            <span
                              className="inline-flex h-4 shrink-0 items-center rounded border border-amber-500/30 bg-amber-500/12 px-1 text-[9px] font-medium leading-none text-amber-900 dark:text-amber-200/95"
                              title="远程已有、本地尚未拉取合并的提交"
                            >
                              待拉取
                            </span>
                          )}
                          {pendingPushIds.has(commit.id) && (
                            <span className="inline-flex h-4 shrink-0 items-center rounded border border-blue-500/30 bg-blue-500/12 px-1 text-[9px] font-medium leading-none text-blue-900 dark:text-blue-200/95">
                              待推送
                            </span>
                          )}
                        <p
                          className="min-w-0 truncate text-[13px] font-medium leading-tight tracking-tight text-foreground/95"
                          title={commit.message}
                        >
                          {commit.message}
                        </p>
                        <span
                          className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/75"
                          title={commit.id}
                        >
                          {commit.short_id}
                        </span>
                      </div>

                      <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                        <span className="min-w-0 truncate">{commit.author}</span>
                        <span className="shrink-0 opacity-40">·</span>
                        <span className="shrink-0 tabular-nums opacity-90">{commit.date}</span>
                      </div>
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
                  在左侧提交记录中点击任意一条，右侧将显示该提交的说明与文件列表。可拖动中间竖条调整列表宽度。在提交项上右键可执行历史操作（分支、重置、cherry-pick、revert、rebase）。
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
                <CardHeader className="flex-shrink-0 border-b border-border/35 py-1.5 pl-2.5 pr-2 sm:pl-3">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                      <FileText className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                      <span className="truncate">文件变更</span>
                      {commitFiles.length > 0 && (
                        <span className="shrink-0 font-normal text-muted-foreground" title={fileFilterActive ? `筛选后 ${visibleCommitFiles.length} / 共 ${commitFiles.length} 个文件` : undefined}>
                          {fileFilterActive
                            ? `${visibleCommitFiles.length}/${commitFiles.length}`
                            : `(${commitFiles.length})`}
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
                <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-1.5 py-1 sm:px-2">
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
                    <>
                      <FileChangeFilterBar
                        query={fileQuery}
                        onQueryChange={setFileQuery}
                        status={fileStatusFilter}
                        onStatusChange={setFileStatusFilter}
                        buckets={fileStatusBuckets}
                      />
                      <div
                        ref={fileListScrollRef}
                        tabIndex={0}
                        role="listbox"
                        aria-label="变更文件列表，↑/↓ 移动，Home/End 跳转，回车选中"
                        onKeyDown={handleFileListKeyDown}
                        className="scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent min-h-0 flex-1 space-y-px overflow-y-auto outline-none"
                      >
                        {visibleCommitFiles.length === 0 ? (
                          <p className="py-8 text-center text-sm text-muted-foreground">
                            没有匹配的文件变更
                          </p>
                        ) : (
                          visibleCommitFiles.map((file) => (
                            <FileItem
                              key={file.path}
                              file={file}
                              isSelected={selectedFile === file.path}
                              onSelect={handleFileSelect}
                              getStatusIcon={getStatusIcon}
                            />
                          ))
                        )}
                      </div>
                    </>
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
                        <div className="flex min-h-[280px] flex-1 flex-col overflow-hidden">
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
                window.innerHeight - commitContextMenuViewportMargin
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
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={syncBusy || isCommitCheckedOut(commitContextMenu.commit)}
                  title={
                    isCommitCheckedOut(commitContextMenu.commit)
                      ? '工作区已在此提交'
                      : '将分支重置到该提交（本地回退，不影响远端，需推送才同步）'
                  }
                  onClick={() => {
                    openResetDialogForCommit(commitContextMenu.commit)
                    setCommitContextMenu(null)
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                  回退/重置到此提交
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm text-amber-700 hover:bg-amber-500/10 dark:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={syncBusy || isCommitCheckedOut(commitContextMenu.commit)}
                  title="本地硬回退到该提交（git reset --hard），仅改本地，不推远端，适合造待拉测试"
                  onClick={async () => {
                    const c = commitContextMenu.commit
                    setCommitContextMenu(null)
                    if (!onResetToCommit) return
                    if (!confirm(`本地回退到 ${c.short_id} ${c.message.split('\n')[0]}？\n仅本地 --hard，不影响远端，之后可用“拉取”拉回。`)) return
                    try {
                      await onResetToCommit(c.id, 'hard')
                    } catch {}
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                  快速回退（--hard，测试用）
                </button>
              </>
            )}
            {onCherryPickCommit && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={syncBusy || isCommitCheckedOut(commitContextMenu.commit)}
                title="将该提交应用到当前分支（git cherry-pick）"
                onClick={() => {
                  openCherryPickDialogForCommit(commitContextMenu.commit)
                  setCommitContextMenu(null)
                }}
              >
                <Copy className="h-3.5 w-3.5 shrink-0" />
                Cherry-pick 此提交
              </button>
            )}
            {onRevertCommit && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={syncBusy || isCommitCheckedOut(commitContextMenu.commit)}
                title="生成一个反做该提交的新提交（git revert）"
                onClick={() => {
                  openRevertDialogForCommit(commitContextMenu.commit)
                  setCommitContextMenu(null)
                }}
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                Revert 此提交
              </button>
            )}
            {onRebaseToCommit && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={syncBusy || isCommitCheckedOut(commitContextMenu.commit)}
                title="将当前分支 rebase 到该提交（git rebase <commit>）"
                onClick={() => {
                  openRebaseDialogForCommit(commitContextMenu.commit)
                  setCommitContextMenu(null)
                }}
              >
                <GitCompare className="h-3.5 w-3.5 shrink-0" />
                Rebase 到此提交
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
            <DialogTitle>回退/重置到该提交 — 仅本地，不影响远端</DialogTitle>
            <p className="text-xs text-muted-foreground pt-1">本地 git reset，推送前远端不变；选 --hard 可造“待拉”用于测试拉取</p>
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

      <Dialog
        open={cherryPickDialogOpen}
        onOpenChange={(open) => {
          setCherryPickDialogOpen(open)
          if (!open) {
            setCherryPickDialogError(null)
            setCherryPickTargetCommit(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cherry-pick 提交</DialogTitle>
          </DialogHeader>
          {cherryPickTargetCommit && (
            <div className="space-y-4 text-sm">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <p className="font-mono text-xs text-muted-foreground">{cherryPickTargetCommit.short_id}</p>
                <p className="mt-1 line-clamp-2 text-foreground" title={cherryPickTargetCommit.message}>
                  {cherryPickTargetCommit.message.split('\n')[0]}
                </p>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                将把该提交应用到当前分支并生成新提交。若发生冲突，需要先解决冲突后再继续或中止。
              </p>
              {cherryPickDialogError && (
                <p className="whitespace-pre-wrap text-xs text-destructive">{cherryPickDialogError}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCherryPickDialogOpen(false)}
                  disabled={cherryPickSubmitting}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleConfirmCherryPick()}
                  disabled={cherryPickSubmitting}
                >
                  {cherryPickSubmitting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      执行中…
                    </span>
                  ) : (
                    '确认 Cherry-pick'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={revertDialogOpen}
        onOpenChange={(open) => {
          setRevertDialogOpen(open)
          if (!open) {
            setRevertDialogError(null)
            setRevertTargetCommit(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revert 提交</DialogTitle>
          </DialogHeader>
          {revertTargetCommit && (
            <div className="space-y-4 text-sm">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <p className="font-mono text-xs text-muted-foreground">{revertTargetCommit.short_id}</p>
                <p className="mt-1 line-clamp-2 text-foreground" title={revertTargetCommit.message}>
                  {revertTargetCommit.message.split('\n')[0]}
                </p>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                将创建一个“反向提交”来撤销该提交的改动，不会改写已有历史。
              </p>
              {revertDialogError && (
                <p className="whitespace-pre-wrap text-xs text-destructive">{revertDialogError}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRevertDialogOpen(false)}
                  disabled={revertSubmitting}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleConfirmRevert()}
                  disabled={revertSubmitting}
                >
                  {revertSubmitting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      执行中…
                    </span>
                  ) : (
                    '确认 Revert'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={rebaseDialogOpen}
        onOpenChange={(open) => {
          setRebaseDialogOpen(open)
          if (!open) {
            setRebaseDialogError(null)
            setRebaseTargetCommit(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rebase 到此提交</DialogTitle>
          </DialogHeader>
          {rebaseTargetCommit && (
            <div className="space-y-4 text-sm">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <p className="font-mono text-xs text-muted-foreground">{rebaseTargetCommit.short_id}</p>
                <p className="mt-1 line-clamp-2 text-foreground" title={rebaseTargetCommit.message}>
                  {rebaseTargetCommit.message.split('\n')[0]}
                </p>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                等价于 <span className="font-mono">git rebase &lt;commit&gt;</span>。会改写当前分支历史，推送前请确认团队协作策略。
              </p>
              {rebaseDialogError && (
                <p className="whitespace-pre-wrap text-xs text-destructive">{rebaseDialogError}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRebaseDialogOpen(false)}
                  disabled={rebaseSubmitting}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => void handleConfirmRebase()}
                  disabled={rebaseSubmitting}
                >
                  {rebaseSubmitting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      执行中…
                    </span>
                  ) : (
                    '确认 Rebase'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={viewedPullDialogOpen}
        onOpenChange={(open) => {
          if (viewedPullSubmitting) return
          setViewedPullDialogOpen(open)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {viewedBranchSync && viewedBranchSync.ahead > 0
                ? '需要切换后再拉取'
                : `快进更新 ${viewedOtherLocalBranch ?? ''}`}
            </DialogTitle>
          </DialogHeader>
          {viewedOtherLocalBranch && viewedBranchSync ? (
            <div className="space-y-3 text-sm">
              {viewedBranchSync.ahead > 0 ? (
                <p className="text-muted-foreground">
                  本地 <span className="font-medium text-foreground">{viewedOtherLocalBranch}</span>{' '}
                  与远程已分叉（超前 {viewedBranchSync.ahead}，落后 {viewedBranchSync.behind}
                  ），无法在不切换的情况下快进。将先切换到该分支，再拉取远程。
                </p>
              ) : (
                <p className="text-muted-foreground">
                  将把本地 <span className="font-medium text-foreground">{viewedOtherLocalBranch}</span>{' '}
                  快进 {viewedBranchSync.behind} 个提交
                  {viewedBranchSync.upstream_name
                    ? `（对齐 ${viewedBranchSync.upstream_name}）`
                    : ''}
                  。工作区仍停留在当前检出分支，不会切走。
                </p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setViewedPullDialogOpen(false)}
                  disabled={viewedPullSubmitting}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void confirmViewedBranchPull()}
                  disabled={
                    viewedPullSubmitting ||
                    syncBusy ||
                    (viewedBranchSync.ahead > 0
                      ? !onCheckoutAndPullViewedBranch
                      : !onFastForwardViewedBranch)
                  }
                >
                  {viewedPullSubmitting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      进行中…
                    </span>
                  ) : viewedBranchSync.ahead > 0 ? (
                    '切换并拉取'
                  ) : (
                    '快进更新'
                  )}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
