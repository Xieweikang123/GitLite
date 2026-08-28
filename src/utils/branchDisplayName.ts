import { hashBranchNameToPaletteIndex } from './commitGraphLayout'

/** 提交列表标签等处省略默认远程前缀 `origin/`，便于同一行多显示几个名称 */
export function formatBranchLabelShort(name: string): string {
  if (name.startsWith('origin/')) {
    return name.slice('origin/'.length)
  }
  return name
}

/**
 * 分支历史查询用的完整引用。
 * 远程跟踪名已是 `origin/master` 这种短名，不能再套 `refs/heads/`，否则 git 找不到记录。
 */
export function branchRevSpec(name: string, isRemote: boolean): string {
  const n = name.trim()
  if (!n) return ''
  if (isRemote) {
    return n.startsWith('refs/remotes/') ? n : `refs/remotes/${n}`
  }
  return n.startsWith('refs/heads/') ? n : `refs/heads/${n}`
}

/** 下拉框值为 `refs/heads/…` 或 `refs/remotes/…` 时，界面只展示短名 */
export function shortBranchRef(ref: string | null | undefined): string {
  if (!ref) return ''
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '')
}

/**
 * 本地分支与其远程跟踪是否同一条线：`dev-ght` ↔ `origin/dev-ght`。
 * 「当前分支」视图只保留正在查看的那条线，避免其它远程把图画成全部分支。
 */
export function refsSameBranchLine(name: string, focus: string): boolean {
  const n = name.trim()
  const f = focus.trim()
  if (!n || !f) return false
  if (n === f) return true
  if (!f.includes('/')) {
    return n === `origin/${f}` || n.endsWith(`/${f}`)
  }
  if (!n.includes('/')) {
    return f === `origin/${n}` || f.endsWith(`/${n}`)
  }
  return false
}

/** 与 CommitGraphStrip 车道色一致顺序；同分支名（完整 ref 名）始终同色 */
const BRANCH_BADGE_PALETTE = [
  'border-sky-500/55 bg-sky-500/15 text-sky-950 dark:border-sky-400/50 dark:bg-sky-500/20 dark:text-sky-50',
  'border-fuchsia-500/55 bg-fuchsia-500/15 text-fuchsia-950 dark:border-fuchsia-400/50 dark:bg-fuchsia-500/20 dark:text-fuchsia-50',
  'border-amber-500/55 bg-amber-500/15 text-amber-950 dark:border-amber-400/50 dark:bg-amber-500/20 dark:text-amber-50',
  'border-emerald-500/55 bg-emerald-500/15 text-emerald-950 dark:border-emerald-400/50 dark:bg-emerald-500/20 dark:text-emerald-50',
  'border-rose-500/55 bg-rose-500/15 text-rose-950 dark:border-rose-400/50 dark:bg-rose-500/20 dark:text-rose-50',
  'border-violet-500/55 bg-violet-500/15 text-violet-950 dark:border-violet-400/50 dark:bg-violet-500/20 dark:text-violet-50',
  'border-cyan-500/55 bg-cyan-500/15 text-cyan-950 dark:border-cyan-400/50 dark:bg-cyan-500/20 dark:text-cyan-50',
  'border-orange-500/55 bg-orange-500/15 text-orange-950 dark:border-orange-400/50 dark:bg-orange-500/20 dark:text-orange-50',
  'border-lime-500/55 bg-lime-500/15 text-lime-950 dark:border-lime-400/50 dark:bg-lime-500/20 dark:text-lime-50',
  'border-indigo-500/55 bg-indigo-500/15 text-indigo-950 dark:border-indigo-400/50 dark:bg-indigo-500/20 dark:text-indigo-50',
] as const

const PALETTE_LEN = BRANCH_BADGE_PALETTE.length

export function branchBadgeClassName(fullBranchName: string): string {
  const i = hashBranchNameToPaletteIndex(fullBranchName, PALETTE_LEN)
  return BRANCH_BADGE_PALETTE[i] ?? BRANCH_BADGE_PALETTE[0]
}
