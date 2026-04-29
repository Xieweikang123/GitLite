import * as React from "react"
import { X } from "lucide-react"
import { cn } from "../../lib/utils"

/** 支持多个 Dialog 同时打开（如确认框叠在主弹窗上）时成对加解锁 */
let bodyScrollLockCount = 0

/** ESC 关闭栈：只有栈顶弹窗响应 ESC，避免嵌套弹窗同时关闭 */
const escapeStack: string[] = []
let escapeIdCounter = 0
/** 解锁后用 scrollTo 恢复的纵向滚动位置 */
let bodyScrollLockSavedY = 0
/** 加锁前 body 上已有的 style.paddingRight，用于解锁后还原 */
let bodyScrollLockSavedPaddingRight = ""

/**
 * 锁定背景滚动：用 fixed + 负 top 冻结当前视图画面的位置，
 * 避免仅用 overflow:hidden 时主文档滚动条消失导致视口“跳顶”。
 * 同时按滚动条宽度增加 padding-right，避免横向因滚动条消失而抖动。
 */
function lockBodyScroll() {
  bodyScrollLockCount++
  if (bodyScrollLockCount === 1) {
    bodyScrollLockSavedY = window.scrollY ?? document.documentElement.scrollTop
    bodyScrollLockSavedPaddingRight = document.body.style.paddingRight

    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth
    if (scrollbarGap > 0) {
      const pr =
        parseFloat(window.getComputedStyle(document.body).paddingRight) || 0
      document.body.style.paddingRight = `${pr + scrollbarGap}px`
    }

    document.body.style.position = "fixed"
    document.body.style.top = `-${bodyScrollLockSavedY}px`
    document.body.style.left = "0"
    document.body.style.right = "0"
    document.body.style.width = "100%"
    document.body.style.overflow = "hidden"
    document.documentElement.style.overflow = "hidden"
    document.body.style.overscrollBehavior = "none"
  }
}

function unlockBodyScroll() {
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1)
  if (bodyScrollLockCount === 0) {
    document.body.style.position = ""
    document.body.style.top = ""
    document.body.style.left = ""
    document.body.style.right = ""
    document.body.style.width = ""
    document.body.style.overflow = ""
    document.body.style.paddingRight = bodyScrollLockSavedPaddingRight
    bodyScrollLockSavedPaddingRight = ""
    document.documentElement.style.overflow = ""
    document.body.style.overscrollBehavior = ""
    window.scrollTo(0, bodyScrollLockSavedY)
  }
}

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

interface DialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode
}

const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, children }) => {
  const [isOpen, setIsOpen] = React.useState(open ?? false)

  React.useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open)
    }
  }, [open])

  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen)
    onOpenChange?.(newOpen)
  }

  return (
    <div className={isOpen ? "fixed inset-0 z-50" : "hidden"}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child, {
            isOpen,
            onOpenChange: handleOpenChange,
          } as any)
        }
        return child 
      })}
    </div>
  )
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(({ 
  className, 
  children, 
  isOpen, 
  onOpenChange,
  ...props 
}, ref) => {
  React.useEffect(() => {
    if (!isOpen) return
    const id = String(++escapeIdCounter)
    escapeStack.push(id)
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // 弹窗内的自定义 Select 等打开时，先由子层关下拉，勿整窗关闭
      if (document.querySelector("[data-app-interactive-overlay]")) return
      // 只有栈顶弹窗响应 ESC
      if (escapeStack[escapeStack.length - 1] !== id) return
      onOpenChange?.(false)
    }
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("keydown", handleEscape)
      const idx = escapeStack.lastIndexOf(id)
      if (idx !== -1) escapeStack.splice(idx, 1)
    }
  }, [isOpen, onOpenChange])

  React.useEffect(() => {
    if (!isOpen) return
    lockBodyScroll()
    return () => {
      unlockBodyScroll()
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <>
      {/* Overlay */}
      <div 
        className="fixed inset-0 bg-black/80 z-40"
        onClick={() => onOpenChange?.(false)}
      /> 
      
      {/* Content */}
      <div
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 flex w-full max-w-4xl translate-x-[-50%] translate-y-[-50%] flex-col gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg",
          className
        )}
        {...props}
      >
        {children}
        <button
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
          onClick={() => onOpenChange?.(false)}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>
      </div>
    </>
  )
})

DialogContent.displayName = 'DialogContent'

const DialogHeader: React.FC<DialogHeaderProps> = ({ 
  className, 
  children, 
  ...props 
}) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  >
    {children}
  </div>
)

const DialogTitle: React.FC<DialogTitleProps> = ({ 
  className, 
  children, 
  ...props 
}) => (
  <h2
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  >
    {children}
  </h2>
)

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
}
