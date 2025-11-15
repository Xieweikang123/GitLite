import React, { useState, useEffect } from 'react' 
import { useGit } from './hooks/useGit'
import { useDarkMode } from './hooks/useDarkMode'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { TopToolbar } from './components/TopToolbar'
import { MenuToolbar } from './components/MenuToolbar'
import { OperationsPanel } from './components/OperationsPanel'
import { CommitList } from './components/CommitList'
import { FileList } from './components/FileList'
import { UnifiedCommitView } from './components/UnifiedCommitView'
import { LogModal } from './components/LogModal'
import { ProxyConfigModal } from './components/ProxyConfigModal'
import { CommitInfo, FileChange } from './types/git'

function App() {
  // 旧的三栏聚焦状态已废弃，保留为将来扩展可用；当前用 tab 切换
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
    getCommitFiles, 
    getCommitsPaginated,
    getFileDiff,
    getSingleFileDiff,
    fetchChangesWithLogs,
    pushChangesWithRealtimeLogs,
    pullChangesWithLogs
  } = useGit()
  
  const { isDark, toggleDarkMode } = useDarkMode()
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null)
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [allCommits, setAllCommits] = useState<CommitInfo[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMoreCommits, setHasMoreCommits] = useState(true)
  
  // 日志弹窗状态
  const [logModalOpen, setLogModalOpen] = useState(false)
  const [logModalTitle, setLogModalTitle] = useState('')
  const [logs, setLogs] = useState<Array<{timestamp: string, level: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR' | 'SUCCESS', message: string}>>([])
  const [isOperationRunning, setIsOperationRunning] = useState(false)
  
  // 代理配置弹窗状态
  const [proxyConfigOpen, setProxyConfigOpen] = useState(false)

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

  const handleRefresh = async () => {
    if (!repoInfo) return
    
    try {
      // 重新获取仓库信息以更新提交列表
      await openRepositoryByPath(repoInfo.path)
      // 仓库信息会通过 useEffect 自动更新
    } catch (error) {
      console.error('Failed to refresh repository:', error)
    }
  }

  const handleOpenRemoteRepository = async () => {
    if (repoInfo?.remote_url) {
      try {
        // 使用 Tauri 的 shell API 在默认浏览器中打开外部链接
        await invoke('open_external_url', { url: repoInfo.remote_url })
      } catch (error) {
        console.error('Failed to open remote repository:', error)
        // 如果 Tauri API 失败，回退到 window.open
        window.open(repoInfo.remote_url, '_blank')
      }
    }
  }

  const handlePullChanges = async () => {
    if (!repoInfo) return
    
    // 打开日志弹窗
    setLogModalTitle('拉取远程更改')
    setLogs([])
    setLogModalOpen(true)
    setIsOperationRunning(true)
    
    try {
      const logData: Array<[string, string, string]> = await pullChangesWithLogs()
      
      // 转换日志格式
      const formattedLogs = logData.map(([timestamp, level, message]) => ({
        timestamp,
        level: level as 'INFO' | 'DEBUG' | 'WARN' | 'ERROR',
        message
      }))
      
      setLogs(formattedLogs)
      setIsOperationRunning(false)
      
      // 拉取成功后重置状态
      setSelectedCommit(null)
      setCommitFiles([])
      setSelectedFile(null)
      setAllCommits([])
      setHasMoreCommits(true)
    } catch (error) {
      console.error('拉取失败:', error)
      setIsOperationRunning(false)
      
      // 添加错误日志
      const errorLog = {
        timestamp: new Date().toLocaleTimeString(),
        level: 'ERROR' as const,
        message: `拉取失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
      setLogs(prev => [...prev, errorLog])
    }
  }

  const handleFetchChanges = async () => {
    if (!repoInfo) return
    
    // 打开日志弹窗
    setLogModalTitle('获取远程更改')
    setLogs([])
    setLogModalOpen(true)
    setIsOperationRunning(true)
    
    try {
      const logData: Array<[string, string, string]> = await fetchChangesWithLogs()
      
      // 转换日志格式
      const formattedLogs = logData.map(([timestamp, level, message]) => ({
        timestamp,
        level: level as 'INFO' | 'DEBUG' | 'WARN' | 'ERROR',
        message
      }))
      
      setLogs(formattedLogs)
      setIsOperationRunning(false)
      
      // 获取成功后重置状态（获取不会改变工作区，所以不需要重置文件状态）
      setAllCommits([])
      setHasMoreCommits(true)
    } catch (error) {
      console.error('获取失败:', error)
      setIsOperationRunning(false)
      
      // 添加错误日志
      const errorLog = {
        timestamp: new Date().toLocaleTimeString(),
        level: 'ERROR' as const,
        message: `获取失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
      setLogs(prev => [...prev, errorLog])
    }
  }

  // 通用的Git操作日志处理函数
  const handleGitOperationWithLogs = async (
    operation: () => Promise<Array<[string, string, string]>>,
    title: string,
    resetState: boolean = false
  ) => {
    if (!repoInfo) return
    
    // 打开日志弹窗
    setLogModalTitle(title)
    setLogs([])
    setLogModalOpen(true)
    setIsOperationRunning(true)
    
    try {
      const logData: Array<[string, string, string]> = await operation()
      
      // 转换日志格式
      const formattedLogs = logData.map(([timestamp, level, message]) => ({
        timestamp,
        level: level as 'INFO' | 'DEBUG' | 'WARN' | 'ERROR',
        message
      }))
      
      setLogs(formattedLogs)
      setIsOperationRunning(false)
      
      // 如果需要重置状态
      if (resetState) {
        setSelectedCommit(null)
        setCommitFiles([])
        setSelectedFile(null)
        setAllCommits([])
        setHasMoreCommits(true)
      }
    } catch (error) {
      console.error(`${title}失败:`, error)
      setIsOperationRunning(false)
      
      // 添加错误日志
      const errorLog = {
        timestamp: new Date().toLocaleTimeString(),
        level: 'ERROR' as const,
        message: `${title}失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
      setLogs(prev => [...prev, errorLog])
    }
  }


  // 实时推送处理函数
  const handlePushChangesRealtime = async () => {
    if (!repoInfo) return
    
    // 打开日志弹窗
    setLogModalTitle('推送本地更改 - 实时日志')
    setLogs([])
    setLogModalOpen(true)
    setIsOperationRunning(true)
    
    try {
      await pushChangesWithRealtimeLogs()
      setIsOperationRunning(false)
      
      // 重置状态
      setSelectedCommit(null)
      setCommitFiles([])
      setSelectedFile(null)
      setAllCommits([])
      setHasMoreCommits(true)
    } catch (error) {
      console.error('推送失败:', error)
      setIsOperationRunning(false)
      
      // 添加错误日志
      const errorLog = {
        timestamp: new Date().toLocaleTimeString(),
        level: 'ERROR' as const,
        message: `推送失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
      setLogs(prev => [...prev, errorLog])
    }
  }

  // 监听实时日志事件
  useEffect(() => {
    const unlisten = listen('push-log', (event) => {
      const logData = event.payload as { timestamp: string, level: string, message: string }
      const logEntry = {
        timestamp: logData.timestamp,
        level: logData.level as 'INFO' | 'DEBUG' | 'WARN' | 'ERROR' | 'SUCCESS',
        message: logData.message
      }
      setLogs(prev => [...prev, logEntry])
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [])

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

  const [activeTab, setActiveTab] = useState<'workspace' | 'commits'>('workspace')

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* 菜单工具栏 */}
      <MenuToolbar
        onOpenRepository={openRepository}
        onRepoSelect={handleRecentRepoSelect}
        recentRepos={recentRepos}
        autoOpenEnabled={autoOpenEnabled}
        onToggleAutoOpen={setAutoOpenEnabled}
        loading={loading}
        repoInfo={repoInfo}
        onOpenProxyConfig={() => setProxyConfigOpen(true)}
      />
      
      {/* 顶部工具栏 */}
      <TopToolbar
        onOpenRepository={openRepository}
        onBranchSelect={handleBranchSelect}
        onOpenRemoteRepository={handleOpenRemoteRepository}
        onPullChanges={handlePullChanges}
        onFetchChanges={handleFetchChanges}
        loading={loading}
        repoInfo={repoInfo}
        isDark={isDark}
        onToggleDarkMode={toggleDarkMode}
      />

      <div className="flex-1 flex flex-col min-h-0">
        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-destructive">{error}</p>
          </div>
        )}

        {/* 顶部 Tab 切换 */}
        <div className="flex-shrink-0 px-4 py-2 border-b border-border flex items-center gap-2">
          <button
            type="button"
            className={`px-3 py-2 text-sm rounded-t-md border-b-2 ${
              activeTab === 'workspace' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('workspace')}
          >
            工作区
          </button>
          <button
            type="button"
            className={`px-3 py-2 text-sm rounded-t-md border-b-2 ${
              activeTab === 'commits' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('commits')}
          >
            提交
          </button>
        </div>

        {/* Tab 内容 */}
        {activeTab === 'workspace' ? (
          <div className="flex-1 flex flex-col min-h-0 px-4">
            <OperationsPanel
              repoInfo={repoInfo}
              onRefresh={handleRefresh}
              onPushChanges={handlePushChangesRealtime}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 px-4">
            {repoInfo ? (
              <UnifiedCommitView
                commits={allCommits}
                onLoadMore={handleLoadMore}
                hasMore={hasMoreCommits}
                loading={loadingMore}
                aheadCount={repoInfo?.ahead ?? 0}
                onGetCommitFiles={getCommitFiles}
                onGetDiff={getFileDiff}
                onGetSingleFileDiff={getSingleFileDiff}
                repoPath={repoInfo.path}
              />
            ) : (
              <div className="text-center py-12 flex-1 flex items-center justify-center">
                <p className="text-muted-foreground">请先选择一个 Git 仓库</p>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* 日志弹窗 */}
      <LogModal
        isOpen={logModalOpen}
        onClose={() => setLogModalOpen(false)}
        title={logModalTitle}
        logs={logs}
        isRunning={isOperationRunning}
      />
      
      {/* 代理配置弹窗 */}
      <ProxyConfigModal
        isOpen={proxyConfigOpen}
        onClose={() => setProxyConfigOpen(false)}
      />
    </div>
  )
}

export default App 
