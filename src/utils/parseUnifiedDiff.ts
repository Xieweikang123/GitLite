/**
 * 将 Git unified diff 文本解析为左右两侧文本，供 Monaco DiffEditor 使用。
 * 多文件 diff 时仅保留最后一个文件的 hunk（与常见单文件接口一致）。
 */
export function parseUnifiedDiffToPair(diffText: string): { original: string; modified: string } {
  const trimmed = diffText.trim()
  if (!trimmed) {
    return { original: '', modified: '' }
  }

  if (/Binary files .+ differ/.test(diffText)) {
    return {
      original: '（二进制文件，无法用文本对比）',
      modified: '（二进制文件，无法用文本对比）',
    }
  }

  const oldLines: string[] = []
  const newLines: string[] = []
  const lines = diffText.split('\n')
  let inHunk = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const head = line.replace(/^\uFEFF/, '').replace(/^\u200B+/, '').replace(/^\r/, '')
    const t = head.trimStart()

    if (t.startsWith('diff --git')) {
      oldLines.length = 0
      newLines.length = 0
      inHunk = false
      continue
    }
    if (t.startsWith('index ') || t.startsWith('---') || t.startsWith('+++')) {
      continue
    }
    if (t.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue

    const normalized = line.replace(/^\uFEFF|^\u200B+/, '')
    const nl = normalized.trim()
    if (nl === '\\ No newline at end of file') {
      continue
    }
    if (nl === '') {
      continue
    }

    const ch = normalized.charAt(0)
    const content = normalized.slice(1)
    if (ch === ' ') {
      oldLines.push(content)
      newLines.push(content)
    } else if (ch === '-') {
      oldLines.push(content)
    } else if (ch === '+') {
      newLines.push(content)
    } else {
      inHunk = false
    }
  }

  let original = oldLines.join('\n')
  let modified = newLines.join('\n')

  if (original === '' && modified === '' && trimmed.length > 0) {
    modified = diffText
  }

  return { original, modified }
}
