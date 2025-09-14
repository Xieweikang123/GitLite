import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { FileChange } from '../types/git'
import { FileText, Plus, Edit, Trash2, GitBranch } from 'lucide-react'

interface FileListProps {
  files: FileChange[]
  selectedFile: string | null
  onFileSelect: (filePath: string) => void
  loading?: boolean
}

export function FileList({ files, selectedFile, onFileSelect }: FileListProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'added':
        return <Plus className="h-4 w-4 text-green-600 dark:text-green-400" />
      case 'modified':
        return <Edit className="h-4 w-4 text-blue-600 dark:text-blue-400" />
      case 'deleted':
        return <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
      case 'renamed':
        return <GitBranch className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
      default:
        return <FileText className="h-4 w-4 text-gray-600 dark:text-gray-400" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'added':
        return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700'
      case 'modified':
        return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700'
      case 'deleted':
        return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700'
      case 'renamed':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800/50 dark:text-gray-300 dark:border-gray-600'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'added':
        return '新增'
      case 'modified':
        return '修改'
      case 'deleted':
        return '删除'
      case 'renamed':
        return '重命名'
      default:
        return status
    }
  }

  if (files.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>文件变更</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">
            此提交没有文件变更
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          文件变更 ({files.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={file.path}
              className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                selectedFile === file.path
                  ? 'bg-accent border-primary'
                  : 'hover:bg-accent'
              }`}
              onClick={() => onFileSelect(file.path)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {getStatusIcon(file.status)}
                    <span className="text-sm font-medium truncate">
                      {file.path}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant="outline" 
                      className={`text-xs ${getStatusColor(file.status)}`}
                    >
                      {getStatusText(file.status)}
                    </Badge>
                    {(file.additions > 0 || file.deletions > 0) && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="text-green-600 dark:text-green-400">+{file.additions}</span>
                        <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
                      </div>
                    )}
                  </div>
                </div>
                {selectedFile === file.path && (
                  <div className="ml-2">
                    <div className="w-2 h-2 bg-primary rounded-full"></div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
