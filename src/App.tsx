import React, { useState } from 'react'
import { useGit } from './hooks/useGit'
import { TopToolbar } from './components/TopToolbar'
import { MenuToolbar } from './components/MenuToolbar'
import { WorkspaceStatus } from './components/WorkspaceStatus'
import { CommitList } from './components/CommitList'
import { DiffViewer } from './components/DiffViewer'
import { FileList } from './components/FileList'
import { CommitInfo, FileChange } from './types/git'
import { invoke } from '@tauri-apps/api/tauri'

function App() {
  const { 
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
    getCommitsPaginated
  } = useGit()
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null)
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [allCommits, setAllCommits] = useState<CommitInfo[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMoreCommits, setHasMoreCommits] = useState(true)

  const handleCommitSelect = async (commit: CommitInfo) => {
    setSelectedCommit(commit)
    setSelectedFile(null) // 清除选中的文件
    
    try {
      const files = await getCommitFiles(commit.id)
      setCommitFiles(files)
    } catch (err) {
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

  const handleRecentRepoSelect = async (path: string) => {
    await openRepositoryByPath(path)
    setSelectedCommit(null)
    setCommitFiles([])
    setSelectedFile(null)
    setAllCommits([])
    setHasMoreCommits(true)
  }

  const handleLoadMore = async () => {
    if (loadingMore || !hasMoreCommits || !repoInfo) return
    
    setLoadingMore(true)
    try {
      const newCommits = await getCommitsPaginated(50, allCommits.length)
      if (newCommits.length === 0) {
        setHasMoreCommits(false)
      } else {
        setAllCommits(prev => [...prev, ...newCommits])
        if (newCommits.length < 50) {
          setHasMoreCommits(false)
        }
      }
    } catch (error) {
      console.error('Failed to load more commits:', error)
    } finally {
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
        // 使用 Tauri 的 shell API 在默认浏览器中打开外部链接
        await invoke('open_external_url', { url: repoInfo.remote_url })
      } catch (error) {
        console.error('Failed to open remote repository:', error)
        // 如果 Tauri API 失败，回退到 window.open
        window.open(repoInfo.remote_url, '_blank')
      }
    }
  }

  // 当仓库信息更新时，重置提交列表
  React.useEffect(() => {
    if (repoInfo) {
      setAllCommits(repoInfo.commits)
      setHasMoreCommits(repoInfo.commits.length >= 50)
    } else {
      setAllCommits([])
      setHasMoreCommits(true)
    }
  }, [repoInfo])

  return (
    <div className="min-h-screen bg-background">
      {/* 菜单工具栏 */}
      <MenuToolbar
        onOpenRepository={openRepository}
        onRepoSelect={handleRecentRepoSelect}
        recentRepos={recentRepos}
        autoOpenEnabled={autoOpenEnabled}
        onToggleAutoOpen={setAutoOpenEnabled}
        loading={loading}
        repoInfo={repoInfo}
      />
      
      {/* 顶部工具栏 */}
      <TopToolbar
        onOpenRepository={openRepository}
        onBranchSelect={handleBranchSelect}
        onOpenRemoteRepository={handleOpenRemoteRepository}
        loading={loading}
        repoInfo={repoInfo}
      />

      <div className="container mx-auto p-6">
        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-destructive">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[450px_400px_1fr] gap-6">
          {/* 左侧：工作区状态 */}
          <div>
            <WorkspaceStatus
              repoInfo={repoInfo}
              onRefresh={handleRefresh}
            />
          </div>

          {/* 中间：文件变更和提交列表 */}
          <div className="space-y-6">
            {selectedCommit && (
              <FileList
                files={commitFiles}
                selectedFile={selectedFile}
                onFileSelect={handleFileSelect}
                loading={loading}
              />
            )}
            
            {repoInfo ? (
              <CommitList
                commits={allCommits}
                onCommitSelect={handleCommitSelect}
                onLoadMore={handleLoadMore}
                hasMore={hasMoreCommits}
                loading={loadingMore}
                aheadCount={repoInfo?.ahead ?? 0}
              />
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  请先选择一个 Git 仓库
                </p>
              </div>
            )}
          </div>

          {/* 右侧：差异查看器 */}
          <div>
            {repoInfo ? (
              <DiffViewer
                commit={selectedCommit}
                selectedFile={selectedFile}
                onGetDiff={getFileDiff}
                onGetSingleFileDiff={getSingleFileDiff}
              />
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  请先选择一个 Git 仓库
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
