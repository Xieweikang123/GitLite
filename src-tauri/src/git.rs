use anyhow::Result;
use git2::{Oid, Repository};
use std::collections::HashSet;

use crate::util;
use crate::CommitInfo;

/// Git 空树对象 id（用于根提交的 diff 一侧）
const GIT_EMPTY_TREE_OID: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

#[derive(Clone)]
pub struct LocalBranchTip {
    pub name: String,
    pub oid: Oid,
    pub is_current: bool,
}

pub enum CommitLogScope {
    Head,
    AllRefs,
    /// `git rev-parse` 可解析的引用（分支名、origin/main 等）
    Rev(String),
}

pub fn commit_log_scope_from_parts(scope: Option<&str>, rev: Option<&str>) -> CommitLogScope {
    if let Some(r) = rev.map(str::trim).filter(|t| !t.is_empty()) {
        return CommitLogScope::Rev(r.to_string());
    }
    match scope.map(str::trim).filter(|t| !t.is_empty()) {
        Some("all") => CommitLogScope::AllRefs,
        _ => CommitLogScope::Head,
    }
}

/// 解析提交历史用的引用。误把远程跟踪写成 `refs/heads/origin/…` 时回退到 `refs/remotes/…`。
fn revparse_history_object<'repo>(
    repo: &'repo Repository,
    ref_spec: &str,
) -> Result<git2::Object<'repo>> {
    match repo.revparse_single(ref_spec) {
        Ok(obj) => Ok(obj),
        Err(e) => {
            if let Some(rest) = ref_spec.strip_prefix("refs/heads/") {
                if let Ok(obj) = repo.revparse_single(&format!("refs/remotes/{rest}")) {
                    return Ok(obj);
                }
            }
            Err(anyhow::anyhow!("无法解析引用 \"{}\": {}", ref_spec, e))
        }
    }
}

pub fn revwalk_push_scope(
    repo: &Repository,
    revwalk: &mut git2::Revwalk,
    scope: CommitLogScope,
) -> Result<()> {
    match scope {
        CommitLogScope::Head => {
            revwalk
                .push_head()
                .map_err(|e| anyhow::anyhow!("Failed to push HEAD: {}", e))?;
        }
        CommitLogScope::AllRefs => {
            let mut tips: HashSet<Oid> = HashSet::new();
            let refs = repo
                .references()
                .map_err(|e| anyhow::anyhow!("Failed to iterate refs: {}", e))?;
            for r in refs {
                let r = r.map_err(|e| anyhow::anyhow!("Failed to read ref: {}", e))?;
                let name = r.name().unwrap_or("");
                if !(name.starts_with("refs/heads/")
                    || name.starts_with("refs/remotes/")
                    || name.starts_with("refs/tags/"))
                {
                    continue;
                }
                if let Ok(obj) = r.peel(git2::ObjectType::Commit) {
                    tips.insert(obj.id());
                }
            }
            if tips.is_empty() {
                revwalk
                    .push_head()
                    .map_err(|e| anyhow::anyhow!("Failed to push HEAD: {}", e))?;
            } else {
                for oid in tips {
                    revwalk
                        .push(oid)
                        .map_err(|e| anyhow::anyhow!("Failed to push ref tip: {}", e))?;
                }
            }
        }
        CommitLogScope::Rev(ref_spec) => {
            let obj = revparse_history_object(repo, ref_spec.as_str())?;
            revwalk
                .push(obj.id())
                .map_err(|e| anyhow::anyhow!("Failed to push rev: {}", e))?;
        }
    }
    Ok(())
}

