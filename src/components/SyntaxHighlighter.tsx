import type { FC } from "react";
import { MonacoReadonly } from "./MonacoReadonly";
import { MonacoColorized } from "./MonacoColorized";

interface SyntaxHighlighterProps {
  code: string;
  language: string;
  className?: string;
  showLineNumbers?: boolean;
  /** diff / 统一视图逐行：Monaco colorize，不创建编辑器 */
  inline?: boolean;
  maxViewportHeightPx?: number;
}

const SyntaxHighlighter: FC<SyntaxHighlighterProps> = ({
  code,
  language,
  className = "",
  showLineNumbers = false,
  inline = false,
  maxViewportHeightPx,
}) => {
  if (inline) {
    return <MonacoColorized code={code} language={language} className={className} />;
  }
  return (
    <MonacoReadonly
      code={code}
      language={language}
      className={`syntax-highlighter ${className}`}
      showLineNumbers={showLineNumbers}
      maxViewportHeightPx={maxViewportHeightPx}
    />
  );
};

export default SyntaxHighlighter;
