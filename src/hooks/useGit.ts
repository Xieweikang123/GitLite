import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { open } from '@tauri-apps/api/dialog'
import { RepoInfo, CommitInfo, FileChange } from '../types/git'

export function useGit() {
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开仓库失败')
    } finally {
      setLoading(false)
    }
  }, [])

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

  return {
    repoInfo,
    loading,
    error,
    openRepository,
    checkoutBranch,
    getFileDiff,
    getCommitFiles,
    getSingleFileDiff,
  }
}
