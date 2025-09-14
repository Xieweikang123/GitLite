import React, { useState } from 'react';
import SyntaxHighlighter from './SyntaxHighlighter';
import { Button } from './ui/button';
import { Copy, Download, Eye, EyeOff } from 'lucide-react';

interface CodeViewerProps {
  code: string;
  language: string;
  filename?: string;
  className?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
}

const CodeViewer: React.FC<CodeViewerProps> = ({
  code,
  language,
  filename,
  className = '',
  showLineNumbers = true,
  maxHeight = '400px',
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `code.${language}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`code-viewer border rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between bg-gray-100 dark:bg-gray-800 px-4 py-2 border-b">
        <div className="flex items-center space-x-2">
          {filename && (
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {filename}
            </span>
          )}
          <span className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-400">
            {language.toUpperCase()}
          </span>
        </div>
        
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 w-8 p-0"
          >
            {isExpanded ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-8 w-8 p-0"
          >
            <Copy className="h-4 w-4" />
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-8 w-8 p-0"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Code Content */}
      <div 
        className="overflow-auto bg-gray-50 dark:bg-gray-900"
        style={{ 
          maxHeight: isExpanded ? 'none' : maxHeight,
          minHeight: '200px'
        }}
      >
        <SyntaxHighlighter
          code={code}
          language={language}
          showLineNumbers={showLineNumbers}
          className="text-sm"
        />
      </div>

      {/* Copy feedback */}
      {copied && (
        <div className="absolute top-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs">
          已复制!
        </div>
      )}
    </div>
  );
};

export default CodeViewer;

