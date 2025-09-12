import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { FolderOpen, GitBranch, Settings } from 'lucide-react'
import { RecentRepos } from './RecentRepos'
import { RecentRepo } from '../types/git'

interface RepositorySelectorProps {
  onOpenRepository: () => void
  onRepoSelect: (path: string) => void
  loading: boolean
  repoInfo: any
  recentRepos: RecentRepo[]
  autoOpenEnabled: boolean
  onToggleAutoOpen: (enabled: boolean) => void
}

export function RepositorySelector({ 
  onOpenRepository, 
  onRepoSelect,
  loading, 
  repoInfo,
  recentRepos,
  autoOpenEnabled,
  onToggleAutoOpen
}: RepositorySelectorProps) {
  if (repoInfo) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              当前仓库
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm">
                <span className="font-medium">路径:</span> {repoInfo.path}
              </p>
              <p className="text-sm">
                <span className="font-medium">当前分支:</span> {repoInfo.current_branch}
              </p>
              <p className="text-sm">
                <span className="font-medium">提交数:</span> {repoInfo.commits.length}
              </p>
            </div>
          </CardContent>
        </Card>
        
        <RecentRepos
          recentRepos={recentRepos}
          onRepoSelect={onRepoSelect}
          loading={loading}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              选择 Git 仓库
            </CardTitle>
            <div className="flex items-center gap-2 text-sm">
              <Settings className="h-4 w-4" />
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoOpenEnabled}
                  onChange={(e) => onToggleAutoOpen(e.target.checked)}
                  className="rounded"
                />
                自动打开最近仓库
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">
              选择一个本地 Git 仓库来开始使用 GitLite
            </p>
            <Button 
              onClick={onOpenRepository} 
              disabled={loading}
              className="flex items-center gap-2"
            >
              <FolderOpen className="h-4 w-4" />
              {loading ? '打开中...' : '选择仓库'}
            </Button>
          </div>
        </CardContent>
      </Card>
      
      <RecentRepos
        recentRepos={recentRepos}
        onRepoSelect={onRepoSelect}
        loading={loading}
      />
    </div>
  )
}
