import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { BranchInfo } from '../types/git'

interface BranchListProps {
  branches: BranchInfo[]
  currentBranch: string
  onBranchSelect: (branchName: string) => void
  loading?: boolean
}

export function BranchList({ 
  branches, 
  currentBranch, 
  onBranchSelect, 
  loading 
}: BranchListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>分支</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {branches.map((branch) => (
            <div
              key={branch.name}
              className="flex items-center justify-between p-2 rounded hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{branch.name}</span>
                {branch.is_current && (
                  <Badge variant="default" className="text-xs">
                    当前
                  </Badge>
                )}
                {branch.is_remote && (
                  <Badge variant="secondary" className="text-xs">
                    远程
                  </Badge>
                )}
              </div>
              {!branch.is_current && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onBranchSelect(branch.name)}
                  disabled={loading}
                >
                  切换
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
