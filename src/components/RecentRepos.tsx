import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { RecentRepo } from '../types/git'
import { Clock, FolderOpen, Trash2 } from 'lucide-react'

interface RecentReposProps {
  recentRepos: RecentRepo[]
  onRepoSelect: (path: string) => void
  onRemoveRepo?: (path: string) => void
  loading?: boolean
}

export function RecentRepos({ 
  recentRepos, 
  onRepoSelect, 
  onRemoveRepo, 
  loading 
}: RecentReposProps) {
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString)
      const now = new Date()
      const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
      
      if (diffInHours < 1) {
        return '刚刚'
      } else if (diffInHours < 24) {
        return `${diffInHours}小时前`
      } else if (diffInHours < 24 * 7) {
        const days = Math.floor(diffInHours / 24)
        return `${days}天前`
      } else {
        return date.toLocaleDateString()
      }
    } catch {
      return '未知时间'
    }
  }

  if (recentRepos.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          最近打开的仓库
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {recentRepos.map((repo) => (
            <div
              key={repo.path}
              className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium truncate">{repo.name}</span>
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {repo.path}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {formatDate(repo.last_opened)}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRepoSelect(repo.path)}
                  disabled={loading}
                >
                  打开
                </Button>
                {onRemoveRepo && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRemoveRepo(repo.path)}
                    disabled={loading}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