pub fn collect_local_branch_tips(repo: &Repository) -> Result<Vec<LocalBranchTip>> {
    let current_branch = util::current_branch_label(repo);
    let mut out: Vec<LocalBranchTip> = Vec::new();
    let iter = repo
        .branches(Some(git2::BranchType::Local))
        .map_err(|e| anyhow::anyhow!("Failed to get local branches: {}", e))?;
    for branch_result in iter {
        let (branch, _) = branch_result
            .map_err(|e| anyhow::anyhow!("Failed to iterate local branch: {}", e))?;
        let name = branch
            .name()
            .map_err(|e| anyhow::anyhow!("Failed to read branch name: {}", e))?
            .unwrap_or("unknown")
            .to_string();
        let Some(oid) = branch.get().target() else {
            continue;
        };
        out.push(LocalBranchTip {
            is_current: name == current_branch,
            name,
            oid,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub fn choose_base_branch(branches: &[LocalBranchTip], preferred: Option<&str>) -> Option<String> {
    let p = preferred.map(str::trim).filter(|s| !s.is_empty());
    if let Some(name) = p {
        if branches.iter().any(|b| b.name == name) {
            return Some(name.to_string());
        }
    }
    for name in ["main", "master", "develop"] {
        if branches.iter().any(|b| b.name == name) {
            return Some(name.to_string());
        }
    }
    if let Some(cur) = branches.iter().find(|b| b.is_current) {
        return Some(cur.name.clone());
    }
    branches.first().map(|b| b.name.clone())
}

/// 在 base 分支第一父链上定位「首次包含 branch_tip 的提交时间」；可用于近似“合并时间”。
pub fn first_contains_branch_time_on_base(repo: &Repository, base_tip: Oid, branch_tip: Oid) -> Option<i64> {
    if !repo.graph_descendant_of(base_tip, branch_tip).ok()? {
        return None;
    }
    let mut cursor = repo.find_commit(base_tip).ok()?;
    let mut merge_ts: Option<i64> = None;
    loop {
        let contains = repo
            .graph_descendant_of(cursor.id(), branch_tip)
            .unwrap_or(false);
        if !contains {
            break;
        }
        merge_ts = Some(cursor.time().seconds());
        if cursor.parent_count() == 0 {
            break;
        }
        cursor = cursor.parent(0).ok()?;
    }
    merge_ts
}

pub fn first_parent_tree_for_diff<'a>(
    repo: &'a Repository,
    commit: &'a git2::Commit,
) -> Result<git2::Tree<'a>> {
    if commit.parent_count() == 0 {
        let oid = Oid::from_str(GIT_EMPTY_TREE_OID)
            .map_err(|e| anyhow::anyhow!("empty tree oid: {}", e))?;
        repo.find_tree(oid)
            .map_err(|e| anyhow::anyhow!("find empty tree: {}", e))
    } else {
        commit
            .parent(0)
            .and_then(|p| p.tree())
            .map_err(|e| anyhow::anyhow!("parent tree: {}", e))
    }
}

pub fn diff_commit_to_first_parent<'a>(
    repo: &'a Repository,
    commit: &'a git2::Commit,
) -> Result<git2::Diff<'a>> {
    let old_tree = first_parent_tree_for_diff(repo, commit)?;
    let new_tree = commit.tree().map_err(|e| anyhow::anyhow!("commit tree: {}", e))?;
    repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), None)
        .map_err(|e| anyhow::anyhow!("diff_tree_to_tree: {}", e))
}

pub fn delta_status_label(status: git2::Delta) -> &'static str {
    match status {
        git2::Delta::Added => "added",
        git2::Delta::Modified => "modified",
        git2::Delta::Deleted => "deleted",
        git2::Delta::Renamed => "renamed",
        git2::Delta::Copied => "copied",
        git2::Delta::Typechange => "typechanged",
        _ => "unknown",
    }
}

pub fn commit_parent_ids(commit: &git2::Commit) -> Vec<String> {
    commit
        .parent_ids()
        .map(|p| p.to_string())
        .collect()
}

/// 单次 revwalk 收集 scope 内全部提交 OID（排序与 `count_commits_scoped` / 分页一致）。
/// 用于增删行统计等需知总数再逐条处理的任务，避免「先全量 count 再全量 diff」对历史遍历两遍。
pub fn collect_revwalk_oids_for_scope(
    repo: &Repository,
    scope: CommitLogScope,
) -> Result<Vec<Oid>> {
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| anyhow::anyhow!("Failed to create revwalk: {}", e))?;
    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(|e| anyhow::anyhow!("Failed to set revwalk sort: {}", e))?;
    revwalk_push_scope(repo, &mut revwalk, scope)?;
    let mut oids = Vec::new();
    for oid_result in revwalk {
        oids.push(
            oid_result.map_err(|e| anyhow::anyhow!("Failed to get OID: {}", e))?,
        );
    }
    Ok(oids)
}

/// 按范围统计可达提交总数（与分页遍历使用相同的 revwalk 起点与排序）。
pub fn count_commits_scoped(repo: &Repository, scope: CommitLogScope) -> Result<usize> {
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| anyhow::anyhow!("Failed to create revwalk: {}", e))?;
    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(|e| anyhow::anyhow!("Failed to set revwalk sort: {}", e))?;
    revwalk_push_scope(repo, &mut revwalk, scope)?;
    let mut n = 0usize;
    for oid_result in revwalk {
        oid_result.map_err(|e| anyhow::anyhow!("Failed to walk commits: {}", e))?;
        n += 1;
    }
    Ok(n)
}

