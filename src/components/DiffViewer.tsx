import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { CommitInfo } from '../types/git'

interface DiffViewerProps {
  commit: CommitInfo | null
  onGetDiff: (commitId: string) => Promise<string>
}

export function DiffViewer({ commit, onGetDiff }: DiffViewerProps) {
  const [diff, setDiff] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (commit) {
      loadDiff(commit.id)
    } else {
      setDiff('')
      setError(null)
    }
  }, [commit])

  const loadDiff = async (commitId: string) => {
    try {
      setLoading(true)
      setError(null)
      const diffContent = await onGetDiff(commitId)
      setDiff(diffContent)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载差异失败')
    } finally {
      setLoading(false)
    }
  }

  if (!commit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>文件差异</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            选择一个提交来查看差异
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>文件差异</CardTitle>
        <div className="text-sm text-muted-foreground">
          {commit.message} - {commit.short_id}
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="text-center py-4">
            <p className="text-muted-foreground">加载中...</p>
          </div>
        )}
        
        {error && (
          <div className="text-center py-4">
            <p className="text-destructive">{error}</p>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => loadDiff(commit.id)}
              className="mt-2"
            >
              重试
            </Button>
          </div>
        )}
        
        {!loading && !error && diff && (
          <div className="bg-muted rounded-lg p-4">
            <pre className="text-sm overflow-auto whitespace-pre-wrap">
              <code>{diff}</code>
            </pre>
          </div>
        )}
        
        {!loading && !error && !diff && (
          <p className="text-muted-foreground text-center py-4">
            此提交没有差异信息
          </p>
        )}
      </CardContent>
    </Card>
  )
}
