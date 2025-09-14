import React, { useEffect, useRef } from 'react';
import Prism from 'prismjs';
// 不导入主题 CSS，使用我们自己的样式
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-diff';

interface SyntaxHighlighterProps {
  code: string;
  language: string;
  className?: string;
  showLineNumbers?: boolean;
}

const SyntaxHighlighter: React.FC<SyntaxHighlighterProps> = ({
  code,
  language,
  className = '',
  showLineNumbers = false,
}) => {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current) {
      // 确保 Prism.js 正确高亮代码
      Prism.highlightElement(codeRef.current);
    }
  }, [code, language]);

  const getLanguageClass = (lang: string): string => {
    const languageMap: { [key: string]: string } = {
      'rs': 'language-rust',
      'rust': 'language-rust',
      'ts': 'language-typescript',
      'tsx': 'language-typescript',
      'typescript': 'language-typescript',
      'js': 'language-javascript',
      'jsx': 'language-javascript',
      'javascript': 'language-javascript',
      'json': 'language-json',
      'sh': 'language-bash',
      'bash': 'language-bash',
      'diff': 'language-diff',
    };
    const mappedLang = languageMap[lang.toLowerCase()] || `language-${lang}`;
    console.log(`SyntaxHighlighter: ${lang} -> ${mappedLang}`); // 调试信息
    return mappedLang;
  };

  const formatCodeWithLineNumbers = (code: string): string => {
    if (!showLineNumbers) return code;
    
    return code
      .split('\n')
      .map((line, index) => `${(index + 1).toString().padStart(3, ' ')}| ${line}`)
      .join('\n');
  };

  return (
    <div className={`syntax-highlighter ${className}`}>
      <pre className="line-numbers">
        <code
          ref={codeRef}
          className={getLanguageClass(language)}
        >
          {formatCodeWithLineNumbers(code)}
        </code>
      </pre>
    </div>
  );
};

export default SyntaxHighlighter;

