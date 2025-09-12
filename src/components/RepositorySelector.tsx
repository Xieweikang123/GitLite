import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { GitBranch } from 'lucide-react'

interface RepositorySelectorProps {
  onBranchSelect: (branchName: string) => void
  loading: boolean
  repoInfo: any
}

export function RepositorySelector({ 
  onBranchSelect,
  loading, 
  repoInfo
}: RepositorySelectorProps) {
  if (repoInfo) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              当前仓库
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="space-y-2">
                <p className="text-sm">
                  <span className="font-medium">路径:</span> {repoInfo.path}
                </p>
                <p className="text-sm">
                  <span className="font-medium">当前分支:</span> {repoInfo.current_branch}
                </p>
                <p className="text-sm">
                  <span className="font-medium">提交数:</span> {repoInfo.commits.length}
                </p>
              </div>
              
              {/* 分支列表 */}
              <div className="border-t pt-3">
                <h4 className="text-sm font-medium mb-2">分支</h4>
                <div className="space-y-1">
                  {repoInfo.branches.map((branch) => (
                    <div
                      key={branch.name}
                      className="flex items-center justify-between text-sm"
                    >
                      <span>{branch.name}</span>
                      <div className="flex items-center gap-2">
                        {branch.is_current && (
                          <span className="px-2 py-1 bg-primary text-primary-foreground text-xs rounded-full">
                            当前
                          </span>
                        )}
                        {!branch.is_current && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onBranchSelect(branch.name)}
                            disabled={loading}
                            className="h-6 px-2 text-xs"
                          >
                            切换
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="text-center py-12">
      <p className="text-muted-foreground">
        请从顶部工具栏选择或打开一个 Git 仓库
      </p>
    </div>
  )
}
