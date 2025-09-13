import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { CommitInfo } from '../types/git'
import { Copy, FileText } from 'lucide-react'
import { VSCodeDiff } from './VSCodeDiff'

interface DiffViewerProps {
  commit: CommitInfo | null
  selectedFile: string | null
  onGetDiff: (commitId: string) => Promise<string>
  onGetSingleFileDiff: (commitId: string, filePath: string) => Promise<string>
}

export function DiffViewer({ commit, selectedFile, onGetDiff, onGetSingleFileDiff }: DiffViewerProps) {
  const [diff, setDiff] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (commit) {
      if (selectedFile) {
        loadSingleFileDiff(commit.id, selectedFile)
      } else {
        loadDiff(commit.id)
      }
    } else {
      setDiff('')
      setError(null)
    }
  }, [commit, selectedFile])

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

  const loadSingleFileDiff = async (commitId: string, filePath: string) => {
    try {
      setLoading(true)
      setError(null)
      const diffContent = await onGetSingleFileDiff(commitId, filePath)
      setDiff(diffContent)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文件差异失败')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(diff)
      // 这里可以添加一个 toast 提示
    } catch (err) {
      console.error('复制失败:', err)
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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              文件差异
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              {commit.message} - {commit.short_id}
            </div>
            {selectedFile && (
              <div className="text-sm text-primary font-medium mt-1">
                文件: {selectedFile}
              </div>
            )}
          </div>
          {diff && (
            <Button
              size="sm"
              variant="outline"
              onClick={copyToClipboard}
              className="flex items-center gap-2"
            >
              <Copy className="h-4 w-4" />
              复制
            </Button>
          )}
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
          <VSCodeDiff 
            diff={diff}
          />
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
