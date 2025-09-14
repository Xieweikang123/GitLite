import React from 'react';
import SyntaxHighlighter from './SyntaxHighlighter';
import CodeViewer from './CodeViewer';

interface CodeDisplayProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  variant?: 'simple' | 'full';
}

const CodeDisplay: React.FC<CodeDisplayProps> = ({
  code,
  language = 'text',
  filename,
  showLineNumbers = true,
  variant = 'simple'
}) => {
  if (variant === 'full') {
    return (
      <CodeViewer
        code={code}
        language={language}
        filename={filename}
        showLineNumbers={showLineNumbers}
      />
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-white dark:bg-gray-900">
      {filename && (
        <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 border-b">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {filename}
          </span>
          <span className="ml-2 text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-400">
            {language.toUpperCase()}
          </span>
        </div>
      )}
      <div className="p-4">
        <SyntaxHighlighter
          code={code}
          language={language}
          showLineNumbers={showLineNumbers}
        />
      </div>
    </div>
  );
};

export default CodeDisplay;

