import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { open } from '@tauri-apps/api/dialog'
import {
  RepoInfo,
  CommitInfo,
  FileChange,
  RecentRepo,
  WorkspaceStatus,
  PullOutcome,
  PullWithLogsResult,
  GitResetMode,
  AuthorCommitStat,
  TimeBucketStat,
  DiffAggregateStats,
  FileTerritoryStat,
} from '../types/git'
import { formatTauriInvokeError } from '../utils/tauriError'

const AUTO_OPEN_ENABLED_KEY = 'gitlite:autoOpenEnabled'

export function useGit() {
  /** 打开仓库 / 轻量刷新的世代号：仅最后一次结果写入 state，避免异步返回乱序 */
  const repoLoadGenRef = useRef(0)

  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>([])
  const [autoOpenEnabled, setAutoOpenEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTO_OPEN_ENABLED_KEY)
      return saved === null ? true : saved === '1'
    } catch {
      return true
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_OPEN_ENABLED_KEY, autoOpenEnabled ? '1' : '0')
    } catch {
      /* ignore storage failures */
    }
  }, [autoOpenEnabled])

  const openRepository = useCallback(async () => {
    const myGen = ++repoLoadGenRef.current
    try {
      setLoading(true)
      setError(null)
      
      const selectedPath = await open({
        directory: true,
        title: '选择 Git 仓库',
      })
      
      if (selectedPath && typeof selectedPath === 'string') {
        const info: RepoInfo = await invoke('open_repository', {
          path: selectedPath,
        })
        if (myGen !== repoLoadGenRef.current) return
        setRepoInfo(info)
        // 刷新最近仓库列表
        loadRecentRepos()
      }
    } catch (err) {
      if (myGen === repoLoadGenRef.current) {
        setError(formatTauriInvokeError(err, '打开仓库失败'))
      }
    } finally {
      if (myGen === repoLoadGenRef.current) {
        setLoading(false)
      }
    }
  }, [])

  const openRepositoryByPath = useCallback(async (path: string) => {
    const myGen = ++repoLoadGenRef.current
    try {
      setLoading(true)
      setError(null)
      
      const info: RepoInfo = await invoke('open_repository', {
        path,
      })
      if (myGen !== repoLoadGenRef.current) return
      setRepoInfo(info)
      // 刷新最近仓库列表
      loadRecentRepos()
    } catch (err) {
      if (myGen === repoLoadGenRef.current) {
        setError(formatTauriInvokeError(err, '打开仓库失败'))
      }
    } finally {
      if (myGen === repoLoadGenRef.current) {
        setLoading(false)
      }
    }
  }, [])

  const loadRecentRepos = useCallback(async () => {
    try {
      const repos: RecentRepo[] = await invoke('get_recent_repos')
      setRecentRepos(repos)
    } catch (err) {
      console.error('Failed to load recent repos:', err)
    }
  }, [])

  /** 重新拉取仓库元数据（ahead/behind 等），不触发全局 loading，供提交面板等轻量刷新 */
  const refreshRepoInfo = useCallback(async (): Promise<RepoInfo> => {
    if (!repoInfo) throw new Error('未打开仓库')
    const myGen = ++repoLoadGenRef.current
    const info: RepoInfo = await invoke('open_repository', {
      path: repoInfo.path,
    })
    if (myGen !== repoLoadGenRef.current) return info
    setRepoInfo(info)
    await loadRecentRepos()
    return info
  }, [repoInfo, loadRecentRepos])

  const removeRecentRepo = useCallback(
    async (path: string) => {
      try {
        await invoke('remove_recent_repo', { path })
        await loadRecentRepos()
      } catch (err) {
        setError(formatTauriInvokeError(err, '从最近列表中删除失败'))
      }
    },
    [loadRecentRepos]
  )

  const updateRecentRepoEntry = useCallback(
    async (oldPath: string, newPath: string, newName: string) => {
      try {
        await invoke('update_recent_repo_entry', {
          oldPath,
          newPath,
          newName,
        })
        await loadRecentRepos()
        if (repoInfo?.path === oldPath && oldPath !== newPath) {
          await openRepositoryByPath(newPath)
        }
      } catch (err) {
        setError(formatTauriInvokeError(err, '更新最近项失败'))
      }
    },
    [loadRecentRepos, repoInfo?.path, openRepositoryByPath]
  )

  // 组件加载时获取最近仓库列表
  useEffect(() => {
    loadRecentRepos()
  }, [])

  // 当最近仓库列表加载完成后，自动打开最新的仓库
  useEffect(() => {
    if (autoOpenEnabled && recentRepos.length > 0 && !repoInfo) {
      openRepositoryByPath(recentRepos[0].path)
    }
  }, [recentRepos, repoInfo, openRepositoryByPath, autoOpenEnabled])

  const checkoutBranch = useCallback(async (branchName: string) => {
    if (!repoInfo) return
    
    try {
      setLoading(true)
      setError(null)
      
      await invoke('checkout_branch', {
        repoPath: repoInfo.path,
        branchName,
      })
      
      // 重新获取仓库信息
      const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
        path: repoInfo.path,
      })
      setRepoInfo(updatedRepoInfo)
    } catch (err) {
      setError(formatTauriInvokeError(err, '切换分支失败'))
    } finally {
      setLoading(false)
    }
  }, [repoInfo])

  const initRepository = useCallback(
    async (path: string, initialBranch?: string): Promise<boolean> => {
      const repoPath = path.trim()
      if (!repoPath) {
        setError('仓库路径不能为空')
        return false
      }
      try {
        setLoading(true)
        setError(null)
        await invoke('init_repository', {
          path: repoPath,
          initialBranch: initialBranch?.trim() || undefined,
        })
        const info: RepoInfo = await invoke('open_repository', {
          path: repoPath,
        })
        setRepoInfo(info)
        await loadRecentRepos()
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '初始化仓库失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [loadRecentRepos]
  )

  const cloneRepository = useCallback(
    async (
      remoteUrl: string,
      destinationPath: string,
      branch?: string
    ): Promise<boolean> => {
      const url = remoteUrl.trim()
      const path = destinationPath.trim()
      if (!url) {
        setError('远程地址不能为空')
        return false
      }
      if (!path) {
        setError('目标路径不能为空')
        return false
      }
      try {
        setLoading(true)
        setError(null)
        await invoke('clone_repository', {
          remoteUrl: url,
          destinationPath: path,
          branch: branch?.trim() || undefined,
        })
        const info: RepoInfo = await invoke('open_repository', {
          path,
        })
        setRepoInfo(info)
        await loadRecentRepos()
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '克隆仓库失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [loadRecentRepos]
  )

  const createBranch = useCallback(
    async (
      branchName: string,
      checkout: boolean = true,
      startPoint?: string
    ): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)

        await invoke('create_branch', {
          repoPath: repoInfo.path,
          branchName: branchName.trim(),
          checkout,
          startPoint: startPoint?.trim() || undefined,
        })

        const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
          path: repoInfo.path,
        })
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '创建分支失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const deleteBranch = useCallback(
    async (branchName: string, force: boolean = false): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)
        await invoke('delete_branch', {
          repoPath: repoInfo.path,
          branchName: branchName.trim(),
          force,
        })
        const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
          path: repoInfo.path,
        })
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '删除分支失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const renameBranch = useCallback(
    async (oldName: string, newName: string): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)
        await invoke('rename_branch', {
          repoPath: repoInfo.path,
          oldName: oldName.trim(),
          newName: newName.trim(),
        })
        const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
          path: repoInfo.path,
        })
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '重命名分支失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const mergeBranch = useCallback(
    async (sourceBranch: string, ffOnly: boolean = true): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)
        await invoke('merge_branch', {
          repoPath: repoInfo.path,
          sourceBranch: sourceBranch.trim(),
          ffOnly,
        })
        const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
          path: repoInfo.path,
        })
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, '合并分支失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const resetToCommit = useCallback(
    async (commitId: string, mode: GitResetMode) => {
      if (!repoInfo) return

      try {
        setLoading(true)
        setError(null)

        await invoke('reset_to_commit', {
          repoPath: repoInfo.path,
          commitId,
          mode,
        })

        const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
          path: repoInfo.path,
        })
        setRepoInfo(updatedRepoInfo)
      } catch (err) {
        setError(formatTauriInvokeError(err, '重置失败'))
        throw err
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const cherryPickCommit = useCallback(
    async (commitId: string): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)
        await invoke('cherry_pick_commit', {
          repoPath: repoInfo.path,
          commitId,
        })
        const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
          path: repoInfo.path,
        })
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, 'Cherry-pick 失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const revertCommit = useCallback(
    async (commitId: string): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)
        await invoke('revert_commit', {
          repoPath: repoInfo.path,
          commitId,
        })
        const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
          path: repoInfo.path,
        })
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, 'Revert 失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const rebaseToCommit = useCallback(
    async (ontoCommitId: string): Promise<boolean> => {
      if (!repoInfo) return false

      try {
        setLoading(true)
        setError(null)
        await invoke('rebase_to_commit', {
          repoPath: repoInfo.path,
          ontoCommitId,
        })
        const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
          path: repoInfo.path,
        })
        setRepoInfo(updatedRepoInfo)
        return true
      } catch (err) {
        setError(formatTauriInvokeError(err, 'Rebase 失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoInfo]
  )

  const getCommitFiles = useCallback(async (commitId: string): Promise<FileChange[]> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const files: FileChange[] = await invoke('get_commit_files', {
        repoPath: repoInfo.path,
        commitId,
      })
      return files
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取文件列表失败'))
    }
  }, [repoInfo])

  const getSingleFileDiff = useCallback(async (commitId: string, filePath: string): Promise<string> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const diff: string = await invoke('get_single_file_diff', {
        repoPath: repoInfo.path,
        commitId,
        filePath,
      })
      return diff
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取文件差异失败'))
    }
  }, [repoInfo])

  const getFileDiff = useCallback(async (commitId: string): Promise<string> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const diff: string = await invoke('get_file_diff', {
        repoPath: repoInfo.path,
        commitId,
      })
      return diff
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取差异失败'))
    }
  }, [repoInfo])

  const getCommitsPaginated = useCallback(
    async (
      limit?: number,
      offset?: number,
      scope?: 'head' | 'all',
      rev?: string | null
    ) => {
      try {
        if (!repoInfo) throw new Error('No repository selected')
        const r = rev?.trim() || null
        return await invoke<CommitInfo[]>('get_commits_paginated', {
          repoPath: repoInfo.path,
          limit,
          offset,
          scope: scope === 'all' ? 'all' : null,
          rev: r,
        })
      } catch (error) {
        console.error('Failed to get paginated commits:', error)
        throw error
      }
    },
    [repoInfo]
  )

  const searchCommits = useCallback(
    async (
      query: string,
      limit?: number,
      scope?: 'head' | 'all',
      rev?: string | null
    ) => {
      try {
        if (!repoInfo) throw new Error('No repository selected')
        const r = rev?.trim() || null
        return await invoke<CommitInfo[]>('search_commits', {
          repoPath: repoInfo.path,
          query: query.trim(),
          limit: limit ?? 500,
          scope: scope === 'all' ? 'all' : null,
          rev: r,
        })
      } catch (error) {
        console.error('Failed to search commits:', error)
        throw error
      }
    },
    [repoInfo]
  )

  const getAuthorCommitStats = useCallback(
    async (scope: 'head' | 'all', rev?: string | null) => {
      if (!repoInfo) throw new Error('No repository selected')
      const r = rev?.trim() || null
      return await invoke<AuthorCommitStat[]>('get_author_commit_stats', {
        repoPath: repoInfo.path,
        scope: scope === 'all' ? 'all' : null,
        rev: r,
      })
    },
    [repoInfo]
  )

  const getCommitActivityStats = useCallback(
    async (
      granularity: 'day' | 'week' | 'month',
      scope: 'head' | 'all',
      rev?: string | null
    ) => {
      if (!repoInfo) throw new Error('No repository selected')
      const r = rev?.trim() || null
      return await invoke<TimeBucketStat[]>('get_commit_activity_stats', {
        repoPath: repoInfo.path,
        scope: scope === 'all' ? 'all' : null,
        rev: r,
        granularity,
      })
    },
    [repoInfo]
  )

  const getCommitsForActivityBucket = useCallback(
    async (
      granularity: 'day' | 'week' | 'month',
      bucketKey: string,
      scope: 'head' | 'all',
      rev?: string | null,
      limit?: number
    ) => {
      if (!repoInfo) throw new Error('No repository selected')
      const r = rev?.trim() || null
      return await invoke<CommitInfo[]>('get_commits_for_activity_bucket', {
        repoPath: repoInfo.path,
        scope: scope === 'all' ? 'all' : null,
        rev: r,
        granularity,
        bucketKey: bucketKey.trim(),
        limit: limit ?? 500,
      })
    },
    [repoInfo]
  )

  const getDiffAggregateStats = useCallback(
    async (scope: 'head' | 'all', rev?: string | null, pathLimit?: number) => {
      if (!repoInfo) throw new Error('No repository selected')
      const r = rev?.trim() || null
      return await invoke<DiffAggregateStats>('get_diff_aggregate_stats', {
        repoPath: repoInfo.path,
        scope: scope === 'all' ? 'all' : null,
        rev: r,
        pathLimit: pathLimit ?? 40,
      })
    },
    [repoInfo]
  )

  const getFileTerritoryStats = useCallback(
    async (scope: 'head' | 'all', rev?: string | null, fileLimit?: number) => {
      if (!repoInfo) throw new Error('No repository selected')
      const r = rev?.trim() || null
      return await invoke<FileTerritoryStat[]>('get_file_territory_stats', {
        repoPath: repoInfo.path,
        scope: scope === 'all' ? 'all' : null,
        rev: r,
        fileLimit: fileLimit ?? 120,
      })
    },
    [repoInfo]
  )

  const getWorkspaceStatus = useCallback(async (): Promise<WorkspaceStatus> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const status: WorkspaceStatus = await invoke('get_workspace_status', {
        repoPath: repoInfo.path,
      })
      return status
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取工作区状态失败'))
    }
  }, [repoInfo])

  const stageFile = useCallback(async (filePath: string) => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      await invoke('stage_file', {
        repoPath: repoInfo.path,
        filePath,
      })
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '暂存文件失败'))
    }
  }, [repoInfo])

  const unstageFile = useCallback(async (filePath: string) => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      await invoke('unstage_file', {
        repoPath: repoInfo.path,
        filePath,
      })
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '取消暂存文件失败'))
    }
  }, [repoInfo])

  const commitChanges = useCallback(async (message: string) => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      await invoke('commit_changes', {
        repoPath: repoInfo.path,
        message,
      })
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '提交失败'))
    }
  }, [repoInfo])

  const pushChanges = useCallback(async () => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      await invoke('push_changes', {
        repoPath: repoInfo.path,
      })
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '推送失败'))
    }
  }, [repoInfo])

  const pullChanges = useCallback(async (): Promise<PullOutcome> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const outcome: PullOutcome = await invoke('pull_changes', {
        repoPath: repoInfo.path,
      })
      
      const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
        path: repoInfo.path,
      })
      setRepoInfo(updatedRepoInfo)
      return outcome
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '拉取失败'))
    }
  }, [repoInfo])

  const fetchChanges = useCallback(async () => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const result = await invoke('fetch_changes', {
        repoPath: repoInfo.path,
      })
      
      // 获取成功后，重新获取仓库信息以更新状态
      const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
        path: repoInfo.path,
      })
      setRepoInfo(updatedRepoInfo)
      
      return result
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取失败'))
    }
  }, [repoInfo])

  const fetchChangesWithLogs = useCallback(async () => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const logs: Array<[string, string, string]> = await invoke('fetch_changes_with_logs', {
        repoPath: repoInfo.path,
      })
      
      // 获取成功后，重新获取仓库信息以更新状态
      const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
        path: repoInfo.path,
      })
      setRepoInfo(updatedRepoInfo)
      
      return logs
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '获取失败'))
    }
  }, [repoInfo])

  const pushChangesWithLogs = useCallback(async () => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const logs: Array<[string, string, string]> = await invoke('push_changes_with_logs', {
        repoPath: repoInfo.path,
      })
      
      // 推送成功后，重新获取仓库信息以更新状态
      const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
        path: repoInfo.path,
      })
      setRepoInfo(updatedRepoInfo)
      
      return logs
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '推送失败'))
    }
  }, [repoInfo])

  const pushChangesWithRealtimeLogs = useCallback(async () => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      await invoke('push_changes_with_realtime_logs', {
        repoPath: repoInfo.path,
      })
      
      // 推送成功后，重新获取仓库信息以更新状态
      const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
        path: repoInfo.path,
      })
      setRepoInfo(updatedRepoInfo)
      
      return []
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '推送失败'))
    }
  }, [repoInfo])

  const pullChangesWithLogs = useCallback(async (): Promise<PullWithLogsResult> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const result: PullWithLogsResult = await invoke('pull_changes_with_logs', {
        repoPath: repoInfo.path,
      })
      
      const updatedRepoInfo: RepoInfo = await invoke('open_repository', {
        path: repoInfo.path,
      })
      setRepoInfo(updatedRepoInfo)
      
      return result
    } catch (err) {
      throw new Error(formatTauriInvokeError(err, '拉取失败'))
    }
  }, [repoInfo])

  return {
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
    resetToCommit,
    cherryPickCommit,
    revertCommit,
    rebaseToCommit,
    getFileDiff,
    getCommitFiles,
    getSingleFileDiff,
    getCommitsPaginated,
    searchCommits,
    getAuthorCommitStats,
    getCommitActivityStats,
    getCommitsForActivityBucket,
    getDiffAggregateStats,
    getFileTerritoryStats,
    getWorkspaceStatus,
    stageFile,
    unstageFile,
    commitChanges,
    pushChanges,
    pullChanges,
    refreshRepoInfo,
    fetchChanges,
    fetchChangesWithLogs,
    pushChangesWithLogs,
    pushChangesWithRealtimeLogs,
    pullChangesWithLogs,
  }
}
