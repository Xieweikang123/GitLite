/**
 * Tauri 1.x 中 invoke 失败时 reject 的值常为 string，而非 Error；
 * 仅用 instanceof Error 会丢失后端返回的详细说明。
 */

/** 去掉 libgit2 在 Display 里附加的 `; class=...; code=...` 调试后缀 */
function stripGit2DebugSuffix(message: string): string {
  const idx = message.indexOf('; class=')
  if (idx === -1) return message
  return message.slice(0, idx).trim()
}

/**
 * 将常见 git2 / 后端错误串整理为简短、可读的中文说明（保留路径等关键信息）。
 */
function humanizeInvokeErrorMessage(raw: string): string {
  let msg = stripGit2DebugSuffix(raw)
  const openRepoPrefix = 'Failed to open repository: '
  const inner = msg.startsWith(openRepoPrefix) ? msg.slice(openRepoPrefix.length) : msg

  // failed to resolve path '...': ... (路径不存在、已移动或无法访问)
  const resolveRe = /^failed to resolve path\s+'([^']+)'\s*:\s*.+$/is
  const pathMatch = inner.match(resolveRe)
  if (pathMatch) {
    const p = pathMatch[1]
    return `无法打开仓库：找不到该路径（文件夹可能已删除、移动或无权访问）。\n${p}`
  }

  if (msg.startsWith(openRepoPrefix)) {
    return `无法打开仓库：${inner}`
  }

  return msg
}

export function formatTauriInvokeError(err: unknown, fallback: string): string {
  let base: string
  if (typeof err === 'string' && err.trim() !== '') {
    base = err
  } else if (err instanceof Error && err.message) {
    base = err.message
  } else if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message
    base = typeof m === 'string' && m.trim() !== '' ? m : fallback
  } else {
    base = fallback
  }
  return humanizeInvokeErrorMessage(base)
}
