interface RepositorySelectorProps {
  loading: boolean
  repoInfo: any
}

export function RepositorySelector({ 
  repoInfo
}: RepositorySelectorProps) {
  if (repoInfo) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          分支切换已移至顶部工具栏
        </p>
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
