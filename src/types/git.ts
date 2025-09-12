export interface CommitInfo {
  id: string
  message: string
  author: string
  email: string
  date: string
  short_id: string
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

export interface RepoInfo {
  path: string
  current_branch: string
  branches: BranchInfo[]
  commits: CommitInfo[]
}
