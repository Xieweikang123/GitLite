import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { FileChange } from '../types/git'

interface WorkspaceStatusProps {
  repoInfo: any
  onRefresh: () => void
}

interface WorkspaceStatusData {
  staged_files: FileChange[]
  unstaged_files: FileChange[]
  untracked_files: string[]
}

export function WorkspaceStatus({ repoInfo, onRefresh }: WorkspaceStatusProps) {
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatusData | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 获取工作区状态
  const fetchWorkspaceStatus = async () => {
    if (!repoInfo) return
    
    try {
      setLoading(true)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      const status: WorkspaceStatusData = await invoke('get_workspace_status', {
        repoPath: repoInfo.path,
      })
      
      setWorkspaceStatus(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取工作区状态失败')
    } finally {
      setLoading(false)
    }
  }

  // 暂存文件
  const stageFile = async (filePath: string) => {
    if (!repoInfo) return
    
    try {
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('stage_file', {
        repoPath: repoInfo.path,
        filePath,
      })
      
      // 刷新工作区状态
      await fetchWorkspaceStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : '暂存文件失败')
    }
  }

  // 取消暂存文件
  const unstageFile = async (filePath: string) => {
    if (!repoInfo) return
    
    try {
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('unstage_file', {
        repoPath: repoInfo.path,
        filePath,
      })
      
      // 刷新工作区状态
      await fetchWorkspaceStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消暂存文件失败')
    }
  }

  // 提交更改
  const commitChanges = async () => {
    if (!repoInfo || !commitMessage.trim()) return
    
    try {
      setLoading(true)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('commit_changes', {
        repoPath: repoInfo.path,
        message: commitMessage.trim(),
      })
      
      setCommitMessage('')
      await fetchWorkspaceStatus()
      onRefresh() // 刷新提交列表
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    } finally {
      setLoading(false)
    }
  }

  // 推送更改
  const pushChanges = async () => {
    if (!repoInfo) return
    
    try {
      setLoading(true)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('push_changes', {
        repoPath: repoInfo.path,
      })
      
      onRefresh() // 刷新提交列表
    } catch (err) {
      setError(err instanceof Error ? err.message : '推送失败')
    } finally {
      setLoading(false)
    }
  }

  // 获取状态徽章颜色
  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'added':
        return 'default'
      case 'modified':
        return 'secondary'
      case 'deleted':
        return 'destructive'
      case 'renamed':
        return 'outline'
      default:
        return 'secondary'
    }
  }

  // 获取状态显示文本
  const getStatusText = (status: string) => {
    switch (status) {
      case 'added':
        return '新增'
      case 'modified':
        return '修改'
      case 'deleted':
        return '删除'
      case 'deleted_restored':
        return '删除(已恢复)'
      case 'renamed':
        return '重命名'
      default:
        return status
    }
  }

  // 当仓库信息变化时获取工作区状态
  useEffect(() => {
    if (repoInfo) {
      fetchWorkspaceStatus()
    } else {
      setWorkspaceStatus(null)
    }
  }, [repoInfo])

  if (!repoInfo) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          请先选择一个 Git 仓库
        </p>
      </div>
    )
  }

  if (loading && !workspaceStatus) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">加载工作区状态中...</p>
      </div>
    )
  }

  const hasChanges = workspaceStatus && (
    workspaceStatus.staged_files.length > 0 ||
    workspaceStatus.unstaged_files.length > 0 ||
    workspaceStatus.untracked_files.length > 0
  )

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      {/* 提交区域 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">提交更改</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="输入提交信息..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commitChanges()
                }
              }}
            />
            <Button 
              onClick={commitChanges}
              disabled={!commitMessage.trim() || loading || !workspaceStatus?.staged_files?.length}
            >
              提交
            </Button>
            <Button 
              variant="outline"
              onClick={pushChanges}
              disabled={loading}
            >
              推送
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 暂存的文件 */}
      {workspaceStatus?.staged_files && workspaceStatus.staged_files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">已暂存的文件</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workspaceStatus.staged_files.map((file, index) => (
                <div key={index} className="flex items-start gap-2 p-2 border rounded">
                  <Badge variant={getStatusBadgeVariant(file.status)} className="flex-shrink-0">
                    {getStatusText(file.status)}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono break-all">{file.path}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => unstageFile(file.path)}
                    disabled={loading}
                    className="flex-shrink-0"
                  >
                    取消暂存
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 未暂存的文件 */}
      {workspaceStatus?.unstaged_files && workspaceStatus.unstaged_files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">未暂存的文件</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workspaceStatus.unstaged_files.map((file, index) => (
                <div key={index} className="flex items-start gap-2 p-2 border rounded">
                  <Badge variant={getStatusBadgeVariant(file.status)} className="flex-shrink-0">
                    {getStatusText(file.status)}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono break-all">{file.path}</div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => stageFile(file.path)}
                    disabled={loading}
                    className="flex-shrink-0"
                  >
                    暂存
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 未跟踪的文件 */}
      {workspaceStatus?.untracked_files && workspaceStatus.untracked_files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">未跟踪的文件</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workspaceStatus.untracked_files.map((file, index) => (
                <div key={index} className="flex items-start gap-2 p-2 border rounded">
                  <Badge variant="outline" className="flex-shrink-0">未跟踪</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono break-all">{file}</div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => stageFile(file)}
                    disabled={loading}
                    className="flex-shrink-0"
                  >
                    添加
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 无更改状态 */}
      {!hasChanges && (
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-muted-foreground">工作区干净，没有未提交的更改</p>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchWorkspaceStatus}
              className="mt-2"
            >
              刷新
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
