/** 将仓库内路径拆成目录与文件名，便于列表中突出文件名、完整路径仍用 title 展示 */
export function splitRepoPath(path: string): { dir: string; base: string } {
  const n = path.replace(/\\/g, '/')
  const i = n.lastIndexOf('/')
  if (i < 0) return { dir: '', base: path }
  return { dir: n.slice(0, i), base: n.slice(i + 1) }
}