// 获取分页提交历史
pub fn get_commit_history_paginated(
    repo: &Repository,
    limit: Option<usize>,
    offset: Option<usize>,
    scope: CommitLogScope,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<Vec<CommitInfo>> {
    let mut revwalk = repo.revwalk()
        .map_err(|e| anyhow::anyhow!("Failed to create revwalk: {}", e))?;
    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(|e| anyhow::anyhow!("Failed to set revwalk sort: {}", e))?;

    revwalk_push_scope(repo, &mut revwalk, scope)?;

    let mut commits = Vec::new();
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);
    let mut count = 0;
    let mut skipped = 0;

    for oid_result in revwalk {
        if skipped < offset {
            skipped += 1;
            continue;
        }

        if count >= limit {
            break;
        }

        let oid = oid_result
            .map_err(|e| anyhow::anyhow!("Failed to get OID: {}", e))?;

        let commit = repo.find_commit(oid)
            .map_err(|e| anyhow::anyhow!("Failed to find commit: {}", e))?;

        let author = commit.author();
        let message = commit.message().unwrap_or("No message").to_string();
        let date = util::commit_display_time(&commit, client_calendar_offset_east_minutes);

        commits.push(CommitInfo {
            id: oid.to_string(),
            short_id: format!("{:.7}", oid),
            message: message.lines().next().unwrap_or("").to_string(),
            author: author.name().unwrap_or("Unknown").to_string(),
            email: author.email().unwrap_or("").to_string(),
            date,
            parent_ids: commit_parent_ids(&commit),
        });

        count += 1;
    }

    Ok(commits)
}

// 获取提交历史（初始加载，只获取前50个；始终为当前 HEAD，与打开仓库时列表一致）
pub fn get_commit_history(
    repo: &Repository,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<Vec<CommitInfo>> {
    get_commit_history_paginated(
        repo,
        Some(50),
        Some(0),
        CommitLogScope::Head,
        client_calendar_offset_east_minutes,
    )
}

// 全仓库历史搜索：按关键词匹配 message / author / short_id，返回最多 limit 条
pub fn get_commit_history_search(
    repo: &Repository,
    query: &str,
    limit: usize,
    scope: CommitLogScope,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<Vec<CommitInfo>> {
    let query_lower = query.to_lowercase();
    if query_lower.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut revwalk = repo.revwalk()
        .map_err(|e| anyhow::anyhow!("Failed to create revwalk: {}", e))?;
    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(|e| anyhow::anyhow!("Failed to set revwalk sort: {}", e))?;
    revwalk_push_scope(repo, &mut revwalk, scope)?;
    let mut commits = Vec::new();
    for oid_result in revwalk {
        if commits.len() >= limit {
            break;
        }
        let oid = oid_result
            .map_err(|e| anyhow::anyhow!("Failed to get OID: {}", e))?;
        let commit = repo.find_commit(oid)
            .map_err(|e| anyhow::anyhow!("Failed to find commit: {}", e))?;
        let author = commit.author();
        let author_name = author.name().unwrap_or("Unknown").to_string();
        let message = commit.message().unwrap_or("No message").to_string();
        let first_line = message.lines().next().unwrap_or("").to_string();
        let short_id = format!("{:.7}", oid);
        let date = util::commit_display_time(&commit, client_calendar_offset_east_minutes);
        let matches = first_line.to_lowercase().contains(&query_lower)
            || author_name.to_lowercase().contains(&query_lower)
            || short_id.to_lowercase().contains(&query_lower)
            || oid.to_string().to_lowercase().contains(&query_lower);
        if matches {
            commits.push(CommitInfo {
                id: oid.to_string(),
                short_id,
                message: first_line,
                author: author_name,
                email: author.email().unwrap_or("").to_string(),
                date,
                parent_ids: commit_parent_ids(&commit),
            });
        }
    }
    Ok(commits)
}

/// 与 `get_commit_activity_stats` 使用相同的日历分桶键（本机时区或作者时区），列出某一桶内的提交（新到旧，最多 limit 条）
pub fn get_commits_for_activity_bucket_inner(
    repo: &Repository,
    scope: CommitLogScope,
    granularity: &str,
    bucket_key: &str,
    limit: usize,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<Vec<CommitInfo>> {
    let g = if matches!(granularity, "day" | "week" | "month") {
        granularity
    } else {
        "day"
    };
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| anyhow::anyhow!("Failed to create revwalk: {}", e))?;
    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(|e| anyhow::anyhow!("Failed to set revwalk sort: {}", e))?;
    revwalk_push_scope(repo, &mut revwalk, scope)?;

    let mut commits = Vec::new();
    for oid_result in revwalk {
        if commits.len() >= limit {
            break;
        }
        let oid = oid_result.map_err(|e| anyhow::anyhow!("Failed to walk commits: {}", e))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| anyhow::anyhow!("Failed to find commit: {}", e))?;
        let dt = util::commit_calendar_datetime(&commit, client_calendar_offset_east_minutes);
        let key = util::time_bucket_key(&dt, g);
        if key != bucket_key {
            continue;
        }
        let author = commit.author();
        let author_name = author.name().unwrap_or("Unknown").to_string();
        let message = commit.message().unwrap_or("No message").to_string();
        let first_line = message.lines().next().unwrap_or("").to_string();
        let short_id = format!("{:.7}", oid);
        let date = util::commit_display_time(&commit, client_calendar_offset_east_minutes);
        commits.push(CommitInfo {
            id: oid.to_string(),
            short_id,
            message: first_line,
            author: author_name,
            email: author.email().unwrap_or("").to_string(),
            date,
            parent_ids: commit_parent_ids(&commit),
        });
    }
    Ok(commits)
}
