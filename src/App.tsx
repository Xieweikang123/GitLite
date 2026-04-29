import React, { useState, useEffect, useLayoutEffect } from 'react' 
import { useGit } from './hooks/useGit'
import { useDarkMode } from './hooks/useDarkMode'
import { useMonacoThemeSync } from './hooks/useMonacoThemeSync'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { getCurrent } from '@tauri-apps/api/window'
import { TopToolbar } from './components/TopToolbar'
import { MenuToolbar } from './components/MenuToolbar'
import { OperationsPanel } from './components/OperationsPanel'
import { CommitList } from './components/CommitList'
import { FileList } from './components/FileList'
import { UnifiedCommitView } from './components/UnifiedCommitView'
import { LogModal } from './components/LogModal'
import { ProxyConfigModal } from './components/ProxyConfigModal'
import { AiConfigModal } from './components/AiConfigModal'
import { RemoteManageModal } from './components/RemoteManageModal'
import { RepoFileTree } from './components/RepoFileTree'
import { AuthorStatsPanel } from './components/AuthorStatsPanel'
import { CommitInfo, FileChange } from './types/git'
import { formatTauriInvokeError } from './utils/tauriError'

function App() {
  useMonacoThemeSync()
  // 旧的三栏聚焦状态已废弃，保留为将来扩展可用；当前用 tab 切换
  const { 
    repoInfo, 
    loading, 
    error, 
    recentRepos,
    autoOpenEnabled,
    setAutoOpenEnabled,
    openRepository, 
    openRepositoryByPath,
    initRepository,
    cloneRepository,
    removeRecentRepo,
    updateRecentRepoEntry,
    checkoutBranch,
    createBranch,
    deleteBranch,
    renameBranch,
    mergeBranch,
    getRemoteManagementInfo,
    addRemote,
    updateRemote,
    removeRemote,
    setBranchUpstream,
    resetToCommit,
    cherryPickCommit,
    revertCommit,
    rebaseToCommit,
    getCommitFiles, 
    getCommitsPaginated,
    searchCommits,
    getFileDiff,
    getSingleFileDiff,
    fetchChangesWithLogs,
    fetchChanges,
    pushChangesWithRealtimeLogs,
    pullChangesWithLogs,
    commitChanges,
    pushChanges,
    pullChanges,
    refreshRepoInfo,
    getAuthorCommitStats,
    getCommitActivityStats,
    getCommitsForActivityBucket,
    getDiffAggregateStats,
    getFileTerritoryStats,
    getRecentChangedFilesStats,
    getBranchActivityLifecycleStats,
  } = useGit()
  
  const { isDark, toggleDarkMode } = useDarkMode()
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null)
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  /** 待拉取区间（远端领先于 HEAD 的提交），与本地分页列表分开，便于 load more 的 offset 仍指向 HEAD 历史 */
  const [incomingCommits, setIncomingCommits] = useState<CommitInfo[]>([])
  const [localCommits, setLocalCommits] = useState<CommitInfo[]>([])
  const localCommitsRef = React.useRef<CommitInfo[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMoreCommits, setHasMoreCommits] = useState(true)
  const [searchResults, setSearchResults] = useState<CommitInfo[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  /** 提交列表范围：当前 HEAD 历史，或所有分支/远程/标签可达（与后端 scope 一致） */
  const [commitLogScope, setCommitLogScope] = useState<'head' | 'all'>('head')
  /** 「当前分支」模式下可选：查看指定本地分支的历史（不经检出）；null 表示当前检出 HEAD */
  const [commitLogRev, setCommitLogRev] = useState<string | null>(null)
  
  // 日志弹窗状态
  const [logModalOpen, setLogModalOpen] = useState(false)
  const [logModalTitle, setLogModalTitle] = useState('')
  const [logs, setLogs] = useState<Array<{timestamp: string, level: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR' | 'SUCCESS', message: string}>>([])
  const [isOperationRunning, setIsOperationRunning] = useState(false)
  
  // 代理 / AI 配置弹窗状态
  const [proxyConfigOpen, setProxyConfigOpen] = useState(false)
  const [aiConfigOpen, setAiConfigOpen] = useState(false)
  const [remoteManageOpen, setRemoteManageOpen] = useState(false)

  /** 提交文件列表请求序号：避免快速切换提交时后返回的请求覆盖当前选中 */
  const commitFilesReqRef = React.useRef(0)
  /** 提交页：搜索 / 加载更多失败时的可读提示 */
  const [commitListError, setCommitListError] = useState<string | null>(null)
  /** 提交列表数据代次：切换范围/仓库或手动重置列表时递增，用于丢弃过期异步结果 */
  const commitListEpochRef = React.useRef(0)
  /** 防止同一时刻并发触发多次 load more（如观察器 + 跳转补载同时触发） */
  const loadMoreInFlightRef = React.useRef(false)
  /** jump 相关状态给早期 effect 判定使用（通过 layout effect 同步，避免晚一拍） */
  const jumpRequestActiveRef = React.useRef(false)
  const pendingJumpCommitIdRef = React.useRef<string | null>(null)
  const appendJumpLog = React.useCallback(
    (message: string, level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' = 'DEBUG') => {
      void invoke('append_gitlite_log', {
        level,
        message: `[jump][App] ${message}`,
      }).catch(() => {
        /* 忽略日志写入失败，避免影响主流程 */
      })
    },
    []
  )

  const handleCommitSelect = async (commit: CommitInfo) => {
    setSelectedCommit(commit)
    setSelectedFile(null) // 清除选中的文件
    const req = ++commitFilesReqRef.current
    
    try {
      const files = await getCommitFiles(commit.id)
      if (req !== commitFilesReqRef.current) return
      setCommitFiles(files)
    } catch (err) {
      if (req !== commitFilesReqRef.current) return
      console.error('获取文件列表失败:', err)
      setCommitFiles([])
    }
  }

  const handleFileSelect = (filePath: string) => {
    setSelectedFile(filePath)
  }

  const handleBranchSelect = async (branchName: string) => {
    await checkoutBranch(branchName)
    setSelectedCommit(null) // 清除选中的提交
    setCommitFiles([])
    setSelectedFile(null)
  }

  const handleCreateBranch = async (
    branchName: string,
    checkout: boolean,
    startPoint?: string
  ) => {
    const ok = await createBranch(branchName, checkout, startPoint)
    if (ok && checkout) {
      setSelectedCommit(null)
      setCommitFiles([])
      setSelectedFile(null)
    }
    return ok
  }

  const handleRecentRepoSelect = async (path: string) => {
    await openRepositoryByPath(path)
    setSelectedCommit(null)
    setCommitFiles([])
    setSelectedFile(null)
    setIncomingCommits([])
    setLocalCommits([])
    setHasMoreCommits(true)
    setSearchResults(null)
  }

  const handleCommitLogScopeChange = (scope: 'head' | 'all') => {
    setCommitLogScope(scope)
    if (scope === 'all') {
      setCommitLogRev(null)
    }
    setSearchResults(null)
    setSelectedCommit(null)
    setCommitFiles([])
    setSelectedFile(null)
  }

  const handleCommitLogRevChange = (rev: string | null) => {
    setCommitLogRev(rev)
    setSearchResults(null)
    setSelectedCommit(null)
    setCommitFiles([])
    setSelectedFile(null)
  }

  const handleInitRepository = async (
    path: string,
    initialBranch?: string
  ) => {
    const ok = await initRepository(path, initialBranch)
    if (!ok) return false
    setSelectedCommit(null)
    setCommitFiles([])
    setSelectedFile(null)
    setIncomingCommits([])
    setLocalCommits([])
    setHasMoreCommits(true)
    setSearchResults(null)
    return true
  }

  const handleCloneRepository = async (
    remoteUrl: string,
    destinationPath: string,
    branch?: string
  ) => {
    const ok = await cloneRepository(remoteUrl, destinationPath, branch)
    if (!ok) return false
    setSelectedCommit(null)
    setCommitFiles([])
    setSelectedFile(null)
    setIncomingCommits([])
    setLocalCommits([])
    setHasMoreCommits(true)
    setSearchResults(null)
    return true
  }

  const handleDeleteBranch = async (branchName: string, force: boolean) => {
    const ok = await deleteBranch(branchName, force)
    if (!ok) return false
    setSelectedCommit(null)
    setCommitFiles([])
    setSelectedFile(null)
    return true
  }

  const handleRenameBranch = async (oldName: string, newName: string) => {
    const ok = await renameBranch(oldName, newName)
    if (!ok) return false
    setSelectedCommit(null)
    setCommitFiles([])
    setSelectedFile(null)
    return true
  }

  const handleMergeBranch = async (sourceBranch: string, ffOnly: boolean) => {
    const ok = await mergeBranch(sourceBranch, ffOnly)
    if (!ok) return false
    setSelectedCommit(null)
    setCommitFiles([])
    setSelectedFile(null)
    setIncomingCommits([])
    setLocalCommits([])
    setHasMoreCommits(true)
    return true
  }

  const handleCherryPickCommit = async (commitId: string) => {
    const ok = await cherryPickCommit(commitId)
    if (!ok) return false
    setSelectedCommit(null)
    setCommitFiles([])
    setSelectedFile(null)
    setIncomingCommits([])
    setLocalCommits([])
    setHasMoreCommits(true)
    return true
  }

  const handleRevertCommit = async (commitId: string) => {
    const ok = await revertCommit(commitId)
    if (!ok) return false
    setSelectedCommit(null)
    setCommitFiles([])
    setSelectedFile(null)
    setIncomingCommits([])
    setLocalCommits([])
    setHasMoreCommits(true)
    return true
  }

  const handleRebaseToCommit = async (ontoCommitId: string) => {
    const ok = await rebaseToCommit(ontoCommitId)
    if (!ok) return false
    setSelectedCommit(null)
    setCommitFiles([])
    setSelectedFile(null)
    setIncomingCommits([])
    setLocalCommits([])
    setHasMoreCommits(true)
    return true
  }

  const handleSearchFullRepo = async (term: string) => {
    if (!term.trim() || searchLoading) return
    setSearchLoading(true)
    setSearchResults(null)
    setCommitListError(null)
    try {
      const list = await searchCommits(
        term,
        500,
        commitLogScope,
        commitLogScope === 'head' ? commitLogRev : null
      )
      setSearchResults(list)
    } catch (e) {
      console.error('全仓库搜索失败:', e)
      setCommitListError(formatTauriInvokeError(e, '搜索提交失败'))
    } finally {
      setSearchLoading(false)
    }
  }

  const handleClearSearchMode = () => {
    setSearchResults(null)
    setCommitListError(null)
  }

  const handleLoadMore = async () => {
    if (loadMoreInFlightRef.current || loadingMore || !hasMoreCommits || !repoInfo) return
    const activeJump = jumpRequestActiveRef.current
    const currentPendingJump = pendingJumpCommitIdRef.current
    // 跳转定位进行中且目标已就绪后，不再接受额外补载，避免定位后被列表二次变化冲掉
    if (activeJump && !currentPendingJump) {
      appendJumpLog(
        `loadMore blocked during jump-settle scope=${commitLogScope} rev=${commitLogRev ?? 'null'}`
      )
      return
    }
    const reqEpoch = commitListEpochRef.current
    const offset = localCommitsRef.current.length
    if (activeJump || currentPendingJump) {
      appendJumpLog(
        `loadMore start epoch=${reqEpoch} offset=${offset} scope=${commitLogScope} rev=${commitLogRev ?? 'null'} pending=${currentPendingJump ?? 'null'}`
      )
    }
    loadMoreInFlightRef.current = true
    setLoadingMore(true)
    setCommitListError(null)
    try {
      const newCommits = await getCommitsPaginated(
        50,
        offset,
        commitLogScope === 'all' ? 'all' : 'head',
        commitLogScope === 'head' ? commitLogRev : null
      )
      if (reqEpoch !== commitListEpochRef.current) return
      if (newCommits.length === 0) {
        setHasMoreCommits(false)
        if (activeJump || currentPendingJump) {
          appendJumpLog(
            `loadMore result empty epoch=${reqEpoch} offset=${offset} => hasMore=false`,
            'WARN'
          )
        }
      } else {
        const currentLocal = localCommitsRef.current
        const currentSeen = new Set(currentLocal.map((c) => c.id))
        const uniqueNewCommits = newCommits.filter((c) => !currentSeen.has(c.id))
        const appendedUnique = uniqueNewCommits.length
        if (appendedUnique > 0) {
          setLocalCommits(prev => {
            const seen = new Set(prev.map((c) => c.id))
            const next = [...prev]
            for (const c of uniqueNewCommits) {
              if (seen.has(c.id)) continue
              seen.add(c.id)
              next.push(c)
            }
            return next
          })
        }
        if (activeJump || currentPendingJump) {
          appendJumpLog(
            `loadMore result epoch=${reqEpoch} offset=${offset} fetched=${newCommits.length} appendedUnique=${appendedUnique} localNow=${currentLocal.length + appendedUnique}`
          )
        }
        if (newCommits.length < 50) {
          setHasMoreCommits(false)
          if (activeJump || currentPendingJump) {
            appendJumpLog(
              `loadMore reached tail epoch=${reqEpoch} offset=${offset} fetched=${newCommits.length} => hasMore=false`
            )
          }
        } else if (appendedUnique === 0 && (activeJump || currentPendingJump)) {
          appendJumpLog(
            `loadMore duplicate page detected epoch=${reqEpoch} offset=${offset} fetched=50 appendedUnique=0`,
            'WARN'
          )
        }
      }
    } catch (error) {
      console.error('Failed to load more commits:', error)
      setCommitListError(formatTauriInvokeError(error, '加载更多提交失败'))
    } finally {
      loadMoreInFlightRef.current = false
      setLoadingMore(false)
    }
  }

  const handleRefresh = async () => {
    if (!repoInfo) return
    
    try {
      // 重新获取仓库信息以更新提交列表
      await openRepositoryByPath(repoInfo.path)
      // 仓库信息会通过 useEffect 自动更新
    } catch (error) {
      console.error('Failed to refresh repository:', error)
    }
  }

  const handleOpenRemoteRepository = async () => {
    if (repoInfo?.remote_url) {
      try {
        const isTauriRuntime = typeof (window as any).__TAURI_IPC__ === 'function'
        if (isTauriRuntime) {
          // 在 Tauri 中必须走后端命令，避免 window.open 导致 about:blank 上下文
          await invoke('open_external_url', { url: repoInfo.remote_url })
        } else {
          // 仅浏览器预览环境兜底
          window.open(repoInfo.remote_url, '_blank', 'noopener,noreferrer')
        }
      } catch (error) {
        console.error('Failed to open remote repository:', error)
      }
    }
  }

  const handlePullChanges = async () => {
    if (!repoInfo) return
    
    // 打开日志弹窗
    setLogModalTitle('拉取远程更改')
    setLogs([])
    setLogModalOpen(true)
    setIsOperationRunning(true)
    
    try {
      const { logs: logData, outcome } = await pullChangesWithLogs()
      
      // 转换日志格式，并附加结构化结果摘要（与 SourceTree 一致：拉取后工作区计数）
      const formattedLogs = logData.map(([timestamp, level, message]) => ({
        timestamp,
        level: level as 'INFO' | 'DEBUG' | 'WARN' | 'ERROR',
        message
      }))
      formattedLogs.push({
        timestamp: new Date().toLocaleTimeString(),
        level: 'INFO',
        message: `拉取结果 [${outcome.kind}] ${outcome.message} — 暂存区 ${outcome.staged_count} 项，未暂存 ${outcome.unstaged_count} 项，冲突 ${outcome.conflicted_count} 项，未跟踪 ${outcome.untracked_count} 项`,
      })
      
      setLogs(formattedLogs)
      setIsOperationRunning(false)
      
      // 拉取成功后重置状态
      setSelectedCommit(null)
      setCommitFiles([])
      setSelectedFile(null)
      setIncomingCommits([])
      setLocalCommits([])
      setHasMoreCommits(true)
    } catch (error) {
      console.error('拉取失败:', error)
      setIsOperationRunning(false)
      
      // 添加错误日志
      const errorLog = {
        timestamp: new Date().toLocaleTimeString(),
        level: 'ERROR' as const,
        message: `拉取失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
      setLogs(prev => [...prev, errorLog])
    }
  }

  const handleFetchChanges = async () => {
    if (!repoInfo) return
    
    // 打开日志弹窗
    setLogModalTitle('获取远程更改')
    setLogs([])
    setLogModalOpen(true)
    setIsOperationRunning(true)
    
    try {
      const logData: Array<[string, string, string]> = await fetchChangesWithLogs()
      
      // 转换日志格式
      const formattedLogs = logData.map(([timestamp, level, message]) => ({
        timestamp,
        level: level as 'INFO' | 'DEBUG' | 'WARN' | 'ERROR',
        message
      }))
      
      setLogs(formattedLogs)
      setIsOperationRunning(false)
      
      // 获取成功后重置状态（获取不会改变工作区，所以不需要重置文件状态）
      setIncomingCommits([])
      setLocalCommits([])
      setHasMoreCommits(true)
    } catch (error) {
      console.error('获取失败:', error)
      setIsOperationRunning(false)
      
      // 添加错误日志
      const errorLog = {
        timestamp: new Date().toLocaleTimeString(),
        level: 'ERROR' as const,
        message: `获取失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
      setLogs(prev => [...prev, errorLog])
    }
  }

  // 通用的Git操作日志处理函数
  const handleGitOperationWithLogs = async (
    operation: () => Promise<Array<[string, string, string]>>,
    title: string,
    resetState: boolean = false
  ) => {
    if (!repoInfo) return
    
    // 打开日志弹窗
    setLogModalTitle(title)
    setLogs([])
    setLogModalOpen(true)
    setIsOperationRunning(true)
    
    try {
      const logData: Array<[string, string, string]> = await operation()
      
      // 转换日志格式
      const formattedLogs = logData.map(([timestamp, level, message]) => ({
        timestamp,
        level: level as 'INFO' | 'DEBUG' | 'WARN' | 'ERROR',
        message
      }))
      
      setLogs(formattedLogs)
      setIsOperationRunning(false)
      
      // 如果需要重置状态
      if (resetState) {
        setSelectedCommit(null)
        setCommitFiles([])
        setSelectedFile(null)
        setIncomingCommits([])
        setLocalCommits([])
        setHasMoreCommits(true)
      }
    } catch (error) {
      console.error(`${title}失败:`, error)
      setIsOperationRunning(false)
      
      // 添加错误日志
      const errorLog = {
        timestamp: new Date().toLocaleTimeString(),
        level: 'ERROR' as const,
        message: `${title}失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
      setLogs(prev => [...prev, errorLog])
    }
  }


  // 实时推送处理函数
  const handlePushChangesRealtime = async () => {
    if (!repoInfo) return
    
    // 打开日志弹窗
    setLogModalTitle('推送本地更改 - 实时日志')
    setLogs([])
    setLogModalOpen(true)
    setIsOperationRunning(true)
    
    try {
      await pushChangesWithRealtimeLogs()
      setIsOperationRunning(false)
      
      // 重置状态
      setSelectedCommit(null)
      setCommitFiles([])
      setSelectedFile(null)
      setIncomingCommits([])
      setLocalCommits([])
      setHasMoreCommits(true)
    } catch (error) {
      console.error('推送失败:', error)
      setIsOperationRunning(false)
      
      // 添加错误日志
      const errorLog = {
        timestamp: new Date().toLocaleTimeString(),
        level: 'ERROR' as const,
        message: `推送失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
      setLogs(prev => [...prev, errorLog])
    }
  }

  // 主界面 Esc：隐藏窗口（与点关闭一致，缩到托盘）；有弹层时由弹层先消费 Esc
  useEffect(() => {
    const overlayOpen = () => {
      if (document.querySelector('div.fixed.inset-0.z-50')) return true
      if (document.querySelector('[data-state="open"][data-side]')) return true
      // 自定义下拉、右键菜单等（见各组件上的 data-app-interactive-overlay）
      if (document.querySelector('[data-app-interactive-overlay]')) return true
      return false
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (overlayOpen()) return
      e.preventDefault()
      void getCurrent().hide().catch((err) => {
        console.warn('隐藏窗口失败（非桌面壳或缺少权限）:', err)
      })
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // 监听实时日志事件
  useEffect(() => {
    const unlisten = listen('push-log', (event) => {
      const logData = event.payload as { timestamp: string, level: string, message: string }
      const logEntry = {
        timestamp: logData.timestamp,
        level: logData.level as 'INFO' | 'DEBUG' | 'WARN' | 'ERROR' | 'SUCCESS',
        message: logData.message
      }
      setLogs(prev => [...prev, logEntry])
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [])

  const prevRepoPathRef = React.useRef<string | null>(null)
  /** HEAD 最新提交 id：仅当它或路径/范围变化时重置「当前分支」下列表，避免仅刷新 ahead/behind 时清掉已加载更多 */
  const headFirstCommitId = repoInfo?.commits?.[0]?.id ?? ''

  // 获取/拉取后仅有 incoming 变化时仍会更新，且不依赖「加载更多」用的 localCommits  effect
  React.useEffect(() => {
    if (!repoInfo) return
    if (commitLogScope !== 'head' || commitLogRev) return
    setIncomingCommits(repoInfo.incoming_commits ?? [])
  }, [repoInfo, commitLogScope, commitLogRev])

  // 当仓库路径、提交范围或 HEAD 首条变化时同步列表；换仓库时先回到「当前分支」
  React.useEffect(() => {
    commitListEpochRef.current += 1
    const path = repoInfo?.path ?? null
    const pathChanged = path != null && path !== prevRepoPathRef.current

    if (!repoInfo) {
      prevRepoPathRef.current = null
      setIncomingCommits([])
      setLocalCommits([])
      setHasMoreCommits(true)
      setSearchResults(null)
      return
    }

    if (pathChanged) {
      prevRepoPathRef.current = path
      setCommitLogRev(null)
      if (commitLogScope !== 'head') {
        setCommitLogScope('head')
        setSearchResults(null)
        return
      }
    }

    if (commitLogScope === 'head' && !commitLogRev) {
      const jumpActive = jumpRequestActiveRef.current || pendingJumpCommitIdRef.current != null
      if (jumpActive) {
        appendJumpLog(
          `skip repoInfo sync during jump local=${localCommitsRef.current.length} repo=${repoInfo.commits.length}`
        )
        return
      }
      // 分页列表已建立后，不再用 repoInfo 快照覆盖，避免与 loadMore 并发时列表基准跳变
      const localHeadId = localCommitsRef.current[0]?.id ?? ''
      const repoHeadId = repoInfo.commits[0]?.id ?? ''
      const canHydrateFromRepoInfo =
        localCommitsRef.current.length === 0 ||
        (localCommitsRef.current.length <= 50 && localHeadId !== repoHeadId)
      if (!canHydrateFromRepoInfo) {
        return
      }
      setLocalCommits(repoInfo.commits)
      setHasMoreCommits(repoInfo.commits.length >= 50)
      return
    }

    if (commitLogScope === 'head' && commitLogRev) {
      setIncomingCommits([])
      let cancelled = false
      void (async () => {
        try {
          const first = await getCommitsPaginated(50, 0, 'head', commitLogRev)
          if (cancelled) return
          // 统计跳转等场景下会 loadMore 追加列表；若此时因 headFirstCommitId 等再次触发本 effect，
          // 勿用「仅首页」覆盖已变长的列表，否则滚动定位会先对后错。
          const jumpListing =
            jumpRequestActiveRef.current || pendingJumpCommitIdRef.current != null
          const curLen = localCommitsRef.current.length
          if (jumpListing && curLen > first.length) {
            appendJumpLog(
              `skip rev-scope list overwrite during jump localLen=${curLen} firstLen=${first.length} rev=${commitLogRev ?? 'null'}`
            )
            return
          }
          setLocalCommits(first)
          setHasMoreCommits(first.length >= 50)
        } catch {
          if (!cancelled) {
            setLocalCommits([])
            setHasMoreCommits(false)
          }
        }
      })()
      return () => {
        cancelled = true
      }
    }

    setIncomingCommits([])
    let cancelled = false
    void (async () => {
      try {
        const first = await getCommitsPaginated(50, 0, 'all')
        if (cancelled) return
        const jumpListing =
          jumpRequestActiveRef.current || pendingJumpCommitIdRef.current != null
        const curLen = localCommitsRef.current.length
        if (jumpListing && curLen > first.length) {
          appendJumpLog(
            `skip all-scope list overwrite during jump localLen=${curLen} firstLen=${first.length}`
          )
          return
        }
        setLocalCommits(first)
        setHasMoreCommits(first.length >= 50)
      } catch {
        if (!cancelled) {
          setLocalCommits([])
          setHasMoreCommits(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // 依赖项不含整个 repoInfo：仅 ahead/behind 刷新时不重置「加载更多」
  }, [repoInfo?.path, commitLogScope, commitLogRev, headFirstCommitId, getCommitsPaginated])

  const mergedCommitsForView =
    searchResults ??
    (commitLogScope === 'all' || commitLogRev
      ? localCommits
      : [...incomingCommits, ...localCommits])

  const mergedCommitsForViewDeduped = React.useMemo(() => {
    if (mergedCommitsForView.length <= 1) return mergedCommitsForView
    const seen = new Set<string>()
    const out: CommitInfo[] = []
    for (const c of mergedCommitsForView) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c)
    }
    return out
  }, [mergedCommitsForView])

  const jumpToCommitSeqRef = React.useRef(0)
  const [jumpToCommitRequest, setJumpToCommitRequest] = useState<{
    commit: CommitInfo
    seq: number
  } | null>(null)
  const [pendingJumpCommitId, setPendingJumpCommitId] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<
    'workspace' | 'commits' | 'files' | 'stats'
  >('workspace')
  const [statsReportTab, setStatsReportTab] = useState<
    | 'authors'
    | 'timeline'
    | 'heatmap'
    | 'calendar'
    | 'lines'
    | 'paths'
    | 'territory'
    | 'recentFiles'
    | 'branches'
  >('authors')

  const handleStatsCommitJump = ({
    commit,
    scope,
    rev,
  }: {
    commit: CommitInfo
    scope: 'head' | 'all'
    rev: string | null
  }) => {
    const targetScope: 'head' | 'all' = scope
    const targetRev: string | null = targetScope === 'head' ? rev : null

    commitListEpochRef.current += 1
    setSearchResults(null)
    setCommitLogScope(targetScope)
    setCommitLogRev(targetRev)
    // 切换范围后先重置分页状态，避免沿用旧 hasMore 导致提前终止定位
    setIncomingCommits([])
    setLocalCommits([])
    setHasMoreCommits(true)

    jumpToCommitSeqRef.current += 1
    appendJumpLog(
      `request created seq=${jumpToCommitSeqRef.current} commitId=${commit.id} short=${commit.short_id} date=${commit.date} scope=${targetScope} rev=${targetRev ?? 'null'}`
    )
    setJumpToCommitRequest({
      commit,
      seq: jumpToCommitSeqRef.current,
    })
    setPendingJumpCommitId(commit.id)
    setActiveTab('commits')
  }

  useEffect(() => {
    localCommitsRef.current = localCommits
  }, [localCommits])

  useLayoutEffect(() => {
    jumpRequestActiveRef.current = jumpToCommitRequest != null
    pendingJumpCommitIdRef.current = pendingJumpCommitId
  }, [jumpToCommitRequest, pendingJumpCommitId])

  const handleJumpToCommitConsumed = React.useCallback(
    ({ seq, commitId }: { seq: number; commitId: string }) => {
      appendJumpLog(`request consumed callback seq=${seq} commitId=${commitId}`)
      setJumpToCommitRequest((prev) => {
        if (!prev || prev.seq !== seq) return prev
        return null
      })
      setPendingJumpCommitId((prev) => (prev === commitId ? null : prev))
    },
    [appendJumpLog]
  )

  useEffect(() => {
    if (!pendingJumpCommitId) return
    const loaded = (commitLogScope === 'all' || commitLogRev
      ? localCommits
      : [...incomingCommits, ...localCommits]
    )
    const existsInLoaded = loaded.some((c) => c.id === pendingJumpCommitId)
    appendJumpLog(
      `pending-check commitId=${pendingJumpCommitId} existsInLoaded=${existsInLoaded} loaded=${loaded.length} local=${localCommits.length} incoming=${incomingCommits.length} hasMore=${hasMoreCommits} loadingMore=${loadingMore} scope=${commitLogScope} rev=${commitLogRev ?? 'null'}`
    )
    if (existsInLoaded) {
      appendJumpLog(`pending-resolved commitId=${pendingJumpCommitId} already-loaded=true`)
      setPendingJumpCommitId(null)
      return
    }
    if (!repoInfo) {
      appendJumpLog(`pending-wait repoInfo missing commitId=${pendingJumpCommitId}`)
      return
    }
    // all/rev 模式首批 50 条由同步 effect 拉取；首批未到前不触发补载，避免 offset=0 并发请求
    const waitingInitialPage =
      (commitLogScope === 'all' || !!commitLogRev) && localCommits.length === 0
    if (waitingInitialPage) {
      appendJumpLog(`pending-wait initial-page commitId=${pendingJumpCommitId}`)
      return
    }
    if (!hasMoreCommits) {
      const hasAnyLoaded = localCommits.length > 0 || incomingCommits.length > 0
      if (hasAnyLoaded) {
        appendJumpLog(
          `pending-stop hasMore=false commitId=${pendingJumpCommitId} loaded=${loaded.length}`,
          'WARN'
        )
        setPendingJumpCommitId(null)
      }
      return
    }
    if (loadingMore) {
      appendJumpLog(`pending-wait loadingMore=true commitId=${pendingJumpCommitId}`)
      return
    }
    appendJumpLog(`pending-trigger loadMore commitId=${pendingJumpCommitId}`)
    void handleLoadMore()
  }, [
    pendingJumpCommitId,
    commitLogScope,
    commitLogRev,
    incomingCommits,
    localCommits,
    hasMoreCommits,
    loadingMore,
    repoInfo,
    handleLoadMore,
    appendJumpLog,
  ])

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* 菜单工具栏 */}
      <MenuToolbar
        onOpenRepository={openRepository}
        onRepoSelect={handleRecentRepoSelect}
        onRemoveRecentRepo={removeRecentRepo}
        onUpdateRecentRepo={updateRecentRepoEntry}
        recentRepos={recentRepos}
        autoOpenEnabled={autoOpenEnabled}
        onToggleAutoOpen={setAutoOpenEnabled}
        loading={loading}
        repoInfo={repoInfo}
        onInitRepository={handleInitRepository}
        onCloneRepository={handleCloneRepository}
        onOpenProxyConfig={() => setProxyConfigOpen(true)}
        onOpenAiConfig={() => setAiConfigOpen(true)}
      />
      
      {/* 顶部工具栏 */}
      <TopToolbar
        onBranchSelect={handleBranchSelect}
        onCreateBranch={handleCreateBranch}
        onDeleteBranch={handleDeleteBranch}
        onRenameBranch={handleRenameBranch}
        onMergeBranch={handleMergeBranch}
        onOpenRemoteRepository={handleOpenRemoteRepository}
        onOpenRemoteManage={() => setRemoteManageOpen(true)}
        onPullChanges={handlePullChanges}
        loading={loading}
        repoInfo={repoInfo}
        isDark={isDark}
        onToggleDarkMode={toggleDarkMode}
      />

      <div className="flex-1 flex flex-col min-h-0">
        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-destructive">{error}</p>
          </div>
        )}

        {/* 顶部 Tab 切换 */}
        <div className="flex-shrink-0 px-4 pt-2 border-b border-border flex items-center gap-1">
          <button
            type="button"
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
              activeTab === 'workspace'
                ? 'border-primary text-primary bg-background'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={() => setActiveTab('workspace')}
          >
            工作区
          </button>
          <button
            type="button"
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
              activeTab === 'commits'
                ? 'border-primary text-primary bg-background'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={() => setActiveTab('commits')}
          >
            提交
          </button>
          <button
            type="button"
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
              activeTab === 'files'
                ? 'border-primary text-primary bg-background'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={() => setActiveTab('files')}
          >
            文件树
          </button>
          <button
            type="button"
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
              activeTab === 'stats'
                ? 'border-primary text-primary bg-background'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={() => setActiveTab('stats')}
          >
            统计
          </button>
        </div>

        {/* Tab 内容 */}
        {activeTab === 'workspace' ? (
          <div className="flex-1 flex flex-col min-h-0 px-4">
            <OperationsPanel
              repoInfo={repoInfo}
              onRefresh={handleRefresh}
              onPushChanges={handlePushChangesRealtime}
              onPullChanges={handlePullChanges}
              onFetchChanges={handleFetchChanges}
              gitActions={
                repoInfo
                  ? {
                      commitChanges,
                      fetchChanges,
                      pushChanges,
                      pullChanges,
                      refreshRepoInfo,
                    }
                  : undefined
              }
            />
          </div>
        ) : activeTab === 'files' ? (
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-2 pt-1">
            {repoInfo ? (
              <RepoFileTree repoPath={repoInfo.path} />
            ) : (
              <div className="flex flex-1 items-center justify-center py-12 text-center text-muted-foreground">
                请先选择一个 Git 仓库
              </div>
            )}
          </div>
        ) : activeTab === 'stats' ? (
          <div className="flex min-h-0 flex-1 flex-col px-2 sm:px-4">
            <AuthorStatsPanel
              repoPath={repoInfo?.path}
              branchNames={repoInfo?.branches.map((b) => b.name) ?? []}
              initialReportTab={statsReportTab}
              onReportTabChange={setStatsReportTab}
              getAuthorCommitStats={getAuthorCommitStats}
              getCommitActivityStats={getCommitActivityStats}
              getCommitsForActivityBucket={getCommitsForActivityBucket}
              getDiffAggregateStats={getDiffAggregateStats}
              getFileTerritoryStats={getFileTerritoryStats}
              getRecentChangedFilesStats={getRecentChangedFilesStats}
              getBranchActivityLifecycleStats={getBranchActivityLifecycleStats}
              onJumpToCommit={handleStatsCommitJump}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col px-2 sm:px-4">
            {repoInfo ? (
              <UnifiedCommitView
                commits={mergedCommitsForViewDeduped}
                onLoadMore={handleLoadMore}
                hasMore={!searchResults && hasMoreCommits}
                loading={loadingMore}
                searchLoading={searchLoading}
                isSearchMode={searchResults !== null}
                onSearchFullRepo={handleSearchFullRepo}
                onClearSearchMode={handleClearSearchMode}
                commitLogScope={commitLogScope}
                onCommitLogScopeChange={handleCommitLogScopeChange}
                commitLogRev={commitLogRev}
                onCommitLogRevChange={handleCommitLogRevChange}
                branchNames={repoInfo.branches.map((b) => b.name)}
                aheadCount={
                  commitLogScope === 'all' || commitLogRev
                    ? 0
                    : (repoInfo?.ahead ?? 0)
                }
                incomingCommitCount={
                  searchResults || commitLogScope === 'all' || commitLogRev
                    ? 0
                    : incomingCommits.length
                }
                behindCount={repoInfo?.behind}
                onFetchChanges={handleFetchChanges}
                onPullChanges={handlePullChanges}
                onPushChanges={handlePushChangesRealtime}
                onRefreshRepo={handleRefresh}
                syncBusy={loading}
                onGetCommitFiles={getCommitFiles}
                onGetDiff={getFileDiff}
                onGetSingleFileDiff={getSingleFileDiff}
                repoPath={repoInfo.path}
                currentBranch={repoInfo.current_branch}
                headShortId={repoInfo.head_short_id ?? undefined}
                onResetToCommit={resetToCommit}
                onCreateBranch={handleCreateBranch}
                onCherryPickCommit={handleCherryPickCommit}
                onRevertCommit={handleRevertCommit}
                onRebaseToCommit={handleRebaseToCommit}
                listError={commitListError}
                hasUpstream={repoInfo.has_upstream ?? true}
                hasOriginRemote={repoInfo.has_origin_remote ?? true}
                jumpToCommitRequest={jumpToCommitRequest}
                onJumpToCommitConsumed={handleJumpToCommitConsumed}
                suspendAutoLoadMore={jumpToCommitRequest != null}
              />
            ) : (
              <div className="text-center py-12 flex-1 flex items-center justify-center">
                <p className="text-muted-foreground">请先选择一个 Git 仓库</p>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* 日志弹窗 */}
      <LogModal
        isOpen={logModalOpen}
        onClose={() => setLogModalOpen(false)}
        title={logModalTitle}
        logs={logs}
        isRunning={isOperationRunning}
      />
      
      {/* 代理配置弹窗 */}
      <ProxyConfigModal
        isOpen={proxyConfigOpen}
        onClose={() => setProxyConfigOpen(false)}
      />
      <AiConfigModal isOpen={aiConfigOpen} onClose={() => setAiConfigOpen(false)} />
      <RemoteManageModal
        isOpen={remoteManageOpen}
        onClose={() => setRemoteManageOpen(false)}
        repoPath={repoInfo?.path}
        loading={loading}
        getRemoteManagementInfo={getRemoteManagementInfo}
        addRemote={addRemote}
        updateRemote={updateRemote}
        removeRemote={removeRemote}
        setBranchUpstream={setBranchUpstream}
      />
    </div>
  )
}

export default App 
