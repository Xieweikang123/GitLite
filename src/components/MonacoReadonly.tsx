import { useCallback, useMemo, useSyncExternalStore } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { toMonacoLanguage } from "@/utils/monacoLanguage";

function subscribeDarkClass(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => obs.disconnect();
}

function getDarkClass(): boolean {
  return document.documentElement.classList.contains("dark");
}

export interface MonacoReadonlyProps {
  code: string;
  language: string;
  className?: string;
  showLineNumbers?: boolean;
  /** When set, editor height is capped so inner scrolling handles overflow (e.g. 400). */
  maxViewportHeightPx?: number;
}

export function MonacoReadonly({
  code,
  language,
  className = "",
  showLineNumbers = true,
  maxViewportHeightPx,
}: MonacoReadonlyProps) {
  const monacoLang = useMemo(() => toMonacoLanguage(language), [language]);
  const isDark = useSyncExternalStore(subscribeDarkClass, getDarkClass, () => false);

  const onMount = useCallback<OnMount>(
    (editor) => {
      const dom = editor.getDomNode()?.parentElement;
      const min = 120;

      const updateHeight = () => {
        const contentH = editor.getContentHeight();
        const natural = Math.max(contentH, min);
        const h =
          maxViewportHeightPx != null
            ? Math.min(natural, maxViewportHeightPx)
            : natural;
        if (dom) dom.style.height = `${h}px`;
        editor.layout();
      };

      updateHeight();
      editor.onDidContentSizeChange(updateHeight);
      const ro =
        typeof ResizeObserver !== "undefined" && dom
          ? new ResizeObserver(() => editor.layout())
          : null;
      ro?.observe(dom!);
    },
    [maxViewportHeightPx],
  );

  return (
    <div className={className}>
      <Editor
        height="120px"
        language={monacoLang}
        value={code}
        theme={isDark ? "vs-dark" : "vs"}
        onMount={onMount}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          lineNumbers: showLineNumbers ? "on" : "off",
          scrollBeyondLastLine: false,
          contextmenu: true,
          wordWrap: "off",
          wrappingIndent: "none",
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          renderLineHighlight: "none",
          scrollbar: {
            vertical: maxViewportHeightPx != null ? "auto" : "hidden",
            horizontal: "auto",
            verticalScrollbarSize: 14,
            horizontalScrollbarSize: 14,
          },
          padding: { top: 8, bottom: 8 },
          automaticLayout: true,
        }}
      />
    </div>
  );
}
