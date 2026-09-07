use anyhow::Result;
use chrono::Utc;
use git2::Repository;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::git::{self, CommitLogScope};
use crate::util;

/// 按作者聚合的提交次数（与提交列表 scope / rev 语义一致）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthorCommitStat {
    pub author: String,
    pub email: String,
    pub commit_count: u64,
}

/// 时间维度的提交分布（按日 / 周 / 月分桶）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TimeBucketStat {
    pub key: String,
    pub commit_count: u64,
}

/// 作者在范围内的增删行（与首父 diff 一致，合并提交仅计相对于第一父级）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthorLineStat {
    pub author: String,
    pub email: String,
    pub insertions: u64,
    pub deletions: u64,
    pub commit_count: u64,
}

/// 路径被提交触及的次数（单次提交内同一路径计 1）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PathTouchStat {
    pub path: String,
    pub touch_count: u64,
}

/// 一次遍历同时返回作者增删行与路径热度，避免重复 diff。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiffAggregateStats {
    pub authors: Vec<AuthorLineStat>,
    pub paths: Vec<PathTouchStat>,
}

/// 单个文件路径上的「主要维护者」：统计首父 diff 中该路径出现的**提交次数**（同一提交内多次出现计 1）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileTerritoryStat {
    pub path: String,
    pub primary_author: String,
    pub primary_email: String,
    /// 主要维护者触及该文件的提交次数
    pub primary_commits: u64,
    /// 该文件在所有作者下的提交次数之和（即历史上有多少条提交改过此文件）
    pub total_commits: u64,
    /// primary_commits / total_commits（0–1）
    pub primary_share: f64,
}

/// 文件最近一次被提交修改的信息（按提交时间由新到旧取每个路径的首次出现）。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentChangedFileStat {
    pub path: String,
    pub status: String,
    pub last_commit_id: String,
    pub last_commit_short_id: String,
    pub last_commit_message: String,
    pub author: String,
    pub email: String,
    pub changed_at: String,
}

/// 分支维度统计（活跃度 + 生命周期），默认以某个基准分支为参照。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BranchActivityLifecycleStat {
    pub branch: String,
    pub is_current: bool,
    /// 相对基准分支尚未包含的提交数（基准分支自身为其全部历史提交数）
    pub unique_commit_count: u64,
    pub active_author_count: u64,
    pub recent_7d_commits: u64,
    pub previous_7d_commits: u64,
    pub last_active_at: Option<String>,
    pub first_commit_at: Option<String>,
    pub branch_created_at: Option<String>,
    pub alive_days: Option<u64>,
    pub inactive_days: Option<u64>,
    pub is_merged_into_base: bool,
    pub merged_at: Option<String>,
    pub first_commit_to_merge_days: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BranchActivityLifecycleReport {
    pub base_branch: String,
    pub rows: Vec<BranchActivityLifecycleStat>,
}

/// 在指定历史范围内按作者（邮箱优先去重）统计提交次数，结果按次数降序。
pub fn author_commit_stats_for_scope(repo: &Repository, scope: CommitLogScope) -> Result<Vec<AuthorCommitStat>> {
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| anyhow::anyhow!("Failed to create revwalk: {}", e))?;
    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(|e| anyhow::anyhow!("Failed to set revwalk sort: {}", e))?;
    git::revwalk_push_scope(repo, &mut revwalk, scope)?;

    let mut map: HashMap<String, (String, String, u64)> = HashMap::new();

    for oid_result in revwalk {
        let oid = oid_result.map_err(|e| anyhow::anyhow!("Failed to walk commits: {}", e))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| anyhow::anyhow!("Failed to find commit: {}", e))?;
        let author = commit.author();
        let name = author.name().unwrap_or("Unknown").to_string();
        let email = author.email().unwrap_or("").to_string();
        let key = if email.trim().is_empty() {
            format!("n:{}", name)
        } else {
            format!("e:{}", email.trim().to_lowercase())
        };
        map.entry(key)
            .and_modify(|(_, _, c)| *c += 1)
            .or_insert((name, email, 1));
    }

    let mut stats: Vec<AuthorCommitStat> = map
        .into_values()
        .map(|(author, email, commit_count)| AuthorCommitStat {
            author,
            email,
            commit_count,
        })
        .collect();
    stats.sort_by(|a, b| {
        b.commit_count
            .cmp(&a.commit_count)
            .then_with(|| a.author.cmp(&b.author))
    });
    Ok(stats)
}

