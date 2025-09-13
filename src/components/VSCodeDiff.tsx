import { useState, useEffect, useRef } from 'react'
import { Button } from './ui/button'
import { Copy, ChevronDown, ChevronRight, ChevronUp, ChevronDown as ChevronDownIcon, Navigation } from 'lucide-react'

interface FileLine {
  lineNumber: number
  content: string
  type: 'unchanged' | 'added' | 'deleted' | 'modified'
  oldLineNumber?: number
  segments?: DiffSegment[]
  changeIndex?: number // 更改的索引
}

interface DiffSegment {
  content: string
  type: 'added' | 'deleted' | 'unchanged'
}

interface VSCodeDiffProps {
  diff: string
  filePath?: string
  repoPath?: string
}

export function VSCodeDiff({ diff, filePath, repoPath }: VSCodeDiffProps) {
  const [fileLines, setFileLines] = useState<FileLine[]>([])
  const [isExpanded, setIsExpanded] = useState(true)
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0)
  const [changeCount, setChangeCount] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

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
      
      // 为更改行添加索引
      const linesWithChangeIndex = addChangeIndices(parsedLines)
      setFileLines(linesWithChangeIndex)
      
      // 计算更改块数量
      const uniqueChangeIndices = new Set(
        linesWithChangeIndex
          .filter(line => line.changeIndex !== undefined)
          .map(line => line.changeIndex)
      )
      setChangeCount(uniqueChangeIndices.size)
      setCurrentChangeIndex(0)
      
      // 启用文件内容补全，显示完整文件
      if (filePath && repoPath) {
        fillUnchangedLines(linesWithChangeIndex, filePath, repoPath)
      } else {
        // 如果没有文件路径，直接滚动到第一个更改
        scrollToFirstChange(linesWithChangeIndex)
      }
    }
  }, [diff]) // 只依赖diff，避免无限重新渲染

  const scrollToFirstChange = (lines: FileLine[]) => {
    // 找到第一个有更改的行
    const firstChangeLine = lines.find(line => 
      line.type === 'added' || line.type === 'deleted' || line.type === 'modified'
    )
    
    if (firstChangeLine && scrollContainerRef.current) {
      // 使用 setTimeout 确保 DOM 已经更新
      setTimeout(() => {
        const element = scrollContainerRef.current?.querySelector(
          `[data-line-number="${firstChangeLine.lineNumber}"]`
        ) as HTMLElement
        
        if (element) {
          element.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
          })
        }
      }, 100)
    }
  }

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
      // 重新为完整文件行添加更改索引
      const fullFileLinesWithIndex = addChangeIndices(fullFileLines)
      setFileLines(fullFileLinesWithIndex)
      
      // 在文件内容加载完成后，滚动到第一个更改
      scrollToFirstChange(fullFileLinesWithIndex)
    } catch (err) {
      console.error('Failed to read file content:', err)
      // 如果读取失败，保持原有内容
      scrollToFirstChange(lines)
    }
  }

  // 为更改行添加索引，将连续的行合并为一个更改块
  const addChangeIndices = (lines: FileLine[]): FileLine[] => {
    let changeIndex = 0
    
    return lines.map((line, index) => {
      const isChangedLine = line.type === 'added' || line.type === 'deleted' || line.type === 'modified'
      
      if (isChangedLine) {
        // 检查是否与上一行是连续的更改
        const prevLine = index > 0 ? lines[index - 1] : null
        const isConsecutive = prevLine && 
                             (prevLine.type === 'added' || prevLine.type === 'deleted' || prevLine.type === 'modified') &&
                             (line.lineNumber === prevLine.lineNumber + 1 || 
                              line.lineNumber === prevLine.lineNumber)
        
        if (!isConsecutive) {
          // 新的更改块
          changeIndex++
        }
        
        return { ...line, changeIndex: changeIndex - 1 }
      } else {
        // 未更改的行
        return line
      }
    })
  }

  // 导航到下一个更改
  const goToNextChange = () => {
    if (currentChangeIndex < changeCount - 1) {
      const newIndex = currentChangeIndex + 1
      setCurrentChangeIndex(newIndex)
      scrollToChange(newIndex)
    }
  }

  // 导航到上一个更改
  const goToPreviousChange = () => {
    if (currentChangeIndex > 0) {
      const newIndex = currentChangeIndex - 1
      setCurrentChangeIndex(newIndex)
      scrollToChange(newIndex)
    }
  }

  // 滚动到指定的更改位置
  const scrollToChange = (changeIndex: number) => {
    const changeLines = fileLines.filter(line => line.changeIndex === changeIndex)
    if (changeLines.length > 0 && scrollContainerRef.current) {
      // 滚动到更改块的第一行
      const firstChangeLine = changeLines[0]
      const lineElement = scrollContainerRef.current.querySelector(`[data-line-number="${firstChangeLine.lineNumber}"]`)
      if (lineElement) {
        lineElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        })
        // 高亮显示当前更改块的所有行
        changeLines.forEach(changeLine => {
          const element = scrollContainerRef.current?.querySelector(`[data-line-number="${changeLine.lineNumber}"]`)
          if (element) {
            element.classList.add('ring-2', 'ring-blue-500', 'ring-opacity-50')
            setTimeout(() => {
              element.classList.remove('ring-2', 'ring-blue-500', 'ring-opacity-50')
            }, 2000)
          }
        })
      }
    }
  }

  // 跳转到指定更改
  const jumpToChange = (changeIndex: number) => {
    if (changeIndex >= 0 && changeIndex < changeCount) {
      setCurrentChangeIndex(changeIndex)
      scrollToChange(changeIndex)
    }
  }

  // 检测字符级别的差异
  const detectCharacterLevelDiff = (oldContent: string, newContent: string): DiffSegment[] => {
    console.log('detectCharacterLevelDiff input:', { oldContent, newContent, oldLength: oldContent.length, newLength: newContent.length })
    
    // 简化算法：直接比较每个字符
    const segments: DiffSegment[] = []
    const maxLength = Math.max(oldContent.length, newContent.length)
    
    for (let i = 0; i < maxLength; i++) {
      const oldChar = i < oldContent.length ? oldContent[i] : null
      const newChar = i < newContent.length ? newContent[i] : null
      
      if (oldChar === null && newChar !== null) {
        // 只有新字符
        segments.push({
          content: newChar,
          type: 'added'
        })
      } else if (oldChar !== null && newChar === null) {
        // 只有旧字符
        segments.push({
          content: oldChar,
          type: 'deleted'
        })
      } else if (oldChar === newChar) {
        // 相同字符
        segments.push({
          content: oldChar!,
          type: 'unchanged'
        })
      } else {
        // 不同字符
        segments.push({
          content: oldChar!,
          type: 'deleted'
        })
        segments.push({
          content: newChar!,
          type: 'added'
        })
      }
    }
    
    // 合并相邻的相同类型分段
    const mergedSegments: DiffSegment[] = []
    for (let i = 0; i < segments.length; i++) {
      const current = segments[i]
      
      if (mergedSegments.length === 0) {
        mergedSegments.push(current)
      } else {
        const last = mergedSegments[mergedSegments.length - 1]
        if (last.type === current.type) {
          // 合并相同类型的分段
          last.content += current.content
        } else {
          mergedSegments.push(current)
        }
      }
    }
    
    console.log('detectCharacterLevelDiff output:', mergedSegments)
    return mergedSegments
  }

  // 检测空白字符的变化
  const detectWhitespaceChanges = (lines: FileLine[]): FileLine[] => {
    const processedLines: FileLine[] = []
    
    for (let i = 0; i < lines.length; i++) {
      const currentLine = lines[i]
      
      // 检查当前行是否是删除行，下一行是否是添加行
      if (currentLine.type === 'deleted') {
        const nextLine = i < lines.length - 1 ? lines[i + 1] : null
        
        if (nextLine && 
            nextLine.type === 'added' &&
            currentLine.lineNumber === nextLine.lineNumber) {
          
          // 检测是否是空白字符的变化
          const oldContent = currentLine.content
          const newContent = nextLine.content
          
          console.log('Checking deleted+added pair:', { 
            oldContent, 
            newContent, 
            oldTrim: oldContent.trim(), 
            newTrim: newContent.trim(),
            trimEqual: oldContent.trim() === newContent.trim(),
            contentNotEqual: oldContent !== newContent,
            oldLength: oldContent.length,
            newLength: newContent.length
          })
          
          // 检查是否是同一行的修改（删除+添加）
          if (oldContent !== newContent) {
            // 这是同一行的修改，创建修改行
            console.log('Detected line modification:', { oldContent, newContent })
            const segments = detectCharacterLevelDiff(oldContent, newContent)
            console.log('Generated segments:', segments)
            
            processedLines.push({
              lineNumber: currentLine.lineNumber,
              content: newContent,
              type: 'modified',
              oldLineNumber: currentLine.oldLineNumber,
              segments: segments
            })
            
            // 跳过下一行（添加行）
            i++
            continue
          }
        }
      }
      
      // 检查当前行是否是未更改行，前后是否有删除和添加行
      if (currentLine.type === 'unchanged') {
        const prevLine = i > 0 ? lines[i - 1] : null
        const nextLine = i < lines.length - 1 ? lines[i + 1] : null
        
        if (prevLine && nextLine && 
            prevLine.type === 'deleted' && 
            nextLine.type === 'added' &&
            prevLine.lineNumber === currentLine.lineNumber &&
            nextLine.lineNumber === currentLine.lineNumber) {
          
          // 检测是否是空白字符的变化
          const oldContent = prevLine.content
          const newContent = nextLine.content
          
          if (oldContent !== newContent) {
            // 这是同一行的修改，创建修改行
            const segments = detectCharacterLevelDiff(oldContent, newContent)
            
            processedLines.push({
              lineNumber: currentLine.lineNumber,
              content: newContent,
              type: 'modified',
              oldLineNumber: currentLine.oldLineNumber,
              segments: segments
            })
            
            // 跳过下一行（添加行）
            i++
            continue
          }
        }
      }
      
      processedLines.push(currentLine)
    }
    
    return processedLines
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
          console.log('Found added line:', content, 'currentLineNumber:', currentLineNumber)
          fileLines.push({
            lineNumber: currentLineNumber,
            content,
            type: 'added'
          })
          currentLineNumber++
        } else if (line.startsWith('-')) {
          // 删除的行
          const content = line.substring(1)
          console.log('Found deleted line:', content, 'currentLineNumber:', currentLineNumber)
          fileLines.push({
            lineNumber: currentLineNumber,
            content,
            type: 'deleted',
            oldLineNumber: oldLineNumber
          })
          // 删除行不增加 currentLineNumber，但增加 oldLineNumber
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
    
    // 后处理：检测空白字符的变化
    const processedLines = detectWhitespaceChanges(fileLines)
    console.log('Processed lines after whitespace detection:', processedLines)
    
    return processedLines
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
      {fileLines.map((line, index) => {
        const isCurrentChange = line.changeIndex === currentChangeIndex
        return (
          <div 
            key={index}
            data-line-number={line.lineNumber}
            className={`px-4 py-1 flex items-start gap-4 transition-all duration-200 ${
              line.type === 'added' ? 'bg-green-50 border-l-4 border-green-500 dark:bg-green-900/20 dark:border-green-400' :
              line.type === 'deleted' ? 'bg-red-50 border-l-4 border-red-500 dark:bg-red-900/20 dark:border-red-400' :
              line.type === 'modified' ? 'bg-orange-50 border-l-4 border-orange-500 dark:bg-orange-900/20 dark:border-orange-400' :
              'bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800'
            } ${
              isCurrentChange ? 'ring-2 ring-blue-500 ring-opacity-50 bg-blue-50 dark:bg-blue-900/20' : ''
            }`}
          >
          {/* Line Number */}
          <div className="text-xs text-gray-500 dark:text-gray-400 w-12 text-right flex-shrink-0">
            {line.lineNumber}
          </div>
          
          {/* Line Icon */}
          <div className="w-4 flex-shrink-0 text-center">
            {line.type === 'added' && <span className="text-green-600 dark:text-green-400 font-bold">+</span>}
            {line.type === 'deleted' && <span className="text-red-600 dark:text-red-400 font-bold">-</span>}
            {line.type === 'modified' && <span className="text-orange-600 dark:text-orange-400 font-bold">~</span>}
            {line.type === 'unchanged' && <span className="text-gray-400 dark:text-gray-500"> </span>}
          </div>
          
          {/* Line Content */}
          <div className="flex-1 min-w-0 break-all">
            {line.type === 'modified' && line.segments ? (
              // 显示字符级别的差异
              <div className="inline">
                {line.segments.map((segment, segmentIndex) => {
                  let segmentStyle = {};
                  let segmentClass = '';
                  
                  if (segment.type === 'added') {
                    segmentStyle = { 
                      padding: '1px 2px',
                      borderRadius: '2px'
                    };
                    segmentClass = 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
                  } else if (segment.type === 'deleted') {
                    segmentStyle = { 
                      padding: '1px 2px',
                      borderRadius: '2px'
                    };
                    segmentClass = 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
                  } else {
                    segmentStyle = {};
                    segmentClass = 'text-foreground';
                  }
                  
                  // 保持原始内容显示，只通过样式高亮空白字符
                  const displayContent = segment.content;
                  
                  return (
                    <span
                      key={segmentIndex}
                      className={segmentClass}
                      style={{
                        ...segmentStyle,
                        // 为空白字符添加特殊样式
                        ...(segment.content.match(/^[\s]+$/) && {
                          border: '1px dashed rgba(0,0,0,0.3)',
                          fontFamily: 'monospace',
                          fontWeight: 'bold'
                        })
                      }}
                      title={`空白字符: "${segment.content}"`}
                    >
                      {displayContent}
                    </span>
                  );
                })}
              </div>
            ) : (
              <span
                style={{
                  // 为非分段内容也添加空白字符可视化
                  fontFamily: 'monospace'
                }}
              >
                {line.content || ' '}
              </span>
            )}
          </div>
        </div>
        )
      })}
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
        
        {/* 更改导航控件 */}
        {changeCount > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              更改 {currentChangeIndex + 1} / {changeCount}
            </span>
            
            {/* 滑动条 */}
            {changeCount > 1 && (
              <div className="flex items-center gap-2 min-w-0 flex-1 max-w-32">
                <input
                  type="range"
                  min="0"
                  max={changeCount - 1}
                  value={currentChangeIndex}
                  onChange={(e) => {
                    const newIndex = parseInt(e.target.value)
                    setCurrentChangeIndex(newIndex)
                    scrollToChange(newIndex)
                  }}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(currentChangeIndex / (changeCount - 1)) * 100}%, #e5e7eb ${(currentChangeIndex / (changeCount - 1)) * 100}%, #e5e7eb 100%)`,
                    WebkitAppearance: 'none',
                    appearance: 'none'
                  }}
                  title={`滑动到更改 ${currentChangeIndex + 1}`}
                />
              </div>
            )}
            
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={goToPreviousChange}
                disabled={currentChangeIndex === 0}
                className="p-1 h-8 w-8"
                title="上一个更改"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={goToNextChange}
                disabled={currentChangeIndex === changeCount - 1}
                className="p-1 h-8 w-8"
                title="下一个更改"
              >
                <ChevronDownIcon className="h-4 w-4" />
              </Button>
            </div>
            {changeCount > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const input = prompt(`跳转到更改 (1-${changeCount}):`, (currentChangeIndex + 1).toString())
                  if (input) {
                    const index = parseInt(input) - 1
                    if (!isNaN(index) && index >= 0 && index < changeCount) {
                      jumpToChange(index)
                    }
                  }
                }}
                className="p-1 h-8 w-8"
                title="跳转到指定更改"
              >
                <Navigation className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
      
      {isExpanded && (
        <div ref={scrollContainerRef} className="max-h-96 overflow-y-auto">
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

