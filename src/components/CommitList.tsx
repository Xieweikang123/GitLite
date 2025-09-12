import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Search, Loader2 } from 'lucide-react'
import { CommitInfo } from '../types/git'

interface CommitListProps {
  commits: CommitInfo[]
  onCommitSelect?: (commit: CommitInfo) => void
  onLoadMore?: () => void
  hasMore?: boolean
  loading?: boolean
}

export function CommitList({ 
  commits, 
  onCommitSelect, 
  onLoadMore, 
  hasMore = false, 
  loading = false 
}: CommitListProps) {
  const [searchTerm, setSearchTerm] = useState('')

  // 过滤提交
  const filteredCommits = useMemo(() => {
    if (!searchTerm.trim()) {
      return commits
    }
    
    const term = searchTerm.toLowerCase()
    return commits.filter(commit => 
      commit.message.toLowerCase().includes(term) ||
      commit.author.toLowerCase().includes(term) ||
      commit.short_id.toLowerCase().includes(term)
    )
  }, [commits, searchTerm])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-center">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索提交..."
              value={searchTerm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
              className="pl-8 w-64"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
          {filteredCommits.map((commit) => (
            <div
              key={commit.id}
              className="border rounded-lg p-4 hover:bg-accent cursor-pointer transition-colors"
              onClick={() => onCommitSelect?.(commit)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {commit.message}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {commit.author}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {commit.date}
                    </span>
                  </div>
                </div>
                <Badge variant="outline" className="ml-2">
                  {commit.short_id}
                </Badge>
              </div>
            </div>
          ))}
          
          {filteredCommits.length === 0 && searchTerm && (
            <div className="text-center py-8 text-muted-foreground">
              没有找到匹配的提交
            </div>
          )}
          
        </div>
        
        {hasMore && (
          <div className="flex justify-center pt-4 border-t mt-4">
            <Button
              onClick={onLoadMore}
              disabled={loading}
              variant="outline"
              className="flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载中...
                </>
              ) : (
                '加载更多'
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
