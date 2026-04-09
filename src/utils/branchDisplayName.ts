/** 提交列表标签等处省略默认远程前缀 `origin/`，便于同一行多显示几个名称 */
export function formatBranchLabelShort(name: string): string {
  if (name.startsWith('origin/')) {
    return name.slice('origin/'.length)
  }
  return name
}
