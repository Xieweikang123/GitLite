import React, { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { Copy, ChevronDown, ChevronRight, Sidebar, FileText, Eye } from 'lucide-react';
import SyntaxHighlighter from './SyntaxHighlighter';

interface FileLine {
  lineNumber: number;
  content: string;
  type: 'unchanged' | 'added' | 'deleted' | 'modified';
  oldLineNumber?: number;
  segments?: DiffSegment[];
  changeIndex?: number;
}

interface DiffSegment {
  content: string;
  type: 'added' | 'deleted' | 'unchanged';
}

interface EnhancedCodeDiffProps {
  diff: string;
  filePath?: string;
  language?: string;
}

const EnhancedCodeDiff: React.FC<EnhancedCodeDiffProps> = ({
  diff,
  filePath,
  language = 'text'
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [viewMode, setViewMode] = useState<'unified' | 'side-by-side' | 'syntax-highlighted'>('unified');
  const [fileLines, setFileLines] = useState<FileLine[]>([]);
  const [copied, setCopied] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 解析 diff 内容
  useEffect(() => {
    const lines = parseDiffToLines(diff);
    setFileLines(lines);
  }, [diff]);

  const parseDiffToLines = (diffText: string): FileLine[] => {
    const lines = diffText.split('\n');
    const fileLines: FileLine[] = [];
    let lineNumber = 1;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        // 跳过 hunk 头部
        continue;
      }

      let type: 'unchanged' | 'added' | 'deleted' | 'modified' = 'unchanged';
      let content = line;

      if (line.startsWith('+')) {
        type = 'added';
        content = line.substring(1);
      } else if (line.startsWith('-')) {
        type = 'deleted';
        content = line.substring(1);
      } else if (line.startsWith(' ')) {
        content = line.substring(1);
      }

      fileLines.push({
        lineNumber: lineNumber++,
        content,
        type,
      });
    }

    return fileLines;
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(diff);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy diff:', err);
    }
  };

  const getLanguageFromPath = (path?: string): string => {
    if (!path) return 'text';
    
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: { [key: string]: string } = {
      'rs': 'rust',
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'go': 'go',
      'php': 'php',
      'rb': 'ruby',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'sh': 'bash',
      'json': 'json',
      'xml': 'xml',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'sql': 'sql',
      'yaml': 'yaml',
      'yml': 'yaml',
      'md': 'markdown',
      'txt': 'text',
    };
    
    return languageMap[ext || ''] || 'text';
  };

  const renderUnifiedView = () => (
    <div className="font-mono text-sm">
      {fileLines.map((line, index) => {
        
        return (
          <div 
            key={index}
            data-line-number={line.lineNumber}
            className={`px-4 py-1 flex items-start transition-all duration-200 ${
              line.type === 'added' ? 'bg-green-50 border-l-4 border-green-500 dark:bg-green-900/20 dark:border-green-400' :
              line.type === 'deleted' ? 'bg-red-50 border-l-4 border-red-500 dark:bg-red-900/20 dark:border-red-400' :
              line.type === 'modified' ? 'bg-yellow-50 border-l-4 border-yellow-500 dark:bg-yellow-900/20 dark:border-yellow-400' :
              'bg-transparent'
            }`}
          >
            <div className="flex-shrink-0 w-12 text-right text-gray-500 dark:text-gray-400 select-none mr-4">
              {line.lineNumber}
            </div>
            <div className="flex-shrink-0 w-8 text-center mr-4">
              {line.type === 'added' && <span className="text-green-600 dark:text-green-400">+</span>}
              {line.type === 'deleted' && <span className="text-red-600 dark:text-red-400">-</span>}
              {line.type === 'unchanged' && <span className="text-gray-400"> </span>}
            </div>
            <div className="flex-1 min-w-0 w-full">
              <SyntaxHighlighter
                code={line.content}
                language={language || getLanguageFromPath(filePath)}
                className="inline-block"
              />
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderSideBySideView = () => {
    const leftLines: FileLine[] = [];
    const rightLines: FileLine[] = [];
    
    fileLines.forEach(line => {
      if (line.type === 'added') {
        rightLines.push(line);
        leftLines.push({ ...line, content: '', type: 'unchanged' });
      } else if (line.type === 'deleted') {
        leftLines.push(line);
        rightLines.push({ ...line, content: '', type: 'unchanged' });
      } else {
        leftLines.push(line);
        rightLines.push(line);
      }
    });

    return (
      <div className="font-mono text-sm">
        <div className="grid grid-cols-2 gap-0 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700">
            删除的内容
          </div>
          <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
            添加的内容
          </div>
          
          {leftLines.map((leftLine, index) => {
            const rightLine = rightLines[index];
            
            return (
              <React.Fragment key={index}>
                <div className={`px-4 py-1 flex items-start ${
                  leftLine.type === 'deleted' ? 'bg-red-50 border-l-4 border-red-500 dark:bg-red-900/20 dark:border-red-400' :
                  leftLine.type === 'modified' ? 'bg-red-50 border-l-4 border-red-500 dark:bg-red-900/20 dark:border-red-400' :
                  'bg-transparent'
                }`}>
                  <div className="flex-shrink-0 w-8 text-center text-red-600 dark:text-red-400 mr-2">
                    {leftLine.type === 'deleted' ? '-' : ' '}
                  </div>
                  <div className="flex-1 min-w-0 w-full">
                    <SyntaxHighlighter
                      code={leftLine.content}
                      language={language || getLanguageFromPath(filePath)}
                      className="inline-block"
                    />
                  </div>
                </div>
                
                <div className={`px-4 py-1 flex items-start ${
                  rightLine.type === 'added' ? 'bg-green-50 border-l-4 border-green-500 dark:bg-green-900/20 dark:border-green-400' :
                  rightLine.type === 'modified' ? 'bg-green-50 border-l-4 border-green-500 dark:bg-green-900/20 dark:border-green-400' :
                  'bg-transparent'
                }`}>
                  <div className="flex-shrink-0 w-8 text-center text-green-600 dark:text-green-400 mr-2">
                    {rightLine.type === 'added' ? '+' : ' '}
                  </div>
                  <div className="flex-1 min-w-0 w-full">
                    <SyntaxHighlighter
                      code={rightLine.content}
                      language={language || getLanguageFromPath(filePath)}
                      className="inline-block"
                    />
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSyntaxHighlightedView = () => {
    const fullCode = fileLines.map(line => line.content).join('\n');
    
    return (
      <div className="font-mono text-sm">
        <SyntaxHighlighter
          code={fullCode}
          language={language || getLanguageFromPath(filePath)}
          showLineNumbers={true}
          className="rounded-lg"
        />
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {isExpanded ? '收起' : '展开'}
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={copyToClipboard}
            className="flex items-center gap-2"
          >
            <Copy className="h-4 w-4" />
            {copied ? '已复制!' : '复制'}
          </Button>
          
          {/* 视图模式切换 */}
          <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
            <Button
              variant={viewMode === 'unified' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('unified')}
              className="rounded-none border-0 h-8 px-3"
              title="统一视图"
            >
              <FileText className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'side-by-side' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('side-by-side')}
              className="rounded-none border-0 h-8 px-3"
              title="并排视图"
            >
              <Sidebar className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'syntax-highlighted' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('syntax-highlighted')}
              className="rounded-none border-0 h-8 px-3"
              title="语法高亮视图"
            >
              <Eye className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        {/* 文件信息 */}
        {filePath && (
          <div className="text-sm text-muted-foreground">
            {filePath} • {language || getLanguageFromPath(filePath)}
          </div>
        )}
      </div>
      
      {isExpanded && (
        <div ref={scrollContainerRef} className="max-h-96 overflow-y-auto">
          {fileLines.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              没有差异内容
            </div>
          ) : (
            <>
              {viewMode === 'unified' && renderUnifiedView()}
              {viewMode === 'side-by-side' && renderSideBySideView()}
              {viewMode === 'syntax-highlighted' && renderSyntaxHighlightedView()}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default EnhancedCodeDiff;
