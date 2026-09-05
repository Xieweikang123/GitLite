import { useMemo, useCallback, useSyncExternalStore, useRef, useEffect, useState } from 'react'
import type { editor } from 'monaco-editor'
import Editor, { DiffEditor, type DiffOnMount, type OnMount } from '@monaco-editor/react'
import { Settings2, X, RotateCcw } from 'lucide-react'
import { getMonacoLanguageFromPath } from '@/utils/monacoLanguage'
import { isUnifiedDiffNewFile, parseUnifiedDiffToPair } from '@/utils/parseUnifiedDiff'
import { useMinimapConfig } from '@/utils/minimapConfig'
import { SimpleSelect } from './SimpleSelect'

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
  forceDiff?: boolean
}

function MinimapConfigPanel({
  onClose,
}: {
  onClose: () => void
}) {
  const { config, update, reset } = useMinimapConfig()
  return (
    <div className="absolute right-2 top-2 z-20 max-h-[min(72vh,520px)] w-[300px] overflow-auto rounded-lg border border-border bg-popover p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold">Minimap 缩略图</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-[11px] hover:bg-accent"
            title="恢复默认"
          >
            <RotateCcw className="h-3 w-3" /> 重置
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="grid gap-2.5">
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>启用 enabled</span>
          <input type="checkbox" checked={config.enabled} onChange={(e) => update({ enabled: e.target.checked })} className="h-4 w-4 accent-primary" />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>位置 side</span>
          <SimpleSelect
            size="xs"
            className="max-w-[16rem]"
            value={config.side}
            onValueChange={(v) => update({ side: v as 'left' | 'right' })}
            options={[
              { value: 'right', label: '右侧' },
              { value: 'left', label: '左侧' },
            ]}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>大小 size</span>
          <SimpleSelect
            size="xs"
            className="max-w-[16rem]"
            value={config.size}
            onValueChange={(v) => update({ size: v as 'proportional' | 'fill' | 'fit' })}
            options={[
              { value: 'proportional', label: 'proportional - 跟内容等高(可滚动)' },
              { value: 'fill', label: 'fill - 拉伸填满高度' },
              { value: 'fit', label: 'fit - 自适应不超出' },
            ]}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>自动隐藏 autohide</span>
          <SimpleSelect
            size="xs"
            className="max-w-[16rem]"
            value={config.autohide}
            onValueChange={(v) => update({ autohide: v as 'none' | 'mouseover' | 'scroll' })}
            options={[
              { value: 'none', label: 'none - 常显' },
              { value: 'mouseover', label: 'mouseover - 悬停显' },
              { value: 'scroll', label: 'scroll - 滚动时显' },
            ]}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>缩放 scale</span>
          <SimpleSelect
            size="xs"
            className="max-w-[16rem]"
            value={String(config.scale)}
            onValueChange={(v) => update({ scale: Number(v) })}
            options={[
              { value: '1', label: '1 - 最小' },
              { value: '2', label: '2 - 中等' },
              { value: '3', label: '3 - 最大' },
            ]}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>滑块 showSlider</span>
          <SimpleSelect
            size="xs"
            className="max-w-[16rem]"
            value={config.showSlider}
            onValueChange={(v) => update({ showSlider: v as 'always' | 'mouseover' })}
            options={[
              { value: 'always', label: '常显' },
              { value: 'mouseover', label: '悬停' },
            ]}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>真实字符 renderCharacters</span>
          <input type="checkbox" checked={config.renderCharacters} onChange={(e) => update({ renderCharacters: e.target.checked })} className="h-4 w-4 accent-primary" />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>最大列 maxColumn</span>
          <input type="number" min={40} max={500} step={10} value={config.maxColumn} onChange={(e) => update({ maxColumn: Number(e.target.value) })} className="h-7 w-20 rounded-md border bg-background px-2 text-xs" />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>显示 region 头</span>
          <input type="checkbox" checked={config.showRegionSectionHeaders} onChange={(e) => update({ showRegionSectionHeaders: e.target.checked })} className="h-4 w-4 accent-primary" />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>显示 MARK 头</span>
          <input type="checkbox" checked={config.showMarkSectionHeaders} onChange={(e) => update({ showMarkSectionHeaders: e.target.checked })} className="h-4 w-4 accent-primary" />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>头字号 fontSize</span>
          <input type="number" min={6} max={24} step={1} value={config.sectionHeaderFontSize} onChange={(e) => update({ sectionHeaderFontSize: Number(e.target.value) })} className="h-7 w-20 rounded-md border bg-background px-2 text-xs" />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>字间距 letterSpacing</span>
          <input type="number" min={0} max={5} step={1} value={config.sectionHeaderLetterSpacing} onChange={(e) => update({ sectionHeaderLetterSpacing: Number(e.target.value) })} className="h-7 w-20 rounded-md border bg-background px-2 text-xs" />
        </label>
        <p className="text-[10px] leading-relaxed text-muted-foreground">12项与 VS Code `editor.minimap.*` 一致 · 实时生效 · 自动保存 localStorage</p>
      </div>
    </div>
  )
}

