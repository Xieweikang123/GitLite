import { useState, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { open } from '@tauri-apps/api/dialog'
import { RepoInfo, CommitInfo, FileChange, RecentRepo, WorkspaceStatus } from '../types/git'

export function useGit() {
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>([])
  const [autoOpenEnabled, setAutoOpenEnabled] = useState(true) // 默认启用自动打开

  const openRepository = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      const selectedPath = await open({
        directory: true,
        title: '选择 Git 仓库',
      })
      
      if (selectedPath && typeof selectedPath === 'string') {
        const repoInfo: RepoInfo = await invoke('open_repository', {
          path: selectedPath,
        })
        setRepoInfo(repoInfo)
        // 刷新最近仓库列表
        loadRecentRepos()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开仓库失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const openRepositoryByPath = useCallback(async (path: string) => {
    try {
      setLoading(true)
      setError(null)
      
      const repoInfo: RepoInfo = await invoke('open_repository', {
        path,
      })
      setRepoInfo(repoInfo)
      // 刷新最近仓库列表
      loadRecentRepos()
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开仓库失败')
    } finally {
      setLoading(false)
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
      setError(err instanceof Error ? err.message : '切换分支失败')
    } finally {
      setLoading(false)
    }
  }, [repoInfo])

  const getCommitFiles = useCallback(async (commitId: string): Promise<FileChange[]> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const files: FileChange[] = await invoke('get_commit_files', {
        repoPath: repoInfo.path,
        commitId,
      })
      return files
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : '获取文件列表失败')
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
      throw new Error(err instanceof Error ? err.message : '获取文件差异失败')
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
      throw new Error(err instanceof Error ? err.message : '获取差异失败')
    }
  }, [repoInfo])

  const getCommitsPaginated = useCallback(async (limit?: number, offset?: number) => {
    try {
      if (!repoInfo) throw new Error('No repository selected')
      return await invoke<CommitInfo[]>('get_commits_paginated', { 
        repoPath: repoInfo.path, 
        limit, 
        offset 
      })
    } catch (error) {
      console.error('Failed to get paginated commits:', error)
      throw error
    }
  }, [repoInfo])

  const getWorkspaceStatus = useCallback(async (): Promise<WorkspaceStatus> => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      const status: WorkspaceStatus = await invoke('get_workspace_status', {
        repoPath: repoInfo.path,
      })
      return status
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : '获取工作区状态失败')
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
      throw new Error(err instanceof Error ? err.message : '暂存文件失败')
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
      throw new Error(err instanceof Error ? err.message : '取消暂存文件失败')
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
      throw new Error(err instanceof Error ? err.message : '提交失败')
    }
  }, [repoInfo])

  const pushChanges = useCallback(async () => {
    if (!repoInfo) throw new Error('No repository open')
    
    try {
      await invoke('push_changes', {
        repoPath: repoInfo.path,
      })
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : '推送失败')
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
    checkoutBranch,
    getFileDiff,
    getCommitFiles,
    getSingleFileDiff,
    getCommitsPaginated,
    getWorkspaceStatus,
    stageFile,
    unstageFile,
    commitChanges,
    pushChanges,
  }
}
