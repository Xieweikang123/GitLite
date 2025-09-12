import React, { useState } from 'react'
import { useGit } from './hooks/useGit'
import { RepositorySelector } from './components/RepositorySelector'
import { CommitList } from './components/CommitList'
import { BranchList } from './components/BranchList'
import { DiffViewer } from './components/DiffViewer'
import { CommitInfo } from './types/git'

function App() {
  const { repoInfo, loading, error, openRepository, checkoutBranch, getFileDiff } = useGit()
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null)

  const handleCommitSelect = (commit: CommitInfo) => {
    setSelectedCommit(commit)
  }

  const handleBranchSelect = async (branchName: string) => {
    await checkoutBranch(branchName)
    setSelectedCommit(null) // 清除选中的提交
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">GitLite</h1>
          <p className="text-muted-foreground">
            轻量级 Git GUI 客户端
          </p>
        </header>

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-destructive">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：仓库选择和分支 */}
          <div className="space-y-6">
            <RepositorySelector
              onOpenRepository={openRepository}
              loading={loading}
              repoInfo={repoInfo}
            />
            
            {repoInfo && (
              <BranchList
                branches={repoInfo.branches}
                currentBranch={repoInfo.current_branch}
                onBranchSelect={handleBranchSelect}
                loading={loading}
              />
            )}
          </div>

          {/* 中间：提交列表 */}
          <div>
            {repoInfo ? (
              <CommitList
                commits={repoInfo.commits}
                onCommitSelect={handleCommitSelect}
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
                onGetDiff={getFileDiff}
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
