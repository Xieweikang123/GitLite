import { useEffect } from "react";
import * as monaco from "monaco-editor";

function applyMonacoTheme() {
  const dark = document.documentElement.classList.contains("dark");
  monaco.editor.setTheme(dark ? "vs-dark" : "vs");
}

/** Keep Monaco tokenizer / colorize theme in sync with Tailwind `dark` class on `<html>`. */
export function useMonacoThemeSync() {
  useEffect(() => {
    applyMonacoTheme();
    const obs = new MutationObserver(applyMonacoTheme);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);
}
