import { useEffect, useState } from "react";
import * as monaco from "monaco-editor";
import { toMonacoLanguage } from "@/utils/monacoLanguage";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface MonacoColorizedProps {
  code: string;
  language: string;
  className?: string;
}

/** One-shot VS Code–style highlighting via Monaco (no editor instance). For diff rows / inline snippets. */
export function MonacoColorized({ code, language, className = "" }: MonacoColorizedProps) {
  const [html, setHtml] = useState(() => escapeHtml(code));

  useEffect(() => {
    let alive = true;
    const lang = toMonacoLanguage(language);
    const source = code.length === 0 ? " " : code;
    monaco.editor
      .colorize(source, lang, {})
      .then((result) => {
        if (alive) setHtml(result);
      })
      .catch(() => {
        if (alive) setHtml(escapeHtml(code));
      });
    return () => {
      alive = false;
    };
  }, [code, language]);

  return (
    <span
      className={className}
      style={{
        color: "inherit",
        fontFamily: "inherit",
        fontSize: "inherit",
        lineHeight: "inherit",
        whiteSpace: "pre",
        display: "inline-block",
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
