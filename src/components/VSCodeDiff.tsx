import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Copy, ChevronDown, ChevronRight } from 'lucide-react'

interface FileLine {
  lineNumber: number
  content: string
  type: 'unchanged' | 'added' | 'deleted'
  oldLineNumber?: number
}

interface VSCodeDiffProps {
  diff: string
  filePath?: string
  repoPath?: string
}

export function VSCodeDiff({ diff, filePath, repoPath }: VSCodeDiffProps) {
  const [fileLines, setFileLines] = useState<FileLine[]>([])
  const [isExpanded, setIsExpanded] = useState(true)

  // 调试：检查传入的props（只在diff变化时打印）
  useEffect(() => {
    console.log('VSCodeDiff props changed:', {
      diff: diff,
      filePath,
      repoPath,
      diffLength: diff?.length,
      diffPreview: diff?.substring(0, 200) + '...'
    })
  }, [diff, filePath, repoPath])

  useEffect(() => {
    if (diff) {
      console.log('Raw diff content:', diff)
      const parsedLines = parseDiffToFullFile(diff)
      console.log('Parsed lines:', parsedLines)
      setFileLines(parsedLines)
      
      // 启用文件内容补全，显示完整文件
      if (filePath && repoPath) {
        fillUnchangedLines(parsedLines, filePath, repoPath)
      }
    }
  }, [diff]) // 只依赖diff，避免无限重新渲染

  const fillUnchangedLines = async (lines: FileLine[], filePath: string, repoPath: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri')
      const fileContent = await invoke('get_file_content', {
        repoPath,
        filePath
      }) as string
      
      const fileContentLines = fileContent.split('\n')
      console.log('File content lines:', fileContentLines.length)
      
      // 创建完整的文件行数组
      const fullFileLines: FileLine[] = []
      
      // 为每一行创建FileLine对象
      for (let i = 0; i < fileContentLines.length; i++) {
        const lineNumber = i + 1
        const content = fileContentLines[i]
        
        // 查找这一行是否在diff中
        const diffLine = lines.find(l => l.lineNumber === lineNumber)
        
        if (diffLine) {
          // 如果在diff中，使用diff中的信息（包括type）
          fullFileLines.push(diffLine)
        } else {
          // 如果不在diff中，说明是未修改的行
          fullFileLines.push({
            lineNumber,
            content,
            type: 'unchanged',
            oldLineNumber: lineNumber
          })
        }
      }
      
      console.log('Full file lines:', fullFileLines)
      setFileLines(fullFileLines)
    } catch (err) {
      console.error('Failed to read file content:', err)
      // 如果读取失败，保持原有内容
    }
  }

  const parseDiffToFullFile = (diffText: string): FileLine[] => {
    const lines = diffText.split('\n')
    const fileLines: FileLine[] = []
    let currentLineNumber = 1
    let oldLineNumber = 1
    let inHunk = false

    console.log('Parsing diff lines:', lines)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      console.log(`Processing line ${i}: "${line}"`)
      
      if (line.startsWith('diff --git')) {
        // 重置状态
        currentLineNumber = 1
        oldLineNumber = 1
        inHunk = false
        console.log('Found diff header, resetting state')
        continue
      } else if (line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        // 跳过这些header行
        console.log('Skipping header line')
        continue
      } else if (line.startsWith('@@')) {
        // 解析hunk header获取起始行号
        const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/)
        if (match) {
          const hunkNewStart = parseInt(match[2])
          console.log('Found hunk header, new start:', hunkNewStart)
          
          // 直接设置当前行号为hunk起始行号，不创建空行
          currentLineNumber = hunkNewStart
          oldLineNumber = parseInt(match[1])
          inHunk = true
          console.log('Entering hunk mode, currentLineNumber:', currentLineNumber, 'oldLineNumber:', oldLineNumber)
        }
      } else if (inHunk) {
        console.log(`In hunk, processing line: "${line}" (starts with +: ${line.startsWith('+')}, starts with -: ${line.startsWith('-')}, starts with space: ${line.startsWith(' ')})`)
        
        if (line.startsWith('+')) {
          // 新增的行
          const content = line.substring(1)
          console.log('Found added line:', content)
          fileLines.push({
            lineNumber: currentLineNumber,
            content,
            type: 'added'
          })
          currentLineNumber++
        } else if (line.startsWith('-')) {
          // 删除的行
          const content = line.substring(1)
          console.log('Found deleted line:', content)
          fileLines.push({
            lineNumber: currentLineNumber,
            content,
            type: 'deleted',
            oldLineNumber: oldLineNumber
          })
          oldLineNumber++
        } else if (line.startsWith(' ')) {
          // 未修改的行
          const content = line.substring(1)
          console.log('Found unchanged line:', content)
          fileLines.push({
            lineNumber: currentLineNumber,
            content,
            type: 'unchanged',
            oldLineNumber: oldLineNumber
          })
          currentLineNumber++
          oldLineNumber++
        } else if (line.trim() === '') {
          // 空行，跳过
          console.log('Skipping empty line')
          continue
        } else {
          // 其他行，可能是hunk结束或其他内容
          console.log('Exiting hunk mode, unknown line:', line)
          inHunk = false
        }
      } else {
        console.log('Not in hunk, skipping line:', line)
      }
    }

    console.log('Final parsed lines:', fileLines)
    return fileLines
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(diff)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const renderFullFileView = () => (
    <div className="font-mono text-sm">
      {fileLines.map((line, index) => (
        <div 
          key={index}
          className={`px-4 py-1 flex items-start gap-4 ${
            line.type === 'added' ? 'bg-green-50 border-l-4 border-green-500' :
            line.type === 'deleted' ? 'bg-red-50 border-l-4 border-red-500' :
            'bg-white hover:bg-gray-50'
          }`}
        >
          {/* Line Number */}
          <div className="text-xs text-gray-500 w-12 text-right flex-shrink-0">
            {line.lineNumber}
          </div>
          
          {/* Line Icon */}
          <div className="w-4 flex-shrink-0 text-center">
            {line.type === 'added' && <span className="text-green-600 font-bold">+</span>}
            {line.type === 'deleted' && <span className="text-red-600 font-bold">-</span>}
            {line.type === 'unchanged' && <span className="text-gray-400"> </span>}
          </div>
          
          {/* Line Content */}
          <div className="flex-1 min-w-0 break-all">
            {line.content || ' '}
          </div>
        </div>
      ))}
    </div>
  )


  return (
    <div>
      <div className="flex items-center justify-between p-4 border-b">
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
      
      {isExpanded && (
        <div className="max-h-96 overflow-y-auto">
          {fileLines.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              没有差异内容
            </div>
          ) : (
            renderFullFileView()
          )}
        </div>
      )}
    </div>
  )
}

