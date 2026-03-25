import { useMemo, useCallback, useSyncExternalStore, useRef, useEffect, useState } from 'react'
import type { editor } from 'monaco-editor'
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import { getMonacoLanguageFromPath } from '@/utils/monacoLanguage'
import { parseUnifiedDiffToPair } from '@/utils/parseUnifiedDiff'

/** Shift + 滚轮：转为横向滚动；兼容 deltaMode 与触控板横向 deltaX */
function shiftWheelHorizontalDelta(e: WheelEvent): number {
  let y = e.deltaY
  let x = e.deltaX
  if (e.deltaMode === 1) {
    const line = 16
    y *= line
    x *= line
  } else if (e.deltaMode === 2) {
    y *= window.innerHeight
    x *= window.innerWidth
  }
  return Math.abs(x) >= Math.abs(y) ? x : y
}

function subscribeDarkClass(cb: () => void) {
  const obs = new MutationObserver(cb)
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  return () => obs.disconnect()
}

function getDarkClass(): boolean {
  return document.documentElement.classList.contains('dark')
}

export interface VSCodeDiffProps {
  diff: string
  filePath?: string
  repoPath?: string
  debugEnabled?: boolean
}

/** 使用 Monaco 内置 Diff Editor 展示 Git unified diff（替代原自绘虚拟列表实现） */
export function MonacoDiffEditor({
  diff,
  filePath,
}: VSCodeDiffProps) {
  const isDark = useSyncExternalStore(subscribeDarkClass, getDarkClass, () => false)
  const language = useMemo(() => getMonacoLanguageFromPath(filePath), [filePath])

  const { original, modified } = useMemo(
    () => parseUnifiedDiffToPair(diff),
    [diff],
  )

  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const [editorMountGen, setEditorMountGen] = useState(0)

  const onMount = useCallback<DiffOnMount>((ed) => {
    diffEditorRef.current = ed
    ed.layout()
    setEditorMountGen((g) => g + 1)
  }, [])

  useEffect(() => {
    const ed = diffEditorRef.current
    if (!ed) return
    const dom = ed.getContainerDomNode()
    if (!dom) return

    const handleWheel = (e: WheelEvent) => {
      if (!e.shiftKey) return
      const delta = shiftWheelHorizontalDelta(e)
      if (delta === 0) return

      const target = e.target as Node
      if (!dom.contains(target)) return

      e.preventDefault()
      e.stopPropagation()

      const orig = ed.getOriginalEditor()
      const mod = ed.getModifiedEditor()
      const origNode = orig.getDomNode()
      const modNode = mod.getDomNode()
      const pane: editor.IStandaloneCodeEditor = origNode?.contains(target)
        ? orig
        : modNode?.contains(target)
          ? mod
          : mod

      const next = pane.getScrollLeft() + delta
      pane.setScrollLeft(next)
    }

    dom.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => {
      dom.removeEventListener('wheel', handleWheel, { capture: true })
    }
  }, [editorMountGen])

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <DiffEditor
        height="100%"
        width="100%"
        className="min-h-0 flex-1"
        original={original}
        modified={modified}
        language={language}
        theme={isDark ? 'vs-dark' : 'vs'}
        onMount={onMount}
        options={{
          readOnly: true,
          automaticLayout: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          scrollBeyondLastLine: false,
          contextmenu: true,
          wordWrap: 'off',
          renderOverviewRuler: true,
          overviewRulerBorder: false,
          diffWordWrap: 'off',
          enableSplitViewResizing: true,
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 12,
            horizontalScrollbarSize: 12,
          },
        }}
        loading={
          <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
            加载编辑器…
          </div>
        }
      />
    </div>
  )
}

/** 与历史代码兼容的别名 */
export const VSCodeDiff = MonacoDiffEditor