fn walk_scope_time_buckets(
    repo: &Repository,
    scope: CommitLogScope,
    granularity: &str,
    client_offset_east_minutes: Option<i32>,
) -> Result<HashMap<String, u64>> {
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| anyhow::anyhow!("Failed to create revwalk: {}", e))?;
    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(|e| anyhow::anyhow!("Failed to set revwalk sort: {}", e))?;
    git::revwalk_push_scope(repo, &mut revwalk, scope)?;

    let g = if matches!(granularity, "day" | "week" | "month") {
        granularity
    } else {
        "month"
    };

    let mut buckets: HashMap<String, u64> = HashMap::new();
    for oid_result in revwalk {
        let oid = oid_result.map_err(|e| anyhow::anyhow!("Failed to walk commits: {}", e))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| anyhow::anyhow!("Failed to find commit: {}", e))?;
        let dt = util::commit_calendar_datetime(&commit, client_offset_east_minutes);
        let key = util::time_bucket_key(&dt, g);
        *buckets.entry(key).or_insert(0) += 1;
    }
    Ok(buckets)
}

fn sorted_time_bucket_vec(map: HashMap<String, u64>) -> Vec<TimeBucketStat> {
    let mut v: Vec<TimeBucketStat> = map
        .into_iter()
        .map(|(key, commit_count)| TimeBucketStat { key, commit_count })
        .collect();
    v.sort_by(|a, b| a.key.cmp(&b.key));
    v
}

fn author_line_and_path_stats_for_scope<F>(
    repo: &Repository,
    scope: CommitLogScope,
    path_limit: usize,
    mut on_progress: F,
) -> Result<(Vec<AuthorLineStat>, Vec<PathTouchStat>)>
where
    F: FnMut(u32, u32),
{
    let oids = git::collect_revwalk_oids_for_scope(repo, scope)?;
    let total = oids.len() as u32;
    on_progress(0, total);
    if total == 0 {
        return Ok((Vec::new(), Vec::new()));
    }

    let mut author_lines: HashMap<String, (String, String, u64, u64, u64)> = HashMap::new();
    let mut path_touches: HashMap<String, u64> = HashMap::new();

    let step = (total / 120).max(1);
    let mut idx: u32 = 0;

    for oid in oids {
        idx += 1;
        if total > 0 && (idx == 1 || idx == total || idx % step == 0) {
            on_progress(idx, total);
        }

        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let author = commit.author();
        let name = author.name().unwrap_or("Unknown").to_string();
        let email = author.email().unwrap_or("").to_string();
        let akey = if email.trim().is_empty() {
            format!("n:{}", name)
        } else {
            format!("e:{}", email.trim().to_lowercase())
        };

        let diff = match git::diff_commit_to_first_parent(repo, &commit) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let stats = match diff.stats() {
            Ok(s) => s,
            Err(_) => continue,
        };
        let ins = stats.insertions() as u64;
        let del = stats.deletions() as u64;

        author_lines
            .entry(akey.clone())
            .and_modify(|(_n, _e, i, d, c)| {
                *i += ins;
                *d += del;
                *c += 1;
            })
            .or_insert((name.clone(), email.clone(), ins, del, 1));

        let _ = diff.foreach(
            &mut |delta: git2::DiffDelta<'_>, _progress: f32| {
                let path_opt = delta.new_file().path().map(std::path::Path::to_path_buf).or_else(|| {
                    delta.old_file().path().map(std::path::Path::to_path_buf)
                });
                if let Some(p) = path_opt {
                    *path_touches
                        .entry(p.to_string_lossy().into_owned())
                        .or_insert(0) += 1;
                }
                true
            },
            None,
            None,
            None,
        );
    }

    on_progress(total, total);

    let mut authors: Vec<AuthorLineStat> = author_lines
        .into_values()
        .map(|(author, email, insertions, deletions, commit_count)| AuthorLineStat {
            author,
            email,
            insertions,
            deletions,
            commit_count,
        })
        .collect();
    authors.sort_by(|a, b| {
        (b.insertions + b.deletions)
            .cmp(&(a.insertions + a.deletions))
            .then_with(|| a.author.cmp(&b.author))
    });

    let mut paths: Vec<(String, u64)> = path_touches.into_iter().collect();
    paths.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    paths.truncate(path_limit.max(1).min(200));
    let path_stats: Vec<PathTouchStat> = paths
        .into_iter()
        .map(|(path, touch_count)| PathTouchStat { path, touch_count })
        .collect();

    Ok((authors, path_stats))
}

