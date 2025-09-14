import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { FileChange } from '../types/git'
import { FileDiffModal } from './FileDiffModal'
import { Eye, Archive, ArchiveRestore, Trash2 } from 'lucide-react'

interface WorkspaceStatusProps {
  repoInfo: any
  onRefresh: () => void
  onPushChanges?: () => void
  onGitDiagnostics?: () => void
}

interface WorkspaceStatusData {
  staged_files: FileChange[]
  unstaged_files: FileChange[]
  untracked_files: string[]
}

interface StashInfo {
  id: string
  message: string
  timestamp: string
  branch: string
}

export function WorkspaceStatus({  repoInfo,  onRefresh,
  onPushChanges,
  onGitDiagnostics
}: WorkspaceStatusProps) {
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatusData | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshIntervalSec] = useState(10)
  const [countdown, setCountdown] = useState<number>(refreshIntervalSec)
  
  // 文件差异查看状态
  const [diffModalOpen, setDiffModalOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{path: string, type: 'staged' | 'unstaged' | 'untracked'} | null>(null)
  
  // 贮藏相关状态
  const [stashList, setStashList] = useState<StashInfo[]>([])
  const [stashMessage, setStashMessage] = useState('')
  const [showStashInput, setShowStashInput] = useState(false)

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

  // 获取贮藏列表
  const fetchStashList = async () => {
    if (!repoInfo) return
    
    try {
      const { invoke } = await import('@tauri-apps/api/tauri')
      const stashes: StashInfo[] = await invoke('get_stash_list', {
        repoPath: repoInfo.path,
      })
      
      setStashList(stashes)
    } catch (err) {
      console.error('获取贮藏列表失败:', err)
    }
  }

  const handleManualRefresh = async () => {
    await fetchWorkspaceStatus()
    await fetchStashList()
    setCountdown(refreshIntervalSec)
  }

  // 创建贮藏
  const createStash = async () => {
    if (!repoInfo || !stashMessage.trim()) return
    
    try {
      setLoading(true)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('create_stash', {
        repoPath: repoInfo.path,
        message: stashMessage.trim(),
      })
      
      setStashMessage('')
      setShowStashInput(false)
      await fetchWorkspaceStatus()
      await fetchStashList()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建贮藏失败')
    } finally {
      setLoading(false)
    }
  }

  // 应用贮藏
  const applyStash = async (stashId: string) => {
    if (!repoInfo) return
    
    try {
      setLoading(true)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      const result = await invoke('apply_stash', {
        repoPath: repoInfo.path,
        stashId,
      })
      
      // 显示成功消息
      console.log('贮藏应用成功:', result)
      
      await fetchWorkspaceStatus()
      await fetchStashList()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '应用贮藏失败'
      
      // 检查是否是重复应用的错误
      if (errorMessage.includes('already been applied') || errorMessage.includes('no changes to apply')) {
        // 这实际上是一个成功的情况，只是贮藏已经被应用过了
        console.log('贮藏已经被应用过了')
        await fetchWorkspaceStatus()
        await fetchStashList()
        return // 不显示错误，直接返回
      } else if (errorMessage.includes('conflicts')) {
        setError('应用贮藏时发生冲突，请手动解决冲突后重试。')
      } else {
        setError(errorMessage)
      }
    } finally {
      setLoading(false)
    }
  }

  // 删除贮藏
  const deleteStash = async (stashId: string) => {
    if (!repoInfo) return
    
    try {
      setLoading(true)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      await invoke('delete_stash', {
        repoPath: repoInfo.path,
        stashId,
      })
      
      await fetchStashList()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除贮藏失败')
    } finally {
      setLoading(false)
    }
  }

  // 自动刷新定时器与倒计时
  useEffect(() => {
    if (!repoInfo || !autoRefresh) {
      setCountdown(refreshIntervalSec)
      return
    }

    let mounted = true
    const tick = () => {
      setCountdown(prev => {
        if (prev <= 1) {
          // 触发刷新并重置倒计时
          ;(async () => {
            try {
              await fetchWorkspaceStatus()
              await fetchStashList()
            } catch (_) {
              // 已在 fetch 内部处理错误
            }
          })()
          return refreshIntervalSec
        }
        return prev - 1
      })
    }

    // 首次立即拉取一次，随后开始计时
    ;(async () => {
      if (mounted) {
        await fetchWorkspaceStatus()
        await fetchStashList()
      }
    })()

    const intervalId = setInterval(tick, 1000)
    return () => {
      mounted = false
      clearInterval(intervalId)
    }
  }, [repoInfo, autoRefresh, refreshIntervalSec])

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

  // 暂存所有未暂存的文件
  const stageAllFiles = async () => {
    if (!repoInfo || !workspaceStatus?.unstaged_files) return
    
    try {
      setLoading(true)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      
      // 批量暂存所有未暂存的文件
      for (const file of workspaceStatus.unstaged_files) {
        await invoke('stage_file', {
          repoPath: repoInfo.path,
          filePath: file.path,
        })
      }
      
      // 刷新工作区状态
      await fetchWorkspaceStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量暂存失败')
    } finally {
      setLoading(false)
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

  // 取消所有暂存文件
  const unstageAllFiles = async () => {
    if (!repoInfo || !workspaceStatus?.staged_files?.length) return
    
    try {
      setLoading(true)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      
      // 批量取消暂存所有文件
      for (const file of workspaceStatus.staged_files) {
        await invoke('unstage_file', {
          repoPath: repoInfo.path,
          filePath: file.path,
        })
      }
      
      // 刷新工作区状态
      await fetchWorkspaceStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消所有暂存失败')
    } finally {
      setLoading(false)
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

  // 查看文件差异
  const viewFileDiff = (filePath: string, type: 'staged' | 'unstaged' | 'untracked') => {
    setSelectedFile({ path: filePath, type })
    setDiffModalOpen(true)
  }

  // 关闭差异查看弹窗
  const closeDiffModal = () => {
    setDiffModalOpen(false)
    setSelectedFile(null)
  }

  // 当仓库信息变化时获取工作区状态
  useEffect(() => {
    if (repoInfo) {
      fetchWorkspaceStatus()
      fetchStashList()
    } else {
      setWorkspaceStatus(null)
      setStashList([])
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
      {/* 刷新与自动刷新控制栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={loading || !repoInfo}
          >
            刷新
          </Button>
          <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            自动刷新
          </label>
        </div>
        {autoRefresh && (
          <div className="text-xs text-muted-foreground">{countdown}s 后自动刷新</div>
        )}
      </div>

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
              onClick={onPushChanges || pushChanges}
              disabled={loading}
            >
              推送
            </Button>
            <Button 
              variant="outline"
              onClick={onGitDiagnostics}
              disabled={loading}
              className="text-xs"
            >
              诊断
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 贮藏区域 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">贮藏</CardTitle>
            <div className="flex gap-2">
              {!showStashInput && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowStashInput(true)}
                  disabled={loading || !hasChanges}
                  className="flex items-center gap-1"
                >
                  <Archive className="h-3 w-3" />
                  贮藏更改
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 贮藏输入区域 */}
          {showStashInput && (
            <div className="flex gap-2">
              <Input
                placeholder="输入贮藏信息..."
                value={stashMessage}
                onChange={(e) => setStashMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    createStash()
                  } else if (e.key === 'Escape') {
                    setShowStashInput(false)
                    setStashMessage('')
                  }
                }}
                autoFocus
              />
              <Button 
                onClick={createStash}
                disabled={!stashMessage.trim() || loading}
                size="sm"
              >
                贮藏
              </Button>
              <Button 
                variant="outline"
                onClick={() => {
                  setShowStashInput(false)
                  setStashMessage('')
                }}
                disabled={loading}
                size="sm"
              >
                取消
              </Button>
            </div>
          )}

          {/* 贮藏列表 */}
          {stashList.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">贮藏列表</div>
              {stashList.map((stash) => (
                <div key={stash.id} className="flex items-start gap-2 p-2 border rounded">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{stash.message}</div>
                    <div className="text-xs text-muted-foreground">
                      {stash.branch} • {new Date(stash.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => applyStash(stash.id)}
                      disabled={loading}
                      className="flex items-center gap-1"
                    >
                      <ArchiveRestore className="h-3 w-3" />
                      应用
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteStash(stash.id)}
                      disabled={loading}
                      className="flex items-center gap-1 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                      删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 无贮藏状态 */}
          {stashList.length === 0 && !showStashInput && (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">暂无贮藏</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 暂存的文件 */}
      {workspaceStatus?.staged_files && workspaceStatus.staged_files.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">已暂存的文件</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={unstageAllFiles}
                disabled={loading || !workspaceStatus?.staged_files?.length}
                className="flex items-center gap-1"
              >
                取消所有暂存
              </Button>
            </div>
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
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => viewFileDiff(file.path, 'staged')}
                      className="flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      查看
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => unstageFile(file.path)}
                      disabled={loading}
                    >
                      取消暂存
                    </Button>
                  </div>
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
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">未暂存的文件</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={stageAllFiles}
                disabled={loading}
              >
                暂存所有
              </Button>
            </div>
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
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => viewFileDiff(file.path, 'unstaged')}
                      className="flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      查看
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => stageFile(file.path)}
                      disabled={loading}
                    >
                      暂存
                    </Button>
                  </div>
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
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => viewFileDiff(file, 'untracked')}
                      className="flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      查看
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => stageFile(file)}
                      disabled={loading}
                    >
                      添加
                    </Button>
                  </div>
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

      {/* 文件差异查看弹窗 */}
      {selectedFile && (
        <FileDiffModal
          isOpen={diffModalOpen}
          onClose={closeDiffModal}
          filePath={selectedFile.path}
          repoPath={repoInfo.path}
          fileType={selectedFile.type}
        />
      )}
    </div>
  )
}
