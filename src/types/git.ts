/** 与后端 `get_author_commit_stats` 一致：按邮箱合并（无邮箱则按姓名） */
export interface AuthorCommitStat {
  author: string
  email: string
  commit_count: number
}

/** 时间分桶（日 / ISO 周 / 月） */
export interface TimeBucketStat {
  key: string
  commit_count: number
}

/** 作者增删行（首父 diff） */
export interface AuthorLineStat {
  author: string
  email: string
  insertions: number
  deletions: number
  commit_count: number
}

export interface PathTouchStat {
  path: string
  touch_count: number
}

export interface DiffAggregateStats {
  authors: AuthorLineStat[]
  paths: PathTouchStat[]
}

/** 单个文件路径上的主要维护者（首父 diff，按提交次数） */
export interface FileTerritoryStat {
  path: string
  primary_author: string
  primary_email: string
  /** 该作者修改此文件的提交次数 */
  primary_commits: number
  /** 所有作者在该文件上的提交次数之和 */
  total_commits: number
  /** 0–1 */
  primary_share: number
}

/** 文件最近一次被提交修改的信息 */
export interface RecentChangedFileStat {
  path: string
  status: string
  last_commit_id: string
  last_commit_short_id: string
  last_commit_message: string
  author: string
  email: string
  changed_at: string
}

/** 分支维度：活跃度 + 生命周期（以 base 分支为参照） */
export interface BranchActivityLifecycleStat {
  branch: string
  is_current: boolean
  unique_commit_count: number
  active_author_count: number
  recent_7d_commits: number
  previous_7d_commits: number
  last_active_at?: string | null
  first_commit_at?: string | null
  branch_created_at?: string | null
  alive_days?: number | null
  inactive_days?: number | null
  is_merged_into_base: boolean
  merged_at?: string | null
  first_commit_to_merge_days?: number | null
}

export interface BranchActivityLifecycleReport {
  base_branch: string
  rows: BranchActivityLifecycleStat[]
}

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
  /** 合并冲突等（与「已暂存」分列） */
  conflicted_files?: FileChange[]
}

/** 与后端 `pull_changes` 返回一致 */
export interface PullOutcome {
  kind: string
  message: string
  head_oid_short?: string | null
  staged_count: number
  unstaged_count: number
  conflicted_count: number
  untracked_count: number
}

/** 与后端 `pull_changes_with_logs` 返回一致 */
export interface PullWithLogsResult {
  logs: Array<[string, string, string]>
  outcome: PullOutcome
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
  /** 当前分支是否设置上游；为 false 时 ahead/behind 不能代表「与远端同步」程度 */
  has_upstream?: boolean
  /** 是否存在命名为 origin 的远程 */
  has_origin_remote?: boolean
}

export interface RemoteItem {
  name: string
  fetch_url?: string | null
  push_url?: string | null
}

export interface BranchUpstreamItem {
  name: string
  upstream?: string | null
  is_current: boolean
}

export interface RemoteManagementInfo {
  remotes: RemoteItem[]
  branches: BranchUpstreamItem[]
  current_branch: string
}

/** 工作区「提交 / 推送 / 拉取」经 useGit 统一封装时使用，避免组件内重复 invoke */
export interface WorkspaceGitActions {
  commitChanges: (message: string) => Promise<void>
  fetchChanges: () => Promise<unknown>
  pushChanges: () => Promise<void>
  pullChanges: () => Promise<PullOutcome>
  refreshRepoInfo: () => Promise<RepoInfo>
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
  test_timeout_seconds?: number
}
