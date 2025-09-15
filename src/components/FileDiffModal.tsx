import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { VSCodeDiff } from './CodeDiff'

interface FileDiffModalProps {
  isOpen: boolean
  onClose: () => void
  filePath: string
  repoPath: string
  fileType: 'staged' | 'unstaged' | 'untracked'
}

export function FileDiffModal({ isOpen, onClose, filePath, repoPath, fileType }: FileDiffModalProps) {
  const [diff, setDiff] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const modalContentRef = useRef<HTMLDivElement>(null)
  const [debugEnabled, setDebugEnabled] = useState(false)

  useEffect(() => {
    if (isOpen && filePath && repoPath) {
      loadFileDiff()
    }
  }, [isOpen, filePath, repoPath, fileType])

  // 添加ESC键关闭功能
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  // 防止弹窗滚动事件冒泡到主界面
  useEffect(() => {
    const modalContent = modalContentRef.current
    if (!modalContent || !isOpen) return

    const handleWheel = (e: WheelEvent) => {
      // 检查滚动事件是否来自弹窗内部的滚动容器
      const scrollContainer = modalContent.querySelector('.overflow-y-auto')
      
      if (scrollContainer && scrollContainer.contains(e.target as Node)) {
        // 如果事件来自滚动容器，完全阻止冒泡和默认行为
        e.stopPropagation()
        e.preventDefault()
        
        // 手动控制滚动
        const scrollAmount = e.deltaY
        ;(scrollContainer as HTMLElement).scrollTop += scrollAmount
      } else {
        // 如果事件来自弹窗的其他区域，只阻止冒泡
        e.stopPropagation()
      }
    }

    // 在弹窗内容区域添加滚动事件监听器
    modalContent.addEventListener('wheel', handleWheel, { passive: false, capture: true })

    return () => {
      modalContent.removeEventListener('wheel', handleWheel, { capture: true })
    }
  }, [isOpen])

  const loadFileDiff = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const { invoke } = await import('@tauri-apps/api/tauri')
      
      let diffContent: string
      
      if (fileType === 'staged') {
        // 获取已暂存文件的差异（与HEAD的差异）
        diffContent = await invoke('get_staged_file_diff', {
          repoPath,
          filePath
        })
      } else if (fileType === 'unstaged') {
        // 获取未暂存文件的差异（工作区与索引的差异）
        diffContent = await invoke('get_unstaged_file_diff', {
          repoPath,
          filePath
        })
      } else {
        // 未跟踪文件显示文件内容
        diffContent = await invoke('get_untracked_file_content', {
          repoPath,
          filePath
        })
      }
      
      console.log('FileDiffModal received diff content:', {
        fileType,
        filePath,
        diffContent,
        diffLength: diffContent?.length,
        diffPreview: diffContent?.substring(0, 300) + '...'
      })
      setDiff(diffContent)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取文件差异失败')
    } finally {
      setLoading(false)
    }
  }

  const getModalTitle = () => {
    switch (fileType) {
      case 'staged':
        return '已暂存文件差异'
      case 'unstaged':
        return '未暂存文件差异'
      case 'untracked':
        return '未跟踪文件内容'
      default:
        return '文件差异'
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent ref={modalContentRef} className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {getModalTitle()}
          </DialogTitle>
          <p className="text-sm text-muted-foreground font-mono">{filePath}</p>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setDebugEnabled(v => !v)} title="切换缩略图调试面板">
              🐛 调试 {debugEnabled ? '开' : '关'}
            </Button>
          </div>
        </DialogHeader>
        
        <div className="flex-1 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-32">
              <p className="text-muted-foreground">加载中...</p>
            </div>
          )}
          
          {error && (
            <div className="flex items-center justify-center h-32">
              <div className="text-center">
                <p className="text-destructive mb-2">{error}</p>
                <Button size="sm" onClick={loadFileDiff}>
                  重试
                </Button>
              </div>
            </div>
          )}
          
          {!loading && !error && diff && (
            <VSCodeDiff diff={diff} filePath={filePath} repoPath={repoPath} debugEnabled={debugEnabled} />
          )}
          
          {!loading && !error && !diff && (
            <div className="flex items-center justify-center h-32">
              <p className="text-muted-foreground">没有差异内容</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
