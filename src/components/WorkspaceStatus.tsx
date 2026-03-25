import { useState, useEffect, useRef } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { FileChange } from '../types/git'
import { FileDiffModal } from './FileDiffModal'
import { Eye, Archive, ArchiveRestore, Trash2, CheckCircle, AlertCircle, Loader2, Sparkles } from 'lucide-react'
import { shortenPathMiddle } from '../lib/utils'
import { formatTauriInvokeError } from '../utils/tauriError'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { RemoteSyncBar } from './RemoteSyncBar'

interface WorkspaceStatusProps {
  repoInfo: any
  onRefresh: () => void
  onPushChanges?: () => void
  onPullChanges?: () => void
  onFetchChanges?: () => void
}

interface WorkspaceStatusData {
  staged_files: FileChange[]
  unstaged_files: FileChange[]
  untracked_files: string[]
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

export function WorkspaceStatus({  repoInfo,  onRefresh,
  onPushChanges,
  onPullChanges,
  onFetchChanges
}: WorkspaceStatusProps) {
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatusData | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [loading, setLoading] = useState(false)
  /** 取消暂存进行中：IPC + 拉状态可能较慢；记录 path 以便在行内按钮上显示加载 */
  const [unstagingLoading, setUnstagingLoading] = useState(false)
  const [unstagingTargetPath, setUnstagingTargetPath] = useState<string | null>(null)
  /** 暂存 / 添加 进行中：同上 */
  const [stagingLoading, setStagingLoading] = useState(false)
  const [stagingTargetPath, setStagingTargetPath] = useState<string | null>(null)
  /** 批量暂存时区分「未暂存」与「未跟踪」，用于横幅与行内按钮 loading */
  const [stagingBulkType, setStagingBulkType] = useState<'unstaged' | 'untracked' | null>(null)
  const [error, setError] = useState<string | null>(null)
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
  const [selectedFile, setSelectedFile] = useState<{path: string, type: 'staged' | 'unstaged' | 'untracked'} | null>(null)
  
  // 贮藏相关状态
  const [stashList, setStashList] = useState<StashInfo[]>([])
  const [stashMessage, setStashMessage] = useState('')
  // 旧的内联贮藏输入已移除
  const [stashDialogOpen, setStashDialogOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  /** 删除未跟踪：确认弹窗 */
  const [untrackedDeleteConfirm, setUntrackedDeleteConfirm] = useState<
    null | { kind: 'one'; path: string } | { kind: 'all' }
  >(null)
  const [deletingUntrackedPath, setDeletingUntrackedPath] = useState<string | null>(null)
  const [deletingAllUntracked, setDeletingAllUntracked] = useState(false)
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

      setWorkspaceStatus(status)
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
    
    try {
      const { invoke } = await import('@tauri-apps/api/tauri')
      const stashes: StashInfo[] = await invoke('get_stash_list', {
        repoPath: repoInfo.path,
      })
      
      setStashList(stashes)
    } catch (err) {
      console.error('获取贮藏列表失败:', err)
    }
  }

  const handleManualRefresh = async () => {
    await fetchWorkspaceStatus()
    await fetchStashList()
  }

  // 打开贮藏对话框时加载列表
  useEffect(() => {
    if (stashDialogOpen) {
      fetchStashList()
    }
  }, [stashDialogOpen])

  // 创建贮藏
  const createStash = async () => {
    if (!repoInfo || !stashMessage.trim()) return
    
    try {
      setLoading(true)
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
      await fetchWorkspaceStatus()
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
      setLoading(false)
    }
  }

  // 应用贮藏
  const applyStash = async (stashId: string) => {
    if (!repoInfo) return
    
    try {
      setLoading(true)
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
      
      await fetchWorkspaceStatus()
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
        await fetchWorkspaceStatus()
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
      setLoading(false)
    }
  }

  // 删除贮藏
  const deleteStash = async (stashId: string) => {
    if (!repoInfo) return
    
    try {
      setLoading(true)
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
      setLoading(false)
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
  }, [repoInfo, autoRefresh, refreshIntervalSec])

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

  // 提交更改
  const commitChanges = async () => {
    if (!repoInfo || !commitMessage.trim()) return
    
    try {
      setLoading(true)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('commit_changes', {
        repoPath: repoInfo.path,
        message: commitMessage.trim(),
      })
      
      setCommitMessage('')
      await fetchWorkspaceStatus()
      onRefresh() // 刷新提交列表
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    } finally {
      setLoading(false)
    }
  }

  // 推送更改
  const pushChanges = async () => {
    if (!repoInfo) return
    
    try {
      setLoading(true)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('push_changes', {
        repoPath: repoInfo.path,
      })
      
      onRefresh() // 刷新提交列表
    } catch (err) {
      setError(err instanceof Error ? err.message : '推送失败')
    } finally {
      setLoading(false)
    }
  }

  // 提交并同步（类似 VS Code 的提交并同步按钮）
  // 工作流程：1. 提交暂存的文件 2. 拉取远程更新（如果有） 3. 推送本地提交
  const commitAndSync = async () => {
    if (!repoInfo) return
    
    try {
      setLoading(true)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      
      // 1. 如果有暂存的文件，先提交
      if (workspaceStatus?.staged_files && workspaceStatus.staged_files.length > 0) {
        if (!commitMessage.trim()) {
          setError('请先输入提交信息')
          setLoading(false)
          return
        }
        
        await invoke('commit_changes', {
          repoPath: repoInfo.path,
          message: commitMessage.trim(),
        })
        
        setCommitMessage('')
        await fetchWorkspaceStatus()
        // 刷新仓库信息以更新 ahead 状态
        onRefresh()
      }
      
      // 2. 如果有远程更新，先拉取
      if (repoInfo.behind > 0) {
        await invoke('pull_changes', {
          repoPath: repoInfo.path,
        })
        // 拉取后刷新仓库信息以更新 ahead/behind 状态
        onRefresh()
        await fetchWorkspaceStatus()
      }
      
      // 3. 最后推送（检查是否有待推送的提交）
      // 重新获取仓库信息以确保 ahead 状态是最新的
      const updatedRepoInfo: any = await invoke('open_repository', {
        path: repoInfo.path,
      })
      
      if (updatedRepoInfo.ahead > 0) {
        await invoke('push_changes', {
          repoPath: repoInfo.path,
        })
      }
      
      // 刷新所有状态
      await fetchWorkspaceStatus()
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交并同步失败')
    } finally {
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
      default:
        return status
    }
  }

  // 查看文件差异
  const viewFileDiff = (filePath: string, type: 'staged' | 'unstaged' | 'untracked') => {
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
    workspaceStatus.untracked_files.length > 0
  )

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
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

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

      {/* 远程同步区域 */}
      {repoInfo && (
        <RemoteSyncBar
          ahead={repoInfo.ahead}
          behind={repoInfo.behind}
          disabled={loading}
          refreshSpinning={loading}
          onFetchChanges={onFetchChanges}
          onPullChanges={onPullChanges}
          onRefresh={onRefresh}
        />
      )}

      {/* 提交区域 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">提交更改</CardTitle>
            <Button size="sm" variant="outline" className="flex items-center gap-1" onClick={() => setStashDialogOpen(true)} disabled={loading && !hasChanges}>
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
                  commitChanges()
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
              onClick={commitChanges}
              disabled={
                !commitMessage.trim() || loading || stagingLoading || unstagingLoading || !workspaceStatus?.staged_files?.length
              }
            >
              提交
            </Button>
            <Button 
              onClick={commitAndSync}
              disabled={
                loading ||
                stagingLoading ||
                unstagingLoading ||
                ((workspaceStatus?.staged_files?.length ?? 0) > 0 && !commitMessage.trim()) ||
                ((workspaceStatus?.staged_files?.length ?? 0) === 0 && (!repoInfo || (repoInfo.ahead <= 0 && repoInfo.behind <= 0)))
              }
              variant="default"
            >
              提交并同步
            </Button>
            <div className="relative">
              <Button 
                variant="outline"
                onClick={onPushChanges || pushChanges}
                disabled={loading || !repoInfo || repoInfo.ahead <= 0}
              >
                推送
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
                    createStash()
                  }
                }}
              />
              <Button onClick={createStash} disabled={!stashMessage.trim() || loading} size="sm">
                贮藏
              </Button>
            </div>

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
                        {stash.branch} • {new Date(stash.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => applyStash(stash.id)}
                        disabled={loading}
                        className="flex items-center gap-1"
                      >
                        <ArchiveRestore className="h-3 w-3" />
                        应用
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => askDeleteStash(stash.id)}
                        disabled={loading}
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
              <Button size="sm" className="text-white" onClick={() => pendingDeleteId && deleteStash(pendingDeleteId)}>
                确认删除
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
              <Button size="sm" variant="destructive" onClick={() => void runUntrackedDeleteConfirm()}>
                确认删除
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
              {workspaceStatus.staged_files.map((file, index) => (
                <div key={index} className="flex items-start gap-2 p-2 rounded bg-green-50/30 dark:bg-green-900/5 hover:bg-green-50/50 dark:hover:bg-green-900/10 transition-colors">
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

      {/* 未暂存的文件 */}
      {workspaceStatus?.unstaged_files && workspaceStatus.unstaged_files.length > 0 && (
        <Card className="border-l-4 border-l-orange-500 dark:border-l-orange-400">
          <CardHeader className="bg-orange-50/50 dark:bg-orange-900/10">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2 text-orange-700 dark:text-orange-300">
                <AlertCircle className="h-5 w-5" />
                未暂存的文件
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={stageAllFiles}
                disabled={loading || unstagingLoading || stagingLoading}
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
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workspaceStatus.unstaged_files.map((file, index) => (
                <div key={index} className="flex items-start gap-2 p-2 rounded bg-orange-50/30 dark:bg-orange-900/5 hover:bg-orange-50/50 dark:hover:bg-orange-900/10 transition-colors">
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
                      onClick={() => viewFileDiff(file.path, 'unstaged')}
                      className="flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      查看
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => stageFile(file.path)}
                      disabled={loading || unstagingLoading || stagingLoading}
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
                .map((file, index) => (
                <div key={index} className="flex items-start gap-2 p-2 border rounded">
                  
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
