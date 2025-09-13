import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Copy, ChevronDown, ChevronRight } from 'lucide-react'

interface DiffLine {
  type: 'context' | 'added' | 'deleted' | 'header'
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

interface DiffHunk {
  header: string
  lines: DiffLine[]
  isExpanded: boolean
}

interface VisualDiffProps {
  diff: string
  fileName: string
  commitInfo?: string
}

export function VisualDiff({ diff, fileName, commitInfo }: VisualDiffProps) {
  const [hunks, setHunks] = useState<DiffHunk[]>([])
  const [isExpanded, setIsExpanded] = useState(true)

  useEffect(() => {
    if (diff) {
      const parsedHunks = parseDiff(diff)
      setHunks(parsedHunks)
    }
  }, [diff])

  const parseDiff = (diffText: string): DiffHunk[] => {
    const lines = diffText.split('\n')
    const hunks: DiffHunk[] = []
    let currentHunk: DiffHunk | null = null

    for (const line of lines) {
      if (line.startsWith('@@')) {
        // 新的hunk开始
        if (currentHunk) {
          hunks.push(currentHunk)
        }
        currentHunk = {
          header: line,
          lines: [],
          isExpanded: true
        }
      } else if (currentHunk) {
        let type: DiffLine['type'] = 'context'
        let content = line
        let oldLineNumber: number | undefined
        let newLineNumber: number | undefined

        if (line.startsWith('+')) {
          type = 'added'
          content = line.substring(1)
        } else if (line.startsWith('-')) {
          type = 'deleted'
          content = line.substring(1)
        } else if (line.startsWith(' ')) {
          type = 'context'
          content = line.substring(1)
        }

        // 简单的行号计算（实际应用中需要更复杂的逻辑）
        if (type === 'context' || type === 'deleted') {
          oldLineNumber = currentHunk.lines.filter(l => l.type === 'context' || l.type === 'deleted').length + 1
        }
        if (type === 'context' || type === 'added') {
          newLineNumber = currentHunk.lines.filter(l => l.type === 'context' || l.type === 'added').length + 1
        }

        currentHunk.lines.push({
          type,
          content,
          oldLineNumber,
          newLineNumber
        })
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk)
    }

    return hunks
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(diff)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const toggleHunk = (index: number) => {
    setHunks(prev => prev.map((hunk, i) => 
      i === index ? { ...hunk, isExpanded: !hunk.isExpanded } : hunk
    ))
  }

  const getLineClassName = (type: DiffLine['type']) => {
    switch (type) {
      case 'added':
        return 'bg-green-50 border-l-4 border-green-500 text-green-800'
      case 'deleted':
        return 'bg-red-50 border-l-4 border-red-500 text-red-800'
      case 'context':
        return 'bg-gray-50 text-gray-700'
      default:
        return 'bg-gray-100 text-gray-600'
    }
  }

  const getLineIcon = (type: DiffLine['type']) => {
    switch (type) {
      case 'added':
        return <span className="text-green-600 font-bold">+</span>
      case 'deleted':
        return <span className="text-red-600 font-bold">-</span>
      default:
        return <span className="text-gray-400"> </span>
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold">文件差异</CardTitle>
            {commitInfo && (
              <p className="text-sm text-muted-foreground mt-1">{commitInfo}</p>
            )}
            <p className="text-sm text-muted-foreground">文件: {fileName}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {isExpanded ? '收起' : '展开'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyToClipboard}
              className="flex items-center gap-2"
            >
              <Copy className="h-4 w-4" />
              复制
            </Button>
          </div>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto">
            {hunks.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">
                没有差异内容
              </div>
            ) : (
              <div className="font-mono text-sm">
                {hunks.map((hunk, hunkIndex) => (
                  <div key={hunkIndex} className="border-b border-gray-200 last:border-b-0">
                    {/* Hunk Header */}
                    <div 
                      className="bg-blue-50 px-4 py-2 cursor-pointer hover:bg-blue-100 transition-colors"
                      onClick={() => toggleHunk(hunkIndex)}
                    >
                      <div className="flex items-center gap-2">
                        {hunk.isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <span className="text-blue-700 font-medium">{hunk.header}</span>
                      </div>
                    </div>
                    
                    {/* Hunk Content */}
                    {hunk.isExpanded && (
                      <div className="divide-y divide-gray-100">
                        {hunk.lines.map((line, lineIndex) => (
                          <div 
                            key={lineIndex}
                            className={`px-4 py-1 flex items-start gap-4 ${getLineClassName(line.type)}`}
                          >
                            {/* Line Numbers */}
                            <div className="flex gap-2 text-xs text-gray-500 min-w-0 flex-shrink-0">
                              <span className="w-8 text-right">
                                {line.oldLineNumber || ''}
                              </span>
                              <span className="w-8 text-right">
                                {line.newLineNumber || ''}
                              </span>
                            </div>
                            
                            {/* Line Icon */}
                            <div className="w-4 flex-shrink-0 text-center">
                              {getLineIcon(line.type)}
                            </div>
                            
                            {/* Line Content */}
                            <div className="flex-1 min-w-0 break-all">
                              {line.content || ' '}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

