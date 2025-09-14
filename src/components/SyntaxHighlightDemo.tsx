import React, { useState } from 'react';
import CodeViewer from './CodeViewer';
import EnhancedCodeDiff from './EnhancedCodeDiff';
import { Button } from './ui/button';
import { Code, GitBranch, FileText } from 'lucide-react';

const SyntaxHighlightDemo: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'viewer' | 'diff'>('viewer');

  // 示例 Rust 代码
  const rustCode = `// 创建贮藏
#[tauri::command]
async fn create_stash(repo_path: String, message: String) -> Result<String, String> {
    let mut repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;

    let signature = repo.signature()
        .map_err(|e| format!("Failed to get signature: {}", e))?;

    let stash_id = repo.stash_save(&signature, &message, None)
        .map_err(|e| format!("Failed to create stash: {}", e))?;
    
    Ok(format!("Successfully created stash: {}", stash_id))
}

// 应用贮藏
#[tauri::command]
async fn apply_stash(repo_path: String, stash_id: String) -> Result<String, String> {
    let mut repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;

    let stash_oid = Oid::from_str(&stash_id)
        .map_err(|e| format!("Invalid stash ID: {}", e))?;

    repo.stash_apply(0, None)
        .map_err(|e| format!("Failed to apply stash: {}", e))?;

    Ok("Successfully applied stash".to_string())
}`;

  // 示例 TypeScript 代码
  const typescriptCode = `import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Copy, Download } from 'lucide-react';

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

  return (
    <div className={\`code-viewer border rounded-lg overflow-hidden \${className}\`}>
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
            onClick={handleCopy}
            className="h-8 w-8 p-0"
          >
            <Copy className="h-4 w-4" />
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
        {/* 这里会渲染语法高亮的代码 */}
      </div>
    </div>
  );
};

export default CodeViewer;`;

  // 示例 diff
  const sampleDiff = `@@ -1,3 +1,4 @@
 // 创建贮藏
 #[tauri::command]
 async fn create_stash(repo_path: String, message: String) -> Result<String, String> {
+    // 添加了新的注释
     let mut repo = Repository::open(&repo_path)
         .map_err(|e| format!("Failed to open repository: {}", e))?;
 
@@ -5,7 +6,8 @@
     let signature = repo.signature()
         .map_err(|e| format!("Failed to get signature: {}", e))?;
 
-    let stash_id = repo.stash_save(&signature, &message, None)
+    // 修改了错误处理
+    let stash_id = repo.stash_save(&signature, &message, None)
         .map_err(|e| format!("Failed to create stash: {}", e))?;
     
     Ok(format!("Successfully created stash: {}", stash_id))
 }`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">语法高亮演示</h1>
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === 'viewer' ? 'default' : 'outline'}
            onClick={() => setActiveTab('viewer')}
            className="flex items-center gap-2"
          >
            <Code className="h-4 w-4" />
            代码查看器
          </Button>
          <Button
            variant={activeTab === 'diff' ? 'default' : 'outline'}
            onClick={() => setActiveTab('diff')}
            className="flex items-center gap-2"
          >
            <GitBranch className="h-4 w-4" />
            差异对比
          </Button>
        </div>
      </div>

      {activeTab === 'viewer' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-4">Rust 代码示例</h2>
            <CodeViewer
              code={rustCode}
              language="rust"
              filename="src-tauri/src/main.rs"
              showLineNumbers={true}
            />
          </div>
          
          <div>
            <h2 className="text-lg font-semibold mb-4">TypeScript 代码示例</h2>
            <CodeViewer
              code={typescriptCode}
              language="typescript"
              filename="src/components/CodeViewer.tsx"
              showLineNumbers={true}
            />
          </div>
        </div>
      )}

      {activeTab === 'diff' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-4">代码差异对比</h2>
            <EnhancedCodeDiff
              diff={sampleDiff}
              filePath="src-tauri/src/main.rs"
              language="rust"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default SyntaxHighlightDemo;

