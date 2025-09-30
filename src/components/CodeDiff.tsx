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
  // 新增：用于测量外层容器高度，避免用自身 clientHeight 造成递减
  const outerContainerRef = useRef<HTMLDivElement>(null)
  
  // 虚拟滚动相关状态
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 })
  const [itemHeight] = useState(24) // 每行的高度（像素）
  const [containerHeight, setContainerHeight] = useState(384) // 容器高度（初始与旧值保持一致，后续由实际测量更新）
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

  // 使用 document 级别监听器处理缩略图滚轮
  useEffect(() => {
    if (!showThumbnail) return
    
    const handleDocumentWheel = (e: WheelEvent) => {
      // 检查鼠标是否在缩略图区域内
      const thumbnailEl = document.querySelector('.gitlite-thumb-container') as HTMLElement
      if (!thumbnailEl) return
      
      const rect = thumbnailEl.getBoundingClientRect()
      const x = e.clientX
      const y = e.clientY
      
      // 检查鼠标是否在缩略图区域内
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        console.log('[Document wheel in thumb]', e.deltaY)
        e.preventDefault()
        e.stopPropagation()
        
        const sc = scrollContainerRef.current
        if (!sc) return
        
        const totalContentPx = Math.max(1, fileLines.length * itemHeight)
        const viewportPx = sc.clientHeight || containerHeight
        const scrollMax = Math.max(1, totalContentPx - viewportPx)
        const containerH = rect.height
        const ratio = scrollMax / Math.max(1, containerH)
        const next = Math.max(0, Math.min(scrollMax, sc.scrollTop + e.deltaY * ratio))
        sc.scrollTop = next
        
        // 更新可见范围
        updateVisibleRange()
      }
    }
    
    document.addEventListener('wheel', handleDocumentWheel, { passive: false, capture: true })
    return () => document.removeEventListener('wheel', handleDocumentWheel, { capture: true })
  }, [showThumbnail, fileLines.length, itemHeight, containerHeight, updateVisibleRange])

  // 防止滚动事件冒泡到主界面，并处理虚拟滚动
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const handleWheel = (e: WheelEvent) => {
      // 临时完全禁用 wheel 拦截，让所有事件正常冒泡
      // 检查事件是否来自缩略图区域
      const target = e.target as HTMLElement
      if (target.closest('.gitlite-thumb-container')) {
        // 如果事件来自缩略图，不拦截，让缩略图自己处理
        return
      }
      
      // 对于其他区域，也暂时不拦截，让原生滚动工作
      // e.stopPropagation()
      // e.preventDefault()
      
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
      // 改为测量外层容器高度，避免“用自身高度写回”导致的累计缩小
      const outer = outerContainerRef.current
      if (outer) {
        const height = outer.clientHeight
        setContainerHeight(height)
      }
    }

    updateContainerHeight()
    window.addEventListener('resize', updateContainerHeight)
    
    return () => {
      window.removeEventListener('resize', updateContainerHeight)
    }
  }, [])

  

  useEffect(() => {
    
    if (diff) {
      setIsLoading(true) // 开始加载
      
      const parsedLines = parseDiffToFullFile(diff)
      
      // 为更改行添加索引
      const linesWithChangeIndex = addChangeIndices(parsedLines)
      
      // 计算更改块数量
      const uniqueChangeIndices = new Set(
        linesWithChangeIndex
          .filter(line => line.changeIndex !== undefined)
          .map(line => line.changeIndex)
      )
      const newChangeCount = uniqueChangeIndices.size
      
      
      
      // 批量更新状态，避免多次渲染
      const updateStates = (finalLines: FileLine[]) => {
        // 打印最终差异行信息（精简表 + 完整对象，便于排查）
        try {
          const preview = finalLines.slice(0, 50).map(l => ({
            lineNumber: l.lineNumber,
            oldLineNumber: l.oldLineNumber,
            type: l.type,
            content: (l.content ?? '').slice(0, 120),
            changeIndex: l.changeIndex
          }))
        } catch {}
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
          behavior: 'instant'
        })
        
        // 更新可见范围以确保目标行被渲染
        setTimeout(() => {
          const start = Math.max(0, targetLineIndex - 10)
          const end = Math.min(lines.length, targetLineIndex + 30)
          setVisibleRange({ start, end })
        }, 10)
      }, 10)
    }
  }

  const fillUnchangedLines = async (lines: FileLine[], filePath: string, repoPath: string): Promise<FileLine[]> => {
    try {
      // 关键日志：开始补全文件
      const { invoke } = await import('@tauri-apps/api/tauri')
      const fileContent = await invoke('get_file_content', {
        repoPath,
        filePath
      }) as string
      
      // 关键日志：拿到文件内容
      
      const fileContentLines = fileContent.split('\n')
      
      
      // 创建diff行的映射表，支持同一行号的多个diff行
      const diffLinesMap = new Map<number, FileLine[]>()
      lines.forEach(line => {
        if (!diffLinesMap.has(line.lineNumber)) {
          diffLinesMap.set(line.lineNumber, [])
        }
        diffLinesMap.get(line.lineNumber)!.push(line)
      })
      
      
      
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
      
      
      // 检查第一行的处理结果
      const firstLines = fullFileLines.filter(line => line.lineNumber === 1)
      
      
      // 重新为完整文件行添加更改索引
      const fullFileLinesWithIndex = addChangeIndices(fullFileLines)
      
      // 返回处理后的行数据，而不是直接设置状态
      return fullFileLinesWithIndex
    } catch (err) {
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
      const targetLineIndex = firstChangeLine.lineNumber - 1 // 转换为0基索引
      
      // 计算目标位置
      const targetScrollTop = targetLineIndex * itemHeight
      
      
      
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
    // 预扫描：统计以 + / - / 空格 开头的行数，帮助确定根因
    try {
      const plusCnt = lines.filter(l => l.startsWith('+')).length
      const minusCnt = lines.filter(l => l.startsWith('-')).length
      const spaceCnt = lines.filter(l => l.startsWith(' ')).length
      const atCnt = lines.filter(l => l.startsWith('@@')).length
    } catch {}
    const fileLines: FileLine[] = []
    let currentLineNumber = 1
    let oldLineNumber = 1
    let inHunk = false

    // 仅保留必要日志


    

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (i < 30) {
        const ch0 = line.length ? line[0] : ''
        const code0 = line.length ? line.charCodeAt(0) : -1
      }
      // 规范化：去掉行首零宽字符/BOM与制表符以便识别 hunk/header；内容行仍使用原始字符处理
      const head = line.replace(/^\uFEFF/, '').replace(/^\u200B+/, '').replace(/^\r/, '')
      const t = head.trimStart()
      
      if (i < 10) { // 只打印前10行的处理过程
        console.log(`🔍 处理第${i}行:`, { 
          line: line.substring(0, 50),
          startsWithDiff: line.startsWith('diff --git'),
          startsWithAt: line.startsWith('@@'),
          startsWithPlus: line.startsWith('+'),
          startsWithMinus: line.startsWith('-'),
          startsWithSpace: line.startsWith(' ')
        })
      }
      
      if (t.startsWith('diff --git')) {
        // header
        // 重置状态
        currentLineNumber = 1
        oldLineNumber = 1
        inHunk = false
        
        continue
      } else if (t.startsWith('index ') || t.startsWith('---') || t.startsWith('+++')) {
        // 跳过这些header行
        // skip header
        continue
      } else if (t.startsWith('@@')) {
        // 解析hunk header获取起始行号
        const match = t.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/)
        if (match) {
          const hunkNewStart = parseInt(match[2])
          
          
          // 直接设置当前行号为hunk起始行号，不创建空行
          currentLineNumber = hunkNewStart
          oldLineNumber = parseInt(match[1])
          inHunk = true
          // 额外：探测此 hunk 后面的若干行的首字符与编码
          try {
            const probe: Array<{i: number; ch: string; code: number; s: string}> = []
            for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
              const lj = lines[j]
              probe.push({ i: j, ch: lj[0] || '', code: lj.length ? lj.charCodeAt(0) : -1, s: lj.slice(0, 80) })
            }
            console.table(probe)
          } catch {}
          
        }
      } else if (inHunk) {
        // 使用规范化首字符判断（去除可能的 BOM/零宽字符）
        const normalized = line.replace(/^\uFEFF|^\u200B+/, '')
        const ch = normalized.charAt(0)
        if (ch === '+') {
          // 新增的行
          const content = normalized.substring(1)
          
          fileLines.push({
            lineNumber: currentLineNumber,
            content,
            type: 'added'
          })
          currentLineNumber++
        } else if (ch === '-') {
          // 删除的行
          const content = normalized.substring(1)
          
          fileLines.push({
            lineNumber: currentLineNumber,
            content,
            type: 'deleted',
            oldLineNumber: oldLineNumber
          })
          // 删除行不增加 currentLineNumber，但增加 oldLineNumber
          oldLineNumber++
        } else if (ch === ' ') {
          // 未修改的行
          const content = normalized.substring(1)
          
          fileLines.push({
            lineNumber: currentLineNumber,
            content,
            type: 'unchanged',
            oldLineNumber: oldLineNumber
          })
          currentLineNumber++
          oldLineNumber++
        } else if (normalized.trim() === '') {
          // 空行，跳过
          
          continue
        } else if (normalized.trim() === '\\ No newline at end of file') {
          // Git diff 特殊标记：文件末尾无换行符。应忽略且保持在 hunk 模式，
          // 否则后续的 + 行可能会被错误地丢弃。
          
          continue
        } else {
          // 其他行，可能是hunk结束或其他内容
          
          inHunk = false
        }
      } else {
        
      }
    }
    
    // 统计各类型行数
    // 统计行数（如需调试可启用）
    // const addedCount = fileLines.filter(l => l.type === 'added').length
    // const deletedCount = fileLines.filter(l => l.type === 'deleted').length
    // const unchangedCount = fileLines.filter(l => l.type === 'unchanged').length
    
    
    // 后处理：检测空白字符的变化
    const processedLines = detectWhitespaceChanges(fileLines)
    

    
    // 特别检查第一行的处理结果
    // const firstLines = processedLines.filter(line => line.lineNumber === 1)
    
    return processedLines
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(diff)
    } catch (err) {
      
    }
  }

  // 缩略图组件 - 使用稳定的渲染逻辑避免闪烁
  const ThumbnailScrollbar = () => {
    // 使用稳定的状态，避免重新挂载
    const [currentScrollTop, setCurrentScrollTop] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const [dragScrollTop, setDragScrollTop] = useState(0)
    
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
    
    // 纯函数：将代码区像素(startTopPx, blockHeightPx)映射到缩略图轨道(trackHeight)
    // 保证：
    // - heightPx >= 2
    // - 0 <= topPx <= trackHeight - heightPx
    // - 若 endPx >= scrollMax 则 topPx + heightPx == trackHeight（贴底）
    const calculateBarPosition = (
      containerHeight: number,
      totalContentPx: number,
      startTopPx: number,
      blockHeightPx: number,
      minHeightPx: number = 2
    ): { topPx: number; heightPx: number } => {
      const safeContainer = Math.max(0, containerHeight)
      const safeTotal = Math.max(1, totalContentPx)
      const startClamped = Math.max(0, Math.min(safeTotal, startTopPx))
      const endClamped = Math.max(0, Math.min(safeTotal, startTopPx + blockHeightPx))

      // 按“文件总像素”精确映射到轨道
      const startRatio = startClamped / safeTotal
      const endRatio = endClamped / safeTotal

      const topFloat = safeContainer * startRatio
      const bottomFloat = safeContainer * endRatio

      // 取整策略：顶部向下取整，底部向上取整，确保覆盖区间且不丢失
      let topPx = Math.max(0, Math.min(safeContainer, Math.floor(topFloat)))
      let bottomPx = Math.max(0, Math.min(safeContainer, Math.ceil(bottomFloat)))

      if (bottomPx <= topPx) {
        bottomPx = Math.min(safeContainer, topPx + minHeightPx)
      }
      let heightPx = bottomPx - topPx
      if (heightPx < minHeightPx) {
        heightPx = minHeightPx
        topPx = Math.max(0, Math.min(safeContainer - heightPx, topPx))
      }

      if (topPx + heightPx > safeContainer) {
        topPx = Math.max(0, safeContainer - heightPx)
      }

      return { topPx, heightPx }
    }

    const lastValidRectRef = useRef<DOMRect | null>(null)
    // 映射参数快照：用于避免不同帧造成的偏差（供调试与渲染一致复算）
    
    
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
      // 指示块的 fixed 基准 top，确保指示块不超出缩略图底部
      const topBase = rect.top
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

    

    // 自管控的 portal 元素，避免 React 重建导致样式丢失
    useEffect(() => {
      const el = document.createElement('div')
      el.className = 'gitlite-indicator'
      document.body.appendChild(el)
      ;(indicatorPortalRef as React.MutableRefObject<HTMLDivElement | null>).current = el
      indicatorElRef.current = el
      
      // 确保有正确的容器测量后再写入
      const ensureRectAndWrite = () => {
        const thumbnailEl = thumbnailContainerRef.current
        if (thumbnailEl) {
          const rect = thumbnailEl.getBoundingClientRect()
          if (rect.height > 2 && rect.width > 0) {
            containerRectRef.current = rect
            lastValidRectRef.current = rect
            requestWrite()
            return
          }
        }
        // 如果还没有正确的测量，延迟重试
        setTimeout(ensureRectAndWrite, 16)
      }
      ensureRectAndWrite()
      
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

      // 缩略图滚轮 => 驱动代码滚动（阻止默认以免影响页面）
    useEffect(() => {
      const el = thumbnailContainerRef.current
      const sc = scrollContainerRef.current
      if (!el || !sc) return
      const onWheel = (e: WheelEvent) => {
        // 仅在缩略图区域拦截
        e.preventDefault()
        e.stopPropagation()
        const totalContentPx = Math.max(1, fileLines.length * itemHeight)
        const viewportPx = sc.clientHeight || containerHeight
        const scrollMax = Math.max(1, totalContentPx - viewportPx)
        const containerH = containerRectRef.current?.height ?? el.getBoundingClientRect().height
        const ratio = scrollMax / Math.max(1, containerH)
        const next = Math.max(0, Math.min(scrollMax, sc.scrollTop + e.deltaY * ratio))
        sc.scrollTop = next
        enqueueScrollTop(next)
        setCurrentScrollTop(next)
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      return () => el.removeEventListener('wheel', onWheel as any)
    }, [fileLines.length, itemHeight, containerHeight])

    

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
    // 使用实际容器高度，避免硬编码导致色块比例失真
    // const rectH = containerRectRef.current?.height?? (scrollContainerRef.current?.clientHeight ?? containerHeight)
    const thumbnailHeight = containerHeight
    


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

    const handleThumbnailWheel = (e: React.WheelEvent) => {
      const sc = scrollContainerRef.current
      const el = thumbnailContainerRef.current
      if (!sc || !el) return
      e.preventDefault()
      e.stopPropagation()
      const totalContentPx = Math.max(1, fileLines.length * itemHeight)
      const viewportPx = sc.clientHeight || containerHeight
      const scrollMax = Math.max(1, totalContentPx - viewportPx)
      const containerH = containerRectRef.current?.height ?? el.getBoundingClientRect().height
      const ratio = scrollMax / Math.max(1, containerH)
      const next = Math.max(0, Math.min(scrollMax, sc.scrollTop + e.deltaY * ratio))
      sc.scrollTop = next
      enqueueScrollTop(next)
      setCurrentScrollTop(next)
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
      const trackHeight = Math.max(0, thumbnailHeight - indicatorHeightPx)
      const scrollMax = Math.max(1, totalContentPx - viewportPx)

      const barRecords = bars.map((bar, idx) => {
        // 更改块行数
        const linesCount = (bar.endIdx - bar.startIdx + 1)
        // 代码区：更改块起点（像素）= 起始索引 × 行高
        const startTopPx = bar.startIdx * itemHeight
        // 代码区：更改块高度（像素）
        const blockHeightPx = Math.max(itemHeight, linesCount * itemHeight)
        const isLastBlock = (idx === bars.length - 1)
        const { topPx, heightPx } = calculateBarPosition(
          thumbnailHeight,
          totalContentPx,
          startTopPx,
          blockHeightPx,
          2
        )
       
        return { idx, type: bar.type, changeIndex: bar.changeIndex, topPx, heightPx }
      })

      // 处理重叠：允许1px内的区间交叠也并排显示（覆盖你提供的案例：top 0/1 高度2/3）
      const overlapTolerance = 1 // px
      const hasOverlapOpposite = (a: any) => {
        const aTop = a.topPx
        const aBottom = a.topPx + a.heightPx
        return barRecords.some(b =>
          b !== a && b.type !== a.type && (
            // 同 changeIndex 优先判定；若缺失也允许像素区间交叠
            (b.changeIndex === a.changeIndex && (
              Math.max(aTop, b.topPx) < Math.min(aBottom, b.topPx + b.heightPx)
            )) || (
              Math.max(aTop, b.topPx) - Math.min(aBottom, b.topPx + b.heightPx) < overlapTolerance
            )
          )
        )
      }
      const elements = barRecords.map((rec) => {
        const overlapOpposite = hasOverlapOpposite(rec)
        const cls = rec.type === 'added'
          ? 'bg-green-300 dark:bg-green-600'
          : 'bg-red-300 dark:bg-red-600'
        const isCurrent = rec.changeIndex === currentChangeIndex
        const width = overlapOpposite ? '50%' : '100%'
        const left = overlapOpposite ? (rec.type === 'deleted' ? '0' : '50%') : '0'
        return (
          <div
            key={rec.idx}
            className={`absolute z-0 gitlite-thumb-bar ${cls} ${isCurrent ? 'ring-1 ring-blue-400' : ''}`}
            data-bar-idx={rec.idx}
            style={{ top: `${rec.topPx}px`, height: `${rec.heightPx}px`, width, left, opacity: 1 }}
            title={`更改块 ${String(rec.changeIndex ?? '')}`}
          />
        )
      })

      return elements
    }

    

    return (
      <>
        <div 
        ref={thumbnailContainerRef}
        className={`absolute right-0 top-0 w-16 h-full bg-gray-100 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 overflow-visible select-none transition-opacity duration-200 gitlite-thumb-container ${
           showThumbnail ? 'opacity-100 cursor-pointer' : 'opacity-0 pointer-events-none'
         }`}
        style={{ zIndex: 1, overscrollBehavior: 'contain' as any, WebkitOverflowScrolling: 'auto' as any }}
         onClick={undefined}
         onMouseDown={showThumbnail ? handleThumbnailMouseDown : undefined}
         onWheel={(e) => {
           console.log('[React onWheel]', e.deltaY)
           e.preventDefault()
           e.stopPropagation()
           const sc = scrollContainerRef.current
           if (!sc) return
           const totalContentPx = Math.max(1, fileLines.length * itemHeight)
           const viewportPx = sc.clientHeight || containerHeight
           const scrollMax = Math.max(1, totalContentPx - viewportPx)
           const containerH = containerRectRef.current?.height ?? thumbnailContainerRef.current?.getBoundingClientRect().height ?? 0
           const ratio = scrollMax / Math.max(1, containerH)
           const next = Math.max(0, Math.min(scrollMax, sc.scrollTop + e.deltaY * ratio))
           sc.scrollTop = next
           enqueueScrollTop(next)
           setCurrentScrollTop(next)
         }}
         title={showThumbnail ? "点击或拖拽跳转到对应位置" : undefined}
       >
        {/* 调试开关按钮（不影响布局） */}
        {/* 移除缩略图内按钮，避免难以点击。调试入口统一放到工具栏。 */}
         {/* 调试面板移至全局 portal，避免与缩略图重合（按钮已移除） */}
         {/* 缩略图内容 */}
        <div
          ref={thumbnailInnerRef}
          className="relative w-full gitlite-thumb-inner"
          style={{ height: `${Math.max(thumbnailHeight, 1)}px` }}
          onWheel={showThumbnail ? handleThumbnailWheel : undefined}
        >
           {renderThumbnailLines()}
           
           {/* 内部指示框已移除，改为使用 fixed portal */}
         </div>
       </div>
      
       </>
     )
   }

  const renderUnifiedView = () => {
    // 统一的渲染逻辑，避免闪烁
    const renderLine = (line: FileLine, index: number) => (
      <div 
        key={index}
        data-line-number={line.lineNumber}
        className={`px-4 py-1 flex items-start transition-all duration-200 ${
          line.type === 'added' ? 'bg-green-50 border-l-4 border-green-500 dark:bg-green-900/20 dark:border-green-400' :
          line.type === 'deleted' ? 'bg-red-50 border-l-4 border-red-500 dark:bg-red-900/20 dark:border-red-400' :
          line.type === 'modified' ? 'bg-orange-50 border-l-4 border-orange-500 dark:bg-orange-900/20 dark:border-orange-400' :
          'bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800'
        } ${showThumbnail ? '-mr-16' : ''}`}
        style={{ height: itemHeight, zIndex: 2 }}
      >
        {/* Line Number */}
        <div className="text-xs text-gray-500 dark:text-gray-400 w-12 text-right flex-shrink-0 mr-4">
          {line.lineNumber}
        </div>
        
        {/* Line Icon */}
        <div className="w-4 flex-shrink-0 text-center mr-4">
          {line.type === 'added' && <span className="text-green-600 dark:text-green-400 font-bold">+</span>}
          {line.type === 'deleted' && <span className="text-red-600 dark:text-red-400 font-bold">-</span>}
          {line.type === 'modified' && <span className="text-orange-600 dark:text-orange-400 font-bold">~</span>}
          {line.type === 'unchanged' && <span className="text-gray-400 dark:text-gray-500"> </span>}
        </div>
        
        {/* Line Content */}
        <div className="flex-1 min-w-0 w-full text-foreground" style={{ whiteSpace: 'pre' }}>
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
        <div className="font-mono text-sm relative" style={{ height: totalHeight, width: 'max-content' ,padding: '0 16px'  }}>  
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
                <div className={`px-4 py-1 flex items-start ${
                  item.type === 'deleted' ? 'bg-red-50 border-l-4 border-red-500 dark:bg-red-900/20 dark:border-red-400' :
                  item.type === 'modified' ? 'bg-red-50 border-l-4 border-red-500 dark:bg-red-900/20 dark:border-red-400' :
                  'bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800'
                } border-r border-gray-200 dark:border-gray-700 ${showThumbnail ? '-mr-16' : ''}`}
                style={{ zIndex: 2 }}>
                  <div className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right flex-shrink-0 mr-2">
                    {item.leftLine?.oldLineNumber || item.leftLine?.lineNumber || ''}
                  </div>
                  <div className="w-4 flex-shrink-0 text-center mr-2">
                    {item.type === 'deleted' && <span className="text-red-600 dark:text-red-400 font-bold">-</span>}
                    {item.type === 'modified' && <span className="text-red-600 dark:text-red-400 font-bold">-</span>}
                    {item.type === 'unchanged' && <span className="text-gray-400 dark:text-gray-500"> </span>}
                  </div>
                  <div className="flex-1 min-w-0 w-full text-red-800 dark:text-red-200" style={{ whiteSpace: 'pre' }}>
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
                <div className={`px-4 py-1 flex items-start ${
                  item.type === 'added' ? 'bg-green-50 border-l-4 border-green-500 dark:bg-green-900/20 dark:border-green-400' :
                  item.type === 'modified' ? 'bg-green-50 border-l-4 border-green-500 dark:bg-green-900/20 dark:border-green-400' :
                  'bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800'
                } ${showThumbnail ? '-mr-16' : ''}`}
                style={{ zIndex: 2 }}>
                  <div className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right flex-shrink-0 mr-2">
                    {item.rightLine?.lineNumber || ''}
                  </div>
                  <div className="w-4 flex-shrink-0 text-center mr-2">
                    {item.type === 'added' && <span className="text-green-600 dark:text-green-400 font-bold">+</span>}
                    {item.type === 'modified' && <span className="text-green-600 dark:text-green-400 font-bold">+</span>}
                    {item.type === 'unchanged' && <span className="text-gray-400 dark:text-gray-500"> </span>}
                  </div>
                  <div className="flex-1 min-w-0 w-full text-green-800 dark:text-green-200" style={{ whiteSpace: 'pre' }}>
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
            onClick={copyToClipboard}
            className="flex items-center gap-2"
          >
            <Copy className="h-4 w-4" />
            复制
          </Button>
          
          

          {/* 打印关键尺寸信息 */}
          
          
          
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
        <div ref={outerContainerRef} className="relative max-h-96 overflow-visible">
          <div 
            ref={scrollContainerRef} 
            className={`overflow-y-auto bg-white dark:bg-gray-900`}
            style={{ height: `${containerHeight}px` }}
          >
            {(() => {
              if (isLoading) {
                return (
                  <div className="p-4 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                      正在加载差异内容...
                    </div>
                  </div>
                )
              } else if (fileLines.length === 0) {
                return (
                  <div className="p-4 text-center text-muted-foreground">
                    没有差异内容
                  </div>
                )
              } else {
                return viewMode === 'side-by-side' ? renderSideBySideView() : renderUnifiedView()
              }
            })()}
          </div>
          
          {/* 缩略图滚动条 */}
          <ThumbnailScrollbar />
        </div>
      )}
    </div>
  )
}

 