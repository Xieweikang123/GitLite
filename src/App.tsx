import React, { useState } from 'react'
import { useGit } from './hooks/useGit'
import { TopToolbar } from './components/TopToolbar'
import { RepositorySelector } from './components/RepositorySelector'
import { CommitList } from './components/CommitList'
import { DiffViewer } from './components/DiffViewer'
import { FileList } from './components/FileList'
import { CommitInfo, FileChange } from './types/git'

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
      {/* 顶部工具栏 */}
      <TopToolbar
        onOpenRepository={openRepository}
        onRepoSelect={handleRecentRepoSelect}
        recentRepos={recentRepos}
        autoOpenEnabled={autoOpenEnabled}
        onToggleAutoOpen={setAutoOpenEnabled}
        loading={loading}
      />

      <div className="container mx-auto p-6">
        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-destructive">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：当前仓库信息 */}
          <div>
            <RepositorySelector
              onBranchSelect={handleBranchSelect}
              loading={loading}
              repoInfo={repoInfo}
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