fn file_territory_stats_for_scope<F>(
    repo: &Repository,
    scope: CommitLogScope,
    file_limit: usize,
    mut on_progress: F,
) -> Result<Vec<FileTerritoryStat>>
where
    F: FnMut(u32, u32),
{
    let oids = git::collect_revwalk_oids_for_scope(repo, scope)?;
    let total = oids.len() as u32;
    on_progress(0, total);
    if total == 0 {
        return Ok(Vec::new());
    }

    // 文件路径 -> 作者 key -> (显示名, 邮箱, 该作者在该文件上的提交次数)
    let mut file_authors: HashMap<String, HashMap<String, (String, String, u64)>> = HashMap::new();

    let step = (total / 120).max(1);
    let mut idx: u32 = 0;

    for oid in oids {
        idx += 1;
        if total > 0 && (idx == 1 || idx == total || idx % step == 0) {
            on_progress(idx, total);
        }

        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let author = commit.author();
        let name = author.name().unwrap_or("Unknown").to_string();
        let email = author.email().unwrap_or("").to_string();
        let akey = if email.trim().is_empty() {
            format!("n:{}", name)
        } else {
            format!("e:{}", email.trim().to_lowercase())
        };

        let diff = match git::diff_commit_to_first_parent(repo, &commit) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let _ = diff.foreach(
            &mut |delta: git2::DiffDelta<'_>, _progress: f32| {
                let path_opt = delta
                    .new_file()
                    .path()
                    .map(std::path::Path::to_path_buf)
                    .or_else(|| delta.old_file().path().map(std::path::Path::to_path_buf));
                if let Some(p) = path_opt {
                    let path_str = p.to_string_lossy();
                    let normalized = path_str.replace('\\', "/");
                    let fmap = file_authors.entry(normalized).or_insert_with(HashMap::new);
                    match fmap.get_mut(&akey) {
                        Some((n, e, c)) => {
                            *c += 1;
                            if n.is_empty() {
                                *n = name.clone();
                            }
                            if e.is_empty() {
                                *e = email.clone();
                            }
                        }
                        None => {
                            fmap.insert(akey.clone(), (name.clone(), email.clone(), 1));
                        }
                    }
                }
                true
            },
            None,
            None,
            None,
        );
    }

    on_progress(total, total);

    let mut rows: Vec<FileTerritoryStat> = Vec::new();
    for (path, authors_map) in file_authors {
        let total_commits: u64 = authors_map.values().map(|(_, _, c)| *c).sum();
        if total_commits == 0 {
            continue;
        }

        let mut best: Option<(u64, String, String)> = None;
        for (_k, (aname, aemail, cnt)) in &authors_map {
            match &best {
                None => best = Some((*cnt, aname.clone(), aemail.clone())),
                Some((bc, bn, _)) => {
                    if *cnt > *bc || (*cnt == *bc && aname < bn) {
                        best = Some((*cnt, aname.clone(), aemail.clone()));
                    }
                }
            }
        }

        if let Some((primary_commits, primary_author, primary_email)) = best {
            let primary_share = if total_commits > 0 {
                (primary_commits as f64) / (total_commits as f64)
            } else {
                0.0
            };
            rows.push(FileTerritoryStat {
                path,
                primary_author,
                primary_email,
                primary_commits,
                total_commits,
                primary_share,
            });
        }
    }

    rows.sort_by(|a, b| {
        b.total_commits
            .cmp(&a.total_commits)
            .then_with(|| a.path.cmp(&b.path))
    });
    rows.truncate(file_limit.max(1).min(200));
    Ok(rows)
}

