import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './ui/button'
import { Copy, ChevronDown, ChevronRight, ChevronUp, ChevronDown as ChevronDownIcon, Navigation, Sidebar, FileText } from 'lucide-react'
import SimpleSyntaxHighlighter from './SimpleSyntaxHighlighter'

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
  debugEnabled?: boolean
}

// 根据文件路径获取语言类型
const getLanguageFromPath = (path?: string): string => {
  if (!path) return 'text'
  
  const ext = path.split('.').pop()?.toLowerCase()
  const languageMap: { [key: string]: string } = {
    'rs': 'rust',
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'py': 'python',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'cs': 'csharp',
    'go': 'go',
    'php': 'php',
    'rb': 'ruby',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'sh': 'bash',
    'json': 'json',
    'xml': 'xml',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'scss',
    'less': 'less',
    'sql': 'sql',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'txt': 'text',
  }
  
  return languageMap[ext || ''] || 'text'
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

export function VSCodeDiff({ diff, filePath, repoPath, debugEnabled: debugFromParent }: VSCodeDiffProps) {
  const [fileLines, setFileLines] = useState<FileLine[]>([])
  const [isExpanded, setIsExpanded] = useState(true)
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0)
  const [changeCount, setChangeCount] = useState(0)
  const [viewMode, setViewMode] = useState<'unified' | 'side-by-side'>('unified')
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  
  // 虚拟滚动相关状态
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 })
  const [itemHeight] = useState(24) // 每行的高度（像素）
  const [containerHeight, setContainerHeight] = useState(600) // 容器高度
  const [showThumbnail, setShowThumbnail] = useState(true) // 是否显示缩略图
  
  // 添加加载状态，避免闪烁
  const [isLoading, setIsLoading] = useState(false)

  // 虚拟滚动处理
  const updateVisibleRange = useCallback(() => {
    if (!scrollContainerRef.current) return
    
    const scrollTop = scrollContainerRef.current.scrollTop
    const start = Math.floor(scrollTop / itemHeight)
    const end = Math.min(start + Math.ceil(containerHeight / itemHeight) + 10, fileLines.length) // 额外渲染10行作为缓冲
    
    setVisibleRange({ start, end })
  }, [itemHeight, containerHeight, fileLines.length])

  // 防止滚动事件冒泡到主界面，并处理虚拟滚动
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
      
      // 更新可见范围
      updateVisibleRange()
    }

    const handleScroll = () => {
      updateVisibleRange()
    }

    // 添加滚动事件监听器，使用捕获阶段确保优先级
    scrollContainer.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })

    // 初始化可见范围
    updateVisibleRange()

    return () => {
      scrollContainer.removeEventListener('wheel', handleWheel, { capture: true })
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [updateVisibleRange])

  // 检测容器高度变化
  useEffect(() => {
    const updateContainerHeight = () => {
      if (scrollContainerRef.current) {
        const height = scrollContainerRef.current.clientHeight
        setContainerHeight(height)
      }
    }

    updateContainerHeight()
    window.addEventListener('resize', updateContainerHeight)
    
    return () => {
      window.removeEventListener('resize', updateContainerHeight)
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
      setIsLoading(true) // 开始加载
      
      const startTime = performance.now()
      console.log('Raw diff content:', diff)
      console.log('Diff length:', diff.length)
      console.log('First 500 chars:', diff.substring(0, 500))
      
      const parsedLines = parseDiffToFullFile(diff)
      const parseTime = performance.now() - startTime
      console.log(`Parsed lines: ${parsedLines.length} (took ${parseTime.toFixed(2)}ms)`)
      
      // 检查解析结果
      const addedLines = parsedLines.filter(line => line.type === 'added')
      const deletedLines = parsedLines.filter(line => line.type === 'deleted')
      const unchangedLines = parsedLines.filter(line => line.type === 'unchanged')
      console.log(`Added lines: ${addedLines.length}, Deleted lines: ${deletedLines.length}, Unchanged lines: ${unchangedLines.length}`)
      
      if (addedLines.length > 0) {
        console.log('First added line:', addedLines[0])
      }
      if (deletedLines.length > 0) {
        console.log('First deleted line:', deletedLines[0])
      }
      
      // 为更改行添加索引
      const linesWithChangeIndex = addChangeIndices(parsedLines)
      
      // 计算更改块数量
      const uniqueChangeIndices = new Set(
        linesWithChangeIndex
          .filter(line => line.changeIndex !== undefined)
          .map(line => line.changeIndex)
      )
      const newChangeCount = uniqueChangeIndices.size
      
      console.log('Final fileLines set:', linesWithChangeIndex.length)
      
      // 批量更新状态，避免多次渲染
      const updateStates = (finalLines: FileLine[]) => {
        setFileLines(finalLines)
        setChangeCount(newChangeCount)
        setCurrentChangeIndex(0)
        setIsLoading(false) // 结束加载
        
        // 延迟滚动，确保DOM已更新
        setTimeout(() => scrollToFirstChange(finalLines), 50)
      }
      
      // 启用文件内容补全，显示完整文件
      if (filePath && repoPath) {
        fillUnchangedLines(linesWithChangeIndex, filePath, repoPath).then((finalLines) => {
          updateStates(finalLines)
        }).catch(() => {
          updateStates(linesWithChangeIndex)
        })
      } else {
        // 如果没有文件路径，直接更新状态
        updateStates(linesWithChangeIndex)
      }
    } else {
      console.log('No diff provided')
      setFileLines([])
      setChangeCount(0)
      setCurrentChangeIndex(0)
      setIsLoading(false)
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
        const targetLineIndex = firstChangeLine.lineNumber - 1 // 转换为0基索引
        const targetScrollTop = targetLineIndex * itemHeight
        
        // 平滑滚动到目标位置
        scrollContainerRef.current?.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth'
        })
        
        // 更新可见范围以确保目标行被渲染
        setTimeout(() => {
          const start = Math.max(0, targetLineIndex - 10)
          const end = Math.min(lines.length, targetLineIndex + 30)
          setVisibleRange({ start, end })
        }, 100)
      }, 100)
    }
  }

  const fillUnchangedLines = async (lines: FileLine[], filePath: string, repoPath: string): Promise<FileLine[]> => {
    try {
      const startTime = performance.now()
      const { invoke } = await import('@tauri-apps/api/tauri')
      const fileContent = await invoke('get_file_content', {
        repoPath,
        filePath
      }) as string
      
      const fileContentLines = fileContent.split('\n')
      console.log(`File content lines: ${fileContentLines.length}`)
      
      // 创建diff行的映射表，支持同一行号的多个diff行
      const diffLinesMap = new Map<number, FileLine[]>()
      lines.forEach(line => {
        if (!diffLinesMap.has(line.lineNumber)) {
          diffLinesMap.set(line.lineNumber, [])
        }
        diffLinesMap.get(line.lineNumber)!.push(line)
      })
      
      console.log('🔍 diffLinesMap 内容:', Array.from(diffLinesMap.entries()).slice(0, 5))
      
      // 创建完整的文件行数组
      const fullFileLines: FileLine[] = [] 
      
      // 为每一行创建FileLine对象 - O(n)复杂度
      for (let i = 0; i < fileContentLines.length; i++) {
        const lineNumber = i + 1
        const content = fileContentLines[i]
        
        // 使用Map查找，O(1)复杂度
        const diffLines = diffLinesMap.get(lineNumber)
        
        if (diffLines && diffLines.length > 0) {
          // 如果在diff中，添加所有相关的diff行
          diffLines.forEach(diffLine => {
            fullFileLines.push(diffLine)
          })
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
      
      const processingTime = performance.now() - startTime
      console.log(`Full file lines: ${fullFileLines.length} (processing took ${processingTime.toFixed(2)}ms)`)
      
      // 检查第一行的处理结果
      const firstLines = fullFileLines.filter(line => line.lineNumber === 1)
      console.log('🔍 fillUnchangedLines 后第一行结果:', firstLines)
      
      // 重新为完整文件行添加更改索引
      const fullFileLinesWithIndex = addChangeIndices(fullFileLines)
      
      // 返回处理后的行数据，而不是直接设置状态
      return fullFileLinesWithIndex
    } catch (err) {
      console.error('Failed to read file content:', err)
      // 如果读取失败，返回原始行数据
      return lines
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
      console.log(`Navigating to next change: ${newIndex + 1}/${changeCount}`)
      setCurrentChangeIndex(newIndex)
      scrollToChange(newIndex)
    }
  }

  // 导航到上一个更改
  const goToPreviousChange = () => {
    if (currentChangeIndex > 0) {
      const newIndex = currentChangeIndex - 1
      console.log(`Navigating to previous change: ${newIndex + 1}/${changeCount}`)
      setCurrentChangeIndex(newIndex)
      scrollToChange(newIndex)
    }
  }

  // 滚动到指定的更改位置
  const scrollToChange = (changeIndex: number) => {
    const changeLines = fileLines.filter(line => line.changeIndex === changeIndex)
    console.log(`scrollToChange: changeIndex=${changeIndex}, found ${changeLines.length} lines`)
    
    if (changeLines.length > 0 && scrollContainerRef.current) {
      // 滚动到更改块的第一行
      const firstChangeLine = changeLines[0]
      const targetLineIndex = firstChangeLine.lineNumber - 1 // 转换为0基索引
      
      // 计算目标位置
      const targetScrollTop = targetLineIndex * itemHeight
      
      console.log(`Scrolling to line ${firstChangeLine.lineNumber}, targetScrollTop=${targetScrollTop}`)
      
      // 平滑滚动到目标位置
      scrollContainerRef.current.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
      })
      
      // 更新可见范围以确保目标行被渲染
      setTimeout(() => {
        const start = Math.max(0, targetLineIndex - 10) // 确保目标行前后有足够的缓冲
        const end = Math.min(fileLines.length, targetLineIndex + 30)
        setVisibleRange({ start, end })
      }, 100)
      
      // 移除临时高亮效果，保持简洁的界面
    }
  }

  // 跳转到指定更改
  const jumpToChange = (changeIndex: number) => {
    if (changeIndex >= 0 && changeIndex < changeCount) {
      setCurrentChangeIndex(changeIndex)
      scrollToChange(changeIndex)
    }
  }



  // 检测相邻的删除和添加行，为它们添加字符级别差异
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
          
          console.log('🔍 发现相邻的删除和添加行，行号:', currentLine.lineNumber)
          console.log('删除行内容:', currentLine.content)
          console.log('添加行内容:', nextLine.content)
          
          // 既然已经显示了两行（删除行和添加行），就不再添加字符级别的差异高亮
          // 直接添加删除行和添加行，保持简洁的显示
          processedLines.push(currentLine)
          processedLines.push(nextLine)
          
          // 跳过下一行（添加行）
          i++
          continue
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

    console.log('=== 开始解析diff ===')
    console.log('原始diff内容:', diffText)
    console.log('分割后的行:', lines)
    console.log('总行数:', lines.length)

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
          console.log('🟢 发现添加行:', content, 'currentLineNumber:', currentLineNumber)
          fileLines.push({
            lineNumber: currentLineNumber,
            content,
            type: 'added'
          })
          currentLineNumber++
        } else if (line.startsWith('-')) {
          // 删除的行
          const content = line.substring(1)
          console.log('🔴 发现删除行:', content, 'currentLineNumber:', currentLineNumber, 'oldLineNumber:', oldLineNumber)
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

    console.log('=== 解析完成 ===')
    console.log('最终解析的行数:', fileLines.length)
    console.log('解析结果详情:', fileLines.map(line => ({
      lineNumber: line.lineNumber,
      type: line.type,
      content: line.content.substring(0, 50) + (line.content.length > 50 ? '...' : ''),
      oldLineNumber: line.oldLineNumber
    })))
    
    // 统计各类型行数
    const addedCount = fileLines.filter(l => l.type === 'added').length
    const deletedCount = fileLines.filter(l => l.type === 'deleted').length
    const unchangedCount = fileLines.filter(l => l.type === 'unchanged').length
    console.log(`行数统计: 添加=${addedCount}, 删除=${deletedCount}, 未修改=${unchangedCount}`)
    
    // 后处理：检测空白字符的变化
    const processedLines = detectWhitespaceChanges(fileLines)
    console.log('=== 空白字符处理后 ===')
    console.log('处理后行数:', processedLines.length)
    console.log('处理后详情:', processedLines.map(line => ({
      lineNumber: line.lineNumber,
      type: line.type,
      content: line.content.substring(0, 50) + (line.content.length > 50 ? '...' : ''),
      hasSegments: !!line.segments,
      segmentsCount: line.segments?.length || 0
    })))
    
    // 特别检查第一行的处理结果
    const firstLines = processedLines.filter(line => line.lineNumber === 1)
    console.log('第一行处理结果:', firstLines)
    
    return processedLines
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(diff)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // 缩略图组件 - 使用稳定的渲染逻辑避免闪烁
  const ThumbnailScrollbar = () => {
    // 使用稳定的状态，避免重新挂载
    const [currentScrollTop, setCurrentScrollTop] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const [dragScrollTop, setDragScrollTop] = useState(0)
    const [debugEnabled, setDebugEnabled] = useState(!!debugFromParent)
    const thumbnailInnerRef = useRef<HTMLDivElement>(null)
    const thumbnailContainerRef = useRef<HTMLDivElement>(null)
    // 仅使用 portal 指示框，避免受内部布局影响
    const indicatorPortalRef = useRef<HTMLDivElement>(null)
    const indicatorTranslateYRef = useRef<number>(0)
    // 移除未使用的 wantScrollTopRef
    const containerRectRef = useRef<DOMRect | null>(null)
    // 移除未使用的 rafIdRef
    const indicatorElRef = useRef<HTMLDivElement | null>(null)
    const desiredRef = useRef<{ scrollTop: number | null }>({ scrollTop: null })
    const scheduledRef = useRef<number | null>(null)
    const debugPortalRef = useRef<HTMLDivElement | null>(null)
    const lastValidRectRef = useRef<DOMRect | null>(null)
    
    // 单一写入者：在 rAF 中统一写入（top/left/width 和 CSS 变量）
    const requestWrite = () => {
      if (scheduledRef.current != null) return
      scheduledRef.current = requestAnimationFrame(flushWrites)
    }
    const flushWrites = () => {
      scheduledRef.current = null
      const indicator = indicatorElRef.current
      const rect = (containerRectRef.current && containerRectRef.current.height > 2 && containerRectRef.current.width > 0)
        ? containerRectRef.current
        : lastValidRectRef.current
      if (!indicator || !rect) {
        // 元素或测量尚未就绪，下一帧再尝试，避免丢写导致 css 变量缺失
        scheduledRef.current = requestAnimationFrame(flushWrites)
        return
      }
      // 读取目标值
      const nextScrollTop = desiredRef.current.scrollTop
      const thumbnailHeight = rect.height
      const totalContentPx = Math.max(1, fileLines.length * itemHeight)
      const viewportPx = scrollContainerRef.current?.clientHeight ?? containerHeight
      const indicatorHeightPx = Math.min(
        thumbnailHeight,
        Math.max(4, Math.round((viewportPx / totalContentPx) * thumbnailHeight))
      )
      // 轨道高度：缩略图总高度减去蓝色可视指示块高度
      const trackHeight = Math.max(0, thumbnailHeight - indicatorHeightPx)
      const usedScrollTop = nextScrollTop ?? (scrollContainerRef.current?.scrollTop ?? 0)
      const scrollMax = Math.max(1, totalContentPx - viewportPx)
      // 将代码区滚动位置映射到缩略图轨道比例 [0,1]
      const p = Math.min(1, Math.max(0, usedScrollTop / scrollMax))
      // 指示块位移（像素）= 比例 × 轨道高度
      const ty = Math.round(trackHeight * p)
      // 写入一次性样式（含视口夹取）
      const viewportH = window.innerHeight || document.documentElement.clientHeight || 0
      // 指示块的 fixed 基准 top，限制在视口内
      const topBase = Math.max(0, Math.min(rect.top, Math.max(0, viewportH - indicatorHeightPx)))
      indicator.style.top = `${topBase}px`
      indicator.style.left = `${rect.left}px`
      indicator.style.width = `${rect.width}px`
      // 通过 CSS 变量驱动 fixed 指示块的位置
      indicator.style.setProperty('--indicator-ty', `${ty}px`)
      indicator.style.setProperty('--indicator-h', `${indicatorHeightPx}px`)
      // 强制确保 transform 使用 css 变量，防止被外部覆盖成 0px/none
      if (!indicator.style.transform || !indicator.style.transform.includes('var(--indicator-ty')) {
        indicator.style.transform = 'translate3d(0, var(--indicator-ty), 0)'
      }
      // 兜底：如果计算后的位置仍超出视口，强制单帧使用绝对 top
      const tyNum = ty
      const finalTop = topBase + tyNum
      const outOfView = finalTop < 0 || finalTop > (viewportH - 1)
      if (outOfView) {
        indicator.style.transform = 'translate3d(0, 0, 0)'
        indicator.style.top = `${Math.max(0, Math.min(finalTop, viewportH - indicatorHeightPx))}px`
        // 下一帧恢复变量驱动
        requestAnimationFrame(() => {
          indicator.style.top = `${topBase}px`
          indicator.style.transform = 'translate3d(0, var(--indicator-ty), 0)'
        })
      }
      // 仅在显式隐藏或无数据时隐藏；避免测量抖动导致短暂消失
      if (!showThumbnail || fileLines.length === 0) {
        indicator.style.display = 'none'
      } else {
        indicator.style.display = 'block'
      }
      indicatorTranslateYRef.current = ty
      // 清空已消费的目标
      desiredRef.current.scrollTop = null
      // 调试面板输出（同帧、同写者）+ 控制台打印
      if (debugEnabled) {
        const cssVarTy = getComputedStyle(indicator).getPropertyValue('--indicator-ty').trim()
        const ts = performance.now().toFixed(1)
        console.log('[IndicatorDebug]', {
          tsMs: Number(ts),
          scrollTop: scrollContainerRef.current?.scrollTop ?? 0,
          desiredScrollTop: nextScrollTop ?? null,
          translateYRefPx: Math.round(ty),
          translateYCssVar: cssVarTy || '(empty)',
          rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width) }
        })
        if (debugPortalRef.current) {
          const left = rect.left + rect.width + 8
          const top = rect.top + 8
          const box = debugPortalRef.current
          box.style.left = `${left}px`
          box.style.top = `${top}px`
          box.innerHTML = `
            <div>ts: ${ts} ms</div>
            <div>scrollTop: ${scrollContainerRef.current?.scrollTop ?? 0}</div>
            <div>desired.scrollTop: ${nextScrollTop ?? 'null'}</div>
            <div>ty(ref): ${Math.round(ty)} px</div>
            <div>ty(css var): ${cssVarTy || '(empty)'}</div>
            <div>rect: top=${Math.round(rect.top)}, left=${Math.round(rect.left)}, w=${Math.round(rect.width)}</div>
          `
        }
      }
    }
    const enqueueScrollTop = (next: number) => {
      desiredRef.current.scrollTop = next
      requestWrite()
    }
    
    // 入队一个目标 scrollTop，由 rAF 写者统一写入
    const enqueueImmediate = (scrollTopValue: number) => {
      desiredRef.current.scrollTop = scrollTopValue
      requestWrite()
    }

    // 初次渲染或尺寸变更时请求一次写入（避免位置被置为0）
    useEffect(() => {
      const scrollTopNow = scrollContainerRef.current?.scrollTop ?? currentScrollTop
      if (isDragging) return
      enqueueScrollTop(scrollTopNow)
    }, [itemHeight, containerHeight, fileLines.length, isDragging])

    // 父级控制调试开关同步
    useEffect(() => {
      setDebugEnabled(!!debugFromParent)
    }, [debugFromParent])

    // 自管控的 portal 元素，避免 React 重建导致样式丢失
    useEffect(() => {
      const el = document.createElement('div')
      el.className = 'gitlite-indicator'
      document.body.appendChild(el)
      ;(indicatorPortalRef as React.MutableRefObject<HTMLDivElement | null>).current = el
      indicatorElRef.current = el
      // 初始写入，防止第一帧为 0
      requestWrite()
      return () => {
        try { document.body.removeChild(el) } catch {}
        if (indicatorPortalRef.current === el) (indicatorPortalRef as React.MutableRefObject<HTMLDivElement | null>).current = null
        if (indicatorElRef.current === el) indicatorElRef.current = null
      }
    }, [])

    // 渲染后确保有最新容器测量，并请求写入
    useLayoutEffect(() => {
      const rect = thumbnailContainerRef.current?.getBoundingClientRect() || null
      if (rect) containerRectRef.current = rect
      requestWrite()
    })

    // 监听容器位置变化，仅测量不写入，交由 rAF 写者统一处理
    useEffect(() => {
      const el = thumbnailContainerRef.current
      if (!el) return
      const measure = () => {
        const r = el.getBoundingClientRect()
        containerRectRef.current = r
        if (r.height > 2 && r.width > 0) {
          lastValidRectRef.current = r
        }
        requestWrite()
      }
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      measure()
      window.addEventListener('resize', measure)
      window.addEventListener('scroll', measure, true)
      return () => {
        ro.disconnect()
        window.removeEventListener('resize', measure)
        window.removeEventListener('scroll', measure, true)
      }
    }, [])

    // 调试：观察是否有外部写者修改了 style（仅在启用时）
    useEffect(() => {
      if (!debugEnabled) return
      const target = indicatorElRef.current
      if (!target) return
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'style') {
            const t = target.style.transform || ''
            const cssVarTy = getComputedStyle(target).getPropertyValue('--indicator-ty').trim()
            // transform 不应被直接改写（应始终为 translate3d(0, var(--indicator-ty), 0)）
            if (t && !t.includes('var(--indicator-ty')) {
              console.warn('[IndicatorDebug] overwritten transform:', t)
              if (debugPortalRef.current) {
                debugPortalRef.current.innerHTML += `<div style=\"color:#ef4444\">overwritten transform: ${t}</div>`
              }
            }
            // CSS 变量缺失也记录
            if (!cssVarTy) {
              console.warn('[IndicatorDebug] missing --indicator-ty')
            }
          }
        }
      })
      mo.observe(target, { attributes: true, attributeFilter: ['style'] })
      return () => mo.disconnect()
    }, [debugEnabled])

    // 监听滚动位置变化：capture+passive，仅入队目标值
    useEffect(() => {
      const scrollContainer = scrollContainerRef.current
      if (!scrollContainer) return
      const handleScroll = () => {
        if (isDragging) return
        const next = scrollContainer.scrollTop
        enqueueScrollTop(next)
        setCurrentScrollTop(next)
        // 同步缩略图容器的屏幕位置，防止 fixed 指示框与缩略图脱节
        if (thumbnailContainerRef.current) {
          containerRectRef.current = thumbnailContainerRef.current.getBoundingClientRect()
          requestWrite()
        }
      }
      scrollContainer.addEventListener('scroll', handleScroll, { capture: true, passive: true } as any)
      return () => scrollContainer.removeEventListener('scroll', handleScroll as any, { capture: true } as any)
    }, [isDragging])
    
    // 防止拖拽结束后被滚动事件重置
    useEffect(() => {
      if (!isDragging && dragScrollTop > 0) {
        console.log('拖拽结束后同步状态:', { dragScrollTop, currentScrollTop })
        setCurrentScrollTop(dragScrollTop)
        
        // 强制同步滚动容器的位置
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = dragScrollTop
        }
      }
    }, [isDragging, dragScrollTop])
    
    // // 调试：打印状态变化
    // useEffect(() => {
    //   console.log('缩略图状态变化:', { isDragging, currentScrollTop, dragScrollTop })
    // }, [isDragging, currentScrollTop, dragScrollTop])

    // 如果没有数据或隐藏缩略图，返回占位元素而不是null
    if (fileLines.length === 0) {
      return (
        <div className="absolute right-0 top-0 w-16 h-full bg-gray-100 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700" />
      )
    }

    // 使用与指示框一致的实际容器高度进行缩放，避免与指示框不匹配
    const rectH = containerRectRef.current?.height
      ?? (scrollContainerRef.current?.clientHeight ?? containerHeight)
    const thumbnailHeight = Math.max(1, rectH)
    // 比例可内联计算，无需单独变量

    // 计算可见区域在缩略图中的位置
    // 可见位置与高度改由 rAF 写者通过 CSS 变量与 rect 统一写入
    

    // 处理缩略图点击和拖拽
    // 点击支持：在拖拽逻辑中按阈值判定为点击

    // 处理缩略图拖拽
    const handleThumbnailMouseDown = (event: React.MouseEvent) => {
      if (!scrollContainerRef.current) return
      
      const rect = (thumbnailContainerRef.current ?? (event.currentTarget as HTMLElement)).getBoundingClientRect()
      setIsDragging(true)
      
      let finalScrollTop = 0 // 保存最终滚动位置
      const startY = event.clientY
      let moved = false

      // 计算点击位置对应的 scrollTop，并立即跳转（首帧即到位）
      {
        const thumbnailHeight = rect.height
        const totalContentPx = Math.max(1, fileLines.length * itemHeight)
        const viewportPx = scrollContainerRef.current?.clientHeight ?? containerHeight
        const indicatorHeightPx = Math.min(
          thumbnailHeight,
          Math.max(4, Math.round((viewportPx / totalContentPx) * thumbnailHeight))
        )
        // 轨道高度：缩略图总高度减去蓝色可视指示块高度
        const trackHeight = Math.max(0, thumbnailHeight - indicatorHeightPx)
        const clickY = Math.max(0, Math.min(startY - rect.top, thumbnailHeight))
        // 比例映射：p = clickY / thumbnailHeight，ty = trackHeight * p
        const p0 = thumbnailHeight > 0 ? Math.min(1, Math.max(0, clickY / thumbnailHeight)) : 0
        const ty0 = trackHeight * p0
        const scrollMax = Math.max(1, totalContentPx - viewportPx)
        const jumpScrollTop = p0 * scrollMax
        console.log('缩略图 mousedown 首跳', { startY, clickY, ty: ty0, p: p0, jumpScrollTop })
        finalScrollTop = jumpScrollTop
        setDragScrollTop(jumpScrollTop)
        enqueueImmediate(jumpScrollTop)
        scrollContainerRef.current.scrollTop = jumpScrollTop
      }
      
      const handleMouseMove = (e: MouseEvent) => {
        e.preventDefault()
        const thumbnailHeight = rect.height
        const totalContentPx = Math.max(1, fileLines.length * itemHeight)
        const indicatorHeightPx = Math.min(
          thumbnailHeight,
          Math.max(4, Math.round((containerHeight / totalContentPx) * thumbnailHeight))
        )
        // 轨道高度：缩略图总高度减去蓝色可视指示块高度
        const trackHeight = Math.max(0, thumbnailHeight - indicatorHeightPx)
        const currentY = Math.max(0, Math.min(e.clientY - rect.top, thumbnailHeight))
        const p = thumbnailHeight > 0 ? Math.min(1, Math.max(0, currentY / thumbnailHeight)) : 0
        // 将代码区滚动位置映射到缩略图轨道比例 [0,1]
        const ty = trackHeight * p
        const viewportPx2 = scrollContainerRef.current?.clientHeight ?? containerHeight
        const scrollMax = Math.max(1, totalContentPx - viewportPx2)
        const newScrollTop = p * scrollMax
        
        // 保存最终滚动位置
        finalScrollTop = newScrollTop
        if (Math.abs(e.clientY - startY) > 3) moved = true
        
        // 实时更新拖拽位置状态
        setDragScrollTop(newScrollTop)
        enqueueScrollTop(newScrollTop)
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = newScrollTop
        }
        console.log('拖拽中(handleMouseMove):', { currentY, ty, p, newScrollTop, translateY: indicatorTranslateYRef.current })
      }
      
      const handleMouseUp = () => {
        
        // 若无明显移动，当作点击：用起点计算一次
        if (!moved) {
          const thumbnailHeight = rect.height
          const totalContentPx = Math.max(1, fileLines.length * itemHeight)
          // 计算点击比例 p（与拖拽一致），避免使用未读变量
          const clickY = Math.max(0, Math.min(startY - rect.top, thumbnailHeight))
          const p = thumbnailHeight > 0 ? Math.min(1, Math.max(0, clickY / thumbnailHeight)) : 0
          const scrollMax = Math.max(1, totalContentPx - (scrollContainerRef.current?.clientHeight ?? containerHeight))
          finalScrollTop = p * scrollMax
        }

        // 先设置最终位置，再结束拖拽状态
        setDragScrollTop(finalScrollTop)
        setCurrentScrollTop(finalScrollTop)
        enqueueScrollTop(finalScrollTop)
        
        // 延迟结束拖拽状态，确保状态更新完成
        setTimeout(() => {
          setIsDragging(false)
        }, 10)
        
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
      
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    // 统一的渲染逻辑：始终渲染所有行，但通过透明度区分
    const renderThumbnailLines = () => {
      // 仅按"更改块"绘制色条，避免未修改行造成误导
      // 总行数用于比例，但下方改为像素映射后不再需要
      const bars: Array<{ startIdx: number; endIdx: number; type: FileLine['type']; changeIndex?: number }> = []
      let i = 0
      while (i < fileLines.length) {
        const line = fileLines[i]
        // 只对新增/删除绘制色条；忽略 modified
        const isChanged = line.type === 'added' || line.type === 'deleted'
        if (!isChanged) {
          i++
          continue
        }
        const start = i
        const thisChangeIndex = line.changeIndex
        // 合并连续的同类型更改行（在同一个 changeIndex 中，类型变化即另起一个色块）
        const thisType = line.type // 'added' | 'deleted'
        while (
          i + 1 < fileLines.length &&
          (fileLines[i + 1].type === thisType) &&
          fileLines[i + 1].changeIndex === thisChangeIndex
        ) { i++ }
        const end = i
        bars.push({ startIdx: start, endIdx: end, type: thisType, changeIndex: thisChangeIndex })
        i++
      }

      // 让色块使用与指示框一致的"trackHeight"坐标系，确保对齐
      const viewportPx = scrollContainerRef.current?.clientHeight ?? containerHeight
      const totalContentPx = Math.max(1, fileLines.length * itemHeight)
      const indicatorHeightPx = Math.min(
        thumbnailHeight,
        Math.max(4, Math.round((viewportPx / totalContentPx) * thumbnailHeight))
      )
      // 彩色条可活动的轨道高度
      // const trackHeight = Math.max(0, thumbnailHeight - indicatorHeightPx)
      const trackHeight = Math.max(0, thumbnailHeight )
      const scrollMax = Math.max(1, totalContentPx - viewportPx)

      return bars.map((bar, idx) => {
        // 更改块行数
        const linesCount = (bar.endIdx - bar.startIdx + 1)
        // 代码区：更改块起点（像素）= 起始索引 × 行高
        const startTopPx = bar.startIdx * itemHeight
        // 代码区：更改块高度（像素）
        const blockHeightPx = Math.max(itemHeight, linesCount * itemHeight)
        // 视觉偏置：将彩色条略微下移半行
        const lineBiasPx = itemHeight * 0.5
        // 起点校正：末尾贴底，否则减去偏置并做下界保护
        const adjustedStartPx = startTopPx >= scrollMax
          ? scrollMax
          : Math.max(0, startTopPx - lineBiasPx)
        // top 映射：把代码区起点按比例压缩到缩略图轨道
        const top = trackHeight * Math.min(1, Math.max(0, adjustedStartPx / scrollMax))
        //log
        // console.log('[Thumbnail] renderThumbnailLines', { idx, type: bar.type, changeIndex: bar.changeIndex, startTopPx, adjustedStartPx, scrollMax, trackHeight })
        // 高度映射：把代码区块高度按比例压缩到轨道，并保证最小 2px 可见
        const height = Math.max(2, trackHeight * Math.min(1, blockHeightPx / scrollMax))
        const cls = bar.type === 'added'
          ? 'bg-green-300 dark:bg-green-600'
          : bar.type === 'deleted'
          ? 'bg-red-300 dark:bg-red-600'
          : 'bg-orange-300 dark:bg-orange-600'
        const isCurrent = bar.changeIndex === currentChangeIndex
        return (
          <div
            key={idx}
            className={`absolute z-0 w-full gitlite-thumb-bar ${cls} ${isCurrent ? 'ring-1 ring-blue-400' : ''}`}
            data-bar-idx={idx}
            style={{ top: `${top}px`, height: `${height}px`, opacity: 1 }}
            title={`更改块 ${String(bar.changeIndex ?? '')}`}
          />
        )
      })
    }

    return (
      <>
      <div 
        ref={thumbnailContainerRef}
        className={`absolute right-0 top-0 w-16 h-full bg-gray-100 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 overflow-hidden select-none transition-opacity duration-200 gitlite-thumb-container ${
           showThumbnail ? 'opacity-100 cursor-pointer' : 'opacity-0 pointer-events-none'
         }`}
         onClick={undefined}
         onMouseDown={showThumbnail ? handleThumbnailMouseDown : undefined}
         title={showThumbnail ? "点击或拖拽跳转到对应位置" : undefined}
       >
         {/* 调试面板移至全局 portal，避免与缩略图重合（按钮已移除） */}
         {/* 缩略图内容 */}
         <div ref={thumbnailInnerRef} className="relative w-full gitlite-thumb-inner" style={{ height: `${Math.max(thumbnailHeight, 1)}px` }}>
           {renderThumbnailLines()}
           
           {/* 内部指示框已移除，改为使用 fixed portal */}
         </div>
       </div>
       {/* indicator 由自管控 DOM 挂载到 body，不再通过 createPortal 渲染 */}
       {debugEnabled && createPortal(
         <div
           ref={debugPortalRef}
           className="fixed z-[10000] pointer-events-none text-[10px] leading-[1.1] p-1 rounded bg-white/90 dark:bg-black/60 text-gray-800 dark:text-gray-200 shadow"
           style={{ maxWidth: '16rem' }}
         />,
         document.body
       )}
       </>
     )
   }

  const renderUnifiedView = () => {
    // 统一的渲染逻辑，避免闪烁
    const renderLine = (line: FileLine, index: number) => (
      <div 
        key={index}
        data-line-number={line.lineNumber}
        className={`px-4 py-1 flex items-start gap-4 transition-all duration-200 ${
          line.type === 'added' ? 'bg-green-50 border-l-4 border-green-500 dark:bg-green-900/20 dark:border-green-400' :
          line.type === 'deleted' ? 'bg-red-50 border-l-4 border-red-500 dark:bg-red-900/20 dark:border-red-400' :
          line.type === 'modified' ? 'bg-orange-50 border-l-4 border-orange-500 dark:bg-orange-900/20 dark:border-orange-400' :
          'bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800'
        }`}
        style={{ height: itemHeight }}
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
        <div className="flex-1 min-w-0" style={{ whiteSpace: 'pre' }}>
          {line.segments ? (
            // 显示字符级别的差异
            <div className="inline">
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
          ) : (
            // 普通行内容显示 - 使用语法高亮
            <SimpleSyntaxHighlighter
              code={line.content || ' '}
              language={getLanguageFromPath(filePath)}
              className="inline-block"
            />
          )}
        </div>
      </div>
    )

    // 对于大文件使用虚拟滚动
    if (fileLines.length > 1000) {
      const visibleLines = fileLines.slice(visibleRange.start, visibleRange.end)
      const totalHeight = fileLines.length * itemHeight
      const offsetY = visibleRange.start * itemHeight
      
      return (
        <div className="font-mono text-sm relative" style={{ height: totalHeight }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleLines.map((line, index) => {
              const actualIndex = visibleRange.start + index
              return renderLine(line, actualIndex)
            })}
          </div>
        </div>
      )
    }
    
    // 对于小文件使用普通渲染
    return (
      <div className="font-mono text-sm">
        {fileLines.map((line, index) => renderLine(line, index))}
      </div>
    )
  }

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
            return (
              <div key={index} className="contents">
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
                  <div className="flex-1 min-w-0 text-red-800 dark:text-red-200" style={{ whiteSpace: 'pre' }}>
                    {item.type === 'modified' && item.originalLine?.segments ? (
                      <Tooltip
                        content={
                          <div className="space-y-2">
                            <div className="text-red-300 text-xs font-semibold">原始代码:</div>
                            <div className="bg-red-900/30 p-2 rounded font-mono text-xs break-all">
                              <SimpleSyntaxHighlighter
                                code={item.originalLine.segments.filter(s => s.type === 'deleted' || s.type === 'unchanged').map(s => s.content).join('')}
                                language={getLanguageFromPath(filePath)}
                                className="inline-block"
                              />
                            </div>
                            <div className="text-green-300 text-xs font-semibold">修改后:</div>
                            <div className="bg-green-900/30 p-2 rounded font-mono text-xs break-all">
                              <SimpleSyntaxHighlighter
                                code={item.originalLine.segments.filter(s => s.type === 'added' || s.type === 'unchanged').map(s => s.content).join('')}
                                language={getLanguageFromPath(filePath)}
                                className="inline-block"
                              />
                            </div>
                          </div>
                        }
                        position="top"
                      >
                        <span className="cursor-help">
                          <SimpleSyntaxHighlighter
                            code={item.leftLine?.content || ' '}
                            language={getLanguageFromPath(filePath)}
                            className="inline-block"
                          />
                        </span>
                      </Tooltip>
                    ) : (
                      <SimpleSyntaxHighlighter
                        code={item.leftLine?.content || ' '}
                        language={getLanguageFromPath(filePath)}
                        className="inline-block"
                      />
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
                  <div className="flex-1 min-w-0 text-green-800 dark:text-green-200" style={{ whiteSpace: 'pre' }}>
                    {item.type === 'modified' && item.originalLine?.segments ? (
                      <Tooltip
                        content={
                          <div className="space-y-2">
                            <div className="text-red-300 text-xs font-semibold">原始代码:</div>
                            <div className="bg-red-900/30 p-2 rounded font-mono text-xs break-all">
                              <SimpleSyntaxHighlighter
                                code={item.originalLine.segments.filter(s => s.type === 'deleted' || s.type === 'unchanged').map(s => s.content).join('')}
                                language={getLanguageFromPath(filePath)}
                                className="inline-block"
                              />
                            </div>
                            <div className="text-green-300 text-xs font-semibold">修改后:</div>
                            <div className="bg-green-900/30 p-2 rounded font-mono text-xs break-all">
                              <SimpleSyntaxHighlighter
                                code={item.originalLine.segments.filter(s => s.type === 'added' || s.type === 'unchanged').map(s => s.content).join('')}
                                language={getLanguageFromPath(filePath)}
                                className="inline-block"
                              />
                            </div>
                          </div>
                        }
                        position="top"
                      >
                        <span className="cursor-help">
                          <SimpleSyntaxHighlighter
                            code={item.rightLine?.content || ' '}
                            language={getLanguageFromPath(filePath)}
                            className="inline-block"
                          />
                        </span>
                      </Tooltip>
                    ) : (
                      <SimpleSyntaxHighlighter
                        code={item.rightLine?.content || ' '}
                        language={getLanguageFromPath(filePath)}
                        className="inline-block"
                      />
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
          
          {/* 打印关键尺寸信息 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // 读取真实 DOM：缩略图高度
              const thumbEl = document.querySelector('.gitlite-thumb-container') as HTMLElement | null
              const thumbRectH = thumbEl?.getBoundingClientRect().height ?? 0
              // 读取真实 DOM：指示块 CSS 变量（高度与位移）
              const indicator = (document.querySelector('.gitlite-indicator') as HTMLElement) || null
              const computed = indicator ? getComputedStyle(indicator) : null
              const indicatorHVar = computed ? computed.getPropertyValue('--indicator-h').trim() : ''
              const indicatorTyVar = computed ? computed.getPropertyValue('--indicator-ty').trim() : ''
              const indicatorH = indicatorHVar ? parseFloat(indicatorHVar) : null
              const indicatorTy = indicatorTyVar ? parseFloat(indicatorTyVar) : null

              // 读取真实 DOM：每个彩色条的 top/height
              const barNodes = document.querySelectorAll('.gitlite-thumb-inner .gitlite-thumb-bar') as NodeListOf<HTMLElement>
              const bars = Array.from(barNodes).map((node) => {
                const idxAttr = node.getAttribute('data-bar-idx') || ''
                const idx = idxAttr ? parseInt(idxAttr) : null
                const style = getComputedStyle(node)
                const topPx = parseFloat(style.top || node.style.top || '0')
                const heightPx = parseFloat(style.height || node.style.height || `${node.offsetHeight}`)
                return { idx, top: Math.round(topPx), height: Math.round(heightPx) }
              })

              console.log('[ThumbnailReal]', {
                thumbnailHeight: Math.round(thumbRectH),
                indicatorH,
                indicatorTy,
                bars
              })
            }}
            className="flex items-center gap-2 text-xs"
            title="打印真实缩略图高度、指示块与彩色条位置"
          >
            📏 打印信息
          </Button>
          
          {/* 缩略图切换按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowThumbnail(!showThumbnail)}
            className="flex items-center gap-2 text-xs"
            title={showThumbnail ? "隐藏缩略图" : "显示缩略图"}
          >
            {showThumbnail ? "📊" : "📈"}
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
        <div className="relative max-h-96 overflow-hidden">
          <div 
            ref={scrollContainerRef} 
            className={`overflow-y-auto ${showThumbnail ? 'pr-16' : ''}`}
            style={{ height: '384px' }}
          >
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground">
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                  正在加载差异内容...
                </div>
              </div>
            ) : fileLines.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">
                没有差异内容
              </div>
            ) : (
              viewMode === 'side-by-side' ? renderSideBySideView() : renderUnifiedView()
            )}
          </div>
          
          {/* 缩略图滚动条 */}
          <ThumbnailScrollbar />
        </div>
      )}
    </div>
  )
}

