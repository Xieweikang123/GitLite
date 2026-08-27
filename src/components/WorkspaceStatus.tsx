import { useState, useEffect, useRef } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { FileChange, type WorkspaceGitActions, type CommitInfo } from '../types/git'
import { FileDiffModal } from './FileDiffModal'
import { Eye, Archive, ArchiveRestore, Trash2, CheckCircle, AlertCircle, Loader2, Sparkles, RotateCcw } from 'lucide-react'
import { shortenPathMiddle } from '../lib/utils'
import { formatTauriInvokeError } from '../utils/tauriError'
import { getClientCalendarOffsetEastMinutes } from '../utils/clientCalendarOffset'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { RemoteSyncBar } from './RemoteSyncBar'

interface WorkspaceStatusProps {
  repoInfo: any
  onRefresh: () => void
  onPushChanges?: () => void
  onPullChanges?: () => void
  onFetchChanges?: () => void
  gitActions?: WorkspaceGitActions
  onJumpToCommit?: (commit: CommitInfo) => void
}

interface WorkspaceStatusData {
  staged_files: FileChange[]
  unstaged_files: FileChange[]
  untracked_files: string[]
  conflicted_files?: FileChange[]
}

/** 与后端 normalize_repo_rel_path 对齐，避免 Windows 反斜杠与 Git 索引路径不一致 */
function normalizeFilePathForGit(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

interface StashInfo {
  id: string
  message: string
  timestamp: string
  branch: string
}

/** 后端时间为 Git commit 的 Unix 秒（字符串），需乘 1000 再交给 Date，否则会得到 Invalid Date */
function formatStashTimestamp(isoOrSeconds: string): string {
  const trimmed = isoOrSeconds.trim()
  if (!trimmed) return '—'
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed)
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
  }
  const sec = Number(trimmed)
  if (!Number.isFinite(sec) || sec <= 0) return '—'
  const d = new Date(sec * 1000)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export function WorkspaceStatus({
  repoInfo,
  onRefresh,
  onPushChanges,
  onPullChanges,
  onFetchChanges,
  gitActions,
  onJumpToCommit,
}: WorkspaceStatusProps) {
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatusData | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [loading, setLoading] = useState(false)
  /** 提交并同步/推送的独立加载态，避免被其他通用 loading（如状态刷新）中途覆盖 */
  const [syncLoading, setSyncLoading] = useState(false)
  /** 取消暂存进行中：IPC + 拉状态可能较慢；记录 path 以便在行内按钮上显示加载 */
  const [unstagingLoading, setUnstagingLoading] = useState(false)
  const [unstagingTargetPath, setUnstagingTargetPath] = useState<string | null>(null)
  /** 暂存 / 添加 进行中：同上 */
  const [stagingLoading, setStagingLoading] = useState(false)
  const [stagingTargetPath, setStagingTargetPath] = useState<string | null>(null)
  /** 批量暂存时区分「未暂存」与「未跟踪」，用于横幅与行内按钮 loading */
  const [stagingBulkType, setStagingBulkType] = useState<'unstaged' | 'untracked' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncInfo, setSyncInfo] = useState<string | null>(null)
  const [syncStep, setSyncStep] = useState<string | null>(null)
  const [abortingMerge, setAbortingMerge] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshIntervalSec] = useState(10)
  /** 避免自动刷新与上一次 IPC 重叠（大仓库 get_workspace_status 可能较慢） */
  const silentRefreshInFlightRef = useRef(false)
  /**
   * 防止多路 status 请求乱序：`定时刷新` 先于 `暂存/取消暂存` 发出但后返回时，
   * 会覆盖乐观更新，造成「消失 → 又出现 → 再消失」。
   * 仅应用 requestGen 仍等于当前值的响应。
   */
  const workspaceStatusFetchGenRef = useRef(0)
  
  // 文件差异查看状态
  const [diffModalOpen, setDiffModalOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{
    path: string
    type: 'staged' | 'unstaged' | 'untracked' | 'conflicted'
  } | null>(null)
  
  // 贮藏相关状态
  const [stashList, setStashList] = useState<StashInfo[]>([])
  const [stashMessage, setStashMessage] = useState('')
  // 旧的内联贮藏输入已移除
  const [stashDialogOpen, setStashDialogOpen] = useState(false)
  /** 贮藏操作进行中：区分创建 / 某条的应用或删除，避免「应用」时顶栏误显示「贮藏中」 */
  const [stashOp, setStashOp] = useState<
    null | { kind: 'create' } | { kind: 'apply'; id: string } | { kind: 'delete'; id: string }
  >(null)
  /** 打开弹窗拉取贮藏列表时 */
  const [stashListLoading, setStashListLoading] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  /** 删除未跟踪：确认弹窗 */
  const [untrackedDeleteConfirm, setUntrackedDeleteConfirm] = useState<
    null | { kind: 'one'; path: string } | { kind: 'all' }
  >(null)
  const [deletingUntrackedPath, setDeletingUntrackedPath] = useState<string | null>(null)
  const [deletingAllUntracked, setDeletingAllUntracked] = useState(false)
  /** 丢弃未暂存修改：确认弹窗 */
  const [unstagedDiscardConfirm, setUnstagedDiscardConfirm] = useState<
    null | { kind: 'one'; path: string } | { kind: 'all' }
  >(null)
  const [discardingUnstagedPath, setDiscardingUnstagedPath] = useState<string | null>(null)
  const [discardingAllUnstaged, setDiscardingAllUnstaged] = useState(false)
  /** AI 根据暂存区生成提交说明 */
  const [aiCommitMessageLoading, setAiCommitMessageLoading] = useState(false)

  // 获取工作区状态（silent：后台定时刷新，不占满屏 loading，减轻卡顿）
  const fetchWorkspaceStatus = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    if (!repoInfo) return

    const requestGen = ++workspaceStatusFetchGenRef.current

    try {
      if (!silent) {
        setLoading(true)
        setError(null)
      }
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      const status: WorkspaceStatusData = await invoke('get_workspace_status', {
        repoPath: repoInfo.path,
      })

      if (requestGen !== workspaceStatusFetchGenRef.current) return

      setWorkspaceStatus({
        ...status,
        conflicted_files: status.conflicted_files ?? [],
      })
    } catch (err) {
      if (requestGen !== workspaceStatusFetchGenRef.current) return
      setError(err instanceof Error ? err.message : '获取工作区状态失败')
    } finally {
      // 不与生 successful 响应一同做 gen 校验：若本次为 !silent 但被更新的 silent 请求抢了代，
      // 仍须关掉 loading，否则界面会一直转圈。
      if (!silent) {
        setLoading(false)
      }
    }
  }

  // 获取贮藏列表
  const fetchStashList = async () => {
    if (!repoInfo) return

    const showListSpinner = stashDialogOpen
    try {
      if (showListSpinner) setStashListLoading(true)
      const { invoke } = await import('@tauri-apps/api/tauri')
      const stashes: StashInfo[] = await invoke('get_stash_list', {
        repoPath: repoInfo.path,
      })

      setStashList(stashes)
    } catch (err) {
      console.error('获取贮藏列表失败:', err)
    } finally {
      if (showListSpinner) setStashListLoading(false)
    }
  }

  /** 工作区页完整刷新：文件变更 + stash + 父级仓库信息（ahead/behind 等）。RemoteSyncBar 的刷新也走此路径，避免只刷新远程数字、列表仍陈旧。 */
  const handleManualRefresh = async () => {
    await fetchWorkspaceStatus()
    await fetchStashList()
    await Promise.resolve(onRefresh())
  }

  // 打开贮藏对话框时加载列表
  useEffect(() => {
    if (stashDialogOpen) {
      fetchStashList()
    }
  }, [stashDialogOpen])

  useEffect(() => {
    if (!syncInfo) return
    const timer = window.setTimeout(() => setSyncInfo(null), 4000)
    return () => window.clearTimeout(timer)
  }, [syncInfo])

  // 创建贮藏
  const createStash = async () => {
    if (!repoInfo || !stashMessage.trim()) return

    try {
      setStashOp({ kind: 'create' })
      setError(null)

      console.log(`开始创建贮藏: ${stashMessage.trim()}`)
      console.log(`仓库路径: ${repoInfo.path}`)

      const { invoke } = await import('@tauri-apps/api/tauri')
      const result = await invoke('create_stash', {
        repoPath: repoInfo.path,
        message: stashMessage.trim(),
      })

      console.log('贮藏创建成功:', result)

      setStashMessage('')
      await fetchWorkspaceStatus({ silent: true })
      await fetchStashList()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '创建贮藏失败'
      console.error('贮藏创建失败:', {
        message: stashMessage.trim(),
        repoPath: repoInfo?.path,
        error: err,
        errorMessage
      })
      setError(`创建贮藏失败: ${errorMessage}`)
    } finally {
      setStashOp(null)
    }
  }

  // 应用贮藏
  const applyStash = async (stashId: string) => {
    if (!repoInfo) return

    try {
      setStashOp({ kind: 'apply', id: stashId })
      setError(null)

      // 记录操作开始
      console.log(`开始应用贮藏: ${stashId}`)
      console.log(`仓库路径: ${repoInfo.path}`)

      const { invoke } = await import('@tauri-apps/api/tauri')
      const result = await invoke('apply_stash', {
        repoPath: repoInfo.path,
        stashId,
      })

      // 显示成功消息
      console.log('贮藏应用成功:', result)

      await fetchWorkspaceStatus({ silent: true })
      await fetchStashList()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '应用贮藏失败'

      // 记录详细错误信息
      console.error('贮藏应用失败:', {
        stashId,
        repoPath: repoInfo?.path,
        error: err,
        errorMessage
      })

      // 检查是否是重复应用的错误
      if (errorMessage.includes('already been applied') || errorMessage.includes('no changes to apply')) {
        // 这实际上是一个成功的情况，只是贮藏已经被应用过了
        console.log('贮藏已经被应用过了')
        await fetchWorkspaceStatus({ silent: true })
        await fetchStashList()
        return // 不显示错误，直接返回
      } else if (errorMessage.includes('conflicts')) {
        setError(`应用贮藏时发生冲突: ${errorMessage}`)
      } else if (errorMessage.includes('Stash not found')) {
        setError(`贮藏未找到: ${errorMessage}`)
      } else {
        setError(`应用贮藏失败: ${errorMessage}`)
      }
    } finally {
      setStashOp(null)
    }
  }

  // 删除贮藏
  const deleteStash = async (stashId: string) => {
    if (!repoInfo) return

    try {
      setStashOp({ kind: 'delete', id: stashId })
      setError(null)

      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('delete_stash', {
        repoPath: repoInfo.path,
        stashId,
      })

      await fetchStashList()
      setConfirmDeleteOpen(false)
      setPendingDeleteId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除贮藏失败')
    } finally {
      setStashOp(null)
    }
  }

  const askDeleteStash = (stashId: string) => {
    setPendingDeleteId(stashId)
    setConfirmDeleteOpen(true)
  }

  const askRemoveOneUntracked = (path: string) => {
    setUntrackedDeleteConfirm({ kind: 'one', path })
  }

  const askRemoveAllUntracked = () => {
    setUntrackedDeleteConfirm({ kind: 'all' })
  }

  const abortMerge = async () => {
    if (!repoInfo) return
    if (!window.confirm('放弃合并会丢弃当前冲突状态，工作区改动将丢失。继续？')) return
    try {
      setAbortingMerge(true)
      setError(null)
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('abort_merge', { repoPath: repoInfo.path })
      await fetchWorkspaceStatus()
      onRefresh?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '放弃合并失败')
    } finally {
      setAbortingMerge(false)
    }
  }

  const runUntrackedDeleteConfirm = async () => {
    if (!repoInfo || !untrackedDeleteConfirm) return
    workspaceStatusFetchGenRef.current++
    try {
      setError(null)
      const { invoke } = await import('@tauri-apps/api/tauri')
      if (untrackedDeleteConfirm.kind === 'one') {
        const norm = normalizeFilePathForGit(untrackedDeleteConfirm.path)
        setDeletingUntrackedPath(norm)
        await invoke('remove_untracked_path', {
          repoPath: repoInfo.path,
          filePath: norm,
        })
      } else {
        setDeletingAllUntracked(true)
        await invoke('remove_all_untracked_paths', {
          repoPath: repoInfo.path,
        })
      }
      setUntrackedDeleteConfirm(null)
      await fetchWorkspaceStatus({ silent: true })
    } catch (err) {
      setError(formatTauriInvokeError(err, '删除未跟踪文件失败'))
      await fetchWorkspaceStatus({ silent: true })
    } finally {
      setDeletingUntrackedPath(null)
      setDeletingAllUntracked(false)
    }
  }

  const runUnstagedDiscardConfirm = async () => {
    if (!repoInfo || !unstagedDiscardConfirm) return
    workspaceStatusFetchGenRef.current++
    try {
      setError(null)
      const { invoke } = await import('@tauri-apps/api/tauri')
      if (unstagedDiscardConfirm.kind === 'one') {
        const norm = normalizeFilePathForGit(unstagedDiscardConfirm.path)
        setDiscardingUnstagedPath(norm)
        await invoke('discard_unstaged_file', {
          repoPath: repoInfo.path,
          filePath: norm,
        })
      } else {
        setDiscardingAllUnstaged(true)
        await invoke('discard_all_unstaged', {
          repoPath: repoInfo.path,
        })
      }
      setUnstagedDiscardConfirm(null)
      await fetchWorkspaceStatus({ silent: true })
      await Promise.resolve(onRefresh())
    } catch (err) {
      setError(formatTauriInvokeError(err, '丢弃未暂存修改失败'))
      await fetchWorkspaceStatus({ silent: true })
    } finally {
      setDiscardingUnstagedPath(null)
      setDiscardingAllUnstaged(false)
    }
  }

  // 工作区 + stash 拉取（与 open_repository 等 effect 合并，避免重复 IPC）
  useEffect(() => {
    if (!repoInfo) {
      workspaceStatusFetchGenRef.current++
      setWorkspaceStatus(null)
      setStashList([])
      return
    }

    workspaceStatusFetchGenRef.current++

    let cancelled = false

    const runPull = async (silent: boolean) => {
      if (cancelled) return
      if (silent) {
        if (silentRefreshInFlightRef.current) return
        silentRefreshInFlightRef.current = true
      }
      try {
        await Promise.all([fetchWorkspaceStatus({ silent }), fetchStashList()])
      } finally {
        if (silent) {
          silentRefreshInFlightRef.current = false
        }
      }
    }

    // 首次加载始终显示 loading（除非已有数据且仅切换自动刷新 — 仍简单处理为短时 loading）
    void runPull(false)

    if (!autoRefresh) {
      return () => {
        cancelled = true
      }
    }

    const intervalMs = refreshIntervalSec * 1000
    const intervalId = window.setInterval(() => {
      void runPull(true)
    }, intervalMs)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [repoInfo, repoInfo?.head_short_id, autoRefresh, refreshIntervalSec])

  // 暂存文件（等刷新完成再更新列表，行内按钮可显示 loading，避免「添加/暂存」无反馈）
  const stageFile = async (filePath: string) => {
    if (!repoInfo) return

    const normPath = normalizeFilePathForGit(filePath)

    workspaceStatusFetchGenRef.current++
    setStagingLoading(true)
    setStagingTargetPath(normPath)

    try {
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('stage_file', {
        repoPath: repoInfo.path,
        filePath: normPath,
      })

      await fetchWorkspaceStatus({ silent: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '暂存文件失败')
      await fetchWorkspaceStatus({ silent: true })
    } finally {
      setStagingLoading(false)
      setStagingTargetPath(null)
    }
  }

  // 暂存所有未暂存的文件
  const stageAllFiles = async () => {
    if (!repoInfo || !workspaceStatus?.unstaged_files) return
    
    try {
      setLoading(true)
      setStagingLoading(true)
      setStagingTargetPath(null)
      setStagingBulkType('unstaged')
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      
      // 批量暂存所有未暂存的文件
      for (const file of workspaceStatus.unstaged_files) {
        await invoke('stage_file', {
          repoPath: repoInfo.path,
          filePath: normalizeFilePathForGit(file.path),
        })
      }
      
      await fetchWorkspaceStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量暂存失败')
    } finally {
      setLoading(false)
      setStagingLoading(false)
      setStagingBulkType(null)
    }
  }

  // 暂存全部未跟踪文件（与列表一致：不含仅表示目录的 `path/` 占位项）
  const stageAllUntracked = async () => {
    if (!repoInfo || !workspaceStatus?.untracked_files?.length) return

    const paths = workspaceStatus.untracked_files.filter((f) => !f.endsWith('/'))
    if (paths.length === 0) return

    try {
      setLoading(true)
      setStagingLoading(true)
      setStagingTargetPath(null)
      setStagingBulkType('untracked')
      setError(null)

      const { invoke } = await import('@tauri-apps/api/tauri')
      for (const file of paths) {
        await invoke('stage_file', {
          repoPath: repoInfo.path,
          filePath: normalizeFilePathForGit(file),
        })
      }

      await fetchWorkspaceStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量添加未跟踪文件失败')
    } finally {
      setLoading(false)
      setStagingLoading(false)
      setStagingBulkType(null)
    }
  }

  // 一键暂存：未暂存 + 未跟踪全部暂存
  const stageAll = async () => {
    if (!repoInfo || !workspaceStatus) return
    const hasUnstaged = workspaceStatus.unstaged_files?.length > 0
    const hasUntracked = workspaceStatus.untracked_files?.some((f) => !f.endsWith('/'))
    if (!hasUnstaged && !hasUntracked) return

    try {
      setLoading(true)
      setStagingLoading(true)
      setStagingTargetPath(null)
      setStagingBulkType('unstaged')
      setError(null)

      const { invoke } = await import('@tauri-apps/api/tauri')

      if (hasUnstaged) {
        for (const file of workspaceStatus.unstaged_files) {
          await invoke('stage_file', {
            repoPath: repoInfo.path,
            filePath: normalizeFilePathForGit(file.path),
          })
        }
      }

      if (hasUntracked) {
        const paths = workspaceStatus.untracked_files.filter((f) => !f.endsWith('/'))
        for (const file of paths) {
          await invoke('stage_file', {
            repoPath: repoInfo.path,
            filePath: normalizeFilePathForGit(file),
          })
        }
      }

      await fetchWorkspaceStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : '一键暂存失败')
    } finally {
      setLoading(false)
      setStagingLoading(false)
      setStagingBulkType(null)
    }
  }

  // 取消暂存文件（等 IPC + 刷新完成再更新列表，避免乐观移除导致按钮消失、仅靠顶部横幅易被误认为卡死）
  const unstageFile = async (filePath: string) => {
    if (!repoInfo) return

    const normPath = normalizeFilePathForGit(filePath)
    const stagedEntry = workspaceStatus?.staged_files.find(
      (f) => normalizeFilePathForGit(f.path) === normPath,
    )
    if (!stagedEntry) return

    workspaceStatusFetchGenRef.current++
    setUnstagingLoading(true)
    setUnstagingTargetPath(normPath)
    try {
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('unstage_file', {
        repoPath: repoInfo.path,
        filePath: normPath,
      })
      await fetchWorkspaceStatus({ silent: true })
    } catch (err) {
      setError(formatTauriInvokeError(err, '取消暂存文件失败'))
      await fetchWorkspaceStatus({ silent: true })
    } finally {
      setUnstagingLoading(false)
      setUnstagingTargetPath(null)
    }
  }

  // 取消所有暂存文件
  const unstageAllFiles = async () => {
    if (!repoInfo || !workspaceStatus?.staged_files?.length) return
    
    try {
      setLoading(true)
      setUnstagingLoading(true)
      setUnstagingTargetPath(null)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      
      // 批量取消暂存所有文件
      workspaceStatusFetchGenRef.current++
      for (const file of workspaceStatus.staged_files) {
        await invoke('unstage_file', {
          repoPath: repoInfo.path,
          filePath: normalizeFilePathForGit(file.path),
        })
      }
      
      // 刷新工作区状态
      await fetchWorkspaceStatus()
    } catch (err) {
      setError(formatTauriInvokeError(err, '取消所有暂存失败'))
    } finally {
      setLoading(false)
      setUnstagingLoading(false)
    }
  }

  const generateCommitMessageAi = async () => {
    if (!repoInfo) return
    try {
      setAiCommitMessageLoading(true)
      setError(null)
      const { invoke } = await import('@tauri-apps/api/tauri')
      const text = await invoke<string>('generate_commit_message_ai', {
        repoPath: repoInfo.path,
      })
      setCommitMessage(text)
    } catch (err) {
      setError(formatTauriInvokeError(err, 'AI 生成提交说明失败'))
    } finally {
      setAiCommitMessageLoading(false)
    }
  }

  /** 提交/推送/拉取后刷新父级 ahead/behind：若接入 useGit 则轻量刷新，避免整页 loading */
  const syncParentRepo = async () => {
    if (gitActions) {
      await gitActions.refreshRepoInfo()
    } else {
      await Promise.resolve(onRefresh())
    }
  }

  // 提交更改（优先经 useGit.commitChanges，错误文案统一）
  const runCommit = async () => {
    if (!repoInfo) return
    if (!commitMessage.trim()) {
      setError('请输入提交说明')
      return
    }
    if (!workspaceStatus?.staged_files?.length) {
      setError('没有已暂存的文件，无法提交')
      return
    }

    try {
      setLoading(true)
      setError(null)

      if (gitActions) {
        await gitActions.commitChanges(commitMessage.trim())
      } else {
        const { invoke } = await import('@tauri-apps/api/tauri')
        await invoke('commit_changes', {
          repoPath: repoInfo.path,
          message: commitMessage.trim(),
        })
      }

      setCommitMessage('')
      await fetchWorkspaceStatus()
      await syncParentRepo()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    } finally {
      setLoading(false)
    }
  }

  // 推送（卡片上的独立推送按钮；顶部工具条可注入 onPushChanges 走带日志的版本）
  const handlePushFromCard = async () => {
    if (!repoInfo) return

    try {
      setLoading(true)
      setSyncLoading(true)
      setError(null)
      setSyncInfo(null)
      setSyncStep('正在推送本地提交…')

      if (onPushChanges) {
        await Promise.resolve(onPushChanges())
      } else {
        if (gitActions) {
          await gitActions.pushChanges()
        } else {
          const { invoke } = await import('@tauri-apps/api/tauri')
          await invoke('push_changes', {
            repoPath: repoInfo.path,
          })
        }
      }

      await syncParentRepo()
    } catch (err) {
      setError(err instanceof Error ? err.message : '推送失败')
    } finally {
      setSyncStep(null)
      setSyncLoading(false)
      setLoading(false)
    }
  }

  // 提交并同步：1. 暂存则提交 2. 落后则拉取 3. 超前则推送
  const commitAndSync = async () => {
    if (!repoInfo) return

    let didCommit = false
    let didPull = false
    let didPush = false

    try {
      setLoading(true)
      setSyncLoading(true)
      setError(null)
      setSyncInfo(null)
      setSyncStep('正在准备同步…')

      if (workspaceStatus?.staged_files?.length) {
        if (!commitMessage.trim()) {
          setError('请先输入提交说明')
          setLoading(false)
          setSyncLoading(false)
          setSyncStep(null)
          return
        }

        setSyncStep('正在提交暂存更改…')
        if (gitActions) {
          await gitActions.commitChanges(commitMessage.trim())
        } else {
          const { invoke } = await import('@tauri-apps/api/tauri')
          await invoke('commit_changes', {
            repoPath: repoInfo.path,
            message: commitMessage.trim(),
          })
        }

        didCommit = true
        setCommitMessage('')
        await fetchWorkspaceStatus({ silent: true })
        await syncParentRepo()
      }

      setSyncStep('正在获取远程最新状态…')
      if (gitActions) {
        await gitActions.fetchChanges()
      } else {
        const { invoke } = await import('@tauri-apps/api/tauri')
        await invoke('fetch_changes', {
          repoPath: repoInfo.path,
        })
      }
      await syncParentRepo()

      let updatedRepoInfo = gitActions
        ? await gitActions.refreshRepoInfo()
        : await (async () => {
            const { invoke } = await import('@tauri-apps/api/tauri')
            return invoke('open_repository', {
              path: repoInfo.path,
              clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
            }) as Promise<any>
          })()

      if (updatedRepoInfo.behind > 0) {
        setSyncStep(`正在拉取远程更改（${updatedRepoInfo.behind}）…`)
        if (gitActions) {
          await gitActions.pullChanges()
        } else {
          const { invoke } = await import('@tauri-apps/api/tauri')
          await invoke('pull_changes', {
            repoPath: repoInfo.path,
          })
        }
        didPull = true
        await syncParentRepo()
        await fetchWorkspaceStatus({ silent: true })
        updatedRepoInfo = gitActions
          ? await gitActions.refreshRepoInfo()
          : await (async () => {
              const { invoke } = await import('@tauri-apps/api/tauri')
              return invoke('open_repository', {
                path: repoInfo.path,
                clientCalendarOffsetEastMinutes: getClientCalendarOffsetEastMinutes(),
              }) as Promise<any>
            })()
      }

      if (updatedRepoInfo.ahead > 0) {
        setSyncStep(`正在推送本地提交（${updatedRepoInfo.ahead}）…`)
        if (gitActions) {
          await gitActions.pushChanges()
        } else {
          const { invoke } = await import('@tauri-apps/api/tauri')
          await invoke('push_changes', {
            repoPath: repoInfo.path,
          })
        }
        didPush = true
      }

      setSyncStep('正在刷新状态…')
      await fetchWorkspaceStatus({ silent: true })
      await syncParentRepo()
      if (didCommit || didPull || didPush) {
        const steps = [
          didCommit ? '提交' : null,
          didPull ? '拉取' : null,
          didPush ? '推送' : null,
        ].filter(Boolean)
        setSyncInfo(`已完成：${steps.join('、')}`)
      } else {
        setSyncInfo('已是最新，无需同步')
      }
    } catch (err) {
      const detail = formatTauriInvokeError(err, '提交并同步失败')
      const doneSteps = [
        didCommit ? '提交' : null,
        didPull ? '拉取' : null,
        didPush ? '推送' : null,
      ].filter(Boolean)
      if (doneSteps.length > 0) {
        setError(`已完成${doneSteps.join('、')}，但后续失败：${detail}`)
      } else {
        setError(detail)
      }
    } finally {
      setSyncStep(null)
      setSyncLoading(false)
      setLoading(false)
    }
  }

  // 获取状态徽章颜色
  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'added':
        return 'default'
      case 'modified':
        return 'secondary'
      case 'deleted':
        return 'destructive'
      case 'renamed':
        return 'outline'
      case 'conflicted':
        return 'destructive'
      default:
        return 'secondary'
    }
  }

  // 获取状态显示文本
  const getStatusText = (status: string) => {
    switch (status) {
      case 'added':
        return '新增'
      case 'modified':
        return '修改'
      case 'deleted':
        return '删除'
      case 'deleted_restored':
        return '删除(已恢复)'
      case 'renamed':
        return '重命名'
      case 'conflicted':
        return '冲突'
      default:
        return status
    }
  }

  // 查看文件差异
  const viewFileDiff = (
    filePath: string,
    type: 'staged' | 'unstaged' | 'untracked' | 'conflicted'
  ) => {
    setSelectedFile({ path: filePath, type })
    setDiffModalOpen(true)
  }

  // 关闭差异查看弹窗
  const closeDiffModal = () => {
    setDiffModalOpen(false)
    setSelectedFile(null)
  }

  if (!repoInfo) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          请先选择一个 Git 仓库
        </p>
      </div>
    )
  }

  if (loading && !workspaceStatus) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">加载工作区状态中...</p>
      </div>
    )
  }

  const hasChanges = workspaceStatus && (
    workspaceStatus.staged_files.length > 0 ||
    workspaceStatus.unstaged_files.length > 0 ||
    workspaceStatus.untracked_files.length > 0 ||
    (workspaceStatus.conflicted_files?.length ?? 0) > 0
  )
  const hasStagedFiles = (workspaceStatus?.staged_files?.length ?? 0) > 0
  const hasSyncDelta = !!repoInfo && ((repoInfo.ahead ?? 0) > 0 || (repoInfo.behind ?? 0) > 0)

  /** 与下列表一致：不含仅表示未跟踪目录的 `path/` 占位项 */
  const untrackedDisplayCount = workspaceStatus
    ? workspaceStatus.untracked_files.filter((f) => !f.endsWith('/')).length
    : 0

  return (
    <div className="space-y-4">
      {/* 刷新与自动刷新控制栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={loading || unstagingLoading || stagingLoading || !repoInfo}
          >
            刷新
          </Button>
          <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            自动刷新
          </label>
        </div>
        {autoRefresh && (
          <div className="text-xs text-muted-foreground">
            每 {refreshIntervalSec}s 自动刷新（后台无全屏加载）
          </div>
        )}
      </div>

      {error && (
        <div
          className="fixed left-1/2 top-20 z-[100] w-[min(90vw,42rem)] -translate-x-1/2 px-4"
          role="alert"
        >
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 shadow-lg backdrop-blur-sm">
            <p className="break-words text-sm text-destructive">{error}</p>
          </div>
        </div>
      )}

      {syncInfo && !error && (
        <div className="fixed left-1/2 top-20 z-[95] w-[min(90vw,42rem)] -translate-x-1/2 px-4">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 shadow-lg backdrop-blur-sm">
            <p className="break-words text-sm text-emerald-700 dark:text-emerald-300">{syncInfo}</p>
          </div>
        </div>
      )}

      <div className={(unstagingLoading || stagingLoading || syncLoading) ? 'min-h-[3.25rem]' : ''}>
        {(unstagingLoading || stagingLoading) && (
          <div
            className="sticky top-2 z-20 flex items-center gap-2 p-3 rounded-lg border border-border bg-muted/95 backdrop-blur-sm shadow-sm text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 animate-spin shrink-0 text-foreground/70" />
            <span>
              {unstagingLoading
                ? unstagingTargetPath
                  ? `正在取消暂存：${shortenPathMiddle(unstagingTargetPath, 48)}`
                  : '正在取消全部暂存…'
                : stagingTargetPath
                  ? `正在暂存：${shortenPathMiddle(stagingTargetPath, 48)}`
                  : stagingBulkType === 'untracked'
                    ? '正在暂存全部未跟踪文件…'
                    : '正在暂存全部未暂存文件…'}
            </span>
          </div>
        )}

        {syncLoading && syncStep && !unstagingLoading && !stagingLoading && (
          <div
            className="sticky top-2 z-20 flex items-center gap-2 rounded-lg border border-border bg-muted/95 p-3 text-sm text-muted-foreground shadow-sm backdrop-blur-sm"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 animate-spin shrink-0 text-foreground/70" />
            <span>{syncStep}</span>
          </div>
        )}
      </div>

      {/* 远程同步区域 */}
      {repoInfo && (
        <RemoteSyncBar
          ahead={repoInfo.ahead}
          behind={repoInfo.behind}
          hasUpstream={repoInfo.has_upstream ?? true}
          hasOriginRemote={repoInfo.has_origin_remote ?? true}
          disabled={loading}
          refreshSpinning={loading}
          onFetchChanges={onFetchChanges}
          onPullChanges={onPullChanges}
          onRefresh={handleManualRefresh}
          refreshTitle="刷新远程状态与工作区文件"
          repoPath={repoInfo.path}
          onPendingCommitClick={onJumpToCommit}
        />
      )}

      {/* 提交区域 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-lg">提交更改</CardTitle>
              {repoInfo && (
                <CardDescription className="mt-1.5 space-y-0.5">
                  <span className="block truncate" title={repoInfo.current_branch}>
                    分支 <span className="font-medium text-foreground">{repoInfo.current_branch}</span>
                    {repoInfo.head_short_id ? (
                      <>
                        {' '}
                        · 当前提交{' '}
                        <span className="font-mono font-medium text-foreground">{repoInfo.head_short_id}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground"> · 尚无提交</span>
                    )}
                  </span>
                </CardDescription>
              )}
            </div>
            <Button size="sm" variant="outline" className="flex shrink-0 items-center gap-1" onClick={() => setStashDialogOpen(true)} disabled={loading && !hasChanges}>
              <Archive className="h-3 w-3" />
              贮藏
              {stashList.length > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-blue-600 text-white text-xs">{stashList.length}</span>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap items-center">
            <Input
              className="flex-1 min-w-[160px]"
              placeholder="输入提交信息..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void runCommit()
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1"
              onClick={() => void generateCommitMessageAi()}
              disabled={
                loading ||
                aiCommitMessageLoading ||
                stagingLoading ||
                unstagingLoading ||
                !(workspaceStatus?.staged_files?.length)
              }
              title="根据暂存区 diff 生成提交说明（需在菜单中配置并启用 AI）"
            >
              {aiCommitMessageLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              AI 生成
            </Button>
            <Button 
              onClick={() => void runCommit()}
              disabled={
                !commitMessage.trim() || loading || stagingLoading || unstagingLoading || !workspaceStatus?.staged_files?.length
              }
            >
              提交
            </Button>
            <Button 
              onClick={() => void commitAndSync()}
              disabled={
                loading ||
                syncLoading ||
                stagingLoading ||
                unstagingLoading ||
                !repoInfo ||
                (hasStagedFiles ? !commitMessage.trim() : !hasSyncDelta)
              }
              variant="default"
              aria-busy={syncLoading && !!syncStep}
              className="min-w-[7.5rem]"
            >
              {syncLoading && syncStep ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  同步中…
                </>
              ) : (
                '提交并同步'
              )}
            </Button>
            <div className="relative">
              <Button 
                variant="outline"
                onClick={() => void handlePushFromCard()}
                disabled={loading || !repoInfo || repoInfo.ahead <= 0}
                aria-busy={syncLoading && !!syncStep && syncStep.includes('推送')}
              >
                {syncLoading && syncStep && syncStep.includes('推送') ? (
                  <>
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    推送中…
                  </>
                ) : (
                  '推送'
                )}
              </Button>
              {repoInfo && repoInfo.ahead > 0 && (
                <span className="absolute -top-2 -right-2 bg-blue-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium">
                  {repoInfo.ahead}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 贮藏模块改为按需弹窗 */}
      <Dialog open={stashDialogOpen} onOpenChange={setStashDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>贮藏管理</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="输入贮藏信息..."
                value={stashMessage}
                onChange={(e) => setStashMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void createStash()
                  }
                }}
                disabled={stashOp !== null}
              />
              <Button
                onClick={() => void createStash()}
                disabled={!stashMessage.trim() || stashOp !== null || stashListLoading}
                size="sm"
                className="min-w-[5.5rem] shrink-0"
              >
                {stashOp?.kind === 'create' ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden />
                    贮藏中…
                  </>
                ) : (
                  '贮藏'
                )}
              </Button>
            </div>

            {(stashListLoading || stashOp !== null) && (
              <div
                className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                <span>
                  {stashListLoading
                    ? '正在加载贮藏列表…'
                    : stashOp?.kind === 'create'
                      ? '正在创建贮藏…'
                      : stashOp?.kind === 'apply'
                        ? '正在应用贮藏…'
                        : stashOp?.kind === 'delete'
                          ? '正在删除贮藏…'
                          : ''}
                </span>
              </div>
            )}

            {stashList.length > 0 ? (
              <div className="space-y-2">
                {stashList.map((stash) => (
                  <div
                    key={stash.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-2 border rounded"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium break-words" title={stash.message}>
                        {stash.message}
                      </div>
                      <div className="text-xs text-muted-foreground break-words">
                        {stash.branch && stash.branch !== 'unknown' ? stash.branch : '未知分支'} • {formatStashTimestamp(stash.timestamp)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void applyStash(stash.id)}
                        disabled={stashOp !== null || stashListLoading}
                        className="flex items-center gap-1"
                      >
                        {stashOp?.kind === 'apply' && stashOp.id === stash.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <ArchiveRestore className="h-3 w-3" />
                        )}
                        应用
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => askDeleteStash(stash.id)}
                        disabled={stashOp !== null || stashListLoading}
                        className="flex items-center gap-1 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                        删除
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground">暂无贮藏</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">确定要删除该贮藏吗？此操作不可撤销。</div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmDeleteOpen(false)}>取消</Button>
              <Button
                size="sm"
                className="text-white"
                disabled={
                  !pendingDeleteId ||
                  stashListLoading ||
                  (stashOp?.kind === 'delete' && stashOp.id === pendingDeleteId)
                }
                onClick={() => pendingDeleteId && void deleteStash(pendingDeleteId)}
              >
                {stashOp?.kind === 'delete' && stashOp.id === pendingDeleteId ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1 inline" aria-hidden />
                    删除中…
                  </>
                ) : (
                  '确认删除'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={untrackedDeleteConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setUntrackedDeleteConfirm(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除未跟踪文件</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {untrackedDeleteConfirm?.kind === 'all'
                ? '将永久删除当前列表中的所有未跟踪文件与目录（对应 git clean）。此操作不可撤销，是否继续？'
                : untrackedDeleteConfirm?.kind === 'one'
                  ? `将永久删除未跟踪项「${shortenPathMiddle(untrackedDeleteConfirm.path, 48)}」。此操作不可撤销，是否继续？`
                  : ''}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setUntrackedDeleteConfirm(null)}>
                取消
              </Button>
              <Button size="sm" variant="destructive" disabled={deletingUntrackedPath !== null || deletingAllUntracked} onClick={() => void runUntrackedDeleteConfirm()}>
                确认删除
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={unstagedDiscardConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setUnstagedDiscardConfirm(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>丢弃未暂存修改</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              将执行 <span className="font-mono">git restore --worktree</span>
              ，用暂存区内容覆盖工作区中对应路径的未提交修改；已暂存的条目不会被取消。此操作不可撤销。
            </div>
            <div className="text-sm text-foreground">
              {unstagedDiscardConfirm?.kind === 'all'
                ? '确定要丢弃当前「未暂存的文件」列表中全部路径的未暂存修改吗？'
                : unstagedDiscardConfirm?.kind === 'one'
                  ? `确定要丢弃「${shortenPathMiddle(unstagedDiscardConfirm.path, 48)}」的未暂存修改吗？`
                  : ''}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setUnstagedDiscardConfirm(null)}>
                取消
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={discardingUnstagedPath !== null || discardingAllUnstaged}
                onClick={() => void runUnstagedDiscardConfirm()}
              >
                {discardingAllUnstaged ||
                (discardingUnstagedPath !== null &&
                  unstagedDiscardConfirm?.kind === 'one' &&
                  discardingUnstagedPath === normalizeFilePathForGit(unstagedDiscardConfirm.path)) ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1 inline" aria-hidden />
                    处理中…
                  </>
                ) : (
                  '确认丢弃'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 合并冲突（单独列出，不计入「已暂存」） */}
      {workspaceStatus?.conflicted_files && workspaceStatus.conflicted_files.length > 0 && (
        <Card className="border-l-4 border-l-red-600 dark:border-l-red-500">
          <CardHeader className="bg-red-50/50 dark:bg-red-950/20">
            <CardTitle className="text-lg flex items-center gap-2 text-red-800 dark:text-red-300">
              <AlertCircle className="h-5 w-5" />
              合并冲突
            </CardTitle>
            <CardDescription>请解决冲突后暂存并提交；查看差异为工作区与索引侧内容（含冲突标记）。</CardDescription>
            <Button
              variant="destructive"
              size="sm"
              className="mt-2 gap-1"
              disabled={abortingMerge}
              onClick={() => void abortMerge()}
            >
              {abortingMerge ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              放弃合并
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workspaceStatus.conflicted_files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-start gap-2 p-2 rounded bg-red-50/30 dark:bg-red-950/10 hover:bg-red-50/50 dark:hover:bg-red-950/20 transition-colors"
                >
                  <Badge variant="destructive" className="flex-shrink-0">
                    冲突
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono truncate" title={file.path}>
                      {shortenPathMiddle(file.path, 56)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => viewFileDiff(file.path, 'conflicted')}
                    className="flex items-center gap-1 flex-shrink-0"
                  >
                    <Eye className="h-3 w-3" />
                    查看
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 暂存的文件 */}
      {workspaceStatus?.staged_files && workspaceStatus.staged_files.length > 0 && (
        <Card className="border-l-4 border-l-green-500 dark:border-l-green-400">
          <CardHeader className="bg-green-50/50 dark:bg-green-900/10">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2 text-green-700 dark:text-green-300">
                <CheckCircle className="h-5 w-5" />
                已暂存的文件
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={unstageAllFiles}
                disabled={
                  loading || unstagingLoading || stagingLoading || !workspaceStatus?.staged_files?.length
                }
                className="flex items-center gap-1"
              >
                {loading && unstagingTargetPath === null && unstagingLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    处理中…
                  </>
                ) : (
                  '取消所有暂存'
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workspaceStatus.staged_files.map((file) => (
                <div key={file.path} className="flex items-start gap-2 p-2 rounded bg-green-50/30 dark:bg-green-900/5 hover:bg-green-50/50 dark:hover:bg-green-900/10 transition-colors">
                  <Badge variant={getStatusBadgeVariant(file.status)} className="flex-shrink-0">
                    {getStatusText(file.status)}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono truncate" title={file.path}>{shortenPathMiddle(file.path, 56)}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => viewFileDiff(file.path, 'staged')}
                      className="flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      查看
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => unstageFile(file.path)}
                      disabled={loading || unstagingLoading || stagingLoading}
                      className="min-w-[5.5rem] flex items-center justify-center gap-1.5"
                    >
                      {unstagingTargetPath === normalizeFilePathForGit(file.path) ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          <span className="sr-only">正在取消暂存</span>
                          <span aria-hidden>处理中</span>
                        </>
                      ) : (
                        '取消暂存'
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 一键暂存按钮：未暂存 + 未跟踪 */}
      {workspaceStatus &&
        ((workspaceStatus.unstaged_files?.length > 0) ||
          (workspaceStatus.untracked_files?.some((f) => !f.endsWith('/')))) && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="default"
            onClick={() => void stageAll()}
            disabled={loading || stagingLoading || unstagingLoading}
            className="gap-1"
          >
            {loading && stagingLoading && stagingBulkType === 'unstaged' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                暂存中…
              </>
            ) : (
              <>
                <CheckCircle className="h-3.5 w-3.5" />
                一键全部暂存
              </>
            )}
          </Button>
        </div>
      )}

      {/* 未暂存的文件 */}
      {workspaceStatus?.unstaged_files && workspaceStatus.unstaged_files.length > 0 && (
        <Card className="border-l-4 border-l-orange-500 dark:border-l-orange-400">
          <CardHeader className="bg-orange-50/50 dark:bg-orange-900/10">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-lg flex items-center gap-2 text-orange-700 dark:text-orange-300">
                <AlertCircle className="h-5 w-5" />
                未暂存的文件
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2 justify-end shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => setUnstagedDiscardConfirm({ kind: 'all' })}
                  disabled={
                    loading ||
                    unstagingLoading ||
                    stagingLoading ||
                    discardingUnstagedPath !== null ||
                    discardingAllUnstaged
                  }
                >
                  {discardingAllUnstaged ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                      处理中…
                    </>
                  ) : (
                    <>
                      <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                      丢弃全部
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={stageAllFiles}
                  disabled={
                    loading ||
                    unstagingLoading ||
                    stagingLoading ||
                    discardingUnstagedPath !== null ||
                    discardingAllUnstaged
                  }
                  className="flex items-center gap-1"
                >
                  {loading &&
                  stagingTargetPath === null &&
                  stagingLoading &&
                  stagingBulkType === 'unstaged' ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      处理中…
                    </>
                  ) : (
                    '暂存所有'
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workspaceStatus.unstaged_files.map((file) => (
                <div key={file.path} className="flex items-start gap-2 p-2 rounded bg-orange-50/30 dark:bg-orange-900/5 hover:bg-orange-50/50 dark:hover:bg-orange-900/10 transition-colors">
                  <Badge variant={getStatusBadgeVariant(file.status)} className="flex-shrink-0">
                    {getStatusText(file.status)}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono truncate" title={file.path}>{shortenPathMiddle(file.path, 56)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 flex-shrink-0 justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => viewFileDiff(file.path, 'unstaged')}
                      className="flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      查看
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10 min-w-[4.5rem]"
                      onClick={() => setUnstagedDiscardConfirm({ kind: 'one', path: file.path })}
                      disabled={
                        loading ||
                        unstagingLoading ||
                        stagingLoading ||
                        discardingUnstagedPath !== null ||
                        discardingAllUnstaged
                      }
                    >
                      {discardingUnstagedPath === normalizeFilePathForGit(file.path) ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          <span className="sr-only">正在丢弃未暂存修改</span>
                          <span aria-hidden>处理中</span>
                        </>
                      ) : (
                        <>
                          <RotateCcw className="h-3.5 w-3.5 shrink-0 inline mr-0.5" aria-hidden />
                          丢弃
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => stageFile(file.path)}
                      disabled={
                        loading ||
                        unstagingLoading ||
                        stagingLoading ||
                        discardingUnstagedPath !== null ||
                        discardingAllUnstaged
                      }
                      className="min-w-[4.5rem] flex items-center justify-center gap-1.5"
                    >
                      {stagingTargetPath === normalizeFilePathForGit(file.path) ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          <span className="sr-only">正在暂存</span>
                          <span aria-hidden>处理中</span>
                        </>
                      ) : (
                        '暂存'
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 未跟踪的文件 */}
      {workspaceStatus?.untracked_files && workspaceStatus.untracked_files.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-lg">
                未跟踪的文件（{untrackedDisplayCount}）
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2 justify-end shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={stageAllUntracked}
                  disabled={
                    loading ||
                    unstagingLoading ||
                    stagingLoading ||
                    deletingAllUntracked ||
                    deletingUntrackedPath !== null
                  }
                  className="flex items-center gap-1"
                >
                  {loading &&
                  stagingTargetPath === null &&
                  stagingLoading &&
                  stagingBulkType === 'untracked' ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      处理中…
                    </>
                  ) : (
                    '暂存全部'
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive shrink-0"
                  onClick={askRemoveAllUntracked}
                  disabled={
                    loading ||
                    unstagingLoading ||
                    stagingLoading ||
                    deletingAllUntracked ||
                    deletingUntrackedPath !== null
                  }
                >
                  {deletingAllUntracked ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      处理中…
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-3 w-3 mr-1" />
                      删除全部
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workspaceStatus.untracked_files
                .filter(file => !file.endsWith('/')) // 过滤掉文件夹
                .map((file) => (
                <div key={file} className="flex items-start gap-2 p-2 border rounded">
                  
                  <Badge variant="outline" className="flex-shrink-0">未跟踪</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono truncate" title={file}>{shortenPathMiddle(file, 56)}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => viewFileDiff(file, 'untracked')}
                      className="flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      查看
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => stageFile(file)}
                      disabled={
                        loading ||
                        unstagingLoading ||
                        stagingLoading ||
                        deletingUntrackedPath !== null ||
                        deletingAllUntracked
                      }
                      className="min-w-[4.5rem] flex items-center justify-center gap-1.5"
                    >
                      {stagingTargetPath === normalizeFilePathForGit(file) ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          <span className="sr-only">正在添加</span>
                          <span aria-hidden>处理中</span>
                        </>
                      ) : (
                        '添加'
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive min-w-[4.5rem] flex items-center justify-center gap-1.5"
                      onClick={() => askRemoveOneUntracked(file)}
                      disabled={
                        loading ||
                        unstagingLoading ||
                        stagingLoading ||
                        deletingUntrackedPath !== null ||
                        deletingAllUntracked
                      }
                    >
                      {deletingUntrackedPath === normalizeFilePathForGit(file) ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          <span className="sr-only">正在删除</span>
                          <span aria-hidden>处理中</span>
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-3 w-3 shrink-0" />
                          删除
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 无更改状态 */}
      {!hasChanges && (
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-muted-foreground">工作区干净，没有未提交的更改</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchWorkspaceStatus()}
              className="mt-2"
            >
              刷新
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 文件差异查看弹窗 */}
      {selectedFile && (
        <FileDiffModal
          isOpen={diffModalOpen}
          onClose={closeDiffModal}
          filePath={selectedFile.path}
          repoPath={repoInfo.path}
          fileType={selectedFile.type}
        />
      )}
    </div>
  )
}