fn recent_changed_files_for_scope(
    repo: &Repository,
    scope: CommitLogScope,
    limit: usize,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<Vec<RecentChangedFileStat>> {
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| anyhow::anyhow!("Failed to create revwalk: {}", e))?;
    revwalk
        .set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)
        .map_err(|e| anyhow::anyhow!("Failed to set revwalk sort: {}", e))?;
    git::revwalk_push_scope(repo, &mut revwalk, scope)?;

    let cap = limit.max(1).min(200);
    let mut seen: HashSet<String> = HashSet::new();
    let mut rows: Vec<RecentChangedFileStat> = Vec::new();

    for oid_result in revwalk {
        if rows.len() >= cap {
            break;
        }
        let oid = match oid_result {
            Ok(v) => v,
            Err(_) => continue,
        };
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let diff = match git::diff_commit_to_first_parent(repo, &commit) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let author_sig = commit.author();
        let author = author_sig.name().unwrap_or("Unknown").to_string();
        let email = author_sig.email().unwrap_or("").to_string();
        let message = commit
            .message()
            .unwrap_or("No message")
            .lines()
            .next()
            .unwrap_or("")
            .to_string();
        let changed_at = util::commit_display_time(&commit, client_calendar_offset_east_minutes);
        let commit_id = oid.to_string();
        let commit_short_id = format!("{:.7}", oid);

        let _ = diff.foreach(
            &mut |delta: git2::DiffDelta<'_>, _progress: f32| {
                if rows.len() >= cap {
                    return false;
                }
                let path_opt = delta
                    .new_file()
                    .path()
                    .map(std::path::Path::to_path_buf)
                    .or_else(|| delta.old_file().path().map(std::path::Path::to_path_buf));
                let Some(path_buf) = path_opt else {
                    return true;
                };
                let path = path_buf.to_string_lossy().replace('\\', "/");
                if path.is_empty() || seen.contains(&path) {
                    return true;
                }
                seen.insert(path.clone());
                rows.push(RecentChangedFileStat {
                    path,
                    status: git::delta_status_label(delta.status()).to_string(),
                    last_commit_id: commit_id.clone(),
                    last_commit_short_id: commit_short_id.clone(),
                    last_commit_message: message.clone(),
                    author: author.clone(),
                    email: email.clone(),
                    changed_at: changed_at.clone(),
                });
                true
            },
            None,
            None,
            None,
        );
    }

    Ok(rows)
}

