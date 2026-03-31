export interface CommitInfo {
  id: string
  message: string
  author: string
  email: string
  date: string
  short_id: string
  /** 父提交完整哈希（与 Git 顺序一致），用于分支图 */
  parent_ids?: string[]
}

/** 分支/远程引用指向的提交，用于在提交列表上标注 */
export interface BranchRefTip {
  name: string
  commit_id: string
  /** 是否为远程跟踪引用（refs/remotes/） */
  is_remote?: boolean
}

/** 某提交所在分支（在分支 tip 的历史上） */
export interface BranchOnCommit {
  name: string
  is_remote: boolean
}

export interface CommitBranchLabels {
  commit_id: string
  branches: BranchOnCommit[]
}

export interface BranchInfo {
  name: string
  is_current: boolean
  is_remote: boolean
}

export interface FileChange {
  path: string
  status: string // "added", "modified", "deleted", "renamed"
  additions: number
  deletions: number
}

export interface RecentRepo {
  path: string
  name: string
  last_opened: string
}

export interface WorkspaceStatus {
  staged_files: FileChange[]
  unstaged_files: FileChange[]
  untracked_files: string[]
}

export interface RepoInfo {
  path: string
  current_branch: string
  /** HEAD 当前提交的短哈希（约 7 字符），空仓库等情况下可能为空 */
  head_short_id?: string | null
  branches: BranchInfo[]
  commits: CommitInfo[]
  ahead: number // 本地比远端超前（待推送）
  behind: number // 本地比远端落后（待拉取）
  /** 远程有而本地尚未拉取合并的提交（与 `git log HEAD..@{upstream}` 一致），展示在列表顶部 */
  incoming_commits?: CommitInfo[]
  remote_url?: string // 远程仓库URL
}

/** 与 `git reset` 一致：soft / mixed / hard */
export type GitResetMode = 'soft' | 'mixed' | 'hard'

export interface ProxyConfig {
  enabled: boolean
  host: string
  port: number
  username?: string
  password?: string
  protocol: string // "http", "socks5" (不支持 "https")
}

/** OpenAI 兼容 API（Ollama / 智谱 / 自建网关等） */
export type AiProviderPreset = 'ollama' | 'zhipu' | 'openai_compatible' | 'custom'

export interface AiConfig {
  enabled: boolean
  provider: string
  base_url: string
  api_key?: string | null
  model: string
}
