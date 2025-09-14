import { useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { X, Copy, Download } from 'lucide-react'

interface LogEntry {
  timestamp: string
  level: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR'
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

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'ERROR': return 'text-red-400'
      case 'WARN': return 'text-yellow-400'
      case 'INFO': return 'text-blue-400'
      case 'DEBUG': return 'text-gray-400'
      default: return 'text-green-400'
    }
  }

  const copyLogs = () => {
    const logText = logs.map(log => 
      `[${log.timestamp}] [${log.level}] ${log.message}`
    ).join('\n')
    navigator.clipboard.writeText(logText)
  }

  const downloadLogs = () => {
    const logText = logs.map(log => 
      `[${log.timestamp}] [${log.level}] ${log.message}`
    ).join('\n')
    
    const blob = new Blob([logText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gitlite-${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[600px] p-0 bg-black text-green-400 font-mono">
        <DialogHeader className="px-6 py-4 border-b border-green-800">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-green-400 font-mono text-lg">
              {title} - 实时日志
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={copyLogs}
                className="text-green-400 hover:text-green-300 hover:bg-green-900/20"
                title="复制日志"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadLogs}
                className="text-green-400 hover:text-green-300 hover:bg-green-900/20"
                title="下载日志"
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-green-400 hover:text-green-300 hover:bg-green-900/20"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
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
