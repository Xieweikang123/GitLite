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

export interface RepoInfo {
  path: string
  current_branch: string
  branches: BranchInfo[]
  commits: CommitInfo[]
}