/** 使用 Monaco 内置 Diff Editor 展示 Git unified diff（替代原自绘虚拟列表实现） */
export function MonacoDiffEditor({
  diff,
  filePath,
  forceDiff,
}: VSCodeDiffProps) {
  const isDark = useSyncExternalStore(subscribeDarkClass, getDarkClass, () => false)
  const language = useMemo(() => getMonacoLanguageFromPath(filePath), [filePath])
  const { config: minimapConfig } = useMinimapConfig()
  const [showMinimapPanel, setShowMinimapPanel] = useState(false)

  const { original, modified } = useMemo(
    () => parseUnifiedDiffToPair(diff),
    [diff],
  )

  const isNewFile = useMemo(() => (forceDiff ? false : isUnifiedDiffNewFile(diff)), [diff, forceDiff])

  const singleEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const [editorMountGen, setEditorMountGen] = useState(0)

  const onMountSingle = useCallback<OnMount>((ed) => {
    singleEditorRef.current = ed
    ed.layout()
    setEditorMountGen((g) => g + 1)
  }, [])

  const onMount = useCallback<DiffOnMount>((ed) => {
    diffEditorRef.current = ed
    ed.layout()
    setEditorMountGen((g) => g + 1)
  }, [])

  useEffect(() => {
    if (isNewFile) {
      const ed = singleEditorRef.current
      if (!ed) return
      const dom = ed.getDomNode()
      if (!dom) return

      const handleWheel = (e: WheelEvent) => {
        if (!e.shiftKey) return
        const delta = shiftWheelHorizontalDelta(e)
        if (delta === 0) return

        const target = e.target as Node
        if (!dom.contains(target)) return

        e.preventDefault()
        e.stopPropagation()

        const next = ed.getScrollLeft() + delta
        ed.setScrollLeft(next)
      }

      dom.addEventListener('wheel', handleWheel, { passive: false, capture: true })
      return () => {
        dom.removeEventListener('wheel', handleWheel, { capture: true })
      }
    }

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
  }, [editorMountGen, isNewFile])

  // 打开时自动跳到第一个差异处
  useEffect(() => {
    if (isNewFile) return
    const ed = diffEditorRef.current
    if (!ed) return
    let disposed = false
    const tryReveal = () => {
      if (disposed) return
      const changes = ed.getLineChanges()
      if (changes && changes.length > 0) {
        const c = changes[0]
        try {
          if (c.originalStartLineNumber) ed.getOriginalEditor().revealLineInCenter(c.originalStartLineNumber)
          if (c.modifiedStartLineNumber) ed.getModifiedEditor().revealLineInCenter(c.modifiedStartLineNumber)
        } catch { /* 忽略编辑器定位异常 */ }
        return true
      }
      return false
    }
    const handle = ed.onDidUpdateDiff(() => {
      if (tryReveal()) {
        handle.dispose()
        disposed = true
      }
    })
    const t1 = setTimeout(() => { if (!disposed) tryReveal() }, 200)
    const t2 = setTimeout(() => { if (!disposed) tryReveal() }, 600)
    return () => {
      disposed = true
      handle.dispose()
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [diff, editorMountGen, isNewFile])

  const minimapOptions = useMemo(() => ({
    enabled: minimapConfig.enabled,
    side: minimapConfig.side,
    scale: minimapConfig.scale,
    showSlider: minimapConfig.showSlider,
    renderCharacters: minimapConfig.renderCharacters,
    maxColumn: minimapConfig.maxColumn,
    autohide: minimapConfig.autohide,
    size: minimapConfig.size,
    showRegionSectionHeaders: minimapConfig.showRegionSectionHeaders,
    showMarkSectionHeaders: minimapConfig.showMarkSectionHeaders,
    sectionHeaderFontSize: minimapConfig.sectionHeaderFontSize,
    sectionHeaderLetterSpacing: minimapConfig.sectionHeaderLetterSpacing,
  }), [minimapConfig])

  if (isNewFile) {
    return (
      <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMinimapPanel((v) => !v)}
          className="absolute right-2 top-2 z-10 inline-flex h-7 items-center gap-1 rounded-md border bg-background/80 px-2 text-[11px] shadow-sm backdrop-blur hover:bg-accent"
          title="配置 minimap"
        >
          <Settings2 className="h-3 w-3" /> 缩略图
        </button>
        {showMinimapPanel && <MinimapConfigPanel onClose={() => setShowMinimapPanel(false)} />}
        <Editor
          height="100%"
          width="100%"
          className="min-h-0 flex-1"
          language={language}
          theme={isDark ? 'vs-dark' : 'vs'}
          value={modified}
          onMount={onMountSingle}
          options={{
            readOnly: true,
            automaticLayout: true,
            minimap: minimapOptions,
            fontSize: 13,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            scrollBeyondLastLine: false,
            contextmenu: true,
            wordWrap: 'off',
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

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
      <button
        type="button"
        onClick={() => setShowMinimapPanel((v) => !v)}
        className="absolute right-2 top-2 z-10 inline-flex h-7 items-center gap-1 rounded-md border bg-background/80 px-2 text-[11px] shadow-sm backdrop-blur hover:bg-accent"
        title="配置 minimap"
      >
        <Settings2 className="h-3 w-3" /> 缩略图
      </button>
      {showMinimapPanel && <MinimapConfigPanel onClose={() => setShowMinimapPanel(false)} />}
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
          minimap: minimapOptions,
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
