import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Copy } from 'lucide-react'
import { VSCodeDiff } from './VSCodeDiff'

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
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {getModalTitle()}
          </DialogTitle>
          <p className="text-sm text-muted-foreground font-mono">{filePath}</p>
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
            <VSCodeDiff diff={diff} filePath={filePath} repoPath={repoPath} />
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
