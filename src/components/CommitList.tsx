import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { CommitInfo } from '../types/git'

interface CommitListProps {
  commits: CommitInfo[]
  onCommitSelect?: (commit: CommitInfo) => void
}

export function CommitList({ commits, onCommitSelect }: CommitListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>提交历史</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {commits.map((commit) => (
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
        </div>
      </CardContent>
    </Card>
  )
}