fn branch_activity_lifecycle_stats(
    repo: &Repository,
    preferred_base_branch: Option<&str>,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<BranchActivityLifecycleReport> {
    let branches = git::collect_local_branch_tips(repo)?;
    if branches.is_empty() {
        return Ok(BranchActivityLifecycleReport {
            base_branch: String::new(),
            rows: Vec::new(),
        });
    }
    let base_branch = git::choose_base_branch(&branches, preferred_base_branch)
        .unwrap_or_else(|| branches[0].name.clone());
    let base_tip = branches
        .iter()
        .find(|b| b.name == base_branch)
        .map(|b| b.oid)
        .unwrap_or(branches[0].oid);

    let now_secs = Utc::now().timestamp();
    let recent_cutoff = now_secs - 7 * 86_400;
    let previous_cutoff = now_secs - 14 * 86_400;

    let mut rows: Vec<BranchActivityLifecycleStat> = Vec::new();

    for branch in branches {
        let mut revwalk = repo
            .revwalk()
            .map_err(|e| anyhow::anyhow!("Failed to create revwalk: {}", e))?;
        revwalk
            .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
            .map_err(|e| anyhow::anyhow!("Failed to set revwalk sort: {}", e))?;
        revwalk
            .push(branch.oid)
            .map_err(|e| anyhow::anyhow!("Failed to push branch tip: {}", e))?;
        if branch.name != base_branch {
            let _ = revwalk.hide(base_tip);
        }

        let mut unique_commit_count: u64 = 0;
        let mut recent_7d_commits: u64 = 0;
        let mut previous_7d_commits: u64 = 0;
        let mut first_commit_ts: Option<i64> = None;
        let mut last_active_ts: Option<i64> = None;
        let mut authors: HashSet<String> = HashSet::new();

        for oid_result in revwalk {
            let oid = match oid_result {
                Ok(v) => v,
                Err(_) => continue,
            };
            let commit = match repo.find_commit(oid) {
                Ok(c) => c,
                Err(_) => continue,
            };
            unique_commit_count += 1;
            let author = commit.author();
            let name = author.name().unwrap_or("Unknown").to_string();
            let email = author.email().unwrap_or("").trim().to_lowercase();
            let author_key = if email.is_empty() {
                format!("n:{}", name)
            } else {
                format!("e:{}", email)
            };
            authors.insert(author_key);

            let ts = commit.time().seconds();
            first_commit_ts = Some(first_commit_ts.map_or(ts, |v| v.min(ts)));
            last_active_ts = Some(last_active_ts.map_or(ts, |v| v.max(ts)));
            if ts >= recent_cutoff {
                recent_7d_commits += 1;
            } else if ts >= previous_cutoff {
                previous_7d_commits += 1;
            }
        }

        // 若相对基准无“新增提交”，回退到分支 tip 时间，便于展示生命周期/闲置天数。
        let tip_ts = repo
            .find_commit(branch.oid)
            .ok()
            .map(|c| c.time().seconds());
        let branch_created_ts = first_commit_ts.or(tip_ts);
        let last_active_fallback_ts = last_active_ts.or(tip_ts);

        let is_merged_into_base = branch.name != base_branch
            && repo
                .graph_descendant_of(base_tip, branch.oid)
                .unwrap_or(false);
        let merged_ts = if is_merged_into_base {
            git::first_contains_branch_time_on_base(repo, base_tip, branch.oid)
        } else {
            None
        };
        let first_commit_to_merge_days = match (first_commit_ts, merged_ts) {
            (Some(first), Some(merged)) => util::days_between(first, merged),
            _ => None,
        };

        rows.push(BranchActivityLifecycleStat {
            branch: branch.name,
            is_current: branch.is_current,
            unique_commit_count,
            active_author_count: authors.len() as u64,
            recent_7d_commits,
            previous_7d_commits,
            last_active_at: last_active_fallback_ts
                .map(|s| util::display_time_from_unix_ts(s, client_calendar_offset_east_minutes)),
            first_commit_at: first_commit_ts
                .map(|s| util::display_time_from_unix_ts(s, client_calendar_offset_east_minutes)),
            branch_created_at: branch_created_ts
                .map(|s| util::display_time_from_unix_ts(s, client_calendar_offset_east_minutes)),
            alive_days: branch_created_ts.and_then(|s| util::days_since(now_secs, s).map(|d| d + 1)),
            inactive_days: last_active_fallback_ts.and_then(|s| util::days_since(now_secs, s)),
            is_merged_into_base,
            merged_at: merged_ts.map(|s| util::display_time_from_unix_ts(s, client_calendar_offset_east_minutes)),
            first_commit_to_merge_days,
        });
    }

    rows.sort_by(|a, b| {
        b.unique_commit_count
            .cmp(&a.unique_commit_count)
            .then_with(|| b.recent_7d_commits.cmp(&a.recent_7d_commits))
            .then_with(|| a.branch.cmp(&b.branch))
    });

    Ok(BranchActivityLifecycleReport { base_branch, rows })
}

/// 供 Tauri 命令调用的统计入口。
pub mod commands {
    use super::*;

    pub fn author_commit_stats(repo: &Repository, scope: CommitLogScope) -> Result<Vec<AuthorCommitStat>> {
        author_commit_stats_for_scope(repo, scope)
    }

    pub fn commit_activity_stats(
        repo: &Repository,
        scope: CommitLogScope,
        granularity: &str,
        client_offset_east_minutes: Option<i32>,
    ) -> Result<Vec<TimeBucketStat>> {
        let map = walk_scope_time_buckets(repo, scope, granularity, client_offset_east_minutes)?;
        Ok(sorted_time_bucket_vec(map))
    }

    pub fn diff_aggregate_stats<F>(
        repo: &Repository,
        scope: CommitLogScope,
        path_limit: usize,
        on_progress: F,
    ) -> Result<DiffAggregateStats>
    where
        F: FnMut(u32, u32),
    {
        let (authors, paths) = author_line_and_path_stats_for_scope(repo, scope, path_limit, on_progress)?;
        Ok(DiffAggregateStats { authors, paths })
    }

    pub fn file_territory_stats<F>(
        repo: &Repository,
        scope: CommitLogScope,
        file_limit: usize,
        on_progress: F,
    ) -> Result<Vec<FileTerritoryStat>>
    where
        F: FnMut(u32, u32),
    {
        file_territory_stats_for_scope(repo, scope, file_limit, on_progress)
    }

    pub fn recent_changed_files(
        repo: &Repository,
        scope: CommitLogScope,
        limit: usize,
        client_calendar_offset_east_minutes: Option<i32>,
    ) -> Result<Vec<RecentChangedFileStat>> {
        recent_changed_files_for_scope(repo, scope, limit, client_calendar_offset_east_minutes)
    }

    pub fn branch_activity_lifecycle(
        repo: &Repository,
        preferred_base_branch: Option<&str>,
        client_calendar_offset_east_minutes: Option<i32>,
    ) -> Result<BranchActivityLifecycleReport> {
        branch_activity_lifecycle_stats(repo, preferred_base_branch, client_calendar_offset_east_minutes)
    }
}
