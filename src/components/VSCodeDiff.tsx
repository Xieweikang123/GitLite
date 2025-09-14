import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './ui/button'
import { Copy, ChevronDown, ChevronRight, ChevronUp, ChevronDown as ChevronDownIcon, Navigation, Sidebar, FileText } from 'lucide-react'

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

// 简单的Tooltip组件
interface TooltipProps {
  children: React.ReactNode
  content: React.ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
}

function Tooltip({ children, content, position = 'top' }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const hideTimeoutRef = useRef<number | null>(null)

  const showTooltip = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      
      // 估算tooltip尺寸
      const tooltipWidth = 400
      const tooltipHeight = 200
      
      let x = rect.left
      let y = rect.top
      
      // 根据position计算位置
      switch (position) {
        case 'top':
          x += rect.width / 2
          y -= 10
          break
        case 'bottom':
          x += rect.width / 2
          y += rect.height + 10
          break
        case 'left':
          x -= 10
          y += rect.height / 2
          break
        case 'right':
          x += rect.width + 10
          y += rect.height / 2
          break
      }
      
      // 边界检查
      x = Math.max(10, Math.min(x, viewportWidth - tooltipWidth - 10))
      y = Math.max(10, Math.min(y, viewportHeight - tooltipHeight - 10))
      
      setTooltipPosition({ x, y })
    }
    setIsVisible(true)
  }

  const hideTooltip = () => {
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false)
    }, 100) // 延迟100ms隐藏，避免闪烁
  }

  const handleMouseEnter = () => {
    showTooltip()
  }

  const handleMouseLeave = () => {
    hideTooltip()
  }

  const handleTooltipMouseEnter = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
  }

  const handleTooltipMouseLeave = () => {
    hideTooltip()
  }

  // 防止Tooltip滚动事件冒泡到主界面
  useEffect(() => {
    const tooltipElement = tooltipRef.current
    if (!tooltipElement || !isVisible) return

    const handleWheel = (e: WheelEvent) => {
      // 完全阻止滚动事件冒泡和默认行为
      e.stopPropagation()
      e.preventDefault()
    }

    // 添加滚动事件监听器，使用capture模式确保优先级
    tooltipElement.addEventListener('wheel', handleWheel, { passive: false, capture: true })

    return () => {
      tooltipElement.removeEventListener('wheel', handleWheel, { capture: true })
    }
  }, [isVisible])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [])

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-block"
      >
        {children}
      </div>
      
      {isVisible && createPortal(
        <div
          ref={tooltipRef}
          className="fixed z-[9999] bg-gray-900 text-white text-xs rounded-lg shadow-lg border border-gray-700 max-w-md"
          style={{
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            transform: position === 'top' || position === 'bottom' ? 'translateX(-50%)' : 
                      position === 'left' ? 'translateX(-100%)' : 'translateX(0)',
            maxWidth: '400px',
            maxHeight: '300px',
            overflow: 'auto'
          }}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        >
          <div className="p-3">
            {content}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

export function VSCodeDiff({ diff, filePath, repoPath }: VSCodeDiffProps) {
  const [fileLines, setFileLines] = useState<FileLine[]>([])
  const [isExpanded, setIsExpanded] = useState(true)
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0)
  const [changeCount, setChangeCount] = useState(0)
  const [viewMode, setViewMode] = useState<'unified' | 'side-by-side'>('unified')
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 防止滚动事件冒泡到主界面
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const handleWheel = (e: WheelEvent) => {
      // 完全阻止事件冒泡和默认行为
      e.stopPropagation()
      e.preventDefault()
      
      // 手动控制滚动
      const scrollAmount = e.deltaY
      scrollContainer.scrollTop += scrollAmount
    }

    // 添加滚动事件监听器，使用捕获阶段确保优先级
    scrollContainer.addEventListener('wheel', handleWheel, { passive: false, capture: true })

    return () => {
      scrollContainer.removeEventListener('wheel', handleWheel, { capture: true })
    }
  }, [])

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

  const renderUnifiedView = () => (
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
              // 显示字符级别的差异 - 带Tooltip版本
              <Tooltip
                content={
                  <div className="space-y-2">
                    <div className="text-red-300 text-xs font-semibold">原始代码:</div>
                    <div className="bg-red-900/30 p-2 rounded font-mono text-xs break-all">
                      {line.segments.filter(s => s.type === 'deleted' || s.type === 'unchanged').map(s => s.content).join('')}
                    </div>
                    <div className="text-green-300 text-xs font-semibold">修改后:</div>
                    <div className="bg-green-900/30 p-2 rounded font-mono text-xs break-all">
                      {line.segments.filter(s => s.type === 'added' || s.type === 'unchanged').map(s => s.content).join('')}
                    </div>
                  </div>
                }
                position="top"
              >
                <div className="inline cursor-help">
                  {line.segments.map((segment, segmentIndex) => {
                    let segmentClass = '';
                    let segmentStyle: React.CSSProperties = {};
                    
                    if (segment.type === 'added') {
                      // 新增内容：使用更柔和的绿色背景
                      segmentClass = 'bg-green-100 text-green-900 dark:bg-green-900/20 dark:text-green-200';
                      segmentStyle = { 
                        padding: '0 2px',
                        borderRadius: '3px',
                        fontWeight: '500'
                      };
                    } else if (segment.type === 'deleted') {
                      // 删除内容：使用更柔和的红色背景
                      segmentClass = 'bg-red-100 text-red-900 dark:bg-red-900/20 dark:text-red-200';
                      segmentStyle = { 
                        padding: '0 2px',
                        borderRadius: '3px',
                        fontWeight: '500'
                      };
                    } else {
                      // 未更改内容：保持原样
                      segmentClass = 'text-foreground';
                      segmentStyle = {};
                    }
                    
                    // 特殊处理空白字符
                    const isWhitespace = /^[\s]+$/.test(segment.content);
                    if (isWhitespace) {
                      segmentStyle = {
                        ...segmentStyle,
                        border: '1px dashed rgba(156, 163, 175, 0.5)',
                        backgroundColor: 'rgba(156, 163, 175, 0.1)',
                        borderRadius: '2px',
                        padding: '0 1px'
                      };
                    }
                    
                    return (
                      <span
                        key={segmentIndex}
                        className={segmentClass}
                        style={segmentStyle}
                        title={isWhitespace ? `空白字符: "${segment.content}"` : undefined}
                      >
                        {segment.content}
                      </span>
                    );
                  })}
                </div>
              </Tooltip>
            ) : (
              <span
                className="font-mono"
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

  const renderSideBySideView = () => {
    // 分离不同类型的行
    const unchangedLines = fileLines.filter(line => line.type === 'unchanged')
    const modifiedLines = fileLines.filter(line => line.type === 'modified')
    
    // 创建并排显示的数据结构
    const sideBySideData: Array<{
      leftLine?: FileLine
      rightLine?: FileLine
      type: 'unchanged' | 'added' | 'deleted' | 'modified'
      originalLine?: FileLine // 用于Tooltip显示
    }> = []
    
    // 处理修改的行（显示为删除+添加）
    modifiedLines.forEach(line => {
      if (line.segments) {
        const deletedContent = line.segments.filter(s => s.type === 'deleted' || s.type === 'unchanged').map(s => s.content).join('')
        const addedContent = line.segments.filter(s => s.type === 'added' || s.type === 'unchanged').map(s => s.content).join('')
        
        sideBySideData.push({
          leftLine: { ...line, content: deletedContent, type: 'deleted' },
          rightLine: { ...line, content: addedContent, type: 'added' },
          type: 'modified',
          originalLine: line // 保存原始行信息用于Tooltip
        })
      }
    })
    
    // 处理未更改的行
    unchangedLines.forEach(line => {
      sideBySideData.push({
        leftLine: line,
        rightLine: line,
        type: 'unchanged'
      })
    })
    
    return (
      <div className="font-mono text-sm">
        <div className="grid grid-cols-2 gap-0 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          {/* 表头 */}
          <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700">
            删除的内容
          </div>
          <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
            添加的内容
          </div>
          
          {/* 内容行 */}
          {sideBySideData.map((item, index) => {
            const isCurrentChange = item.leftLine?.changeIndex === currentChangeIndex || item.rightLine?.changeIndex === currentChangeIndex
            
            return (
              <div key={index} className={`contents ${isCurrentChange ? 'ring-2 ring-blue-500 ring-opacity-50' : ''}`}>
                {/* 左侧（删除） */}
                <div className={`px-4 py-1 flex items-start gap-2 ${
                  item.type === 'deleted' ? 'bg-red-50 border-l-4 border-red-500 dark:bg-red-900/20 dark:border-red-400' :
                  item.type === 'modified' ? 'bg-red-50 border-l-4 border-red-500 dark:bg-red-900/20 dark:border-red-400' :
                  'bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800'
                } border-r border-gray-200 dark:border-gray-700`}>
                  <div className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right flex-shrink-0">
                    {item.leftLine?.oldLineNumber || item.leftLine?.lineNumber || ''}
                  </div>
                  <div className="w-4 flex-shrink-0 text-center">
                    {item.type === 'deleted' && <span className="text-red-600 dark:text-red-400 font-bold">-</span>}
                    {item.type === 'modified' && <span className="text-red-600 dark:text-red-400 font-bold">-</span>}
                    {item.type === 'unchanged' && <span className="text-gray-400 dark:text-gray-500"> </span>}
                  </div>
                  <div className="flex-1 min-w-0 break-all text-red-800 dark:text-red-200">
                    {item.type === 'modified' && item.originalLine?.segments ? (
                      <Tooltip
                        content={
                          <div className="space-y-2">
                            <div className="text-red-300 text-xs font-semibold">原始代码:</div>
                            <div className="bg-red-900/30 p-2 rounded font-mono text-xs break-all">
                              {item.originalLine.segments.filter(s => s.type === 'deleted' || s.type === 'unchanged').map(s => s.content).join('')}
                            </div>
                            <div className="text-green-300 text-xs font-semibold">修改后:</div>
                            <div className="bg-green-900/30 p-2 rounded font-mono text-xs break-all">
                              {item.originalLine.segments.filter(s => s.type === 'added' || s.type === 'unchanged').map(s => s.content).join('')}
                            </div>
                          </div>
                        }
                        position="top"
                      >
                        <span className="cursor-help">{item.leftLine?.content || ' '}</span>
                      </Tooltip>
                    ) : (
                      item.leftLine?.content || ' '
                    )}
                  </div>
                </div>
                
                {/* 右侧（添加） */}
                <div className={`px-4 py-1 flex items-start gap-2 ${
                  item.type === 'added' ? 'bg-green-50 border-l-4 border-green-500 dark:bg-green-900/20 dark:border-green-400' :
                  item.type === 'modified' ? 'bg-green-50 border-l-4 border-green-500 dark:bg-green-900/20 dark:border-green-400' :
                  'bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800'
                }`}>
                  <div className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right flex-shrink-0">
                    {item.rightLine?.lineNumber || ''}
                  </div>
                  <div className="w-4 flex-shrink-0 text-center">
                    {item.type === 'added' && <span className="text-green-600 dark:text-green-400 font-bold">+</span>}
                    {item.type === 'modified' && <span className="text-green-600 dark:text-green-400 font-bold">+</span>}
                    {item.type === 'unchanged' && <span className="text-gray-400 dark:text-gray-500"> </span>}
                  </div>
                  <div className="flex-1 min-w-0 break-all text-green-800 dark:text-green-200">
                    {item.type === 'modified' && item.originalLine?.segments ? (
                      <Tooltip
                        content={
                          <div className="space-y-2">
                            <div className="text-red-300 text-xs font-semibold">原始代码:</div>
                            <div className="bg-red-900/30 p-2 rounded font-mono text-xs break-all">
                              {item.originalLine.segments.filter(s => s.type === 'deleted' || s.type === 'unchanged').map(s => s.content).join('')}
                            </div>
                            <div className="text-green-300 text-xs font-semibold">修改后:</div>
                            <div className="bg-green-900/30 p-2 rounded font-mono text-xs break-all">
                              {item.originalLine.segments.filter(s => s.type === 'added' || s.type === 'unchanged').map(s => s.content).join('')}
                            </div>
                          </div>
                        }
                        position="top"
                      >
                        <span className="cursor-help">{item.rightLine?.content || ' '}</span>
                      </Tooltip>
                    ) : (
                      item.rightLine?.content || ' '
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }


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
          
          {/* 视图模式切换 */}
          <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
            <Button
              variant={viewMode === 'unified' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('unified')}
              className="rounded-none border-0 h-8 px-3"
              title="统一视图"
            >
              <FileText className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'side-by-side' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('side-by-side')}
              className="rounded-none border-0 h-8 px-3"
              title="并排视图"
            >
              <Sidebar className="h-4 w-4" />
            </Button>
          </div>
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
            viewMode === 'side-by-side' ? renderSideBySideView() : renderUnifiedView()
          )}
        </div>
      )}
    </div>
  )
}

