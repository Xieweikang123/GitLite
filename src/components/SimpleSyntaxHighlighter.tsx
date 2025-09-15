import React, { useEffect, useRef } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';

interface SimpleSyntaxHighlighterProps {
  code: string;
  language: string;
  className?: string;
}

const SimpleSyntaxHighlighter: React.FC<SimpleSyntaxHighlighterProps> = ({
  code,
  language,
  className = '',
}) => {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current) {
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
      'css': 'language-css',
      'scss': 'language-scss',
      'sass': 'language-scss',
      'json': 'language-json',
      'sh': 'language-bash',
      'bash': 'language-bash',
    };
    return languageMap[lang.toLowerCase()] || 'language-text';
  };

  return (
    <code
      ref={codeRef}
      className={`${getLanguageClass(language)} ${className}`}
      style={{
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: 'inherit',
        whiteSpace: 'pre',
        display: 'inline-block',
      }}
    >
      {code}
    </code>
  );
};

export default SimpleSyntaxHighlighter;
