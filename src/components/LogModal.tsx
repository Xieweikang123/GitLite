import { useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

interface LogEntry {
  timestamp: string
  level: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR' | 'SUCCESS'
  message: string
}

interface LogModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  logs: LogEntry[]
  isRunning: boolean
}

export function LogModal({ isOpen, onClose, title, logs, isRunning }: LogModalProps) {
  const logContainerRef = useRef<HTMLDivElement>(null)

  // 自动滚动到最新日志
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs])

  // ESC键关闭弹窗
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

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'ERROR': return 'text-red-400'
      case 'WARN': return 'text-yellow-400'
      case 'INFO': return 'text-blue-400'
      case 'DEBUG': return 'text-gray-400'
      case 'SUCCESS': return 'text-green-400'
      default: return 'text-green-400'
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[600px] p-0 bg-black text-green-400 font-mono">
        <DialogHeader className="px-6 py-4 border-b border-green-800 pr-14">
          <DialogTitle className="text-green-400 font-mono text-lg">
            {title} - 实时日志
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-hidden">
          <div 
            ref={logContainerRef}
            className="h-full overflow-y-auto p-4 bg-black text-green-400 font-mono text-sm leading-relaxed"
          >
            {logs.length === 0 ? (
              <div className="text-green-600">
                {isRunning ? '等待日志输出...' : '暂无日志'}
              </div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="mb-1">
                  <span className="text-gray-500">[{log.timestamp}]</span>
                  <span className={`ml-2 font-bold ${getLevelColor(log.level)}`}>
                    [{log.level}]
                  </span>
                  <span className="ml-2 text-green-400">{log.message}</span>
                </div>
              ))
            )}
            
            {isRunning && (
              <div className="text-green-600 animate-pulse">
                <span className="inline-block w-2 h-4 bg-green-400 animate-pulse"></span>
                <span className="ml-2">操作进行中...</span>
              </div>
            )}
          </div>
        </div>
        
        <div className="px-6 py-3 border-t border-green-800 text-xs text-green-600">
          <div className="flex items-center justify-between">
            <span>日志条数: {logs.length}</span>
            <span>状态: {isRunning ? '运行中' : '已完成'}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
