// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{Datelike, DateTime, FixedOffset, Utc};
use git2::{Oid, Repository, RepositoryState, StashFlags};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::fs;
use anyhow::Result;
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Condvar, Mutex, Once, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem, CustomMenuItem, GlobalWindowEvent};

/// AI 总结排查日志路径：调试构建写入仓库 `logs/ai-summary.log`；发布构建写入本机 `%LOCALAPPDATA%/GitLite/logs/`。可用环境变量 `GITLITE_AI_SUMMARY_LOG` 覆盖为绝对路径。
fn ai_summary_log_file_path() -> PathBuf {
    static CACHE: OnceLock<PathBuf> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            if let Ok(p) = std::env::var("GITLITE_AI_SUMMARY_LOG") {
                return PathBuf::from(p.trim());
            }
            if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../logs/ai-summary.log")
            } else {
                dirs::data_local_dir()
                    .unwrap_or_else(std::env::temp_dir)
                    .join("GitLite")
                    .join("logs")
                    .join("ai-summary.log")
            }
        })
        .clone()
}

static AI_SUMMARY_LOG_HEADER: Once = Once::new();
static AI_SUMMARY_LOG_MUTEX: Mutex<()> = Mutex::new(());

fn ai_summary_log_line(message: &str) {
    let path = ai_summary_log_file_path();
    AI_SUMMARY_LOG_HEADER.call_once(|| {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let header = format!(
            "\n======== {} [ai-summary] 日志文件: {} ========\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            path.display()
        );
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
            let _ = f.write_all(header.as_bytes());
            let _ = f.flush();
        }
        eprintln!(
            "[ai-summary] 详情已写入文件: {}",
            path.display()
        );
    });
    if let Ok(_g) = AI_SUMMARY_LOG_MUTEX.lock() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let line = format!(
            "{} {}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            message
        );
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
            let _ = f.write_all(line.as_bytes());
            let _ = f.flush();
        }
    }
    eprintln!("{}", message);
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitInfo {
    pub id: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub short_id: String,
    /// 父提交完整哈希（顺序与 Git 一致：首父、次父…），用于分支图
    pub parent_ids: Vec<String>,
}

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

/// Git 空树对象 id（用于根提交的 diff 一侧）
const GIT_EMPTY_TREE_OID: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

fn first_parent_tree_for_diff<'a>(
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

fn diff_commit_to_first_parent<'a>(
    repo: &'a Repository,
    commit: &'a git2::Commit,
) -> Result<git2::Diff<'a>> {
    let old_tree = first_parent_tree_for_diff(repo, commit)?;
    let new_tree = commit.tree().map_err(|e| anyhow::anyhow!("commit tree: {}", e))?;
    repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), None)
        .map_err(|e| anyhow::anyhow!("diff_tree_to_tree: {}", e))
}

/// 将「以东经分钟数」转为 `FixedOffset`（与前端 `-Date.getTimezoneOffset()` 一致），并限制在合理范围。
fn fixed_offset_from_east_minutes(minutes: i32) -> FixedOffset {
    let clamped = minutes.clamp(-18 * 60, 18 * 60);
    let secs = clamped.saturating_mul(60);
    FixedOffset::east_opt(secs).unwrap_or_else(|| FixedOffset::east_opt(0).unwrap())
}

/// 提交作者时间戳对应的 UTC 时刻，再换算到指定时区墙上时钟。
/// `client_offset_east_minutes`：`Some` 时使用界面本机时区（与热力图格子 `yyyy-MM-dd` 一致）；`None` 时使用 Git 作者签名中的时区偏移。
fn commit_calendar_datetime(
    commit: &git2::Commit,
    client_offset_east_minutes: Option<i32>,
) -> DateTime<FixedOffset> {
    let when = commit.author().when();
    let utc = DateTime::<Utc>::from_timestamp(when.seconds(), 0)
        .unwrap_or_else(|| DateTime::<Utc>::from_timestamp(0, 0).unwrap());
    match client_offset_east_minutes {
        Some(m) => utc.with_timezone(&fixed_offset_from_east_minutes(m)),
        None => {
            let off = FixedOffset::east_opt(when.offset_minutes() * 60)
                .unwrap_or_else(|| FixedOffset::east_opt(0).unwrap());
            utc.with_timezone(&off)
        }
    }
}

fn commit_display_time(commit: &git2::Commit, client_offset_east_minutes: Option<i32>) -> String {
    commit_calendar_datetime(commit, client_offset_east_minutes)
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

fn time_bucket_key(dt: &DateTime<FixedOffset>, granularity: &str) -> String {
    let d = dt.date_naive();
    match granularity {
        "day" => d.format("%Y-%m-%d").to_string(),
        "month" => d.format("%Y-%m").to_string(),
        "week" => {
            let iso = d.iso_week();
            format!("{}-W{:02}", iso.year(), iso.week())
        }
        _ => d.format("%Y-%m").to_string(),
    }
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
    revwalk_push_scope(repo, &mut revwalk, scope)?;

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
        let dt = commit_calendar_datetime(&commit, client_offset_east_minutes);
        let key = time_bucket_key(&dt, g);
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
    let oids = collect_revwalk_oids_for_scope(repo, scope)?;
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

        let diff = match diff_commit_to_first_parent(repo, &commit) {
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
    let oids = collect_revwalk_oids_for_scope(repo, scope)?;
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

        let diff = match diff_commit_to_first_parent(repo, &commit) {
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

fn delta_status_label(status: git2::Delta) -> &'static str {
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
    revwalk_push_scope(repo, &mut revwalk, scope)?;

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
        let diff = match diff_commit_to_first_parent(repo, &commit) {
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
        let changed_at = commit_display_time(&commit, client_calendar_offset_east_minutes);
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
                    status: delta_status_label(delta.status()).to_string(),
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

#[derive(Debug, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

/// 分支/远程引用指向的提交，用于在提交列表上标注分支名
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BranchRefTip {
    pub name: String,
    pub commit_id: String,
    pub is_remote: bool,
}

/// 某条分支是否包含指定提交（在分支 tip 的历史上）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BranchOnCommit {
    pub name: String,
    pub is_remote: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitBranchLabels {
    pub commit_id: String,
    pub branches: Vec<BranchOnCommit>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub status: String, // "added", "modified", "deleted", "renamed"
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceStatus {
    pub staged_files: Vec<FileChange>,
    pub unstaged_files: Vec<FileChange>,
    pub untracked_files: Vec<String>,
    /// 合并冲突等：与 staged/unstaged 分列，避免与「已暂存」混淆
    #[serde(default)]
    pub conflicted_files: Vec<FileChange>,
}

/// 拉取结果（供前端展示与日志；`kind` 为结构化分支标识）
#[derive(Debug, Serialize, Deserialize)]
pub struct PullOutcome {
    pub kind: String,
    pub message: String,
    pub head_oid_short: Option<String>,
    pub staged_count: usize,
    pub unstaged_count: usize,
    pub conflicted_count: usize,
    pub untracked_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PullWithLogsResult {
    pub logs: Vec<(String, String, String)>,
    pub outcome: PullOutcome,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteItem {
    pub name: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BranchUpstreamItem {
    pub name: String,
    pub upstream: Option<String>,
    pub is_current: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteManagementInfo {
    pub remotes: Vec<RemoteItem>,
    pub branches: Vec<BranchUpstreamItem>,
    pub current_branch: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StashInfo {
    pub id: String,
    pub message: String,
    pub timestamp: String,
    pub branch: String,
}

fn guess_stash_branch(message: &str) -> String {
    let msg = message.trim();
    if let Some(rest) = msg.strip_prefix("WIP on ") {
        if let Some((branch, _)) = rest.split_once(':') {
            let branch = branch.trim();
            if !branch.is_empty() {
                return branch.to_string();
            }
        }
    }
    if let Some(rest) = msg.strip_prefix("On ") {
        if let Some((branch, _)) = rest.split_once(':') {
            let branch = branch.trim();
            if !branch.is_empty() {
                return branch.to_string();
            }
        }
    }
    "unknown".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitDiff {
    pub commit: CommitInfo,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecentRepo {
    pub path: String,
    pub name: String,
    pub last_opened: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SilentStashBackup {
    pub id: String,
    pub name: String,
    pub repo_path: String,
    pub branch: String,
    pub operation_type: String,
    pub created_at: String,
    pub tracked_patch_path: String,
    pub untracked_root: String,
    pub affected_files: usize,
    pub tracked_files: Vec<String>,
    pub untracked_files: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OperationLogRecord {
    pub id: String,
    pub timestamp: String,
    pub repo_path: String,
    pub branch: String,
    pub operation_type: String,
    pub is_high_risk: bool,
    pub affected_files: usize,
    pub duration_ms: u128,
    pub status: String,
    pub error_detail: Option<String>,
    pub suggestion: Option<String>,
    pub silent_stash_id: Option<String>,
    pub silent_stash_name: Option<String>,
    pub silent_stash_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AutoSnapshotConfig {
    pub enabled: bool,
    #[serde(default = "default_snapshot_interval_minutes")]
    pub interval_minutes: u32,
}

fn default_snapshot_interval_minutes() -> u32 { 10 }

fn default_auto_snapshot_config() -> AutoSnapshotConfig {
    AutoSnapshotConfig { enabled: false, interval_minutes: 10 }
}

pub struct SchedulerState {
    current_repo: Mutex<Option<String>>,
    config: Mutex<AutoSnapshotConfig>,
    scheduler_thread: Mutex<Option<std::thread::JoinHandle<()>>>,
    restart_signal: Condvar,
    stop_flag: AtomicBool,
    busy: AtomicBool,
}

impl SchedulerState {
    fn new() -> Self {
        SchedulerState {
            current_repo: Mutex::new(None),
            config: Mutex::new(default_auto_snapshot_config()),
            scheduler_thread: Mutex::new(None),
            restart_signal: Condvar::new(),
            stop_flag: AtomicBool::new(false),
            busy: AtomicBool::new(false),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProxyConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub protocol: String, // "http", "socks5" (不支持 "https")
}

/// 大模型/API 配置（OpenAI 兼容接口：Ollama、智谱、自建网关等）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiConfig {
    pub enabled: bool,
    /// 预设类型：ollama | zhipu | openai_compatible | custom（仅用于前端展示，后端原样存储）
    pub provider: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    #[serde(default = "default_ai_test_timeout_seconds")]
    pub test_timeout_seconds: u64,
}

fn default_ai_test_timeout_seconds() -> u64 {
    20
}

fn normalize_ai_test_timeout_seconds(value: u64) -> u64 {
    value.clamp(3, 120)
}

fn default_ai_config() -> AiConfig {
    AiConfig {
        enabled: false,
        provider: "ollama".to_string(),
        base_url: "http://127.0.0.1:11434/v1".to_string(),
        api_key: None,
        model: "llama3.2".to_string(),
        test_timeout_seconds: default_ai_test_timeout_seconds(),
    }
}

#[tauri::command]
async fn get_ai_config() -> Result<AiConfig, String> {
    let config_file = get_config_dir().join("ai_config.json");
    if !config_file.exists() {
        return Ok(default_ai_config());
    }
    let content = fs::read_to_string(&config_file)
        .map_err(|e| format!("读取 AI 配置失败: {}", e))?;
    let mut config: AiConfig = serde_json::from_str(&content)
        .map_err(|e| format!("解析 AI 配置失败: {}", e))?;
    config.test_timeout_seconds =
        normalize_ai_test_timeout_seconds(config.test_timeout_seconds);
    Ok(config)
}

#[tauri::command]
async fn save_ai_config(config: AiConfig) -> Result<(), String> {
    let base = config.base_url.trim();
    if config.enabled && base.is_empty() {
        return Err("启用 AI 时请填写 API 地址".to_string());
    }
    let model = config.model.trim();
    if config.enabled && model.is_empty() {
        return Err("启用 AI 时请填写模型名称".to_string());
    }
    let normalized = AiConfig {
        enabled: config.enabled,
        provider: config.provider.trim().to_string(),
        base_url: base.to_string(),
        api_key: config
            .api_key
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        model: model.to_string(),
        test_timeout_seconds: normalize_ai_test_timeout_seconds(config.test_timeout_seconds),
    };
    let config_dir = get_config_dir();
    fs::create_dir_all(&config_dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    let config_file = config_dir.join("ai_config.json");
    let content = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("序列化 AI 配置失败: {}", e))?;
    fs::write(&config_file, content).map_err(|e| format!("写入 AI 配置失败: {}", e))?;
    Ok(())
}

/// 使用当前表单值发一条最小 chat/completions 请求，验证地址、密钥与模型是否可用。
#[tauri::command]
async fn test_ai_connection(config: AiConfig) -> Result<String, String> {
    let base_url = config.base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("请填写 API 地址".to_string());
    }
    let model = config.model.trim().to_string();
    if model.is_empty() {
        return Err("请填写模型名称".to_string());
    }
    let api_key = config
        .api_key
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let timeout_seconds = normalize_ai_test_timeout_seconds(config.test_timeout_seconds);

    let url = format!("{}/chat/completions", base_url);
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 8
    });

    let resp = std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(timeout_seconds))
            .build();
        let req = agent.post(&url).set("Content-Type", "application/json");
        let req = if let Some(ref key) = api_key {
            req.set("Authorization", &format!("Bearer {}", key))
        } else {
            req
        };
        req.send_json(body)
    })
    .join()
    .map_err(|_| "测试线程异常".to_string())?;

    let resp = resp.map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    let text = resp.into_string().unwrap_or_default();
    if status >= 400 {
        let short: String = text.chars().take(600).collect();
        return Err(format!("HTTP {} — {}", status, short));
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(err) = v.get("error") {
            let msg = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or(&text);
            return Err(format!("API 错误: {}", msg));
        }
    }
    Ok("测试成功：接口可用并已返回内容。".to_string())
}

/// 读取 `git diff --cached` 全文，供生成提交说明（需系统 PATH 中有 git）。
fn read_staged_diff_cached(repo_path: &str) -> Result<String, String> {
    let output = git_command()
        .args(["diff", "--cached"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("无法执行 git diff：{}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff --cached 失败：{}", stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn normalize_llm_commit_message(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("模型响应为空或只有空白字符".to_string());
    }

    let mut s = trimmed;
    if s.starts_with("```") {
        if let Some(idx) = s.find('\n') {
            s = &s[idx + 1..];
        } else {
            return Err("模型只返回了代码块标记，没有实际内容".to_string());
        }
        if let Some(end) = s.rfind("```") {
            s = s[..end].trim_end();
        }
    }

    let mut lines = s
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| {
            line.trim_start_matches("- ")
                .trim_start_matches("* ")
                .trim_start_matches("1. ")
                .trim_start_matches("2. ")
                .trim_start_matches("3. ")
                .trim()
        })
        .filter(|line| !line.is_empty());

    let first = lines
        .next()
        .ok_or_else(|| "模型返回了内容，但没有可用的首行文本".to_string())?;
    let second = lines.next();
    let first_msg = first.trim_matches('"').trim_matches('\'').trim();
    let msg = if first_msg.chars().count() < 16 {
        if let Some(s2) = second {
            format!("{}；{}", first_msg, s2.trim_matches('"').trim_matches('\'').trim())
        } else {
            first_msg.to_string()
        }
    } else {
        first_msg.to_string()
    };

    if msg.is_empty() {
        return Err("模型返回的首行内容在清理引号后变为空".to_string());
    }

    if matches!(msg.chars().next(), Some('{') | Some('[')) {
        return Err("模型返回了 JSON/数组格式，但这里需要纯文本提交说明".to_string());
    }

    let capped: String = msg.chars().take(120).collect();
    Ok(capped.trim().to_string())
}

/// AI 未给出可用提交说明时的兜底文案：尽量基于 diff 生成更完整的单行说明。
fn fallback_commit_message_from_diff(diff_text: &str) -> String {
    let mut files: HashSet<String> = HashSet::new();
    let mut added = 0usize;
    let mut deleted = 0usize;
    for line in diff_text.lines() {
        if let Some(rest) = line.strip_prefix("diff --git a/") {
            if let Some((left, _)) = rest.split_once(" b/") {
                let path = left.trim();
                if !path.is_empty() {
                    files.insert(path.to_string());
                }
            }
        }
        if line.starts_with('+') && !line.starts_with("+++") {
            added += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            deleted += 1;
        }
    }

    let file_count = files.len();
    if file_count == 0 {
        return "完善代码实现并同步调整细节".to_string();
    }
    if file_count == 1 {
        if let Some(path) = files.iter().next() {
            let short = path.rsplit('/').next().unwrap_or(path.as_str());
            if added + deleted > 0 {
                return format!(
                    "完善 {} 相关实现，新增 {} 行并调整 {} 行",
                    short, added, deleted
                );
            }
            return format!("完善 {} 相关实现并同步细节调整", short);
        }
    }
    let mut samples: Vec<&str> = files
        .iter()
        .map(|p| p.rsplit('/').next().unwrap_or(p.as_str()))
        .collect();
    samples.sort_unstable();
    let focus = samples.into_iter().take(3).collect::<Vec<_>>().join("、");
    if added + deleted > 0 {
        return format!(
            "完善多处改动（{} 个文件），新增 {} 行、调整 {} 行，涉及 {}",
            file_count, added, deleted, focus
        );
    }
    format!("完善多处改动（{} 个文件），重点涉及 {}", file_count, focus)
}

/// OpenAI 兼容 chat/completions，返回 assistant 文本（单条）。
fn openai_chat_completion_text(
    config: &AiConfig,
    messages: Vec<serde_json::Value>,
    max_tokens: u32,
    disable_thinking: bool,
) -> Result<String, String> {
    let base_url = config.base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("请填写 API 地址".to_string());
    }
    let model = config.model.trim().to_string();
    if model.is_empty() {
        return Err("请填写模型名称".to_string());
    }
    let api_key = config
        .api_key
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let url = format!("{}/chat/completions", base_url);
    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.3
    });
    if disable_thinking {
        if let Some(obj) = body.as_object_mut() {
            obj.insert(
                "thinking".to_string(),
                serde_json::json!({
                    "type": "disabled"
                }),
            );
            obj.insert("do_sample".to_string(), serde_json::json!(false));
            obj.insert("temperature".to_string(), serde_json::json!(0.0));
        }
    }

    let resp = std::thread::spawn(move || {
        let req = ureq::post(&url).set("Content-Type", "application/json");
        let req = if let Some(ref key) = api_key {
            req.set("Authorization", &format!("Bearer {}", key))
        } else {
            req
        };
        req.send_json(body)
    })
    .join()
    .map_err(|_| "请求线程异常".to_string())?;

    let resp = resp.map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    let text = resp.into_string().unwrap_or_default();
    if status >= 400 {
        let short: String = text.chars().take(800).collect();
        return Err(format!("HTTP {} — {}", status, short));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析响应失败: {}", e))?;
    if let Some(err) = v.get("error") {
        let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or(&text);
        return Err(format!("API 错误: {}", msg));
    }

    let choices = v
        .get("choices")
        .and_then(|c| c.as_array())
        .ok_or_else(|| "响应中无 choices 数组".to_string())?;
    let first = choices
        .first()
        .ok_or_else(|| "响应中 choices 为空".to_string())?;
    let message = first.get("message");
    let content_value = message.and_then(|m| m.get("content"));

    let content = match content_value {
        Some(serde_json::Value::String(s)) if !s.trim().is_empty() => s.to_string(),
        Some(serde_json::Value::String(_)) => {
            let summary = summarize_openai_chat_response(&v);
            log_message(
                "WARN",
                &format!(
                    "openai_chat_completion_text: empty content string | summary={}",
                    summary
                ),
            );
            return Err(format!("响应中 choices[0].message.content 为空；响应摘要：{}", summary));
        }
        Some(serde_json::Value::Array(arr)) => {
            let mut out = String::new();
            for item in arr {
                if let Some(t) = item.get("text").and_then(|x| x.as_str()) {
                    out.push_str(t);
                } else if let Some(t) = item.get("content").and_then(|x| x.as_str()) {
                    out.push_str(t);
                } else if let Some(t) = item.as_str() {
                    out.push_str(t);
                }
            }
            if out.trim().is_empty() {
                let summary = summarize_openai_chat_response(&v);
                log_message(
                    "WARN",
                    &format!(
                        "openai_chat_completion_text: empty content array | summary={}",
                        summary
                    ),
                );
                return Err(format!(
                    "响应中 choices[0].message.content 是数组，但没有可用文本；响应摘要：{}",
                    summary
                ));
            }
            out
        }
        Some(other) => {
            let summary = summarize_openai_chat_response(&v);
            log_message(
                "WARN",
                &format!(
                    "openai_chat_completion_text: unsupported content type={} | summary={}",
                    other,
                    summary
                ),
            );
            return Err(format!(
                "响应中 choices[0].message.content 类型不受支持；响应摘要：{}",
                summary
            ));
        }
        None => {
            let summary = summarize_openai_chat_response(&v);
            let message_reasoning = message
                .and_then(|m| m.get("reasoning_content"))
                .and_then(|c| c.as_str())
                .map(|s| s.chars().take(120).collect::<String>());
            let choice_text = first
                .get("text")
                .and_then(|c| c.as_str())
                .map(|s| s.chars().take(120).collect::<String>());
            log_message(
                "WARN",
                &format!(
                    "openai_chat_completion_text: missing content field | summary={} | reasoning_content_preview={:?} | choice_text_preview={:?}",
                    summary,
                    message_reasoning,
                    choice_text
                ),
            );
            return Err(format!("响应中无 choices[0].message.content；响应摘要：{}", summary));
        }
    };
    Ok(content)
}

fn summarize_openai_chat_response(v: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    if let Some(s) = v.get("object").and_then(|x| x.as_str()) {
        parts.push(format!("object={}", s));
    }
    if let Some(s) = v.get("model").and_then(|x| x.as_str()) {
        parts.push(format!("model={}", s));
    }
    if let Some(choices) = v.get("choices").and_then(|c| c.as_array()) {
        parts.push(format!("choices_len={}", choices.len()));
        if let Some(first) = choices.first() {
            if let Some(s) = first.get("finish_reason").and_then(|x| x.as_str()) {
                parts.push(format!("finish_reason={}", s));
            }
            if let Some(message) = first.get("message") {
                if let Some(content) = message.get("content") {
                    match content {
                        serde_json::Value::String(s) => parts.push(format!(
                            "message.content_len={}",
                            s.chars().count()
                        )),
                        serde_json::Value::Array(arr) => parts.push(format!(
                            "message.content_array_len={}",
                            arr.len()
                        )),
                        other => parts.push(format!("message.content_type={}", other)),
                    }
                } else {
                    parts.push("message.content=missing".to_string());
                }
                if let Some(s) = message.get("reasoning_content").and_then(|x| x.as_str()) {
                    parts.push(format!("message.reasoning_content_len={}", s.chars().count()));
                }
                if let Some(tc) = message.get("tool_calls").and_then(|x| x.as_array()) {
                    parts.push(format!("message.tool_calls_len={}", tc.len()));
                }
            } else if let Some(s) = first.get("text").and_then(|x| x.as_str()) {
                parts.push(format!("choice0.text_len={}", s.chars().count()));
            }
        }
    }
    if let Some(s) = v.get("usage") {
        parts.push(format!("usage={}", s));
    }
    if parts.is_empty() {
        serde_json::to_string(v)
            .unwrap_or_else(|_| "<unprintable response>".to_string())
            .chars()
            .take(300)
            .collect()
    } else {
        parts.join(" | ")
    }
}

fn should_disable_thinking_for_commit_message(config: &AiConfig) -> bool {
    let model = config.model.trim().to_ascii_lowercase();
    let base_url = config.base_url.trim().to_ascii_lowercase();
    model.starts_with("glm-") || base_url.contains("bigmodel.cn")
}

/// 从 OpenAI 兼容的 SSE `data:` JSON 中取本帧增量文本（不同网关/模型字段不一致）。
fn openai_sse_delta_piece(v: &serde_json::Value) -> Option<String> {
    if let Some(delta) = v.pointer("/choices/0/delta") {
        if delta.is_object() {
            // 最常见：delta.content 字符串
            if let Some(s) = delta.get("content").and_then(|c| c.as_str()) {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
            // 新版/网关：delta.content 为数组，元素含 text
            if let Some(arr) = delta.get("content").and_then(|c| c.as_array()) {
                let mut out = String::new();
                for item in arr {
                    if let Some(t) = item.get("text").and_then(|x| x.as_str()) {
                        out.push_str(t);
                    } else if let Some(t) = item.get("content").and_then(|x| x.as_str()) {
                        out.push_str(t);
                    } else if let Some(t) = item.as_str() {
                        out.push_str(t);
                    }
                }
                if !out.is_empty() {
                    return Some(out);
                }
            }
            // 部分兼容层使用 delta.text
            if let Some(s) = delta.get("text").and_then(|c| c.as_str()) {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
            // 推理模型常见：reasoning_content（无 content 时仍展示推理过程）
            if let Some(s) = delta.get("reasoning_content").and_then(|c| c.as_str()) {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
        }
    }
    // completion 流或缺少 delta：choices[0].text
    if let Some(s) = v.pointer("/choices/0/text").and_then(|c| c.as_str()) {
        if !s.is_empty() {
            return Some(s.to_string());
        }
    }
    None
}

/// OpenAI 兼容 `stream: true` 的 chat/completions；增量文本经 `tx` 送出，由异步任务调用 `window.emit`（勿在 `spawn_blocking` 内直接 emit，否则前端事件会积压到请求结束才显示）。
fn stream_openai_chat_sse(
    tx: tokio::sync::mpsc::UnboundedSender<String>,
    config: &AiConfig,
    messages: Vec<serde_json::Value>,
    max_tokens: u32,
) -> Result<(), String> {
    let base_url = config.base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("请填写 API 地址".to_string());
    }
    let model = config.model.trim().to_string();
    if model.is_empty() {
        return Err("请填写模型名称".to_string());
    }
    let api_key = config
        .api_key
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let url = format!("{}/chat/completions", base_url);
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.3,
        "stream": true
    });

    let resp = std::thread::spawn(move || {
        let req = ureq::post(&url).set("Content-Type", "application/json");
        let req = if let Some(ref key) = api_key {
            req.set("Authorization", &format!("Bearer {}", key))
        } else {
            req
        };
        req.send_json(body)
    })
    .join()
    .map_err(|_| "请求线程异常".to_string())?;

    let resp = resp.map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    if status >= 400 {
        let text = resp.into_string().unwrap_or_default();
        let short: String = text.chars().take(800).collect();
        return Err(format!("HTTP {} — {}", status, short));
    }

    ai_summary_log_line(&format!(
        "[ai-summary] sse HTTP {} 已开始读响应体（首字延迟取决于模型与 {} 字符左右的用户消息）",
        status,
        messages
            .get(1)
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .map(|s| s.chars().count())
            .unwrap_or(0)
    ));

    let reader = resp.into_reader();
    let mut buf_reader = BufReader::new(reader);
    let mut line_buf = String::new();
    let mut got_any_content = false;
    let mut delta_chunk_count: usize = 0;
    let mut delta_char_count: usize = 0;
    let mut json_parse_skips: usize = 0;
    let mut non_data_line_logs: usize = 0;
    let mut line_count: usize = 0;
    let mut no_delta_shape_logs: usize = 0;
    let t_sse = std::time::Instant::now();
    loop {
        line_buf.clear();
        let n = buf_reader
            .read_line(&mut line_buf)
            .map_err(|e| format!("读取流失败: {}", e))?;
        if n == 0 {
            break;
        }
        line_count += 1;
        if line_count == 1 {
            ai_summary_log_line(&format!(
                "[ai-summary] sse 首行已到达 (距读流开始 {:?})",
                t_sse.elapsed()
            ));
        }
        let line = line_buf.trim_end();
        if line.is_empty() {
            continue;
        }
        if !line.starts_with("data:") {
            if non_data_line_logs < 6 {
                non_data_line_logs += 1;
                let short: String = line.chars().take(160).collect();
                ai_summary_log_line(&format!(
                    "[ai-summary] sse 非 data: 行（跳过）#{}: {:?}",
                    non_data_line_logs, short
                ));
            }
            continue;
        }
        let rest = line[5..].trim_start();
        if rest == "[DONE]" {
            break;
        }
        let v: serde_json::Value = match serde_json::from_str(rest) {
            Ok(v) => v,
            Err(_) => {
                if json_parse_skips < 3 {
                    let short: String = rest.chars().take(160).collect();
                    ai_summary_log_line(&format!(
                        "[ai-summary] sse 非 JSON 行（跳过）: {:?}",
                        short
                    ));
                }
                json_parse_skips += 1;
                continue;
            }
        };
        if let Some(err) = v.get("error") {
            let msg = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown");
            return Err(format!("API 错误: {}", msg));
        }
        if let Some(content) = openai_sse_delta_piece(&v) {
            if !content.is_empty() {
                got_any_content = true;
                delta_chunk_count += 1;
                delta_char_count += content.chars().count();
                if delta_chunk_count <= 4 || delta_chunk_count % 50 == 0 {
                    let preview: String = content.chars().take(40).collect();
                    ai_summary_log_line(&format!(
                        "[ai-summary] sse delta #{} len={} total_chars={} preview={:?}",
                        delta_chunk_count,
                        content.chars().count(),
                        delta_char_count,
                        preview
                    ));
                }
                tx.send(content)
                    .map_err(|_| "UI 广播通道已关闭".to_string())?;
            }
        } else if no_delta_shape_logs < 3 && v.get("choices").is_some() {
            let short: String = serde_json::to_string(&v)
                .unwrap_or_default()
                .chars()
                .take(500)
                .collect();
            ai_summary_log_line(&format!(
                "[ai-summary] sse 有 choices 但未解析出增量文本，样例: {}",
                short
            ));
            no_delta_shape_logs += 1;
        }
    }
    ai_summary_log_line(&format!(
        "[ai-summary] sse 结束 raw_lines≈{} delta_chunks={} delta_chars={} json_parse_skips={} non_data_skip_logs={}",
        line_count,
        delta_chunk_count,
        delta_char_count,
        json_parse_skips,
        non_data_line_logs
    ));
    if !got_any_content {
        return Err("模型未返回有效内容（流式响应为空），请重试或检查模型是否支持 stream".to_string());
    }
    Ok(())
}

/// 根据暂存区 diff 调用已配置模型生成较完整的单行中文提交说明。
#[tauri::command]
async fn generate_commit_message_ai(repo_path: String) -> Result<String, String> {
    let config = get_ai_config().await?;
    if !config.enabled {
        return Err("请先在菜单「AI」中启用并保存配置".to_string());
    }
    let staged_diff = read_staged_diff_cached(&repo_path)?;

    let trimmed = staged_diff.trim();
    if trimmed.is_empty() {
        return Err("暂无暂存更改，请先暂存文件后再生成".to_string());
    }

    const MAX_DIFF_CHARS: usize = 48_000;
    let diff_for_prompt: String = if staged_diff.len() > MAX_DIFF_CHARS {
        let mut t = staged_diff.chars().take(MAX_DIFF_CHARS).collect::<String>();
        t.push_str("\n\n…（diff 过长已截断）");
        t
    } else {
        staged_diff
    };

    let system = "你是 Git 提交信息助手。只根据用户给出的暂存区 diff 写一条中文提交说明。\
要求：必须单行；建议 20-60 个中文字符；内容包含“做了什么 + 影响范围/对象”；优先具体表达，不要泛化成“更新代码/修复问题”。\
不要引号、不要 Markdown、不要解释、不要输出思考过程。若信息有限，也要给出最可能且尽量具体的一条说明。";
    let user = format!("以下为 git diff --cached：\n\n{}", diff_for_prompt);

    let messages = vec![
        serde_json::json!({"role": "system", "content": system}),
        serde_json::json!({"role": "user", "content": user}),
    ];

    let disable_thinking = should_disable_thinking_for_commit_message(&config);
    log_message(
        "INFO",
        &format!(
            "generate_commit_message_ai: request start | repo_path={} | model={} | disable_thinking={}",
            repo_path, config.model, disable_thinking
        ),
    );
    let raw = match openai_chat_completion_text(&config, messages, 512, disable_thinking) {
        Ok(raw) => raw,
        Err(e) => {
            let fallback = fallback_commit_message_from_diff(&diff_for_prompt);
            log_message(
                "WARN",
                &format!(
                    "generate_commit_message_ai: llm request failed, use fallback | repo_path={} | reason={} | fallback={}",
                    repo_path, e, fallback
                ),
            );
            return Ok(fallback);
        }
    };
    let msg = match normalize_llm_commit_message(&raw) {
        Ok(msg) => msg,
        Err(reason) => {
            let preview: String = raw
                .chars()
                .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
                .take(300)
                .collect();
            let fallback = fallback_commit_message_from_diff(&diff_for_prompt);
            log_message(
                "WARN",
                &format!(
                    "generate_commit_message_ai: invalid llm response, use fallback | repo_path={} | reason={} | raw_len={} | raw_preview={} | fallback={}",
                    repo_path,
                    reason,
                    raw.chars().count(),
                    preview,
                    fallback
                ),
            );
            fallback
        }
    };
    Ok(msg)
}

/// 提交页「AI 总结」传入的单条记录（与前端 CommitInfo 字段对齐，无需整仓库路径）。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommitLineForAi {
    pub short_id: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

fn parse_commit_line_date(s: &str) -> Option<chrono::NaiveDateTime> {
    chrono::NaiveDateTime::parse_from_str(s.trim(), "%Y-%m-%d %H:%M:%S").ok()
}

/// 根据当前筛选范围内的提交记录流式生成中文工作总结（经 `ai-summary-chunk` 推送增量）。
#[tauri::command]
async fn summarize_commits_ai_stream(
    window: tauri::Window,
    commits: Vec<CommitLineForAi>,
) -> Result<(), String> {
    let config = get_ai_config().await?;
    if !config.enabled {
        return Err("请先在菜单「AI」中启用并保存配置".to_string());
    }
    if commits.is_empty() {
        return Err("当前筛选范围内没有可总结的提交".to_string());
    }

    ai_summary_log_line(&format!(
        "[ai-summary] summarize_commits_ai_stream 开始 commits={}",
        commits.len()
    ));

    let mut rows = commits;
    rows.sort_by(|a, b| {
        let da = parse_commit_line_date(&a.date);
        let db = parse_commit_line_date(&b.date);
        match (da, db) {
            (Some(x), Some(y)) => x.cmp(&y),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        }
    });

    const MAX_ITEMS: usize = 500;
    const MAX_CHARS: usize = 100_000;
    let mut block = String::new();
    for (i, c) in rows.iter().take(MAX_ITEMS).enumerate() {
        let line = format!(
            "{}. {} | {} | {} | {}\n",
            i + 1,
            c.date,
            c.short_id,
            c.author,
            c.message
        );
        if block.len() + line.len() > MAX_CHARS {
            block.push_str("…（提交列表过长已截断）\n");
            break;
        }
        block.push_str(&line);
    }

    let system = "你是 Git 版本历史助手。用户会给出若干条提交记录（按时间从旧到新）。\
请用简洁的中文总结这些提交主要完成了什么工作：分主题或按时间脉络组织；用要点列表；不要逐条机械复述；若只能依据提交说明推断，可简要说明。";
    let user = format!("以下为当前筛选范围内的提交记录：\n\n{}", block.trim_end());

    let messages = vec![
        serde_json::json!({"role": "system", "content": system}),
        serde_json::json!({"role": "user", "content": user}),
    ];

    let _ = window.emit(
        "ai-summary-conversation",
        serde_json::json!({
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ]
        }),
    );

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let window_emit = window.clone();
    let emit_task = tokio::spawn(async move {
        let mut emit_n = 0usize;
        while let Some(text) = rx.recv().await {
            emit_n += 1;
            let tlen = text.chars().count();
            if emit_n <= 4 || emit_n % 50 == 0 {
                ai_summary_log_line(&format!(
                    "[ai-summary] window.emit ai-summary-chunk #{} len={}",
                    emit_n, tlen
                ));
            }
            let _ = window_emit.emit(
                "ai-summary-chunk",
                serde_json::json!({ "text": text }),
            );
        }
    });

    let config = config.clone();
    let read_result = tokio::task::spawn_blocking(move || stream_openai_chat_sse(tx, &config, messages, 2048))
        .await
        .map_err(|e| format!("流式任务异常: {}", e))?;

    read_result?;
    emit_task
        .await
        .map_err(|e| format!("流式广播任务异常: {}", e))?;

    ai_summary_log_line("[ai-summary] summarize_commits_ai_stream 完成（invoke 将返回）");
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RepoInfo {
    pub path: String,
    pub current_branch: String,
    /// HEAD 指向的提交短哈希（约 7 字符），空仓库或无提交时为 None
    pub head_short_id: Option<String>,
    pub branches: Vec<BranchInfo>,
    pub commits: Vec<CommitInfo>,
    pub ahead: u32,   // 本地比远端超前的提交数（待推送）
    pub behind: u32,  // 本地比远端落后的提交数（待拉取）
    /// 远程有而本地尚未合并的提交（等价于 `git log HEAD..@{upstream}`），用于列表顶部展示
    pub incoming_commits: Vec<CommitInfo>,
    pub remote_url: Option<String>, // 远程仓库URL
    /// 当前本地分支是否已设置上游（`@{upstream}` 存在）。为 false 时 ahead/behind 无意义。
    pub has_upstream: bool,
    /// 是否存在名为 `origin` 的远程（推送/拉取/获取依赖此名）。
    pub has_origin_remote: bool,
}

/// 与 Git 索引一致：正斜杠、无 `./` 前缀，避免 Windows 反斜杠导致 reset / add 未命中条目。
fn normalize_repo_rel_path(path: &str) -> String {
    let p = path
        .trim()
        .trim_start_matches("./")
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    p
}

/// 推送/拉取等与「当前检出分支」绑定的操作：分离 HEAD 时返回错误，禁止默认成 main 误推。
fn branch_name_for_sync_commands(repo: &Repository) -> Result<String, String> {
    let head = repo
        .head()
        .map_err(|e| format!("无法获取 HEAD: {}", e))?;
    if !head.is_branch() {
        return Err(
            "当前为分离 HEAD（未检出本地分支），请 checkout 到某个分支后再进行推送、拉取或与远程同步。"
                .to_string(),
        );
    }
    let name = head.shorthand().map(|s| s.to_string()).ok_or_else(|| {
        "无法解析当前分支名（分离 HEAD？），请检出一个分支后再试。".to_string()
    })?;
    if name == "detached" {
        return Err(
            "当前为分离 HEAD（未检出本地分支），请检出一个分支后再试。".to_string(),
        );
    }
    Ok(name)
}

fn emit_push_log(app: &tauri::AppHandle, payload: serde_json::Value) {
    if let Some(w) = app.get_window("main") {
        let _ = w.emit("push-log", payload);
    } else {
        let _ = app.emit_all("push-log", payload);
    }
}

fn dedupe_file_changes_by_path(v: &mut Vec<FileChange>) {
    let mut seen = HashSet::new();
    v.retain(|f| seen.insert(f.path.clone()));
}

fn dedupe_strings_preserve_order(v: &mut Vec<String>) {
    let mut seen = HashSet::new();
    v.retain(|s| seen.insert(s.clone()));
}

// 获取最近打开的仓库列表
#[tauri::command]
async fn get_recent_repos() -> Result<Vec<RecentRepo>, String> {
    let config_dir = get_config_dir();
    let config_file = config_dir.join("recent_repos.json");
    
    if !config_file.exists() {
        return Ok(Vec::new());
    }
    
    let content = fs::read_to_string(&config_file)
        .map_err(|e| format!("Failed to read config file: {}", e))?;
    
    let repos: Vec<RecentRepo> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config file: {}", e))?;
    Ok(repos)
}

// 保存最近打开的仓库
#[tauri::command]
async fn save_recent_repo(path: String) -> Result<(), String> {
    let config_dir = get_config_dir();
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    
    let config_file = config_dir.join("recent_repos.json");
    
    // 读取现有列表
    let mut repos = if config_file.exists() {
        let content = fs::read_to_string(&config_file)
            .map_err(|e| format!("Failed to read config file: {}", e))?;
        match serde_json::from_str::<Vec<RecentRepo>>(&content) {
            Ok(repos) => repos,
            Err(e) => {
                // JSON 损坏：备份原文件，避免数据丢失
                log_message("WARN", &format!("recent_repos.json 解析失败，已备份: {}", e));
                let _ = fs::copy(&config_file, config_file.with_extension("json.bak"));
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };
    
    // 获取仓库名称（若已有记录则保留用户重命名后的显示名）
    let repo_name = Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Unknown")
        .to_string();
    let preserved_name = repos
        .iter()
        .find(|r| r.path == path)
        .map(|r| r.name.clone());
    
    // 移除已存在的相同路径
    repos.retain(|repo| repo.path != path);
    
    let name = preserved_name.unwrap_or(repo_name);
    
    // 添加新的仓库到列表开头
    let recent_repo = RecentRepo {
        path: path.clone(),
        name,
        last_opened: chrono::Utc::now().to_rfc3339(),
    };
    repos.insert(0, recent_repo);

    const MAX_RECENT_REPOS: usize = 30;
    if repos.len() > MAX_RECENT_REPOS {
        repos.truncate(MAX_RECENT_REPOS);
    }
    
    // 保存到文件
    let content = serde_json::to_string_pretty(&repos)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_file, content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn remove_recent_repo(path: String) -> Result<(), String> {
    let config_dir = get_config_dir();
    let config_file = config_dir.join("recent_repos.json");
    if !config_file.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&config_file)
        .map_err(|e| format!("Failed to read config file: {}", e))?;
    let mut repos: Vec<RecentRepo> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config file: {}", e))?;
    let before = repos.len();
    repos.retain(|r| r.path != path);
    if repos.len() == before {
        return Ok(());
    }
    let content = serde_json::to_string_pretty(&repos)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_file, content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn rename_recent_repo(path: String, new_name: String) -> Result<(), String> {
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() {
        return Err("名称不能为空".to_string());
    }
    let config_dir = get_config_dir();
    let config_file = config_dir.join("recent_repos.json");
    if !config_file.exists() {
        return Err("最近列表为空".to_string());
    }
    let content = fs::read_to_string(&config_file)
        .map_err(|e| format!("Failed to read config file: {}", e))?;
    let mut repos: Vec<RecentRepo> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config file: {}", e))?;
    let Some(repo) = repos.iter_mut().find(|r| r.path == path) else {
        return Err("未找到该仓库".to_string());
    };
    repo.name = new_name;
    let content = serde_json::to_string_pretty(&repos)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_file, content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn update_recent_repo_entry(
    old_path: String,
    new_path: String,
    new_name: String,
) -> Result<(), String> {
    let new_path = new_path.trim().to_string();
    let new_name = new_name.trim().to_string();
    if new_path.is_empty() {
        return Err("路径不能为空".to_string());
    }
    if new_name.is_empty() {
        return Err("名称不能为空".to_string());
    }

    let config_dir = get_config_dir();
    let config_file = config_dir.join("recent_repos.json");
    if !config_file.exists() {
        return Err("最近列表为空".to_string());
    }
    let content = fs::read_to_string(&config_file)
        .map_err(|e| format!("Failed to read config file: {}", e))?;
    let mut repos: Vec<RecentRepo> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config file: {}", e))?;

    if !repos.iter().any(|r| r.path == old_path) {
        return Err("未找到该仓库".to_string());
    }

    if old_path != new_path {
        repos.retain(|r| r.path == old_path || r.path != new_path);
    }

    let Some(repo) = repos.iter_mut().find(|r| r.path == old_path) else {
        return Err("未找到该仓库".to_string());
    };
    repo.path = new_path;
    repo.name = new_name;

    let content = serde_json::to_string_pretty(&repos)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_file, content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;
    Ok(())
}

// 获取配置目录
fn get_config_dir() -> std::path::PathBuf {
    let mut config_dir = dirs::config_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    config_dir.push("GitLite");
    config_dir
}

/// 构造 `git` 子进程。Windows 上必须隐藏控制台，否则会每次执行都闪出类似 cmd 的黑窗口。
fn git_command() -> std::process::Command {
    let mut cmd = std::process::Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

/// 在指定仓库目录执行系统 `git`（与 VS / 命令行一致，沿用 http.proxy、凭据助手等）
fn run_git_in_repo(repo_path: &str, args: &[&str]) -> Result<std::process::Output, std::io::Error> {
    git_command()
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
}

/// 直接执行系统 `git`（不带 `-C`），用于 clone 等仓库外命令。
fn run_git(args: &[&str]) -> Result<std::process::Output, std::io::Error> {
    git_command().args(args).output()
}

fn git_output_detail(output: &std::process::Output) -> String {
    let stdout_lossy = String::from_utf8_lossy(&output.stdout);
    let stderr_lossy = String::from_utf8_lossy(&output.stderr);
    let stdout = stdout_lossy.trim();
    let stderr = stderr_lossy.trim();
    let mut s = String::new();
    if !stdout.is_empty() {
        s.push_str(stdout);
    }
    if !stderr.is_empty() {
        if !s.is_empty() {
            s.push('\n');
        }
        s.push_str(stderr);
    }
    s
}

fn reliability_dir() -> PathBuf {
    get_config_dir().join("reliability")
}

fn operation_log_file() -> PathBuf {
    reliability_dir().join("operation_logs.json")
}

fn silent_stashes_dir() -> PathBuf {
    reliability_dir().join("silent-stashes")
}

fn auto_snapshot_config_file() -> PathBuf {
    reliability_dir().join("auto_snapshot_config.json")
}

fn load_auto_snapshot_config() -> AutoSnapshotConfig {
    let file = auto_snapshot_config_file();
    if !file.exists() {
        return default_auto_snapshot_config();
    }
    fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str::<AutoSnapshotConfig>(&s).ok())
        .unwrap_or_else(default_auto_snapshot_config)
}

fn save_auto_snapshot_config_to_disk(config: &AutoSnapshotConfig) -> Result<(), String> {
    fs::create_dir_all(reliability_dir()).map_err(|e| format!("创建配置目录失败: {}", e))?;
    let content =
        serde_json::to_string_pretty(config).map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::write(auto_snapshot_config_file(), content).map_err(|e| format!("写入配置失败: {}", e))
}

fn restart_scheduler(app_handle: tauri::AppHandle) {
    let state: Arc<SchedulerState> = (*app_handle.state::<Arc<SchedulerState>>()).clone();

    // 通知旧线程停止
    {
        state.stop_flag.store(true, Ordering::SeqCst);
        state.restart_signal.notify_all();
        let mut running = state.scheduler_thread.lock().unwrap();
        if let Some(h) = running.take() {
            let _ = h.join();
        }
    }
    state.stop_flag.store(false, Ordering::SeqCst);

    let config = state.config.lock().unwrap().clone();
    if !config.enabled {
        return;
    }

    let interval_secs = (config.interval_minutes.max(1) as u64) * 60;
    let state_for_thread = state.clone();

    let handle = std::thread::spawn(move || {
        loop {
            // 等待 interval 或被唤醒
            let guard = state_for_thread.config.lock().unwrap();
            let _ = state_for_thread
                .restart_signal
                .wait_timeout(guard, Duration::from_secs(interval_secs))
                .unwrap();

            // 检查是否应停止
            if state_for_thread.stop_flag.load(Ordering::SeqCst) {
                return;
            }

            let cfg = state_for_thread.config.lock().unwrap().clone();
            if !cfg.enabled {
                return;
            }

            let repo = state_for_thread.current_repo.lock().unwrap().clone();
            let Some(repo_path) = repo else {
                continue;
            };

            if state_for_thread
                .busy
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                let started = Instant::now();
                let result = create_silent_stash_backup(&repo_path, "auto-snapshot");
                match &result {
                    Ok(Some(b)) => {
                        let msg = format!("自动快照: {}", b.name);
                        record_git_write_operation(
                            &repo_path,
                            "auto-snapshot",
                            false,
                            started,
                            &Ok(msg),
                            Some(b),
                            Some(b.affected_files),
                        );
                    }
                    Ok(None) => {
                        // 工作区无变更，不记录日志
                    }
                    Err(e) => {
                        record_git_write_operation(
                            &repo_path,
                            "auto-snapshot",
                            false,
                            started,
                            &Err(e.clone()),
                            None,
                            None,
                        );
                    }
                }
                state_for_thread.busy.store(false, Ordering::SeqCst);
            }
        }
    });

    *state.scheduler_thread.lock().unwrap() = Some(handle);
}

fn safe_filename_piece(input: &str) -> String {
    let mut out = String::new();
    for c in input.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
            out.push(c);
        } else {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "op".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn current_branch_label(repo: &Repository) -> String {
    repo.head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "detached".to_string())
}

fn read_operation_logs_file() -> Vec<OperationLogRecord> {
    let file = operation_log_file();
    if !file.exists() {
        return Vec::new();
    }
    fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<OperationLogRecord>>(&s).ok())
        .unwrap_or_default()
}

fn append_operation_log(record: OperationLogRecord) {
    let dir = reliability_dir();
    if let Err(e) = fs::create_dir_all(&dir) {
        log_message("WARN", &format!("operation log: create dir failed: {}", e));
        return;
    }
    let mut logs = read_operation_logs_file();
    logs.insert(0, record);
    const MAX_OPERATION_LOGS: usize = 200;
    if logs.len() > MAX_OPERATION_LOGS {
        logs.truncate(MAX_OPERATION_LOGS);
    }
    match serde_json::to_string_pretty(&logs) {
        Ok(content) => {
            if let Err(e) = fs::write(operation_log_file(), content) {
                log_message("WARN", &format!("operation log: write failed: {}", e));
            }
        }
        Err(e) => log_message("WARN", &format!("operation log: serialize failed: {}", e)),
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建备份目录失败: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let ty = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败: {}", e))?;
        if ty.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if ty.is_file() {
            if let Some(parent) = dst_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建备份父目录失败: {}", e))?;
            }
            fs::copy(&src_path, &dst_path).map_err(|e| format!("复制未跟踪文件失败: {}", e))?;
        }
    }
    Ok(())
}

fn copy_repo_path_to_backup(repo_path: &str, rel: &str, backup_root: &Path) -> Result<(), String> {
    let key = normalize_repo_rel_path(rel).trim_end_matches('/').to_string();
    if key.is_empty() {
        return Ok(());
    }
    let src = Path::new(repo_path).join(&key);
    if !src.exists() {
        return Ok(());
    }
    let dst = backup_root.join(&key);
    if src.is_dir() {
        copy_dir_recursive(&src, &dst)
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建备份父目录失败: {}", e))?;
        }
        fs::copy(&src, &dst).map_err(|e| format!("复制未跟踪文件失败: {}", e))?;
        Ok(())
    }
}

fn collect_dirty_paths_for_backup(repo: &Repository, ws: &WorkspaceStatus) -> Vec<String> {
    let mut set = HashSet::new();
    if let Ok(paths) = paths_dirty_vs_head(repo) {
        set.extend(paths);
    }
    for f in &ws.staged_files {
        set.insert(f.path.clone());
    }
    for f in &ws.unstaged_files {
        set.insert(f.path.clone());
    }
    for f in &ws.conflicted_files {
        set.insert(f.path.clone());
    }
    for f in &ws.untracked_files {
        set.insert(normalize_repo_rel_path(f));
    }
    let mut v: Vec<String> = set.into_iter().filter(|s| !s.is_empty()).collect();
    v.sort();
    v
}

fn read_silent_stash_metadata(id: &str) -> Result<SilentStashBackup, String> {
    let safe_id = safe_filename_piece(id);
    let file = silent_stashes_dir().join(safe_id).join("metadata.json");
    let content = fs::read_to_string(&file).map_err(|e| format!("读取静默贮藏元数据失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析静默贮藏元数据失败: {}", e))
}

fn cleanup_old_silent_stashes() {
    let root = silent_stashes_dir();
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    let mut dirs: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .collect();
    dirs.sort_by(|a, b| b.0.cmp(&a.0));
    const MAX_SILENT_STASHES: usize = 30;
    for (_, path) in dirs.into_iter().skip(MAX_SILENT_STASHES) {
        let _ = fs::remove_dir_all(path);
    }
}

fn create_silent_stash_backup(
    repo_path: &str,
    operation_type: &str,
) -> Result<Option<SilentStashBackup>, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    let ws = collect_workspace_status(&repo)?;
    let dirty = !ws.staged_files.is_empty()
        || !ws.unstaged_files.is_empty()
        || !ws.untracked_files.is_empty()
        || !ws.conflicted_files.is_empty();
    if !dirty {
        return Ok(None);
    }

    let affected_files = collect_dirty_paths_for_backup(&repo, &ws);
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S%.3f").to_string();
    let op_piece = safe_filename_piece(operation_type);
    let id = format!("auto-stash-{}-{}", timestamp, op_piece);
    let backup_dir = silent_stashes_dir().join(&id);
    let untracked_root = backup_dir.join("untracked");
    fs::create_dir_all(&untracked_root).map_err(|e| format!("创建静默贮藏目录失败: {}", e))?;

    let patch_path = backup_dir.join("tracked.patch");
    let diff_output = run_git_in_repo(repo_path, &["diff", "--binary", "HEAD"])
        .or_else(|_| run_git_in_repo(repo_path, &["diff", "--binary"]))
        .map_err(|e| format!("生成静默贮藏 patch 失败: {}", e))?;
    if diff_output.status.success() {
        fs::write(&patch_path, &diff_output.stdout)
            .map_err(|e| format!("写入静默贮藏 patch 失败: {}", e))?;
    } else {
        let detail = git_output_detail(&diff_output);
        fs::write(&patch_path, Vec::<u8>::new())
            .map_err(|e| format!("写入空 patch 失败: {}", e))?;
        log_message("WARN", &format!("silent stash: git diff failed: {}", detail));
    }

    let mut untracked_files = Vec::new();
    for f in &ws.untracked_files {
        let key = normalize_repo_rel_path(f);
        if key.is_empty() {
            continue;
        }
        copy_repo_path_to_backup(repo_path, &key, &untracked_root)?;
        untracked_files.push(key);
    }
    untracked_files.sort();
    untracked_files.dedup();

    let tracked_files: Vec<String> = affected_files
        .iter()
        .filter(|p| !untracked_files.contains(p))
        .cloned()
        .collect();

    let backup = SilentStashBackup {
        id: id.clone(),
        name: format!("auto-stash-{}-{}", timestamp, op_piece),
        repo_path: repo_path.to_string(),
        branch: current_branch_label(&repo),
        operation_type: operation_type.to_string(),
        created_at: chrono::Local::now().to_rfc3339(),
        tracked_patch_path: patch_path.to_string_lossy().to_string(),
        untracked_root: untracked_root.to_string_lossy().to_string(),
        affected_files: affected_files.len(),
        tracked_files,
        untracked_files,
    };

    let metadata = serde_json::to_string_pretty(&backup)
        .map_err(|e| format!("序列化静默贮藏元数据失败: {}", e))?;
    fs::write(backup_dir.join("metadata.json"), metadata)
        .map_err(|e| format!("写入静默贮藏元数据失败: {}", e))?;
    cleanup_old_silent_stashes();
    log_message(
        "INFO",
        &format!(
            "silent stash: created | repo={} op={} id={} files={}",
            repo_path, operation_type, backup.id, backup.affected_files
        ),
    );
    Ok(Some(backup))
}

fn reliability_suggestion(operation_type: &str, err: Option<&str>) -> Option<String> {
    let e = err.unwrap_or("");
    if e.contains("conflict") || e.contains("冲突") {
        return Some("请先查看冲突文件；可在可靠性面板中查看本次操作前的静默贮藏。".to_string());
    }
    if e.contains("overwrite") || e.contains("覆盖") || e.contains("未提交") {
        return Some("本地改动已生成静默贮藏备份；建议查看影响文件后再重试。".to_string());
    }
    match operation_type {
        "checkout" | "switch" => Some("若切换失败，请确认目标分支存在，并检查本地改动是否与目标分支冲突。".to_string()),
        "pull" | "merge" => Some("若远程合并失败，请先 fetch 查看远端状态，必要时解决冲突后继续。".to_string()),
        "reset-hard" | "rebase" => Some("历史改写类操作失败后，请检查仓库是否处于进行中状态；必要时使用 Git 命令中止。".to_string()),
        "discard" => Some("丢弃操作前已创建静默备份，可从可靠性面板查看或恢复。".to_string()),
        _ => None,
    }
}

fn record_git_write_operation(
    repo_path: &str,
    operation_type: &str,
    is_high_risk: bool,
    started: Instant,
    result: &Result<String, String>,
    backup: Option<&SilentStashBackup>,
    affected_files: Option<usize>,
) {
    let branch = Repository::open(repo_path)
        .ok()
        .map(|repo| current_branch_label(&repo))
        .unwrap_or_else(|| "unknown".to_string());
    let status = if result.is_ok() { "success" } else { "failed" }.to_string();
    let error_detail = result.as_ref().err().cloned();
    let suggestion = reliability_suggestion(operation_type, error_detail.as_deref());
    append_operation_log(OperationLogRecord {
        id: format!(
            "{}-{}",
            chrono::Utc::now().timestamp_millis(),
            safe_filename_piece(operation_type)
        ),
        timestamp: chrono::Local::now().to_rfc3339(),
        repo_path: repo_path.to_string(),
        branch,
        operation_type: operation_type.to_string(),
        is_high_risk,
        affected_files: affected_files.or_else(|| backup.map(|b| b.affected_files)).unwrap_or(0),
        duration_ms: started.elapsed().as_millis(),
        status,
        error_detail,
        suggestion,
        silent_stash_id: backup.map(|b| b.id.clone()),
        silent_stash_name: backup.map(|b| b.name.clone()),
        silent_stash_path: backup.map(|b| {
            Path::new(&b.tracked_patch_path)
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .to_string_lossy()
                .to_string()
        }),
    });
}

#[tauri::command]
async fn get_auto_snapshot_config(
    state: tauri::State<'_, Arc<SchedulerState>>,
) -> Result<AutoSnapshotConfig, String> {
    Ok(state.config.lock().unwrap().clone())
}

#[tauri::command]
async fn save_auto_snapshot_config(
    config: AutoSnapshotConfig,
    state: tauri::State<'_, Arc<SchedulerState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let interval = config.interval_minutes.max(1).min(1440);
    let normalized = AutoSnapshotConfig {
        enabled: config.enabled,
        interval_minutes: interval,
    };
    save_auto_snapshot_config_to_disk(&normalized)?;
    *state.config.lock().unwrap() = normalized;
    restart_scheduler(app_handle);
    Ok(())
}

#[tauri::command]
async fn set_current_repo_for_snapshot(
    repo_path: Option<String>,
    state: tauri::State<'_, Arc<SchedulerState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    *state.current_repo.lock().unwrap() = repo_path;
    restart_scheduler(app_handle);
    Ok(())
}

#[tauri::command]
async fn trigger_auto_snapshot_now(
    state: tauri::State<'_, Arc<SchedulerState>>,
) -> Result<String, String> {
    let scheduler: Arc<SchedulerState> = (*state).clone();
    let repo = scheduler
        .current_repo
        .lock()
        .unwrap()
        .clone()
        .ok_or("未打开仓库")?;
    if scheduler
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("定时快照正在进行中".to_string());
    }
    let started = Instant::now();
    let result = create_silent_stash_backup(&repo, "auto-snapshot");
    scheduler.busy.store(false, Ordering::SeqCst);
    match result {
        Ok(Some(b)) => {
            let msg = format!("已创建快照: {}", b.name);
            record_git_write_operation(&repo, "auto-snapshot", false, started, &Ok(msg.clone()), Some(&b), Some(b.affected_files));
            Ok(msg)
        }
        Ok(None) => Ok("工作区无变更，跳过".to_string()),
        Err(e) => {
            record_git_write_operation(&repo, "auto-snapshot", false, started, &Err(e.clone()), None, None);
            Err(e)
        }
    }
}

#[tauri::command]
async fn get_operation_logs(limit: Option<usize>) -> Result<Vec<OperationLogRecord>, String> {
    let mut logs = read_operation_logs_file();
    let lim = limit.unwrap_or(100).max(1).min(200);
    if logs.len() > lim {
        logs.truncate(lim);
    }
    Ok(logs)
}

#[tauri::command]
async fn get_silent_stash_diff(stash_id: String) -> Result<String, String> {
    let backup = read_silent_stash_metadata(&stash_id)?;
    let mut text = fs::read_to_string(&backup.tracked_patch_path)
        .unwrap_or_else(|_| String::new());
    if !backup.untracked_files.is_empty() {
        text.push_str("\n\n# Untracked files copied in this silent stash:\n");
        for f in backup.untracked_files {
            text.push_str("# ");
            text.push_str(&f);
            text.push('\n');
        }
    }
    Ok(text)
}

#[tauri::command]
async fn restore_silent_stash(stash_id: String) -> Result<String, String> {
    let started = Instant::now();
    let backup = read_silent_stash_metadata(&stash_id)?;
    let mut result: Result<String, String> = Ok(String::new());

    let patch_path = backup.tracked_patch_path.clone();
    if fs::metadata(&patch_path).map(|m| m.len()).unwrap_or(0) > 0 {
        // 优先用 --3way 三路合并（兼容工作区已有改动），失败则回退 --index
        let out = run_git_in_repo(&backup.repo_path, &["apply", "--3way", &patch_path])
            .map_err(|e| format!("无法执行 git apply: {}", e));
        match out {
            Ok(output) if output.status.success() => {}
            Ok(_) => {
                let out2 = run_git_in_repo(&backup.repo_path, &["apply", "--index", &patch_path])
                    .map_err(|e| format!("无法执行 git apply: {}", e));
                match out2 {
                    Ok(output) if output.status.success() => {}
                    Ok(output) => {
                        result = Err(format!("恢复 tracked patch 失败: {}", git_output_detail(&output)));
                    }
                    Err(e) => result = Err(e),
                }
            }
            Err(e) => result = Err(e),
        }
    }

    if result.is_ok() {
        for rel in &backup.untracked_files {
            let src = Path::new(&backup.untracked_root).join(rel);
            let dst = Path::new(&backup.repo_path).join(rel);
            if src.is_dir() {
                copy_dir_recursive(&src, &dst)?;
            } else if src.is_file() {
                if let Some(parent) = dst.parent() {
                    fs::create_dir_all(parent).map_err(|e| format!("创建恢复目录失败: {}", e))?;
                }
                // Windows: 目标文件若存在且只读，fs::copy 会报 Access denied，先尝试删除
                if dst.exists() {
                    let _ = fs::remove_file(&dst);
                }
                fs::copy(&src, &dst).map_err(|e| format!("恢复未跟踪文件失败: {}", e))?;
            }
        }
        result = Ok(format!("已恢复静默贮藏 {}", backup.name));
    }

    record_git_write_operation(
        &backup.repo_path,
        "restore-silent-stash",
        false,
        started,
        &result,
        Some(&backup),
        Some(backup.affected_files),
    );
    result
}

// 获取代理配置
#[tauri::command]
async fn get_proxy_config() -> Result<(ProxyConfig, bool), String> {
    let config_dir = get_config_dir();
    let config_file = config_dir.join("proxy_config.json");
    
    // 1. 优先从本地配置文件读取（用户明确保存的配置）
    if config_file.exists() {
        let content = fs::read_to_string(&config_file)
            .map_err(|e| format!("Failed to read proxy config file: {}", e))?;
        
        let config: ProxyConfig = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse proxy config file: {}", e))?;
        
        return Ok((config, false)); // 不是从Git配置读取的
    }
    
    // 2. 如果本地没有配置，尝试从Git全局配置读取
    if let Ok(Some(git_config)) = get_git_proxy_config() {
        return Ok((git_config, true)); // 是从Git配置读取的
    }
    
    // 3. 返回默认配置
    Ok((ProxyConfig {
        enabled: false,
        host: "127.0.0.1".to_string(),
        port: 7890,
        username: None,
        password: None,
        protocol: "http".to_string(),
    }, false)) // 默认配置，不是从Git读取的
}

// 从Git全局配置读取代理设置
fn get_git_proxy_config() -> Result<Option<ProxyConfig>, String> {
    // 尝试读取HTTP代理
    let http_proxy = match git_command()
        .args(&["config", "--global", "--get", "http.proxy"])
        .output()
    {
        Ok(output) => {
            if output.status.success() {
                let proxy_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !proxy_str.is_empty() {
                    Some(proxy_str)
                } else {
                    None
                }
            } else {
                None
            }
        },
        Err(_) => None,
    };
    
    // 尝试读取HTTPS代理
    let https_proxy = match git_command()
        .args(&["config", "--global", "--get", "https.proxy"])
        .output()
    {
        Ok(output) => {
            if output.status.success() {
                let proxy_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !proxy_str.is_empty() {
                    Some(proxy_str)
                } else {
                    None
                }
            } else {
                None
            }
        },
        Err(_) => None,
    };
    
    // 优先使用HTTPS代理，如果没有则使用HTTP代理
    let proxy_url = https_proxy.or(http_proxy);
    
    if let Some(url) = proxy_url {
        // 解析代理URL
        match parse_proxy_url(&url) {
            Ok(config) => {
                log_message("INFO", &format!("Found Git proxy configuration: {}", url));
                Ok(Some(config))
            },
            Err(e) => {
                log_message("WARN", &format!("Failed to parse Git proxy URL '{}': {}", url, e));
                Ok(None)
            }
        }
    } else {
        Ok(None)
    }
}

// 验证代理协议，只允许 http 或 socks5
fn validate_proxy_protocol(protocol: &str) -> Result<(), String> {
    match protocol {
        "http" | "socks5" => Ok(()),
        "https" => Err("代理协议不支持 https，请选择 http 或 socks5".to_string()),
        _ => Err(format!("不支持的代理协议: {}，只允许 http 或 socks5", protocol)),
    }
}

// 解析代理URL
fn parse_proxy_url(url: &str) -> Result<ProxyConfig, String> {
    // 确定协议（禁止 https）
    let (protocol, url_without_protocol) = if url.starts_with("socks5://") {
        ("socks5", &url[9..])
    } else if url.starts_with("https://") {
        // https 代理协议不支持，转换为 http
        log_message("WARN", &format!("检测到 https 代理协议，已自动转换为 http: {}", url));
        ("http", &url[8..])
    } else if url.starts_with("http://") {
        ("http", &url[7..])
    } else {
        ("http", url)
    };
    
    // 检查是否包含认证信息
    let (host_port, username, password) = if let Some(at_pos) = url_without_protocol.find('@') {
        let auth_part = &url_without_protocol[..at_pos];
        let host_part = &url_without_protocol[at_pos + 1..];
        
        let (user, pass) = if let Some(colon_pos) = auth_part.find(':') {
            (
                Some(auth_part[..colon_pos].to_string()),
                Some(auth_part[colon_pos + 1..].to_string())
            )
        } else {
            (Some(auth_part.to_string()), None)
        };
        
        (host_part, user, pass)
    } else {
        (url_without_protocol, None, None)
    };
    
    // 解析主机和端口
    let (host, port) = if let Some(colon_pos) = host_port.find(':') {
        let host = host_port[..colon_pos].to_string();
        let port_str = &host_port[colon_pos + 1..];
        let port = port_str.parse::<u16>()
            .map_err(|_| format!("Invalid port number: {}", port_str))?;
        (host, port)
    } else {
        // 默认端口
        (host_port.to_string(), 8080)
    };
    
    let protocol_str = protocol.to_string();
    // 验证协议
    validate_proxy_protocol(&protocol_str)?;
    
    Ok(ProxyConfig {
        enabled: true,
        host,
        port,
        username,
        password,
        protocol: protocol_str,
    })
}

// 保存代理配置
#[tauri::command]
async fn save_proxy_config(config: ProxyConfig) -> Result<(), String> {
    // 验证协议
    validate_proxy_protocol(&config.protocol)?;
    
    let config_dir = get_config_dir();
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    
    let config_file = config_dir.join("proxy_config.json");
    
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize proxy config: {}", e))?;
    
    fs::write(&config_file, content)
        .map_err(|e| format!("Failed to write proxy config file: {}", e))?;
    
    Ok(())
}

// Git 配置项
#[derive(Debug, Serialize, Deserialize)]
pub struct GitConfigItem {
    pub origin: String,
    pub key: String,
    pub value: String,
}

// 获取 Git 配置信息（与代理、SSL 相关）
#[tauri::command]
async fn get_git_config_info() -> Result<Vec<GitConfigItem>, String> {
    // 执行 git config --list --show-origin
    let output = match git_command()
        .args(&["config", "--list", "--show-origin"])
        .output()
    {
        Ok(output) => {
            if output.status.success() {
                String::from_utf8_lossy(&output.stdout).to_string()
            } else {
                return Ok(vec![]); // 如果命令失败，返回空列表
            }
        },
        Err(e) => {
            return Err(format!("Failed to execute git config command: {}", e));
        }
    };
    
    // 过滤与代理、SSL 相关的配置
    let keywords = ["proxy", "ssl", "cainfo", "cacert", "backend", "schannel"];
    let mut config_items = Vec::new();
    
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        
        // 解析格式: file:path/to/config	key=value (使用制表符分隔)
        // 或者: file:path/to/config key=value (使用空格分隔，较少见)
        let parts: Vec<&str> = if line.contains('\t') {
            // 优先使用制表符分隔（标准格式）
            line.splitn(2, '\t').collect()
        } else {
            // 如果没有制表符，尝试使用空格分隔
            line.splitn(2, ' ').collect()
        };
        
        if parts.len() != 2 {
            continue;
        }
        
        let origin = parts[0].trim().to_string();
        let key_value = parts[1].trim();
        
        // 解析 key=value
        let kv_parts: Vec<&str> = key_value.splitn(2, '=').collect();
        if kv_parts.len() != 2 {
            continue;
        }
        
        let key = kv_parts[0];
        let value = kv_parts[1].to_string();
        
        // 检查是否包含关键词（不区分大小写）
        let key_lower = key.to_lowercase();
        if keywords.iter().any(|&keyword| key_lower.contains(keyword)) {
            config_items.push(GitConfigItem {
                origin,
                key: key.to_string(),
                value,
            });
        }
    }
    
    Ok(config_items)
}

fn local_proxy_override_file_exists() -> bool {
    get_config_dir().join("proxy_config.json").exists()
}

// 清理仓库中的错误代理配置（https://...）
fn cleanup_invalid_proxy_config(repo: &Repository) -> Result<Vec<String>, String> {
    let mut cleaned_keys = Vec::new();
    let mut config = repo.config()
        .map_err(|e| format!("Failed to get repository config: {}", e))?;
    
    // 检查 http.proxy
    if let Ok(http_proxy) = config.get_string("http.proxy") {
        if http_proxy.starts_with("https://") {
            if let Err(e) = config.remove("http.proxy") {
                log_message("WARN", &format!("清理 http.proxy 失败: {}", e));
            } else {
                cleaned_keys.push("http.proxy".to_string());
                log_message("WARN", &format!("已清理错误的 http.proxy 配置: {}", http_proxy));
            }
        }
    }
    
    // 检查 https.proxy
    if let Ok(https_proxy) = config.get_string("https.proxy") {
        if https_proxy.starts_with("https://") {
            if let Err(e) = config.remove("https.proxy") {
                log_message("WARN", &format!("清理 https.proxy 失败: {}", e));
            } else {
                cleaned_keys.push("https.proxy".to_string());
                log_message("WARN", &format!("已清理错误的 https.proxy 配置: {}", https_proxy));
            }
        }
    }
    
    Ok(cleaned_keys)
}

// 简单日志写入（追加到 GitLite/logs/gitlite.log）
fn log_message(level: &str, message: &str) {
    let base = get_config_dir();
    let log_dir = base.join("logs");
    if let Err(e) = fs::create_dir_all(&log_dir) {
        eprintln!("Failed to create log dir: {}", e);
        return;
    }
    let log_file = log_dir.join("gitlite.log");
    let timestamp = chrono::Local::now().to_rfc3339();
    let line = format!("[{}][{}] {}\n", timestamp, level, message);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_file) {
        let _ = f.write_all(line.as_bytes());
    }
}

// 返回日志文件完整路径（若目录不存在则创建）
#[tauri::command]
async fn get_log_file_path() -> Result<String, String> {
    let base = get_config_dir();
    let log_dir = base.join("logs");
    if let Err(e) = fs::create_dir_all(&log_dir) {
        return Err(format!("Failed to create log directory: {}", e));
    }
    let log_file = log_dir.join("gitlite.log");
    Ok(log_file.to_string_lossy().to_string())
}

// 前端可用：追加一条调试日志到 gitlite.log
#[tauri::command]
async fn append_gitlite_log(level: String, message: String) -> Result<(), String> {
    let lv = level.trim();
    let normalized = if lv.is_empty() { "INFO" } else { lv };
    log_message(normalized, &message);
    Ok(())
}

// 打开日志目录（跨平台）
#[tauri::command]
async fn open_log_dir() -> Result<(), String> {
    let base = get_config_dir();
    let log_dir = base.join("logs");
    if let Err(e) = fs::create_dir_all(&log_dir) {
        return Err(format!("Failed to create log directory: {}", e));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

// 打开指定文件夹（跨平台）
#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    use std::path::PathBuf;
    let target: PathBuf = PathBuf::from(path);
    if !target.exists() {
        return Err("Folder does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

// 在默认浏览器中打开外部链接（跨平台）
#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    // 校验 URL 以防命令注入（cmd.exe 会解释 shell 元字符）
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://") || trimmed.starts_with("mailto:")) {
        return Err("不支持的 URL 协议".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    Ok(())
}

// 打开 Git 仓库
#[tauri::command]
async fn open_repository(
    path: String,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<RepoInfo, String> {
    let path_for_repo = path.clone();
    let repo_info = tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&path_for_repo)
            .map_err(|e| format!("无法打开仓库：{}", e))?;

        // 清理错误的代理配置（https://...）
        if let Ok(cleaned_keys) = cleanup_invalid_proxy_config(&repo) {
            if !cleaned_keys.is_empty() {
                log_message("INFO", &format!("已清理错误的代理配置: {:?}", cleaned_keys));
            }
        }

        get_repository_info(&repo, &path_for_repo, client_calendar_offset_east_minutes)
            .map_err(|e| format!("无法读取仓库信息：{}", e))
    })
    .await
    .map_err(|e| format!("任务已中断: {}", e))??;

    // 保存到最近打开的仓库列表（异步 I/O，保留在阻塞段之外）
    if let Err(e) = save_recent_repo(path).await {
        eprintln!("Failed to save recent repo: {}", e);
    }

    Ok(repo_info)
}

/// 初始化一个新的 Git 仓库（等价于 `git init`）。
#[tauri::command]
async fn init_repository(path: String, initial_branch: Option<String>) -> Result<String, String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("仓库路径不能为空".to_string());
    }

    let target = PathBuf::from(p);
    if !target.exists() {
        return Err(format!("目录不存在: {}", p));
    }
    if !target.is_dir() {
        return Err(format!("目标不是目录: {}", p));
    }

    if Repository::open(&target).is_ok() {
        return Err("该目录已经是一个 Git 仓库".to_string());
    }

    let mut opts = git2::RepositoryInitOptions::new();
    if let Some(b) = initial_branch
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        opts.initial_head(b);
    }

    Repository::init_opts(&target, &opts).map_err(|e| format!("初始化仓库失败: {}", e.message()))?;
    Ok(format!("已初始化仓库: {}", target.display()))
}

/// 克隆远程仓库到本地目录（等价于 `git clone`）。
#[tauri::command]
async fn clone_repository(
    app_handle: tauri::AppHandle,
    remote_url: String,
    destination_path: String,
    branch: Option<String>,
) -> Result<String, String> {
    let url = remote_url.trim();
    let dest = destination_path.trim();
    if url.is_empty() {
        return Err("远程地址不能为空".to_string());
    }
    if dest.is_empty() {
        return Err("目标路径不能为空".to_string());
    }

    let dest_path = PathBuf::from(dest);
    if dest_path.exists() {
        if !dest_path.is_dir() {
            return Err("目标路径已存在且不是目录".to_string());
        }
        let mut rd = fs::read_dir(&dest_path).map_err(|e| format!("读取目标目录失败: {}", e))?;
        if rd.next().is_some() {
            return Err("目标目录非空，请选择一个空目录或不存在的路径".to_string());
        }
    } else {
        // 目标路径不存在：检查父目录是否存在，不存在则报错（不自动创建）
        if let Some(parent) = dest_path.parent() {
            if !parent.exists() {
                return Err(format!("父目录不存在: {}", parent.display()));
            }
        }
    }

    let branch_name = branch
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // 构造 git clone --progress 参数
    let mut args: Vec<String> = vec![
        "-c".to_string(),
        "clone.defaultRemoteName=origin".to_string(),
        "clone".to_string(),
        "--progress".to_string(),
    ];
    if let Some(b) = branch_name.as_ref() {
        args.push("--branch".to_string());
        args.push(b.clone());
    }
    args.push(url.to_string());
    args.push(dest.to_string());

    // 注入代理配置
    let proxy_args = build_git_proxy_args();

    // spawn 进程，流式读取 stderr 进度
    let mut cmd = git_command();
    for pa in &proxy_args {
        cmd.arg(pa);
    }
    cmd.args(&args);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 git clone: {}", e))?;

    let stderr = child.stderr.take().ok_or("无法读取 git 输出")?;
    let window = app_handle.clone();
    let stderr_thread = std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                let trimmed = line.trim().to_string();
                if !trimmed.is_empty() {
                    let _ = window.emit_all("clone-progress", &trimmed);
                }
            }
        }
    });

    let status = child
        .wait()
        .map_err(|e| format!("等待 git clone 完成失败: {}", e))?;

    let _ = stderr_thread.join();

    if !status.success() {
        // 解析常见错误，提供友好提示
        let code = status.code().unwrap_or(-1);
        return Err(match code {
            128 => "克隆失败：远程地址无效或认证失败，请检查地址和凭据".to_string(),
            _ => format!("克隆失败（退出码 {}）", code),
        });
    }

    Repository::open(&dest_path).map_err(|e| format!("克隆后无法打开仓库: {}", e))?;
    Ok(format!("已克隆到 {}", dest_path.display()))
}

/// 读取代理配置，生成 git -c http.proxy=... 参数
fn build_git_proxy_args() -> Vec<String> {
    let config_file = get_config_dir().join("proxy_config.json");
    if !config_file.exists() {
        return Vec::new();
    }
    let Ok(content) = fs::read_to_string(&config_file) else {
        return Vec::new();
    };
    let Ok(config) = serde_json::from_str::<ProxyConfig>(&content) else {
        return Vec::new();
    };
    if !config.enabled {
        return Vec::new();
    }
    let proxy_url = format!(
        "{}://{}:{}@{}:{}",
        config.protocol,
        config.username.as_deref().unwrap_or(""),
        config.password.as_deref().unwrap_or(""),
        config.host,
        config.port
    );
    // 去掉空的 user:pass@
    let proxy_url = proxy_url
        .replace("://:@", "://");
    vec![
        "-c".to_string(),
        format!("http.proxy={}", proxy_url),
        "-c".to_string(),
        format!("https.proxy={}", proxy_url),
    ]
}

#[tauri::command]
async fn get_remote_management_info(repo_path: String) -> Result<RemoteManagementInfo, String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    let current_branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "detached".to_string());

    let remotes = repo
        .remotes()
        .map_err(|e| format!("读取远程列表失败: {}", e))?;
    let mut remote_items = Vec::new();
    for i in 0..remotes.len() {
        let Some(name) = remotes.get(i) else {
            continue;
        };
        let remote = repo
            .find_remote(name)
            .map_err(|e| format!("读取远程 {} 失败: {}", name, e))?;
        remote_items.push(RemoteItem {
            name: name.to_string(),
            fetch_url: remote.url().map(|s| s.to_string()),
            push_url: remote.pushurl().map(|s| s.to_string()),
        });
    }
    remote_items.sort_by(|a, b| a.name.cmp(&b.name));

    let branch_iter = repo
        .branches(Some(git2::BranchType::Local))
        .map_err(|e| format!("读取本地分支失败: {}", e))?;
    let mut branches = Vec::new();
    for branch_result in branch_iter {
        let (branch, _) = branch_result.map_err(|e| format!("读取分支失败: {}", e))?;
        let name = branch
            .name()
            .map_err(|e| format!("读取分支名失败: {}", e))?
            .unwrap_or("unknown")
            .to_string();
        let upstream = branch
            .upstream()
            .ok()
            .and_then(|up| up.name().ok().flatten().map(|s| s.to_string()))
            .map(|s| {
                s.strip_prefix("refs/remotes/")
                    .map(|x| x.to_string())
                    .unwrap_or(s)
            });
        branches.push(BranchUpstreamItem {
            is_current: name == current_branch,
            name,
            upstream,
        });
    }
    branches.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(RemoteManagementInfo {
        remotes: remote_items,
        branches,
        current_branch,
    })
}

#[tauri::command]
async fn add_remote(repo_path: String, name: String, url: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    let remote_name = name.trim();
    let remote_url = url.trim();
    if remote_name.is_empty() {
        return Err("远程名称不能为空".to_string());
    }
    if remote_url.is_empty() {
        return Err("远程地址不能为空".to_string());
    }
    if repo.find_remote(remote_name).is_ok() {
        return Err(format!("远程 {} 已存在", remote_name));
    }
    repo.remote(remote_name, remote_url)
        .map_err(|e| format!("新增远程失败: {}", e.message()))?;
    Ok(format!("已新增远程 {} -> {}", remote_name, remote_url))
}

#[tauri::command]
async fn update_remote(repo_path: String, name: String, url: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    let remote_name = name.trim();
    let remote_url = url.trim();
    if remote_name.is_empty() {
        return Err("远程名称不能为空".to_string());
    }
    if remote_url.is_empty() {
        return Err("远程地址不能为空".to_string());
    }
    repo.find_remote(remote_name)
        .map_err(|_| format!("未找到远程 {}", remote_name))?;
    repo.remote_set_url(remote_name, remote_url)
        .map_err(|e| format!("更新远程失败: {}", e.message()))?;
    Ok(format!("已更新远程 {} -> {}", remote_name, remote_url))
}

#[tauri::command]
async fn remove_remote(repo_path: String, name: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    let remote_name = name.trim();
    if remote_name.is_empty() {
        return Err("远程名称不能为空".to_string());
    }
    repo.find_remote(remote_name)
        .map_err(|_| format!("未找到远程 {}", remote_name))?;
    repo.remote_delete(remote_name)
        .map_err(|e| format!("删除远程失败: {}", e.message()))?;
    Ok(format!("已删除远程 {}", remote_name))
}

#[tauri::command]
async fn set_branch_upstream(
    repo_path: String,
    branch_name: String,
    upstream_ref: Option<String>,
) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    let name = branch_name.trim();
    if name.is_empty() {
        return Err("分支名不能为空".to_string());
    }

    let mut branch = repo
        .find_branch(name, git2::BranchType::Local)
        .map_err(|_| format!("未找到本地分支 {}", name))?;

    let normalized_upstream = upstream_ref
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.strip_prefix("refs/remotes/")
                .map(|x| x.to_string())
                .unwrap_or(s)
        });

    branch
        .set_upstream(normalized_upstream.as_deref())
        .map_err(|e| format!("设置上游失败: {}", e.message()))?;

    if let Some(up) = normalized_upstream {
        Ok(format!("已将 {} 的上游设置为 {}", name, up))
    } else {
        Ok(format!("已清除 {} 的上游分支", name))
    }
}

// 获取仓库信息
fn get_repository_info(
    repo: &Repository,
    path: &str,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<RepoInfo> {
    // 获取当前分支
    let head = repo.head().map_err(|e| anyhow::anyhow!("Failed to get HEAD: {}", e))?;
    let current_branch = head.shorthand().unwrap_or("detached").to_string();
    let head_short_id = head.peel_to_commit().ok().map(|c| {
        let s = c.id().to_string();
        if s.len() > 7 {
            s[..7].to_string()
        } else {
            s
        }
    });
    
    // 获取分支列表
    let mut branches = Vec::new();
    let branch_iter = repo.branches(Some(git2::BranchType::Local))
        .map_err(|e| anyhow::anyhow!("Failed to get branches: {}", e))?;
    
    for branch_result in branch_iter {
        let (branch, _branch_type) = branch_result
            .map_err(|e| anyhow::anyhow!("Failed to iterate branch: {}", e))?;
        
        let branch_name = branch.name()
            .map_err(|e| anyhow::anyhow!("Failed to get branch name: {}", e))?
            .unwrap_or("unknown")
            .to_string();
        
        let is_current = branch_name == current_branch;
        
        branches.push(BranchInfo {
            name: branch_name,
            is_current,
            is_remote: false,
        });
    }
    
    // 获取提交历史
    let commits = get_commit_history(repo, client_calendar_offset_east_minutes)?;

    // 计算当前分支与上游的 ahead/behind
    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;
    // 通过分支名找到本地与上游引用
    if let Ok(branch) = repo.find_branch(&current_branch, git2::BranchType::Local) {
        // 本地提交
        let local_oid_opt = branch.get().target();
        // 上游跟踪分支（origin/<branch>）
        let upstream_oid_opt = branch.upstream().ok().and_then(|up| up.get().target());
        if let (Some(local_oid), Some(upstream_oid)) = (local_oid_opt, upstream_oid_opt) {
            if let Ok((a, b)) = repo.graph_ahead_behind(local_oid, upstream_oid) {
                ahead = a as u32;
                behind = b as u32;
            }
        }
    }

    let incoming_commits =
        get_incoming_commits(repo, &current_branch, behind, client_calendar_offset_east_minutes);

    let has_upstream = repo
        .find_branch(&current_branch, git2::BranchType::Local)
        .ok()
        .map(|b| b.upstream().is_ok())
        .unwrap_or(false);
    let has_origin_remote = repo.find_remote("origin").is_ok();
    
    // 获取远程仓库URL
    let remote_url = repo.find_remote("origin")
        .ok()
        .and_then(|remote| remote.url().map(|url| url.to_string()));
    
    Ok(RepoInfo {
        path: path.to_string(),
        current_branch,
        head_short_id,
        branches,
        commits,
        ahead,
        behind,
        incoming_commits,
        remote_url,
        has_upstream,
        has_origin_remote,
    })
}

/// 列出 `git log HEAD..@{upstream}` 中的提交（需已 fetch，对象在本地远程跟踪分支上）。
/// 失败或无上游时返回空列表，不阻断打开仓库。
fn get_incoming_commits(
    repo: &Repository,
    current_branch: &str,
    behind: u32,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Vec<CommitInfo> {
    if behind == 0 {
        return Vec::new();
    }
    let Ok(branch) = repo.find_branch(current_branch, git2::BranchType::Local) else {
        return Vec::new();
    };
    let Some(local_oid) = branch.get().target() else {
        return Vec::new();
    };
    let Ok(upstream_ref) = branch.upstream() else {
        return Vec::new();
    };
    let Some(upstream_oid) = upstream_ref.get().target() else {
        return Vec::new();
    };

    let mut revwalk = match repo.revwalk() {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    if revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .is_err()
    {
        return Vec::new();
    }
    if revwalk.push(upstream_oid).is_err() || revwalk.hide(local_oid).is_err() {
        return Vec::new();
    }

    let limit = (behind as usize).min(500);
    let mut out = Vec::new();
    for oid_result in revwalk {
        if out.len() >= limit {
            break;
        }
        let Ok(oid) = oid_result else {
            continue;
        };
        let Ok(commit) = repo.find_commit(oid) else {
            continue;
        };
        let author = commit.author();
        let message = commit.message().unwrap_or("No message").to_string();
        let date = commit_display_time(&commit, client_calendar_offset_east_minutes);
        out.push(CommitInfo {
            id: oid.to_string(),
            short_id: format!("{:.7}", oid),
            message: message.lines().next().unwrap_or("").to_string(),
            author: author.name().unwrap_or("Unknown").to_string(),
            email: author.email().unwrap_or("").to_string(),
            date,
            parent_ids: commit_parent_ids(&commit),
        });
    }
    out
}

fn commit_parent_ids(commit: &git2::Commit) -> Vec<String> {
    (0..commit.parent_count())
        .filter_map(|i| commit.parent_id(i).ok())
        .map(|oid| oid.to_string())
        .collect()
}

/// 提交列表范围：当前 HEAD 可达历史，或所有本地分支 / 远程跟踪 / 标签可达（类似 `git log --all` 的引用集合），或指定引用（如某本地分支名，不经检出）。
#[derive(Clone, PartialEq, Eq)]
enum CommitLogScope {
    Head,
    AllRefs,
    /// `git rev-parse` 可解析的引用（分支名、origin/main 等）
    Rev(String),
}

fn commit_log_scope_from_parts(scope: Option<&str>, rev: Option<&str>) -> CommitLogScope {
    if let Some(r) = rev.map(str::trim).filter(|t| !t.is_empty()) {
        return CommitLogScope::Rev(r.to_string());
    }
    match scope.map(str::trim).filter(|t| !t.is_empty()) {
        Some("all") => CommitLogScope::AllRefs,
        _ => CommitLogScope::Head,
    }
}

fn revwalk_push_scope(
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
            let obj = repo
                .revparse_single(ref_spec.as_str())
                .map_err(|e| anyhow::anyhow!("无法解析引用 \"{}\": {}", ref_spec, e))?;
            revwalk
                .push(obj.id())
                .map_err(|e| anyhow::anyhow!("Failed to push rev: {}", e))?;
        }
    }
    Ok(())
}

#[derive(Clone)]
struct LocalBranchTip {
    name: String,
    oid: Oid,
    is_current: bool,
}

fn collect_local_branch_tips(repo: &Repository) -> Result<Vec<LocalBranchTip>> {
    let current_branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_default();
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

fn choose_base_branch(branches: &[LocalBranchTip], preferred: Option<&str>) -> Option<String> {
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

fn display_time_from_unix_ts(secs: i64, client_calendar_offset_east_minutes: Option<i32>) -> String {
    let utc = DateTime::<Utc>::from_timestamp(secs, 0)
        .unwrap_or_else(|| DateTime::<Utc>::from_timestamp(0, 0).unwrap());
    match client_calendar_offset_east_minutes {
        Some(m) => utc
            .with_timezone(&fixed_offset_from_east_minutes(m))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string(),
        None => utc.format("%Y-%m-%d %H:%M:%S").to_string(),
    }
}

fn days_since(now_secs: i64, then_secs: i64) -> Option<u64> {
    if now_secs < then_secs {
        return Some(0);
    }
    Some(((now_secs - then_secs) / 86_400) as u64)
}

fn days_between(start_secs: i64, end_secs: i64) -> Option<u64> {
    if end_secs < start_secs {
        return Some(0);
    }
    Some(((end_secs - start_secs) / 86_400) as u64)
}

/// 在 base 分支第一父链上定位「首次包含 branch_tip 的提交时间」；可用于近似“合并时间”。
fn first_contains_branch_time_on_base(repo: &Repository, base_tip: Oid, branch_tip: Oid) -> Option<i64> {
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

fn branch_activity_lifecycle_stats(
    repo: &Repository,
    preferred_base_branch: Option<&str>,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<BranchActivityLifecycleReport> {
    let branches = collect_local_branch_tips(repo)?;
    if branches.is_empty() {
        return Ok(BranchActivityLifecycleReport {
            base_branch: String::new(),
            rows: Vec::new(),
        });
    }
    let base_branch = choose_base_branch(&branches, preferred_base_branch)
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
            first_contains_branch_time_on_base(repo, base_tip, branch.oid)
        } else {
            None
        };
        let first_commit_to_merge_days = match (first_commit_ts, merged_ts) {
            (Some(first), Some(merged)) => days_between(first, merged),
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
                .map(|s| display_time_from_unix_ts(s, client_calendar_offset_east_minutes)),
            first_commit_at: first_commit_ts
                .map(|s| display_time_from_unix_ts(s, client_calendar_offset_east_minutes)),
            branch_created_at: branch_created_ts
                .map(|s| display_time_from_unix_ts(s, client_calendar_offset_east_minutes)),
            alive_days: branch_created_ts.and_then(|s| days_since(now_secs, s).map(|d| d + 1)),
            inactive_days: last_active_fallback_ts.and_then(|s| days_since(now_secs, s)),
            is_merged_into_base,
            merged_at: merged_ts.map(|s| display_time_from_unix_ts(s, client_calendar_offset_east_minutes)),
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

// 获取分页提交历史
fn get_commit_history_paginated(
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
        let date = commit_display_time(&commit, client_calendar_offset_east_minutes);
        
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
fn get_commit_history(
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

/// 按范围统计可达提交总数（与分页遍历使用相同的 revwalk 起点与排序）。
fn count_commits_scoped(repo: &Repository, scope: CommitLogScope) -> Result<usize> {
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

/// 单次 revwalk 收集 scope 内全部提交 OID（排序与 `count_commits_scoped` / 分页一致）。
/// 用于增删行统计等需知总数再逐条处理的任务，避免「先全量 count 再全量 diff」对历史遍历两遍。
fn collect_revwalk_oids_for_scope(
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

/// 在指定历史范围内按作者（邮箱优先去重）统计提交次数，结果按次数降序。
fn author_commit_stats_for_scope(repo: &Repository, scope: CommitLogScope) -> Result<Vec<AuthorCommitStat>> {
    let mut revwalk = repo
        .revwalk()
        .map_err(|e| anyhow::anyhow!("Failed to create revwalk: {}", e))?;
    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(|e| anyhow::anyhow!("Failed to set revwalk sort: {}", e))?;
    revwalk_push_scope(repo, &mut revwalk, scope)?;

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

#[tauri::command]
async fn get_author_commit_stats(
    repo_path: String,
    scope: Option<String>,
    rev: Option<String>,
) -> Result<Vec<AuthorCommitStat>, String> {
    let s = commit_log_scope_from_parts(scope.as_deref(), rev.as_deref());
    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
        author_commit_stats_for_scope(&repo, s).map_err(|e| format!("统计作者提交失败: {}", e))
    })
    .await
    .map_err(|e| format!("任务已中断: {}", e))?
}

#[tauri::command]
async fn get_commit_activity_stats(
    repo_path: String,
    scope: Option<String>,
    rev: Option<String>,
    granularity: String,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<Vec<TimeBucketStat>, String> {
    let s = commit_log_scope_from_parts(scope.as_deref(), rev.as_deref());
    let g = granularity.to_lowercase();
    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
        let map = walk_scope_time_buckets(&repo, s, g.as_str(), client_calendar_offset_east_minutes)
            .map_err(|e| format!("统计时间分布失败: {}", e))?;
        Ok(sorted_time_bucket_vec(map))
    })
    .await
    .map_err(|e| format!("任务已中断: {}", e))?
}

#[tauri::command]
async fn get_diff_aggregate_stats(
    app: tauri::AppHandle,
    repo_path: String,
    scope: Option<String>,
    rev: Option<String>,
    path_limit: Option<u32>,
) -> Result<DiffAggregateStats, String> {
    let s = commit_log_scope_from_parts(scope.as_deref(), rev.as_deref());
    let lim = path_limit.unwrap_or(40).max(1).min(200) as usize;
    let repo_path_buf = repo_path.clone();
    let app_clone = app.clone();

    let _ = app.emit_all(
        "diff-aggregate-progress",
        serde_json::json!({
            "repo_path": repo_path_buf,
            "phase": "start",
            "current": 0u32,
            "total": 0u32,
        }),
    );

    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;

        let (authors, paths) = author_line_and_path_stats_for_scope(&repo, s, lim, |cur, tot| {
            let _ = app_clone.emit_all(
                "diff-aggregate-progress",
                serde_json::json!({
                    "repo_path": repo_path.clone(),
                    "phase": "diff",
                    "current": cur,
                    "total": tot,
                }),
            );
        })
        .map_err(|e| format!("统计增删行与路径失败: {}", e))?;
        Ok(DiffAggregateStats { authors, paths })
    })
    .await
    .map_err(|e| format!("任务已中断: {}", e))?
}

#[tauri::command]
async fn get_file_territory_stats(
    app: tauri::AppHandle,
    repo_path: String,
    scope: Option<String>,
    rev: Option<String>,
    file_limit: Option<u32>,
) -> Result<Vec<FileTerritoryStat>, String> {
    let s = commit_log_scope_from_parts(scope.as_deref(), rev.as_deref());
    let lim = file_limit.unwrap_or(120).max(1).min(200) as usize;
    let repo_path_buf = repo_path.clone();
    let app_clone = app.clone();

    let _ = app.emit_all(
        "diff-aggregate-progress",
        serde_json::json!({
            "repo_path": repo_path_buf,
            "phase": "start",
            "current": 0u32,
            "total": 0u32,
        }),
    );

    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;

        file_territory_stats_for_scope(&repo, s, lim, |cur, tot| {
            let _ = app_clone.emit_all(
                "diff-aggregate-progress",
                serde_json::json!({
                    "repo_path": repo_path.clone(),
                    "phase": "diff",
                    "current": cur,
                    "total": tot,
                }),
            );
        })
        .map_err(|e| format!("统计文件维护者失败: {}", e))
    })
    .await
    .map_err(|e| format!("任务已中断: {}", e))?
}

#[tauri::command]
async fn get_recent_changed_files_stats(
    repo_path: String,
    scope: Option<String>,
    rev: Option<String>,
    limit: Option<u32>,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<Vec<RecentChangedFileStat>, String> {
    let s = commit_log_scope_from_parts(scope.as_deref(), rev.as_deref());
    let lim = limit.unwrap_or(80).max(1).min(200) as usize;
    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
        recent_changed_files_for_scope(&repo, s, lim, client_calendar_offset_east_minutes)
            .map_err(|e| format!("统计最近更改文件失败: {}", e))
    })
    .await
    .map_err(|e| format!("任务已中断: {}", e))?
}

#[tauri::command]
async fn get_branch_activity_lifecycle_stats(
    repo_path: String,
    base_branch: Option<String>,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<BranchActivityLifecycleReport, String> {
    let base = base_branch
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
        branch_activity_lifecycle_stats(
            &repo,
            base.as_deref(),
            client_calendar_offset_east_minutes,
        )
        .map_err(|e| format!("统计分支活跃度与生命周期失败: {}", e))
    })
    .await
    .map_err(|e| format!("任务已中断: {}", e))?
}

#[tauri::command]
async fn get_commit_count_head(
    repo_path: String,
    scope: Option<String>,
    rev: Option<String>,
) -> Result<u64, String> {
    let s = commit_log_scope_from_parts(scope.as_deref(), rev.as_deref());
    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
        let n =
            count_commits_scoped(&repo, s).map_err(|e| format!("Failed to count commits: {}", e))?;
        Ok(n as u64)
    })
    .await
    .map_err(|e| format!("任务已中断: {}", e))?
}

// 获取分页提交历史
#[tauri::command]
async fn get_commits_paginated(
    repo_path: String,
    limit: Option<usize>,
    offset: Option<usize>,
    scope: Option<String>,
    rev: Option<String>,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<Vec<CommitInfo>, String> {
    let s = commit_log_scope_from_parts(scope.as_deref(), rev.as_deref());
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)
            .map_err(|e| format!("Failed to open repository: {}", e))?;
        let commits = get_commit_history_paginated(
            &repo,
            limit,
            offset,
            s,
            client_calendar_offset_east_minutes,
        )
            .map_err(|e| format!("Failed to get commit history: {}", e))?;
        Ok(commits)
    })
    .await
    .map_err(|e| format!("任务已中断: {}", e))?
}

// 全仓库历史搜索：按关键词匹配 message / author / short_id，返回最多 limit 条
fn get_commit_history_search(
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
        let date = commit_display_time(&commit, client_calendar_offset_east_minutes);
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

#[tauri::command]
async fn search_commits(
    repo_path: String,
    query: String,
    limit: Option<usize>,
    scope: Option<String>,
    rev: Option<String>,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<Vec<CommitInfo>, String> {
    let limit = limit.unwrap_or(500);
    let s = commit_log_scope_from_parts(scope.as_deref(), rev.as_deref());
    let query = query.trim().to_string();
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)
            .map_err(|e| format!("Failed to open repository: {}", e))?;
        let commits = get_commit_history_search(
            &repo,
            query.as_str(),
            limit,
            s,
            client_calendar_offset_east_minutes,
        )
            .map_err(|e| format!("Search failed: {}", e))?;
        Ok(commits)
    })
    .await
    .map_err(|e| format!("任务已中断: {}", e))?
}

/// 与 `get_commit_activity_stats` 使用相同的日历分桶键（本机时区或作者时区），列出某一桶内的提交（新到旧，最多 limit 条）
fn get_commits_for_activity_bucket_inner(
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
        let dt = commit_calendar_datetime(&commit, client_calendar_offset_east_minutes);
        let key = time_bucket_key(&dt, g);
        if key != bucket_key {
            continue;
        }
        let author = commit.author();
        let author_name = author.name().unwrap_or("Unknown").to_string();
        let message = commit.message().unwrap_or("No message").to_string();
        let first_line = message.lines().next().unwrap_or("").to_string();
        let short_id = format!("{:.7}", oid);
        let date = commit_display_time(&commit, client_calendar_offset_east_minutes);
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

#[tauri::command]
async fn get_commits_for_activity_bucket(
    repo_path: String,
    scope: Option<String>,
    rev: Option<String>,
    granularity: String,
    bucket_key: String,
    limit: Option<usize>,
    client_calendar_offset_east_minutes: Option<i32>,
) -> Result<Vec<CommitInfo>, String> {
    let s = commit_log_scope_from_parts(scope.as_deref(), rev.as_deref());
    let lim = limit.unwrap_or(500).max(1).min(2000);
    let granularity = granularity.to_lowercase();
    let bucket_key = bucket_key.trim().to_string();
    if bucket_key.is_empty() {
        return Err("bucket_key 不能为空".to_string());
    }
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path)
            .map_err(|e| format!("Failed to open repository: {}", e))?;
        get_commits_for_activity_bucket_inner(
            &repo,
            s,
            granularity.as_str(),
            &bucket_key,
            lim,
            client_calendar_offset_east_minutes,
        )
            .map_err(|e| format!("列出分桶提交失败: {}", e))
    })
    .await
    .map_err(|e| format!("任务已中断: {}", e))?
}

fn walk_tree_collect_paths(
    repo: &Repository,
    tree: &git2::Tree,
    prefix: &str,
    out: &mut Vec<String>,
    max: usize,
) -> Result<(), String> {
    if out.len() >= max {
        return Ok(());
    }
    for entry in tree.iter() {
        if out.len() >= max {
            break;
        }
        let name = entry.name().unwrap_or("");
        let path = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{}/{}", prefix, name)
        };
        match entry.kind() {
            Some(git2::ObjectType::Tree) => {
                let obj = entry.to_object(repo).map_err(|e| e.to_string())?;
                let sub = obj
                    .into_tree()
                    .map_err(|_| "子树解析失败".to_string())?;
                walk_tree_collect_paths(repo, &sub, &path, out, max)?;
            }
            Some(git2::ObjectType::Blob) => {
                out.push(path);
            }
            _ => {}
        }
    }
    Ok(())
}

/// 列出当前 HEAD 提交树中的文件路径（扁平、已排序），用于文件树视图
#[tauri::command]
async fn get_head_file_paths(repo_path: String, max_entries: Option<usize>) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let max = max_entries.unwrap_or(5000).min(50_000);
        let repo = Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
        let head = repo.head().map_err(|e| format!("无法读取 HEAD: {}", e))?;
        let oid = head
            .target()
            .ok_or_else(|| "无法解析 HEAD 目标".to_string())?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("无法读取提交: {}", e))?;
        let tree = commit.tree().map_err(|e| format!("无法读取树: {}", e))?;
        let mut paths = Vec::new();
        walk_tree_collect_paths(&repo, &tree, "", &mut paths, max)?;
        paths.sort();
        Ok(paths)
    }).await.map_err(|e| format!("任务异常: {}", e))?
}

fn collect_branch_tip_pairs(repo: &Repository) -> Result<Vec<(String, Oid, bool)>, String> {
    let mut tips = Vec::new();
    let refs = repo.references().map_err(|e| format!("references: {}", e))?;
    for reference in refs {
        let reference = reference.map_err(|e| format!("ref: {}", e))?;
        let Some(name) = reference.name() else {
            continue;
        };
        if name == "HEAD" || name.ends_with("/HEAD") {
            continue;
        }
        let is_remote = name.starts_with("refs/remotes/");
        if !(name.starts_with("refs/heads/") || is_remote) {
            continue;
        }
        let Ok(obj) = reference.peel(git2::ObjectType::Commit) else {
            continue;
        };
        let commit_oid = obj.id();
        let short_name = name
            .strip_prefix("refs/heads/")
            .or_else(|| name.strip_prefix("refs/remotes/"))
            .unwrap_or(name)
            .to_string();
        tips.push((short_name, commit_oid, is_remote));
    }
    Ok(tips)
}

#[tauri::command]
async fn get_branch_ref_tips(repo_path: String) -> Result<Vec<BranchRefTip>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
    let pairs = collect_branch_tip_pairs(&repo)?;
    Ok(pairs
        .into_iter()
        .map(|(name, oid, is_remote)| BranchRefTip {
            name,
            commit_id: oid.to_string(),
            is_remote,
        })
        .collect())
}

/// 批量查询：每个提交在哪些**远程跟踪**分支的历史上（分支 tip 为该提交的后代或等于该提交）。
/// 不包含 `refs/heads/` 本地分支，避免与 `origin/…` 等同名引用重复展示。
#[tauri::command]
async fn get_commits_branch_labels(
    repo_path: String,
    commit_ids: Vec<String>,
) -> Result<Vec<CommitBranchLabels>, String> {
    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
        let tips: Vec<_> = collect_branch_tip_pairs(&repo)?
            .into_iter()
            .filter(|(_, _, is_remote)| *is_remote)
            .collect();
        let mut out = Vec::with_capacity(commit_ids.len());
        for id_str in commit_ids {
            let Ok(oid) = Oid::from_str(&id_str) else {
                out.push(CommitBranchLabels {
                    commit_id: id_str,
                    branches: vec![],
                });
                continue;
            };
            let mut branches: Vec<BranchOnCommit> = Vec::new();
            for (name, tip_oid, is_remote) in &tips {
                let on_branch = *tip_oid == oid
                    || repo.graph_descendant_of(*tip_oid, oid).unwrap_or(false);
                if on_branch {
                    branches.push(BranchOnCommit {
                        name: name.clone(),
                        is_remote: *is_remote,
                    });
                }
            }
            branches.sort_by(|a, b| {
                a.is_remote
                    .cmp(&b.is_remote)
                    .then_with(|| a.name.cmp(&b.name))
            });
            branches.dedup_by(|a, b| a.name == b.name && a.is_remote == b.is_remote);
            out.push(CommitBranchLabels {
                commit_id: id_str,
                branches,
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("任务已中断: {}", e))?
}

// 切换分支
#[tauri::command]
async fn checkout_branch(repo_path: String, branch_name: String) -> Result<String, String> {
    let started = Instant::now();
    let backup = create_silent_stash_backup(&repo_path, "checkout")?;
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("无法打开仓库: {}", e))?;

    let (object, reference) = repo.revparse_ext(&branch_name)
        .map_err(|e| {
            let msg = e.message();
            if msg.contains("reference") || msg.contains("unknown") {
                format!("未找到分支「{}」，请检查分支名或先拉取远程分支", branch_name)
            } else {
                format!("无法解析分支: {}", msg)
            }
        })?;

    let result = if let Err(e) = repo.checkout_tree(&object, None) {
        let msg = e.message();
        Err(if msg.contains("overwrite") || msg.contains("would be overwritten") || msg.contains("conflict") {
            "有未提交的修改，无法切换分支。请先提交或暂存后再切换。".to_string()
        } else {
            format!("检出失败: {}", msg)
        })
    } else {
        if let Some(reference) = reference {
            let ref_name = reference.name().unwrap_or("refs/heads/unknown");
            repo.set_head(ref_name)
                .map_err(|e| format!("设置当前分支失败: {}", e.message()))
        } else {
            repo.set_head_detached(object.id())
                .map_err(|e| format!("设置分离头指针失败: {}", e.message()))
        }
        .map(|_| format!("已切换到 {}", branch_name))
    };

    record_git_write_operation(
        &repo_path,
        "checkout",
        true,
        started,
        &result,
        backup.as_ref(),
        None,
    );
    result
}

/// 从指定提交（默认 HEAD）创建本地分支；`checkout` 为 true 时等价于 `git checkout -b`。
#[tauri::command]
async fn create_branch(
    repo_path: String,
    branch_name: String,
    checkout: bool,
    start_point: Option<String>,
) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;

    let name = branch_name.trim();
    if name.is_empty() {
        return Err("分支名不能为空".to_string());
    }

    if repo.find_branch(name, git2::BranchType::Local).is_ok() {
        return Err(format!("分支「{}」已存在", name));
    }

    let commit = if let Some(start) = start_point.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let oid = Oid::from_str(start).map_err(|e| format!("无效的起点提交 ID: {}", e))?;
        repo.find_commit(oid)
            .map_err(|e| format!("找不到起点提交「{}」: {}", start, e))?
    } else {
        let head = repo.head().map_err(|e| format!("无法获取 HEAD: {}", e))?;
        head.peel_to_commit()
            .map_err(|e| format!("无法解析当前提交: {}", e))?
    };

    repo.branch(name, &commit, false)
        .map_err(|e| format!("创建分支失败: {}", e.message()))?;

    if checkout {
        let (object, reference) = repo.revparse_ext(name).map_err(|e| {
            format!("检出新分支失败: {}", e.message())
        })?;

        if let Err(e) = repo.checkout_tree(&object, None) {
            let msg = e.message();
            return Err(if msg.contains("overwrite") || msg.contains("would be overwritten") || msg.contains("conflict") {
                "有未提交的修改，无法切换分支。请先提交或暂存后再切换。".to_string()
            } else {
                format!("检出失败: {}", msg)
            });
        }

        if let Some(reference) = reference {
            let ref_name = reference.name().unwrap_or("refs/heads/unknown");
            repo.set_head(ref_name)
                .map_err(|e| format!("设置当前分支失败: {}", e.message()))?;
        } else {
            repo.set_head_detached(object.id())
                .map_err(|e| format!("设置分离头指针失败: {}", e.message()))?;
        }
        Ok(format!("已创建并切换到 {}", name))
    } else {
        Ok(format!("已创建分支 {}", name))
    }
}

/// 删除本地分支；默认行为等同 `git branch -d`，`force=true` 时等同 `git branch -D`。
#[tauri::command]
async fn delete_branch(repo_path: String, branch_name: String, force: bool) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    pull_preflight(&repo)?;

    let name = branch_name.trim();
    if name.is_empty() {
        return Err("分支名不能为空".to_string());
    }

    let current = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_default();
    if current == name {
        return Err("不能删除当前分支，请先切换到其他分支".to_string());
    }

    repo.find_branch(name, git2::BranchType::Local)
        .map_err(|_| format!("未找到本地分支「{}」", name))?;

    let mode = if force { "-D" } else { "-d" };
    let out = run_git_in_repo(&repo_path, &["branch", mode, name])
        .map_err(|e| format!("无法执行 git branch {}: {}", mode, e))?;
    if !out.status.success() {
        return Err(format!("删除分支失败: {}", git_output_detail(&out)));
    }
    Ok(format!("已删除分支 {}", name))
}

/// 重命名本地分支（等价于 `git branch -m`）。
#[tauri::command]
async fn rename_branch(repo_path: String, old_name: String, new_name: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    pull_preflight(&repo)?;

    let old_n = old_name.trim();
    let new_n = new_name.trim();
    if old_n.is_empty() || new_n.is_empty() {
        return Err("旧分支名和新分支名都不能为空".to_string());
    }
    if old_n == new_n {
        return Err("新旧分支名相同，无需重命名".to_string());
    }

    let mut branch = repo
        .find_branch(old_n, git2::BranchType::Local)
        .map_err(|_| format!("未找到本地分支「{}」", old_n))?;
    if repo.find_branch(new_n, git2::BranchType::Local).is_ok() {
        return Err(format!("分支「{}」已存在", new_n));
    }

    branch
        .rename(new_n, false)
        .map_err(|e| format!("重命名分支失败: {}", e.message()))?;
    Ok(format!("已将分支 {} 重命名为 {}", old_n, new_n))
}

/// 将指定分支合并到当前分支（`ff_only=true` 时等价于 `git merge --ff-only`）。
#[tauri::command]
async fn merge_branch(repo_path: String, source_branch: String, ff_only: bool) -> Result<String, String> {
    let started = Instant::now();
    let backup = create_silent_stash_backup(&repo_path, "merge")?;
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    pull_preflight(&repo)?;

    let source = source_branch.trim();
    if source.is_empty() {
        return Err("待合并分支不能为空".to_string());
    }
    let current = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_default();
    if current == source {
        return Err("不能将当前分支合并到自身".to_string());
    }

    repo.find_branch(source, git2::BranchType::Local)
        .map_err(|_| format!("未找到本地分支「{}」", source))?;

    let args: Vec<&str> = if ff_only {
        vec!["merge", "--ff-only", source]
    } else {
        vec!["merge", "--no-edit", source]
    };
    let result = match run_git_in_repo(&repo_path, &args) {
        Ok(out) if out.status.success() => Ok(format!("已将 {} 合并到当前分支", source)),
        Ok(out) => {
            let detail = git_output_detail(&out);
            let repo_after = Repository::open(&repo_path).map_err(|e| format!("合并失败后无法重新打开仓库: {}", e));
            match repo_after {
                Ok(repo_after) if repo_after.state() == RepositoryState::Merge => {
                    Err(format!("合并产生冲突，请先解决冲突后继续: {}", detail))
                }
                Ok(_) => Err(format!("合并失败: {}", detail)),
                Err(e) => Err(e),
            }
        }
        Err(e) => Err(format!("无法执行 git merge: {}", e)),
    };

    record_git_write_operation(
        &repo_path,
        "merge",
        true,
        started,
        &result,
        backup.as_ref(),
        None,
    );
    result
}

/// 中止进行中的合并或清理冲突状态。
/// 若仓库处于正式 Merge 状态则执行 `git merge --abort`，
/// 否则若有冲突文件则用 `git reset --hard HEAD` 清理。
#[tauri::command]
async fn abort_merge(repo_path: String) -> Result<String, String> {
    let started = Instant::now();
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    let result = if repo.state() == RepositoryState::Merge {
        run_git_in_repo(&repo_path, &["merge", "--abort"])
            .map_err(|e| format!("无法执行 git merge --abort: {}", e))
            .and_then(|output| {
                if output.status.success() {
                    Ok("已放弃合并".to_string())
                } else {
                    Err(format!("放弃合并失败: {}", git_output_detail(&output)))
                }
            })
    } else {
        // 非正式合并状态（如 git apply --3way 引发的冲突），用 reset --hard 清理
        run_git_in_repo(&repo_path, &["reset", "--hard", "HEAD"])
            .map_err(|e| format!("无法执行 git reset: {}", e))
            .and_then(|output| {
                if output.status.success() {
                    Ok("已清理冲突状态".to_string())
                } else {
                    Err(format!("清理冲突失败: {}", git_output_detail(&output)))
                }
            })
    };
    record_git_write_operation(&repo_path, "merge-abort", false, started, &result, None, None);
    result
}

/// 将当前分支（或分离 HEAD）重置到指定提交，行为与 `git reset --soft|--mixed|--hard` 一致。
#[tauri::command]
async fn reset_to_commit(repo_path: String, commit_id: String, mode: String) -> Result<String, String> {
    let started = Instant::now();
    let mode_normalized = mode.trim().to_lowercase();
    let backup = if mode_normalized == "hard" {
        create_silent_stash_backup(&repo_path, "reset-hard")?
    } else {
        None
    };
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;

    let oid = Oid::from_str(commit_id.trim()).map_err(|e| format!("无效的提交 ID: {}", e))?;

    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("找不到该提交: {}", e))?;

    let reset_type = match mode_normalized.as_str() {
        "soft" => git2::ResetType::Soft,
        "mixed" => git2::ResetType::Mixed,
        "hard" => git2::ResetType::Hard,
        _ => return Err("重置模式须为 soft、mixed 或 hard".to_string()),
    };

    let object = commit.as_object();
    let reset_result = repo.reset(object, reset_type, None).map_err(|e| {
        let msg = e.message();
        if msg.contains("overwrite") || msg.contains("conflict") || msg.contains("Failed to") {
            format!(
                "无法完成重置：{}。若工作区有未提交修改，可先提交或贮藏，或尝试「软重置/混合重置」而非硬重置。",
                msg
            )
        } else {
            format!("重置失败: {}", msg)
        }
    });

    let mode_cn = match reset_type {
        git2::ResetType::Soft => "软",
        git2::ResetType::Mixed => "混合",
        git2::ResetType::Hard => "硬",
    };

    let id_disp = commit_id.trim();
    let short = if id_disp.len() > 7 {
        id_disp[..7].to_string()
    } else {
        id_disp.to_string()
    };

    let result = reset_result.map(|_| format!("已执行「{}」重置，当前指向 {}", mode_cn, short));
    record_git_write_operation(
        &repo_path,
        if mode_normalized == "hard" { "reset-hard" } else { "reset" },
        mode_normalized == "hard",
        started,
        &result,
        backup.as_ref(),
        None,
    );
    result
}

/// 在当前分支应用指定提交（等价于 `git cherry-pick <commit>`）。
#[tauri::command]
async fn cherry_pick_commit(repo_path: String, commit_id: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    history_op_preflight(&repo)?;

    let id = commit_id.trim();
    if id.is_empty() {
        return Err("提交 ID 不能为空".to_string());
    }
    let _ = Oid::from_str(id).map_err(|e| format!("无效的提交 ID: {}", e))?;

    let out = run_git_in_repo(&repo_path, &["cherry-pick", id])
        .map_err(|e| format!("无法执行 git cherry-pick: {}", e))?;
    if !out.status.success() {
        let detail = git_output_detail(&out);
        let repo_after =
            Repository::open(&repo_path).map_err(|e| format!("操作失败后无法重新打开仓库: {}", e))?;
        if repo_after.state() != RepositoryState::Clean {
            return Err(format!(
                "Cherry-pick 失败并进入进行中状态（{:?}）。请先解决冲突后继续，或用命令行 `git cherry-pick --abort` 终止。详情：{}",
                repo_after.state(),
                detail
            ));
        }
        return Err(format!("Cherry-pick 失败: {}", detail));
    }

    Ok(format!("已应用提交 {}", &id[..id.len().min(7)]))
}

/// 反做指定提交（等价于 `git revert --no-edit <commit>`）。
#[tauri::command]
async fn revert_commit(repo_path: String, commit_id: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    history_op_preflight(&repo)?;

    let id = commit_id.trim();
    if id.is_empty() {
        return Err("提交 ID 不能为空".to_string());
    }
    let _ = Oid::from_str(id).map_err(|e| format!("无效的提交 ID: {}", e))?;

    let out = run_git_in_repo(&repo_path, &["revert", "--no-edit", id])
        .map_err(|e| format!("无法执行 git revert: {}", e))?;
    if !out.status.success() {
        let detail = git_output_detail(&out);
        let repo_after =
            Repository::open(&repo_path).map_err(|e| format!("操作失败后无法重新打开仓库: {}", e))?;
        if repo_after.state() != RepositoryState::Clean {
            return Err(format!(
                "Revert 失败并进入进行中状态（{:?}）。请先解决冲突后继续，或用命令行 `git revert --abort` 终止。详情：{}",
                repo_after.state(),
                detail
            ));
        }
        return Err(format!("Revert 失败: {}", detail));
    }

    Ok(format!("已反做提交 {}", &id[..id.len().min(7)]))
}

/// 将当前分支 rebase 到指定提交（等价于 `git rebase <onto>`）。
#[tauri::command]
async fn rebase_to_commit(repo_path: String, onto_commit_id: String) -> Result<String, String> {
    let started = Instant::now();
    let backup = create_silent_stash_backup(&repo_path, "rebase")?;
    let repo = Repository::open(&repo_path).map_err(|e| format!("无法打开仓库: {}", e))?;
    if let Err(e) = history_op_preflight(&repo) {
        let result = Err(e);
        record_git_write_operation(
            &repo_path,
            "rebase",
            true,
            started,
            &result,
            backup.as_ref(),
            None,
        );
        return result;
    }

    let onto = onto_commit_id.trim();
    if onto.is_empty() {
        return Err("目标提交 ID 不能为空".to_string());
    }
    let _ = Oid::from_str(onto).map_err(|e| format!("无效的提交 ID: {}", e))?;

    let result = match run_git_in_repo(&repo_path, &["rebase", onto]) {
        Ok(out) if out.status.success() => Ok(format!("已将当前分支 rebase 到 {}", &onto[..onto.len().min(7)])),
        Ok(out) => {
            let detail = git_output_detail(&out);
            match Repository::open(&repo_path) {
                Ok(repo_after) if repo_after.state() != RepositoryState::Clean => Err(format!(
                    "Rebase 失败并进入进行中状态（{:?}）。请先解决冲突后继续，或用命令行 `git rebase --abort` 终止。详情：{}",
                    repo_after.state(),
                    detail
                )),
                Ok(_) => Err(format!("Rebase 失败: {}", detail)),
                Err(e) => Err(format!("操作失败后无法重新打开仓库: {}", e)),
            }
        }
        Err(e) => Err(format!("无法执行 git rebase: {}", e)),
    };

    record_git_write_operation(
        &repo_path,
        "rebase",
        true,
        started,
        &result,
        backup.as_ref(),
        None,
    );
    result
}

// 获取提交的文件列表
#[tauri::command]
async fn get_commit_files(repo_path: String, commit_id: String) -> Result<Vec<FileChange>, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let oid = Oid::from_str(&commit_id)
        .map_err(|e| format!("Invalid commit ID: {}", e))?;
    
    let commit = repo.find_commit(oid)
        .map_err(|e| format!("Failed to find commit: {}", e))?;
    
    let tree = commit.tree()
        .map_err(|e| format!("Failed to get commit tree: {}", e))?;
    
    let parent = if commit.parent_count() > 0 {
        Some(commit.parent(0)
            .map_err(|e| format!("Failed to get parent commit: {}", e))?
            .tree()
            .map_err(|e| format!("Failed to get parent tree: {}", e))?)
    } else {
        None
    };
    
    let diff = repo.diff_tree_to_tree(parent.as_ref(), Some(&tree), None)
        .map_err(|e| format!("Failed to create diff: {}", e))?;
    
    let mut files = Vec::new();
    
    diff.foreach(
        &mut |delta, _progress| {
            let old_path = delta.old_file().path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
            let new_path = delta.new_file().path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
            
            let status = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Modified => "modified", 
                git2::Delta::Deleted => "deleted",
                git2::Delta::Renamed => "renamed",
                git2::Delta::Copied => "copied",
                _ => "unknown",
            };
            
            // 获取正确的文件路径
            let file_path = if new_path.is_empty() { old_path } else { new_path };
            
            // 简化的统计方法 - 先确保文件被检测到
            let additions = match status {
                "added" => 1, // 新增文件至少算1行
                "deleted" => 0,
                _ => 1, // 其他情况先算1行
            };
            
            let deletions = match status {
                "deleted" => 1, // 删除文件至少算1行
                "added" => 0,
                _ => 0, // 其他情况先算0行
            };
            
            files.push(FileChange {
                path: file_path,
                status: status.to_string(),
                additions,
                deletions,
            });
            
            true
        },
        None,
        None,
        None,
    ).map_err(|e| format!("Failed to iterate diff: {}", e))?;
    
    Ok(files)
}

// 获取单个文件的差异
#[tauri::command]
async fn get_single_file_diff(repo_path: String, commit_id: String, file_path: String) -> Result<String, String> {
    use git2::{Repository, Oid, DiffOptions, DiffFormat};

    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;

    let oid = Oid::from_str(&commit_id)
        .map_err(|e| format!("Invalid commit ID: {}", e))?;

    let commit = repo.find_commit(oid)
        .map_err(|e| format!("Failed to find commit: {}", e))?;

    let tree = commit.tree()
        .map_err(|e| format!("Failed to get commit tree: {}", e))?;

    let parent = if commit.parent_count() > 0 {
        Some(commit.parent(0)
            .map_err(|e| format!("Failed to get parent commit: {}", e))?
            .tree()
            .map_err(|e| format!("Failed to get parent tree: {}", e))?)
    } else {
        None
    };

    // 仅对目标文件生成差异，并输出完整 Patch（包含 diff header/hunk/行前缀）
    let mut opts = DiffOptions::new();
    opts.pathspec(&file_path);
    let diff = repo
        .diff_tree_to_tree(parent.as_ref(), Some(&tree), Some(&mut opts))
        .map_err(|e| format!("Failed to create diff: {}", e))?;

    let mut text = String::new();
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        text.push_str(&format!("{}\n", std::str::from_utf8(line.content()).unwrap_or("")));
        true
    }).map_err(|e| format!("Failed to print diff: {}", e))?;

    // Fallback: 如果含有 hunk 但几乎没有 +/- 行，尝试调用 git 原生命令生成统一补丁
    let plus = text.lines().filter(|l| l.starts_with('+')).count();
    let minus = text.lines().filter(|l| l.starts_with('-')).count();
    let has_hunk = text.lines().any(|l| l.starts_with("@@"));
    if has_hunk && (plus + minus) < 3 {
        if commit.parent_count() > 0 {
            let parent_id = commit.parent_id(0).ok();
            if let Some(pid) = parent_id {
                let pid_s = format!("{}", pid);
                let output = run_git_in_repo(
                    &repo_path,
                    &["diff", pid_s.as_str(), commit_id.as_str(), "--", file_path.as_str()],
                );
                if let Ok(out) = output {
                    if out.status.success() {
                        let t = String::from_utf8_lossy(&out.stdout).to_string();
                        if !t.trim().is_empty() {
                            text = t;
                        }
                    }
                }
            }
        }
    }

    Ok(text)
}

// 获取文件差异（保持向后兼容）
#[tauri::command]
async fn get_file_diff(repo_path: String, commit_id: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let oid = Oid::from_str(&commit_id)
        .map_err(|e| format!("Invalid commit ID: {}", e))?;
    
    let commit = repo.find_commit(oid)
        .map_err(|e| format!("Failed to find commit: {}", e))?;
    
    let tree = commit.tree()
        .map_err(|e| format!("Failed to get commit tree: {}", e))?;
    
    let parent = if commit.parent_count() > 0 {
        Some(commit.parent(0)
            .map_err(|e| format!("Failed to get parent commit: {}", e))?
            .tree()
            .map_err(|e| format!("Failed to get parent tree: {}", e))?)
    } else {
        None
    };
    
    let diff = repo.diff_tree_to_tree(parent.as_ref(), Some(&tree), None)
        .map_err(|e| format!("Failed to create diff: {}", e))?;
    
    let mut diff_text = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        diff_text.push_str(&format!("{}\n", std::str::from_utf8(line.content()).unwrap_or("")));
        true
    }).map_err(|e| format!("Failed to print diff: {}", e))?;
    
    Ok(diff_text)
}

/// 从 diff 单条 delta 生成 UI 用的文件状态（与 `git diff` 语义一致）
fn file_change_from_delta(delta: &git2::DiffDelta) -> Option<FileChange> {
    let path = normalize_repo_rel_path(
        &delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    );
    if path.is_empty() {
        return None;
    }
    let status = match delta.status() {
        git2::Delta::Added => "added",
        git2::Delta::Deleted => "deleted",
        git2::Delta::Modified => "modified",
        git2::Delta::Renamed => "renamed",
        git2::Delta::Copied => "added",
        git2::Delta::Typechange => "modified",
        git2::Delta::Conflicted => "modified",
        _ => "modified",
    };
    Some(FileChange {
        path,
        status: status.to_string(),
        additions: 1,
        deletions: 0,
    })
}

// 收集工作区状态（供 get_workspace_status / 删除未跟踪 等复用）
// 双 diff 模型：已暂存 = HEAD^{tree} vs index；未暂存 = index vs worktree；冲突单独列出
fn collect_workspace_status(repo: &Repository) -> Result<WorkspaceStatus, String> {
    let mut conflicted_files = Vec::new();
    let mut conflicted_paths: HashSet<String> = HashSet::new();

    let mut status_options = git2::StatusOptions::new();
    status_options.include_untracked(true);
    status_options.include_ignored(false);
    status_options.include_unmodified(false);

    let statuses = repo
        .statuses(Some(&mut status_options))
        .map_err(|e| format!("Failed to get statuses: {}", e))?;

    for entry in statuses.iter() {
        let file_path = normalize_repo_rel_path(entry.path().unwrap_or(""));
        if file_path.is_empty() {
            continue;
        }
        if entry.status().contains(git2::Status::CONFLICTED) {
            conflicted_paths.insert(file_path.clone());
            conflicted_files.push(FileChange {
                path: file_path,
                status: "conflicted".to_string(),
                additions: 0,
                deletions: 0,
            });
        }
    }
    dedupe_file_changes_by_path(&mut conflicted_files);

    let head_tree = repo
        .head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?
        .peel_to_tree()
        .map_err(|e| format!("Failed to peel HEAD to tree: {}", e))?;
    let index = repo
        .index()
        .map_err(|e| format!("Failed to get index: {}", e))?;

    let staged_diff = repo
        .diff_tree_to_index(Some(&head_tree), Some(&index), None)
        .map_err(|e| format!("Failed to diff HEAD vs index: {}", e))?;
    let mut staged_files = Vec::new();
    for delta in staged_diff.deltas() {
        if let Some(fc) = file_change_from_delta(&delta) {
            if !conflicted_paths.contains(&fc.path) {
                staged_files.push(fc);
            }
        }
    }
    dedupe_file_changes_by_path(&mut staged_files);

    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.include_untracked(true).recurse_untracked_dirs(true);
    let unstaged_diff = repo
        .diff_index_to_workdir(Some(&index), Some(&mut diff_opts))
        .map_err(|e| format!("Failed to create index->workdir diff: {}", e))?;

    let mut unstaged_files = Vec::new();
    let mut untracked_files = Vec::new();
    for delta in unstaged_diff.deltas() {
        let file_path = normalize_repo_rel_path(
            &delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
        );
        if file_path.is_empty() {
            continue;
        }
        if conflicted_paths.contains(&file_path) {
            continue;
        }
        match delta.status() {
            git2::Delta::Untracked => {
                if !untracked_files.contains(&file_path) {
                    untracked_files.push(file_path);
                }
            }
            _ => {
                if let Some(fc) = file_change_from_delta(&delta) {
                    if !unstaged_files.iter().any(|f: &FileChange| f.path == fc.path) {
                        unstaged_files.push(fc);
                    }
                }
            }
        }
    }

    dedupe_file_changes_by_path(&mut unstaged_files);
    dedupe_strings_preserve_order(&mut untracked_files);

    Ok(WorkspaceStatus {
        staged_files,
        unstaged_files,
        untracked_files,
        conflicted_files,
    })
}

/// 收集 diff 中涉及的路径（与 `git diff --name-only` 类似）。
fn diff_paths_set(diff: &git2::Diff) -> Result<HashSet<String>, String> {
    let mut set = HashSet::new();
    for delta in diff.deltas() {
        let p = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let p = normalize_repo_rel_path(&p);
        if !p.is_empty() {
            set.insert(p);
        }
    }
    Ok(set)
}

/// 相对当前 HEAD，索引 + 工作区有改动的路径（与 `git diff HEAD` 一致，不含未跟踪）。
fn paths_dirty_vs_head(repo: &Repository) -> Result<HashSet<String>, String> {
    let head_tree = repo
        .head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?
        .peel_to_tree()
        .map_err(|e| format!("Failed to peel HEAD to tree: {}", e))?;
    let diff = repo
        .diff_tree_to_workdir_with_index(Some(&head_tree), None)
        .map_err(|e| format!("Failed to diff HEAD vs index/workdir: {}", e))?;
    diff_paths_set(&diff)
}

#[tauri::command]
async fn get_workspace_status(repo_path: String) -> Result<WorkspaceStatus, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    collect_workspace_status(&repo)
}

/// 解析仓库工作区内相对路径为绝对路径，并确保不逃出仓库根目录。
fn resolve_repo_workdir_path(repo_path: &str, relative: &str) -> Result<std::path::PathBuf, String> {
    let rel = relative.trim_end_matches('/').trim_end_matches('\\');
    if rel.is_empty() {
        return Err("Empty path after normalize".to_string());
    }
    let repo_canon = fs::canonicalize(Path::new(repo_path))
        .map_err(|e| format!("Failed to canonicalize repository: {}", e))?;
    let joined = Path::new(repo_path).join(rel);
    let target = fs::canonicalize(&joined)
        .map_err(|e| format!("Cannot access path (moved or deleted?): {}", e))?;
    if !target.starts_with(&repo_canon) {
        return Err("Path is outside repository".to_string());
    }
    Ok(target)
}

#[tauri::command]
async fn remove_untracked_path(repo_path: String, file_path: String) -> Result<String, String> {
    let file_path = normalize_repo_rel_path(&file_path);
    if file_path.is_empty() {
        return Err("Empty file path".to_string());
    }
    let key = file_path.trim_end_matches('/').to_string();
    log_message(
        "INFO",
        &format!(
            "remove_untracked_path: start | repo={} file={}",
            repo_path, file_path
        ),
    );

    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    let ws = collect_workspace_status(&repo)?;
    let is_untracked = ws.untracked_files.iter().any(|p| {
        normalize_repo_rel_path(p).trim_end_matches('/') == key
    });
    if !is_untracked {
        log_message(
            "WARN",
            &format!(
                "remove_untracked_path: not untracked | repo={} file={}",
                repo_path, file_path
            ),
        );
        return Err("Path is not listed as untracked; refusing to delete".to_string());
    }

    let target = resolve_repo_workdir_path(&repo_path, &key)?;
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("Failed to remove directory: {}", e))?;
    } else {
        fs::remove_file(&target).map_err(|e| format!("Failed to remove file: {}", e))?;
    }
    log_message(
        "INFO",
        &format!(
            "remove_untracked_path: success | repo={} file={}",
            repo_path, file_path
        ),
    );
    Ok(format!("Removed {}", file_path))
}

#[tauri::command]
async fn remove_all_untracked_paths(repo_path: String) -> Result<String, String> {
    log_message(
        "INFO",
        &format!("remove_all_untracked_paths: start | repo={}", repo_path),
    );
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    let ws = collect_workspace_status(&repo)?;
    let mut keys: Vec<String> = ws
        .untracked_files
        .iter()
        .map(|p| normalize_repo_rel_path(p).trim_end_matches('/').to_string())
        .filter(|k| !k.is_empty())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    keys.sort_by_key(|k| std::cmp::Reverse(k.len()));

    let mut removed: u32 = 0;
    for key in keys {
        let ws = collect_workspace_status(&repo)?;
        let still_untracked = ws.untracked_files.iter().any(|p| {
            normalize_repo_rel_path(p).trim_end_matches('/') == key
        });
        if !still_untracked {
            continue;
        }
        let target = match resolve_repo_workdir_path(&repo_path, &key) {
            Ok(t) => t,
            Err(e) => {
                log_message(
                    "WARN",
                    &format!(
                        "remove_all_untracked_paths: skip {} | {}",
                        key, e
                    ),
                );
                continue;
            }
        };
        if target.is_dir() {
            fs::remove_dir_all(&target).map_err(|e| format!("Failed to remove directory: {}", e))?;
        } else {
            fs::remove_file(&target).map_err(|e| format!("Failed to remove file: {}", e))?;
        }
        removed += 1;
    }
    log_message(
        "INFO",
        &format!(
            "remove_all_untracked_paths: done | repo={} removed={}",
            repo_path, removed
        ),
    );
    Ok(format!("Removed {} path(s)", removed))
}

// 暂存文件
#[tauri::command]
async fn stage_file(repo_path: String, file_path: String) -> Result<String, String> {
    let file_path = normalize_repo_rel_path(&file_path);
    if file_path.is_empty() {
        return Err("Empty file path".to_string());
    }
    log_message("INFO", &format!("stage_file: attempt start | path={} file={}", repo_path, file_path));
    
    let repo = Repository::open(&repo_path)
        .map_err(|e| {
            let error_msg = format!("Failed to open repository: {}", e);
            log_message("ERROR", &format!("stage_file: {} | path={}", error_msg, repo_path));
            error_msg
        })?;
    
    let mut index = repo.index()
        .map_err(|e| {
            let error_msg = format!("Failed to get index: {}", e);
            log_message("ERROR", &format!("stage_file: {} | path={} file={}", error_msg, repo_path, file_path));
            error_msg
        })?;
    
    // 检查文件是否在工作区中存在
    let full_path = Path::new(&repo_path).join(&file_path);
    let file_exists = full_path.exists();
    
    if file_exists {
        // 文件存在，使用 add_path 暂存
        index.add_path(Path::new(&file_path))
            .map_err(|e| {
                let error_msg = format!("Failed to add file to index: {}", e);
                log_message("ERROR", &format!("stage_file: {} | path={} file={}", error_msg, repo_path, file_path));
                error_msg
            })?;
        log_message("DEBUG", &format!("stage_file: file exists, using add_path | path={} file={}", repo_path, file_path));
    } else {
        // 文件不存在，使用 remove_path 暂存删除
        index.remove_path(Path::new(&file_path))
            .map_err(|e| {
                let error_msg = format!("Failed to remove file from index: {}", e);
                log_message("ERROR", &format!("stage_file: {} | path={} file={}", error_msg, repo_path, file_path));
                error_msg
            })?;
        log_message("DEBUG", &format!("stage_file: file deleted, using remove_path | path={} file={}", repo_path, file_path));
    }
    
    index.write()
        .map_err(|e| {
            let error_msg = format!("Failed to write index: {}", e);
            log_message("ERROR", &format!("stage_file: {} | path={} file={}", error_msg, repo_path, file_path));
            error_msg
        })?;
    
    log_message("INFO", &format!("stage_file: success | path={} file={}", repo_path, file_path));
    Ok(format!("Successfully staged {}", file_path))
}

// 取消暂存文件
#[tauri::command]
async fn unstage_file(repo_path: String, file_path: String) -> Result<String, String> {
    let file_path = normalize_repo_rel_path(&file_path);
    if file_path.is_empty() {
        return Err("Empty file path".to_string());
    }
    log_message("INFO", &format!("unstage_file: attempt start | path={} file={}", repo_path, file_path));
    
    let repo = Repository::open(&repo_path)
        .map_err(|e| {
            let error_msg = format!("Failed to open repository: {}", e);
            log_message("ERROR", &format!("unstage_file: {} | path={}", error_msg, repo_path));
            error_msg
        })?;

    // 与 `git reset HEAD <file>` 一致：用 HEAD 指向的对象重置这些路径在索引中的状态。
    // `reset_default` 需要 `Object`（Commit 等），不能传 `Tree`。
    // 尚无任何提交时 `HEAD` 无法解析，只能像 `git rm --cached` 一样从索引移除。
    match repo.revparse_single("HEAD") {
        Ok(target) => {
            repo.reset_default(Some(&target), &[Path::new(&file_path)])
                .map_err(|e| {
                    let error_msg = format!("Failed to unstage file: {}", e);
                    log_message("ERROR", &format!("unstage_file: {} | path={} file={}", error_msg, repo_path, file_path));
                    error_msg
                })?;
        }
        Err(e_head) => {
            log_message(
                "INFO",
                &format!(
                    "unstage_file: no HEAD (unborn?), using index.remove_path | parse_err={} path={} file={}",
                    e_head, repo_path, file_path
                ),
            );
            let mut index = repo.index().map_err(|e| {
                let error_msg = format!("Failed to get index: {}", e);
                log_message("ERROR", &format!("unstage_file: {} | path={} file={}", error_msg, repo_path, file_path));
                error_msg
            })?;
            index.remove_path(Path::new(&file_path)).map_err(|e| {
                let error_msg = format!("Failed to unstage (no commits yet): {}", e);
                log_message("ERROR", &format!("unstage_file: {} | path={} file={}", error_msg, repo_path, file_path));
                error_msg
            })?;
            index.write().map_err(|e| {
                let error_msg = format!("Failed to write index: {}", e);
                log_message("ERROR", &format!("unstage_file: {} | path={} file={}", error_msg, repo_path, file_path));
                error_msg
            })?;
        }
    }
    
    log_message("INFO", &format!("unstage_file: success | path={} file={}", repo_path, file_path));
    Ok(format!("Successfully unstaged {}", file_path))
}

/// 丢弃指定路径的未暂存修改，使工作区与暂存区一致（`git restore --worktree -- <path>`）。
#[tauri::command]
async fn discard_unstaged_file(repo_path: String, file_path: String) -> Result<String, String> {
    let started = Instant::now();
    let file_path = normalize_repo_rel_path(&file_path);
    if file_path.is_empty() {
        return Err("文件路径为空".to_string());
    }
    log_message(
        "INFO",
        &format!(
            "discard_unstaged_file: attempt | path={} file={}",
            repo_path, file_path
        ),
    );

    let backup = create_silent_stash_backup(&repo_path, "discard")?;
    let result = match run_git_in_repo(&repo_path, &["restore", "--worktree", "--", &file_path]) {
        Ok(output) if output.status.success() => Ok(format!("已丢弃未暂存修改: {}", file_path)),
        Ok(output) => {
            let detail = git_output_detail(&output);
            log_message("ERROR", &format!("discard_unstaged_file: failed | {}", detail));
            Err(format!("丢弃未暂存修改失败: {}", detail))
        }
        Err(e) => Err(format!("无法执行 git restore（请确认已安装 Git 并加入 PATH）: {}", e)),
    };

    if result.is_ok() {
        log_message(
            "INFO",
            &format!(
                "discard_unstaged_file: success | path={} file={}",
                repo_path, file_path
            ),
        );
    }
    record_git_write_operation(
        &repo_path,
        "discard",
        true,
        started,
        &result,
        backup.as_ref(),
        Some(1),
    );
    result
}

/// 丢弃全部未暂存修改，使工作区与暂存区一致（`git restore --worktree -- .`）。
#[tauri::command]
async fn discard_all_unstaged(repo_path: String) -> Result<String, String> {
    let started = Instant::now();
    log_message(
        "INFO",
        &format!("discard_all_unstaged: attempt | path={}", repo_path),
    );

    let backup = create_silent_stash_backup(&repo_path, "discard")?;
    let result = match run_git_in_repo(&repo_path, &["restore", "--worktree", "--", "."]) {
        Ok(output) if output.status.success() => Ok("已丢弃全部未暂存修改".to_string()),
        Ok(output) => {
            let detail = git_output_detail(&output);
            log_message("ERROR", &format!("discard_all_unstaged: failed | {}", detail));
            Err(format!("丢弃全部未暂存修改失败: {}", detail))
        }
        Err(e) => Err(format!("无法执行 git restore（请确认已安装 Git 并加入 PATH）: {}", e)),
    };

    if result.is_ok() {
        log_message(
            "INFO",
            &format!("discard_all_unstaged: success | path={}", repo_path),
        );
    }
    record_git_write_operation(
        &repo_path,
        "discard",
        true,
        started,
        &result,
        backup.as_ref(),
        None,
    );
    result
}

/// 与命令行 `git commit` 一致：从仓库/全局配置读取 `user.name` 与 `user.email` 生成签名（不长期借用 `Repository`，便于后续 `stash_save` 等需 `&mut repo` 的场景）。
fn repo_author_signature(repo: &Repository) -> Result<git2::Signature<'static>, String> {
    let cfg = repo
        .config()
        .map_err(|e| format!("读取 Git 配置失败：{}", e))?;
    let name = cfg
        .get_string("user.name")
        .map_err(|_| {
            "未设置 user.name。请执行：git config user.name \"你的名字\"。".to_string()
        })?;
    let email = cfg
        .get_string("user.email")
        .map_err(|_| {
            "未设置 user.email。请执行：git config user.email \"你的邮箱\"。".to_string()
        })?;
    git2::Signature::now(name.trim(), email.trim())
        .map_err(|e| format!("无法创建提交身份：{}", e))
}

// 提交更改
#[tauri::command]
async fn commit_changes(repo_path: String, message: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("打开仓库失败：{}", e))?;
    
    let mut index = repo.index().map_err(|e| format!("获取索引失败：{}", e))?;
    
    // 检查是否有暂存的文件
    if index.len() == 0 {
        return Err("没有已暂存的文件，无法提交".to_string());
    }
    
    let tree_id = index.write_tree().map_err(|e| format!("写入树对象失败：{}", e))?;
    let tree = repo.find_tree(tree_id).map_err(|e| format!("读取树对象失败：{}", e))?;
    
    let head = repo.head().ok();
    let parent_commit = if let Some(head) = head {
        head.peel_to_commit().ok()
    } else {
        None
    };
    
    let signature = repo_author_signature(&repo)?;
    
    let commit_id = repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        &message,
        &tree,
        &parent_commit.iter().collect::<Vec<_>>(),
    ).map_err(|e| format!("提交失败：{}", e))?;
    
    Ok(format!("提交成功：{}", commit_id))
}

// 推送更改（支持认证与自动设置上游）
#[tauri::command]
async fn push_changes(repo_path: String) -> Result<String, String> {
    log_message("INFO", &format!("push: attempt start | path={}", repo_path));

    let repo = match Repository::open(&repo_path) {
        Ok(r) => r,
        Err(e) => {
            log_message("ERROR", &format!("push: open repository failed: {} | path={}", e, repo_path));
            return Err(format!("无法打开仓库：{}", e));
        }
    };

    let branch_name = branch_name_for_sync_commands(&repo).map_err(|e| {
        log_message("ERROR", &format!("push: branch for sync: {}", e));
        e
    })?;

    if let Err(e) = repo.find_remote("origin") {
        log_message("ERROR", &format!("push: find remote 'origin' failed: {}", e));
        return Err(format!("未找到远程 origin：{}", e));
    }

    let output = run_git_in_repo(&repo_path, &["push", "-u", "origin", &branch_name])
        .map_err(|e| format!("推送失败：{}（无法执行 git）", e))?;
    if !output.status.success() {
        let detail = git_output_detail(&output);
        log_message("ERROR", &format!("push: git push failed: {} | branch={}", detail, branch_name));
        return Err(format!("推送失败：{}", detail));
    }

    // 若本地分支没有上游，自动设置到 origin/<branch>（git push -u 通常已设置）
    if let Ok(mut branch) = repo.find_branch(&branch_name, git2::BranchType::Local) {
        if branch.upstream().is_err() {
            if let Err(e) = branch.set_upstream(Some(&format!("origin/{}", branch_name))) {
                log_message("WARN", &format!("push: set upstream failed but push succeeded: {}", e));
            }
        }
    }

    log_message("INFO", &format!("push: success | branch={}", branch_name));
    Ok(format!("推送成功：origin/{}", branch_name))
}

fn pull_preflight(repo: &Repository) -> Result<(), String> {
    match repo.state() {
        RepositoryState::Clean => Ok(()),
        s => Err(format!(
            "仓库处于进行中的操作状态（{:?}），请先完成、中止或解决冲突后再拉取。",
            s
        )),
    }
}

fn history_op_preflight(repo: &Repository) -> Result<(), String> {
    pull_preflight(repo)?;
    let ws = collect_workspace_status(repo)?;
    if !ws.staged_files.is_empty()
        || !ws.unstaged_files.is_empty()
        || !ws.conflicted_files.is_empty()
    {
        return Err(
            "工作区存在未提交修改或冲突，请先提交/暂存/清理后再执行历史操作。".to_string(),
        );
    }
    Ok(())
}

fn tauri_pull_log_line(
    logs: &mut Option<&mut Vec<(String, String, String)>>,
    level: &str,
    message: impl AsRef<str>,
) {
    let msg = message.as_ref().to_string();
    log_message(level, &msg);
    if let Some(l) = logs.as_mut() {
        let ts = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        l.push((ts, level.to_string(), msg));
    }
}

fn finish_pull_outcome(
    repo_path: &str,
    logs: &mut Option<&mut Vec<(String, String, String)>>,
    kind: &str,
    message: &str,
) -> Result<PullOutcome, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("拉取结束后重新打开仓库失败: {}", e))?;
    let ws = collect_workspace_status(&repo)?;
    let head_short = repo.head().ok().and_then(|h| h.peel_to_commit().ok()).map(|c| {
        c.id()
            .to_string()
            .chars()
            .take(7)
            .collect::<String>()
    });
    let summary = format!(
        "pull: 结束 kind={} | HEAD≈{} | staged={} unstaged={} conflicted={} untracked={}",
        kind,
        head_short.as_deref().unwrap_or("?"),
        ws.staged_files.len(),
        ws.unstaged_files.len(),
        ws.conflicted_files.len(),
        ws.untracked_files.len()
    );
    log_message("INFO", &summary);
    tauri_pull_log_line(logs, "INFO", &summary);
    Ok(PullOutcome {
        kind: kind.to_string(),
        message: message.to_string(),
        head_oid_short: head_short,
        staged_count: ws.staged_files.len(),
        unstaged_count: ws.unstaged_files.len(),
        conflicted_count: ws.conflicted_files.len(),
        untracked_count: ws.untracked_files.len(),
    })
}

/// 拉取核心逻辑：fetch 后用 **系统 git merge** 更新 HEAD/index/worktree（与 SourceTree / 命令行一致），
/// 避免 libgit2 与 CLI 混写导致的 index 假象「大量已暂存」。
fn execute_pull(
    repo_path: &str,
    mut logs: Option<&mut Vec<(String, String, String)>>,
) -> Result<PullOutcome, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("打开仓库失败: {}", e))?;
    tauri_pull_log_line(
        &mut logs,
        "INFO",
        &format!("pull: 开始 | path={}", repo_path),
    );

    pull_preflight(&repo)?;
    tauri_pull_log_line(
        &mut logs,
        "INFO",
        "pull: 预检通过（无进行中的 merge/rebase/cherry-pick 等）",
    );

    let branch_name = branch_name_for_sync_commands(&repo)?;
    if let Ok(b) = repo.find_branch(&branch_name, git2::BranchType::Local) {
        if b.upstream().is_err() {
            tauri_pull_log_line(
                &mut logs,
                "WARN",
                &format!(
                    "pull: 当前分支未设置上游；将使用 refs/remotes/origin/{} 作为拉取目标",
                    branch_name
                ),
            );
        }
    }
    tauri_pull_log_line(
        &mut logs,
        "INFO",
        &format!("pull: 当前分支={}", branch_name),
    );

    repo.find_remote("origin")
        .map_err(|_| "未找到远程 origin。".to_string())?;

    let head_oid = repo
        .refname_to_id("HEAD")
        .map_err(|e| format!("读取本地 HEAD 失败: {}", e))?;
    let head_short = head_oid.to_string().chars().take(7).collect::<String>();
    let dirty_paths = paths_dirty_vs_head(&repo)?;
    tauri_pull_log_line(
        &mut logs,
        "INFO",
        &format!(
            "pull: 拉取前 HEAD={} dirty_paths={}",
            head_short,
            dirty_paths.len()
        ),
    );

    tauri_pull_log_line(&mut logs, "INFO", "pull: 执行 git fetch origin …");
    let fetch_out = run_git_in_repo(repo_path, &["fetch", "origin"])
        .map_err(|e| format!("无法执行 git fetch: {}", e))?;
    if !fetch_out.status.success() {
        let detail = git_output_detail(&fetch_out);
        tauri_pull_log_line(&mut logs, "ERROR", &format!("git fetch 失败: {}", detail));
        return Err(format!("git fetch 失败: {}", detail));
    }

    let repo = Repository::open(repo_path).map_err(|e| format!("fetch 后重新打开仓库失败: {}", e))?;

    let remote_ref = format!("refs/remotes/origin/{}", branch_name);
    let remote_oid = repo
        .refname_to_id(&remote_ref)
        .map_err(|e| format!("未找到远程分支 origin/{}: {}", branch_name, e))?;
    let local_oid = repo
        .refname_to_id("HEAD")
        .map_err(|e| format!("读取本地 HEAD 失败: {}", e))?;

    if remote_oid == local_oid {
        tauri_pull_log_line(&mut logs, "INFO", "pull: fetch 后本地与远端一致（已是最新）");
        return finish_pull_outcome(repo_path, &mut logs, "up_to_date", "已经是最新");
    }

    let (ahead, behind) = repo
        .graph_ahead_behind(local_oid, remote_oid)
        .map_err(|e| format!("无法计算本地与远端相对位置: {}", e))?;
    tauri_pull_log_line(
        &mut logs,
        "INFO",
        &format!(
            "pull: 分支关系（graph_ahead_behind: 本地相对远端）| ahead={} behind={}",
            ahead, behind
        ),
    );

    if behind == 0 && ahead > 0 {
        tauri_pull_log_line(
            &mut logs,
            "INFO",
            "pull: 本地领先于远端，无需合并 — 跳过",
        );
        return finish_pull_outcome(
            repo_path,
            &mut logs,
            "up_to_date",
            "已经是最新（本地领先于远端，无需拉取合并）",
        );
    }

    let local_commit = repo
        .find_commit(local_oid)
        .map_err(|e| format!("解析本地提交失败: {}", e))?;
    let remote_commit = repo
        .find_commit(remote_oid)
        .map_err(|e| format!("解析远端提交失败: {}", e))?;

    if behind > 0 && ahead == 0 {
        let local_tree = local_commit.tree().map_err(|e| e.to_string())?;
        let remote_tree = remote_commit.tree().map_err(|e| e.to_string())?;
        let pull_diff = repo
            .diff_tree_to_tree(Some(&local_tree), Some(&remote_tree), None)
            .map_err(|e| format!("计算快进差异失败: {}", e))?;
        let pull_paths = diff_paths_set(&pull_diff)?;
        if !dirty_paths.is_empty() {
            let overlap: Vec<String> = dirty_paths.intersection(&pull_paths).cloned().collect();
            if !overlap.is_empty() {
                let sample = overlap.iter().take(8).cloned().collect::<Vec<_>>().join(", ");
                tauri_pull_log_line(
                    &mut logs,
                    "WARN",
                    &format!("pull: 阻塞 — 本地改动与将拉取的文件重叠: {}", sample),
                );
                return Err(format!(
                    "无法拉取：未提交的修改会被覆盖（例如 {}）。请先提交或贮藏。",
                    sample
                ));
            }
        }

        tauri_pull_log_line(
            &mut logs,
            "INFO",
            &format!("pull: 执行 git merge --ff-only origin/{}", branch_name),
        );
        let merge_out = run_git_in_repo(
            repo_path,
            &["merge", "--ff-only", &format!("origin/{}", branch_name)],
        )
        .map_err(|e| format!("无法执行 git merge: {}", e))?;
        if !merge_out.status.success() {
            let detail = git_output_detail(&merge_out);
            tauri_pull_log_line(&mut logs, "ERROR", &format!("git merge --ff-only 失败: {}", detail));
            return Err(format!("快进拉取失败: {}", detail));
        }
        tauri_pull_log_line(&mut logs, "INFO", "pull: fast-forward 成功（系统 git merge）");
        return finish_pull_outcome(
            repo_path,
            &mut logs,
            "fast_forward",
            "拉取成功（快进）",
        );
    }

    if behind > 0 && ahead > 0 {
        let mut merge_index = repo
            .merge_commits(&local_commit, &remote_commit, None)
            .map_err(|e| format!("预演合并失败: {}", e))?;
        if merge_index.has_conflicts() {
            tauri_pull_log_line(
                &mut logs,
                "WARN",
                "pull: 预演显示合并将产生冲突 — 仍将执行 git merge 以在工作区写入冲突标记",
            );
        }
        let merge_tree_oid = merge_index
            .write_tree_to(&repo)
            .map_err(|e| format!("写入预演合并树失败: {}", e))?;
        let merge_tree = repo.find_tree(merge_tree_oid).map_err(|e| e.to_string())?;
        let local_tree = local_commit.tree().map_err(|e| e.to_string())?;
        let merge_touch = repo
            .diff_tree_to_tree(Some(&local_tree), Some(&merge_tree), None)
            .map_err(|e| e.to_string())?;
        let merge_paths = diff_paths_set(&merge_touch)?;
        if !dirty_paths.is_empty() {
            let overlap: Vec<String> = dirty_paths.intersection(&merge_paths).cloned().collect();
            if !overlap.is_empty() {
                let sample = overlap.iter().take(8).cloned().collect::<Vec<_>>().join(", ");
                tauri_pull_log_line(
                    &mut logs,
                    "WARN",
                    &format!("pull: 阻塞 — 本地改动与合并将触及的路径重叠: {}", sample),
                );
                return Err(format!(
                    "无法拉取：未提交的修改会被覆盖（例如 {}）。请先提交或贮藏。",
                    sample
                ));
            }
        }

        tauri_pull_log_line(
            &mut logs,
            "INFO",
            &format!("pull: 执行 git merge origin/{}（分支已分叉）", branch_name),
        );
        let merge_out = run_git_in_repo(
            repo_path,
            &["merge", &format!("origin/{}", branch_name)],
        )
        .map_err(|e| format!("无法执行 git merge: {}", e))?;
        if !merge_out.status.success() {
            let detail = git_output_detail(&merge_out);
            let repo_after = Repository::open(repo_path).map_err(|e| e.to_string())?;
            if repo_after.state() == RepositoryState::Merge {
                tauri_pull_log_line(
                    &mut logs,
                    "WARN",
                    &format!("pull: merge 未完成（存在冲突）: {}", detail),
                );
                return finish_pull_outcome(
                    repo_path,
                    &mut logs,
                    "merge_conflict",
                    "合并发生冲突，请在本地解决冲突后提交。",
                );
            }
            tauri_pull_log_line(&mut logs, "ERROR", &format!("git merge 失败: {}", detail));
            return Err(format!("合并拉取失败: {}", detail));
        }
        tauri_pull_log_line(&mut logs, "INFO", "pull: merge 提交成功（系统 git merge）");
        return finish_pull_outcome(
            repo_path,
            &mut logs,
            "merge_commit",
            "拉取成功（已合并远程提交）",
        );
    }

    Err("pull: 未处理的分支关系（内部逻辑错误）".to_string())
}

// 拉取更改
#[tauri::command]
async fn pull_changes(repo_path: String) -> Result<PullOutcome, String> {
    let started = Instant::now();
    let backup = create_silent_stash_backup(&repo_path, "pull")?;
    let outcome = execute_pull(&repo_path, None);
    let log_result: Result<String, String> = outcome
        .as_ref()
        .map(|o| o.message.clone())
        .map_err(|e| e.clone());
    record_git_write_operation(
        &repo_path,
        "pull",
        true,
        started,
        &log_result,
        backup.as_ref(),
        None,
    );
    outcome
}

// 获取远程更改（不合并）- 简版（供普通按钮与同步流程调用）
#[tauri::command]
async fn fetch_changes(repo_path: String) -> Result<String, String> {
    log_message("INFO", &format!("fetch: attempt start | path={}", repo_path));

    let repo = Repository::open(&repo_path).map_err(|e| {
        log_message(
            "ERROR",
            &format!("fetch: open repository failed: {} | path={}", e, repo_path),
        );
        format!("无法打开仓库：{}", e)
    })?;

    if let Err(e) = repo.find_remote("origin") {
        log_message("ERROR", &format!("fetch: find remote 'origin' failed: {}", e));
        return Err(format!("未找到远程 origin：{}", e));
    }

    let output = run_git_in_repo(&repo_path, &["fetch", "origin"])
        .map_err(|e| format!("获取失败：{}（无法执行 git）", e))?;
    if !output.status.success() {
        let detail = git_output_detail(&output);
        log_message("ERROR", &format!("fetch: git fetch failed: {}", detail));
        return Err(format!("获取失败：{}", detail));
    }

    log_message("INFO", "fetch: success");
    Ok("获取成功：已更新远程状态".to_string())
}

// 获取远程更改（不合并）- 带日志流
#[tauri::command]
async fn fetch_changes_with_logs(repo_path: String) -> Result<Vec<(String, String, String)>, String> {
    let mut logs = Vec::new();

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    
    logs.push((timestamp, "INFO".to_string(), format!("fetch: attempt start | path={}", repo_path)));
    
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "正在打开仓库...".to_string()));
    
    let repo = match Repository::open(&repo_path) {
        Ok(r) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "仓库打开成功".to_string()));
            r
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("打开仓库失败: {}", e)));
            return Err(format!("Failed to open repository: {}", e));
        }
    };

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "正在查找远程仓库 origin...".to_string()));

    let remote = match repo.find_remote("origin") {
        Ok(r) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "找到远程仓库 origin".to_string()));
            r
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("未找到远程仓库 origin: {}", e)));
            return Err(format!("Failed to find remote 'origin': {}", e));
        }
    };

    let url = remote.url().unwrap_or("").to_string();
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "使用系统 Git 执行 fetch（与 VS / 命令行一致，沿用 http.proxy 等配置）...".to_string()));

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "开始获取远程更改...".to_string()));

    let fetch_result = run_git_in_repo(&repo_path, &["fetch", "origin"]);

    match fetch_result {
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !stdout.is_empty() {
                let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                logs.push((timestamp, "INFO".to_string(), stdout));
            }
            if !stderr.is_empty() {
                let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                logs.push((timestamp, "INFO".to_string(), stderr.clone()));
            }
            if output.status.success() {
                let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                logs.push((timestamp, "INFO".to_string(), "获取成功！".to_string()));
                let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                logs.push((timestamp, "SUCCESS".to_string(), "操作完成 - 已获取远程仓库最新信息".to_string()));
                Ok(logs)
            } else {
                let code = output.status.code().unwrap_or(-1);
                let detail = format!("git fetch 退出码 {}: {}", code, stderr);
                log_message("ERROR", &format!("fetch: {} | url={}", detail, url));
                let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                logs.push((timestamp, "ERROR".to_string(), format!("获取失败: {}", detail)));
                let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                logs.push((timestamp, "ERROR".to_string(), format!("远程仓库URL: {}", url)));
                Err(format!("Failed to fetch: {}", detail))
            }
        }
        Err(e) => {
            let msg = format!("无法执行 git 命令: {}（请确认已安装 Git for Windows 并加入 PATH）", e);
            log_message("ERROR", &format!("fetch: {} | url={}", msg, url));
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), msg.clone()));
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("远程仓库URL: {}", url)));
            Err(format!("Failed to fetch: {}", msg))
        }
    }
}

// 推送更改 - 实时日志流
#[tauri::command]
async fn push_changes_with_realtime_logs(
    repo_path: String,
    app_handle: tauri::AppHandle
) -> Result<String, String> {
    // 发送开始日志
    emit_push_log(&app_handle, serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO",
        "message": "开始推送操作..."
    }));
    
    emit_push_log(&app_handle, serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO", 
        "message": format!("正在打开仓库: {}", repo_path)
    }));
    
    let repo = match Repository::open(&repo_path) {
        Ok(r) => {
            emit_push_log(&app_handle, serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "SUCCESS",
                "message": "仓库打开成功"
            }));
            r
        },
        Err(e) => {
            emit_push_log(&app_handle, serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "ERROR",
                "message": format!("打开仓库失败: {}", e)
            }));
            return Err(format!("Failed to open repository: {}", e));
        }
    };

    // 应用代理配置
    emit_push_log(&app_handle, serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO",
        "message": "正在应用代理配置..."
    }));

    let has_local_proxy_file = local_proxy_override_file_exists();
    let proxy_config = match get_proxy_config().await {
        Ok((config, is_from_git)) => {
            // 配置来源
            emit_push_log(&app_handle, serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "INFO",
                "message": if is_from_git { "代理配置来源: Git 全局配置" } else { "代理配置来源: 应用本地配置" }
            }));

            if config.enabled {
                emit_push_log(&app_handle, serde_json::json!({
                    "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                    "level": "INFO",
                    "message": format!("使用代理: {}://{}:{}", config.protocol, config.host, config.port)
                }));
            } else {
                emit_push_log(&app_handle, serde_json::json!({
                    "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                    "level": "INFO",
                    "message": "未启用代理"
                }));
            }
            config
        },
        Err(e) => {
            emit_push_log(&app_handle, serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "WARN",
                "message": format!("获取代理配置失败: {}", e)
            }));
            ProxyConfig {
                enabled: false,
                host: "127.0.0.1".to_string(),
                port: 7890,
                username: None,
                password: None,
                protocol: "http".to_string(),
            }
        }
    };

    // 推送使用系统 git 子进程，沿用 Git 全局配置中的代理；此处仅校验应用内代理表单格式
    if proxy_config.enabled {
        if let Err(e) = validate_proxy_protocol(&proxy_config.protocol) {
            emit_push_log(&app_handle, serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "ERROR",
                "message": e
            }));
            return Err(format!("代理配置错误: {}", e));
        }
        emit_push_log(&app_handle, serde_json::json!({
            "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            "level": "INFO",
            "message": format!(
                "libgit2 将经代理连接远程：{}://{}:{}",
                proxy_config.protocol, proxy_config.host, proxy_config.port
            )
        }));
    } else if !has_local_proxy_file {
        emit_push_log(&app_handle, serde_json::json!({
            "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            "level": "INFO",
            "message": "libgit2 将从 Git 配置自动检测代理（http.proxy / https.proxy）；未配置则不使用代理"
        }));
    } else {
        emit_push_log(&app_handle, serde_json::json!({
            "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            "level": "INFO",
            "message": "libgit2：不使用代理（应用内已关闭，且存在 proxy_config.json）"
        }));
    }

    emit_push_log(&app_handle, serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO",
        "message": "正在解析当前分支（须已检出本地分支）..."
    }));

    let branch_name = match branch_name_for_sync_commands(&repo) {
        Ok(n) => {
            emit_push_log(&app_handle, serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "SUCCESS",
                "message": format!("当前分支: {}", n)
            }));
            n
        }
        Err(e) => {
            emit_push_log(&app_handle, serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "ERROR",
                "message": e.clone()
            }));
            return Err(e);
        }
    };

    emit_push_log(&app_handle, serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO",
        "message": "正在查找远程仓库 origin..."
    }));

    let remote = match repo.find_remote("origin") {
        Ok(r) => {
            emit_push_log(&app_handle, serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "SUCCESS",
                "message": "找到远程仓库 origin"
            }));
            r
        },
        Err(e) => {
            emit_push_log(&app_handle, serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "ERROR",
                "message": format!("未找到远程仓库 origin: {}", e)
            }));
            return Err(format!("Failed to find remote 'origin': {}", e));
        }
    };

    emit_push_log(&app_handle, serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO",
        "message": "使用系统 Git 执行 push（与 VS / 命令行一致）..."
    }));

    emit_push_log(&app_handle, serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO",
        "message": format!("开始推送分支 {} 到 origin...", branch_name)
    }));

    let push_out = match run_git_in_repo(&repo_path, &["push", "-u", "origin", &branch_name]) {
        Ok(o) => o,
        Err(e) => {
            let msg = format!("无法执行 git: {}", e);
            emit_push_log(&app_handle, serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "ERROR",
                "message": msg.clone()
            }));
            return Err(format!("Failed to push: {}", msg));
        }
    };

    let detail = git_output_detail(&push_out);
    if !detail.is_empty() {
        emit_push_log(&app_handle, serde_json::json!({
            "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            "level": "INFO",
            "message": detail
        }));
    }

    if push_out.status.success() {
        emit_push_log(&app_handle, serde_json::json!({
            "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            "level": "SUCCESS",
            "message": "推送成功！"
        }));

        emit_push_log(&app_handle, serde_json::json!({
            "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            "level": "INFO",
            "message": "正在检查上游分支设置..."
        }));

        if let Ok(mut branch) = repo.find_branch(&branch_name, git2::BranchType::Local) {
            if branch.upstream().is_err() {
                if let Err(e) = branch.set_upstream(Some(&format!("origin/{}", branch_name))) {
                    emit_push_log(&app_handle, serde_json::json!({
                        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                        "level": "WARN",
                        "message": format!("设置上游分支失败: {}", e)
                    }));
                } else {
                    emit_push_log(&app_handle, serde_json::json!({
                        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                        "level": "SUCCESS",
                        "message": format!("已设置上游分支: origin/{}", branch_name)
                    }));
                }
            } else {
                emit_push_log(&app_handle, serde_json::json!({
                    "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                    "level": "INFO",
                    "message": "上游分支已存在"
                }));
            }
        }

        emit_push_log(&app_handle, serde_json::json!({
            "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            "level": "SUCCESS",
            "message": format!("操作完成 - 已推送到 origin/{}", branch_name)
        }));

        Ok(format!("Successfully pushed to origin/{}", branch_name))
    } else {
        let url = remote.url().unwrap_or("");
        let err_text = git_output_detail(&push_out);
        let error_msg = format!("推送失败: {}", err_text);
        let url_msg = format!("远程仓库URL: {}", url);

        emit_push_log(&app_handle, serde_json::json!({
            "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            "level": "ERROR",
            "message": error_msg.clone()
        }));

        emit_push_log(&app_handle, serde_json::json!({
            "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            "level": "ERROR",
            "message": url_msg
        }));

        let suggestion = if err_text.contains("authentication") || err_text.contains("Authentication") {
            "建议：检查Git凭据配置，确保有推送权限"
        } else if err_text.contains("network") || err_text.contains("timeout") || err_text.contains("timed out") {
            "建议：检查网络连接，或尝试使用代理"
        } else if err_text.contains("rejected") {
            "建议：远程仓库可能已更新，请先拉取最新更改"
        } else {
            "建议：查看详细错误信息，或尝试使用命令行推送"
        };

        emit_push_log(&app_handle, serde_json::json!({
            "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            "level": "INFO",
            "message": suggestion
        }));

        Err(format!("Failed to push: {}", err_text))
    }
}

// 推送更改 - 带日志流（保留原函数以兼容性）
#[tauri::command]
async fn push_changes_with_logs(repo_path: String) -> Result<Vec<(String, String, String)>, String> {
    let mut logs = Vec::new();

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    
    logs.push((timestamp, "INFO".to_string(), format!("push: attempt start | path={}", repo_path)));
    
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "正在打开仓库...".to_string()));
    
    let repo = match Repository::open(&repo_path) {
        Ok(r) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "仓库打开成功".to_string()));
            r
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("打开仓库失败: {}", e)));
            return Err(format!("Failed to open repository: {}", e));
        }
    };

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "正在解析当前分支...".to_string()));

    let branch_name = match branch_name_for_sync_commands(&repo) {
        Ok(n) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), format!("当前分支: {}", n)));
            n
        }
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), e.clone()));
            return Err(e);
        }
    };

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "正在查找远程仓库 origin...".to_string()));

    let remote = match repo.find_remote("origin") {
        Ok(r) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "找到远程仓库 origin".to_string()));
            r
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("未找到远程仓库 origin: {}", e)));
            return Err(format!("Failed to find remote 'origin': {}", e));
        }
    };

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "使用系统 Git 执行 push（与 VS / 命令行一致）...".to_string()));

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), format!("开始推送分支 {} 到 origin...", branch_name)));

    let push_out = match run_git_in_repo(&repo_path, &["push", "-u", "origin", &branch_name]) {
        Ok(o) => o,
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            let msg = format!("无法执行 git: {}", e);
            logs.push((timestamp, "ERROR".to_string(), msg.clone()));
            return Err(format!("Failed to push: {}", msg));
        }
    };
    let push_txt = git_output_detail(&push_out);
    if !push_txt.is_empty() {
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "INFO".to_string(), push_txt));
    }
    if !push_out.status.success() {
        let detail = git_output_detail(&push_out);
        let url = remote.url().unwrap_or("");
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "ERROR".to_string(), format!("推送失败: {}", detail)));
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "ERROR".to_string(), format!("远程仓库URL: {}", url)));
        return Err(format!("Failed to push: {}", detail));
    }

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "推送成功！".to_string()));

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "正在检查上游分支设置...".to_string()));

    if let Ok(mut branch) = repo.find_branch(&branch_name, git2::BranchType::Local) {
        if branch.upstream().is_err() {
            if let Err(e) = branch.set_upstream(Some(&format!("origin/{}", branch_name))) {
                let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                logs.push((timestamp, "WARN".to_string(), format!("设置上游分支失败: {}", e)));
            } else {
                let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                logs.push((timestamp, "INFO".to_string(), format!("已设置上游分支: origin/{}", branch_name)));
            }
        } else {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "上游分支已存在".to_string()));
        }
    }

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "SUCCESS".to_string(), format!("操作完成 - 已推送到 origin/{}", branch_name)));

    Ok(logs)
}

// Git诊断功能
#[tauri::command]
async fn git_diagnostics(repo_path: String) -> Result<Vec<(String, String, String)>, String> {
    let mut logs = Vec::new();
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    
    logs.push((timestamp, "INFO".to_string(), "开始Git诊断...".to_string()));
    
    // 检查仓库状态
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "检查仓库状态...".to_string()));
    
    let repo = match Repository::open(&repo_path) {
        Ok(r) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "SUCCESS".to_string(), "仓库打开成功".to_string()));
            r
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("仓库打开失败: {}", e)));
            return Err(format!("Failed to open repository: {}", e));
        }
    };
    
    // 检查远程仓库
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "检查远程仓库配置...".to_string()));
    
    match repo.find_remote("origin") {
        Ok(remote) => {
            let url = remote.url().unwrap_or("未设置");
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "SUCCESS".to_string(), format!("远程仓库URL: {}", url)));
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("未找到远程仓库 origin: {}", e)));
        }
    }
    
    // 检查Git配置
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "检查Git配置...".to_string()));
    
    if let Ok(config) = repo.config() {
        // 检查用户配置
        if let Ok(name) = config.get_string("user.name") {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "SUCCESS".to_string(), format!("用户名: {}", name)));
        } else {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "WARN".to_string(), "未设置用户名".to_string()));
        }
        
        if let Ok(email) = config.get_string("user.email") {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "SUCCESS".to_string(), format!("邮箱: {}", email)));
        } else {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "WARN".to_string(), "未设置邮箱".to_string()));
        }
        
        // 检查凭据配置
        if let Ok(helper) = config.get_string("credential.helper") {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "SUCCESS".to_string(), format!("凭据助手: {}", helper)));
        } else {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "WARN".to_string(), "未配置凭据助手".to_string()));
        }
    } else {
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "ERROR".to_string(), "无法读取Git配置".to_string()));
    }
    
    // 检查当前分支
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "检查当前分支...".to_string()));
    
    match repo.head() {
        Ok(head) => {
            let branch_name = head.shorthand().unwrap_or("未知");
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "SUCCESS".to_string(), format!("当前分支: {}", branch_name)));
            
            // 检查上游分支
            if let Ok(branch) = repo.find_branch(branch_name, git2::BranchType::Local) {
                match branch.upstream() {
                    Ok(upstream) => {
                        let upstream_name = upstream.name().unwrap_or(Some("未知")).unwrap_or("未知");
                        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                        logs.push((timestamp, "SUCCESS".to_string(), format!("上游分支: {}", upstream_name)));
                    },
                    Err(_) => {
                        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                        logs.push((timestamp, "WARN".to_string(), "未设置上游分支".to_string()));
                    }
                }
            }
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("获取HEAD失败: {}", e)));
        }
    }
    
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "SUCCESS".to_string(), "Git诊断完成".to_string()));
    
    Ok(logs)
}

// 拉取更改 - 带日志流
#[tauri::command]
async fn pull_changes_with_logs(repo_path: String) -> Result<PullWithLogsResult, String> {
    let started = Instant::now();
    let backup = create_silent_stash_backup(&repo_path, "pull")?;
    let mut logs = Vec::new();
    let ts = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((
        ts,
        "INFO".to_string(),
        format!("pull: attempt start | path={}", repo_path),
    ));
    let outcome = execute_pull(&repo_path, Some(&mut logs));
    let log_result: Result<String, String> = outcome
        .as_ref()
        .map(|o| o.message.clone())
        .map_err(|e| e.clone());
    record_git_write_operation(
        &repo_path,
        "pull",
        true,
        started,
        &log_result,
        backup.as_ref(),
        None,
    );
    outcome.map(|outcome| PullWithLogsResult { logs, outcome })
}

/// 与 git 侧路径比较（统一为正斜杠，避免 Windows 下 `a\b` 与 `a/b` 不相等导致差异为空）
fn git_paths_equal(a: &str, b: &str) -> bool {
    a.replace('\\', "/") == b.replace('\\', "/")
}

// 获取已暂存文件的差异
#[tauri::command]
async fn get_staged_file_diff(repo_path: String, file_path: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let head = repo.head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?
        .peel_to_commit()
        .map_err(|e| format!("Failed to peel to commit: {}", e))?;
    
    let head_tree = head.tree()
        .map_err(|e| format!("Failed to get HEAD tree: {}", e))?;
    
    let index = repo.index()
        .map_err(|e| format!("Failed to get index: {}", e))?;
    
    let diff = repo.diff_tree_to_index(Some(&head_tree), Some(&index), None)
        .map_err(|e| format!("Failed to create diff: {}", e))?;
    
    let mut diff_text = String::new();
    diff.print(git2::DiffFormat::Patch, |delta, _hunk, line| {
        // 检查是否是目标文件
        let current_file = delta.new_file().path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        
        if git_paths_equal(&current_file, &file_path) {
            // 添加diff行前缀
            let prefix = match line.origin() {
                '+' => "+",
                '-' => "-",
                ' ' => " ",
                _ => "",
            };
            // 安全地处理 UTF-8 编码
            let content = std::str::from_utf8(line.content()).unwrap_or("[INVALID UTF-8]");
            diff_text.push_str(&format!("{}{}\n", prefix, content));
        }
        true
    }).map_err(|e| format!("Failed to print diff: {}", e))?;
    
    Ok(diff_text)
}

// 获取未暂存文件的差异
#[tauri::command]
async fn get_unstaged_file_diff(repo_path: String, file_path: String) -> Result<String, String> {
    // 展示更完整上下文：等价 `git diff -U999999 -- <file>`（索引 vs 工作区）
    let output = run_git_in_repo(
        &repo_path,
        &["diff", "-U999999", "--", file_path.as_str()],
    )
    .map_err(|e| format!("无法执行 git diff：{}", e))?;

    if !output.status.success() {
        let detail = git_output_detail(&output);
        return Err(format!("读取未暂存差异失败：{}", detail));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// 获取未跟踪文件的内容
#[tauri::command]
async fn get_untracked_file_content(repo_path: String, file_path: String) -> Result<String, String> {
    let full_path = resolve_repo_workdir_path(&repo_path, &file_path)?;

    if full_path.is_dir() {
        return Err("Cannot show content of directory".to_string());
    }

    let content = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // 格式化为类似diff的格式，显示为新增文件
    let lines: Vec<&str> = content.lines().collect();
    let mut diff_text = format!("diff --git a/{} b/{}\n", file_path, file_path);
    diff_text.push_str("new file mode 100644\n");
    diff_text.push_str("index 0000000..0000000\n");
    diff_text.push_str("--- /dev/null\n");
    diff_text.push_str(&format!("+++ b/{}\n", file_path));
    diff_text.push_str(&format!("@@ -0,0 +1,{} @@\n", lines.len()));
    for line in &lines {
        diff_text.push_str(&format!("+{}\n", line));
    }

    Ok(diff_text)
}

// 获取文件内容
#[tauri::command]
async fn get_file_content(repo_path: String, file_path: String) -> Result<String, String> {
    let full_path = resolve_repo_workdir_path(&repo_path, &file_path)?;

    if full_path.is_dir() {
        return Err("Cannot read content of directory".to_string());
    }

    let content = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    Ok(content)
}

/// 优先读取工作区文件；若不存在则读取 HEAD 中的 blob（UTF-8 文本）
#[tauri::command]
async fn get_head_or_worktree_file_text(repo_path: String, file_path: String) -> Result<String, String> {
    let full_path = resolve_repo_workdir_path(&repo_path, &file_path).unwrap_or_else(|_| Path::new(&repo_path).join(&file_path));
    if full_path.is_file() {
        return fs::read_to_string(&full_path).map_err(|e| format!("读取工作区文件失败: {}", e));
    }

    let repo = Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;
    let head = repo.head().map_err(|e| format!("无法读取 HEAD: {}", e))?;
    let oid = head
        .target()
        .ok_or_else(|| "无法解析 HEAD 目标".to_string())?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("无法读取提交: {}", e))?;
    let tree = commit.tree().map_err(|e| format!("无法读取树: {}", e))?;
    let entry = tree
        .get_path(Path::new(&file_path))
        .map_err(|_| "工作区无此文件且 HEAD 中不存在".to_string())?;
    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| format!("无法读取 blob: {}", e))?;
    let content = blob.content();
    String::from_utf8(content.to_vec()).map_err(|_| "二进制文件，无法以文本显示".to_string())
}

// 获取贮藏列表
#[tauri::command]
async fn get_stash_list(repo_path: String) -> Result<Vec<StashInfo>, String> {
    let mut repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;

    let mut stashes = Vec::new();
    
    // 收集贮藏信息
    let mut stash_data = Vec::new();
    repo.stash_foreach(|_index, message, oid| {
        stash_data.push((oid.to_string(), message.to_string()));
        true // 继续遍历
    }).map_err(|e| format!("Failed to iterate stashes: {}", e))?;
    
    // 处理每个贮藏
    for (stash_id, stash_message) in stash_data {
        let oid = match Oid::from_str(&stash_id) {
            Ok(oid) => oid,
            Err(_) => continue,
        };
        let branch = guess_stash_branch(&stash_message);
        let timestamp = match repo.find_commit(oid) {
            Ok(commit) => commit.time().seconds().to_string(),
            Err(_) => "0".to_string(),
        };
        
        stashes.push(StashInfo {
            id: stash_id,
            message: stash_message,
            timestamp,
            branch,
        });
    }
    
    Ok(stashes)
}

// 创建贮藏
#[tauri::command]
async fn create_stash(repo_path: String, message: String) -> Result<String, String> {
    log_message("INFO", &format!("create_stash: attempt start | path={} message={}", repo_path, message));
    
    let mut repo = Repository::open(&repo_path)
        .map_err(|e| {
            let error_msg = format!("Failed to open repository: {}", e);
            log_message("ERROR", &format!("create_stash: {}", error_msg));
            error_msg
        })?;

    let signature = repo_author_signature(&repo).map_err(|e| {
        log_message("ERROR", &format!("create_stash: {}", e));
        e
    })?;

    log_message("DEBUG", &format!("create_stash: signature obtained | name={} email={}", 
        signature.name().unwrap_or("unknown"), 
        signature.email().unwrap_or("unknown")));

    // 检查工作区是否有更改
    let has_changes = {
        let statuses = repo.statuses(None)
            .map_err(|e| {
                let error_msg = format!("Failed to get status: {}", e);
                log_message("ERROR", &format!("create_stash: {}", error_msg));
                error_msg
            })?;
        
        statuses.iter().any(|entry| {
            let status = entry.status();
            status.contains(git2::Status::WT_NEW) ||
            status.contains(git2::Status::WT_MODIFIED) ||
            status.contains(git2::Status::WT_DELETED) ||
            status.contains(git2::Status::WT_TYPECHANGE) ||
            status.contains(git2::Status::WT_RENAMED) ||
            status.contains(git2::Status::INDEX_NEW) ||
            status.contains(git2::Status::INDEX_MODIFIED) ||
            status.contains(git2::Status::INDEX_DELETED)
        })
    };
    
    if !has_changes {
        log_message("WARN", "create_stash: no changes to stash");
        return Err("No changes to stash".to_string());
    }
    
    log_message(
        "DEBUG",
        "create_stash: changes detected, proceeding with stash (include untracked, like git stash -u)",
    );

    let stash_id = repo.stash_save(&signature, &message, Some(StashFlags::INCLUDE_UNTRACKED))
        .map_err(|e| {
            let error_msg = format!("Failed to create stash: {}", e);
            log_message("ERROR", &format!("create_stash: {}", error_msg));
            error_msg
        })?;
    
    log_message("INFO", &format!("create_stash: success | stash_id={}", stash_id));
    Ok(format!("Successfully created stash: {}", stash_id))
}

// 应用贮藏
#[tauri::command]
async fn apply_stash(repo_path: String, stash_id: String) -> Result<String, String> {
    let mut repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;

    // 查找贮藏的索引 - 改进匹配逻辑
    let mut stash_index = None;
    let mut found_stash_info = None;
    
    repo.stash_foreach(|index, message, oid| {
        let oid_str = oid.to_string();
        // 支持完整SHA1 hash匹配和短hash匹配
        if oid_str == stash_id || oid_str.starts_with(&stash_id) {
            stash_index = Some(index);
            found_stash_info = Some((oid_str, message.to_string()));
            false // 停止遍历
        } else {
            true // 继续遍历
        }
    }).map_err(|e| format!("Failed to find stash: {}", e))?;

    let index = match stash_index {
        Some(idx) => idx,
        None => {
            // 提供更详细的错误信息
            let mut available_stashes = Vec::new();
            repo.stash_foreach(|_index, message, oid| {
                available_stashes.push(format!("{}: {}", oid.to_string(), message.to_string()));
                true
            }).ok(); // 忽略错误，只是为了收集信息
            
            return Err(format!(
                "Stash not found: {}. Available stashes: [{}]", 
                stash_id, 
                available_stashes.join(", ")
            ));
        }
    };

    // 创建贮藏应用选项
    let mut options = git2::StashApplyOptions::new();
    options.reinstantiate_index();
    
    match repo.stash_apply(index, Some(&mut options)) {
        Ok(_) => {
            let stash_info = found_stash_info.unwrap_or((stash_id, "unknown".to_string()));
            Ok(format!("Successfully applied stash: {} ({})", stash_info.0, stash_info.1))
        },
        Err(e) => {
            let error_msg = e.message();
            let stash_info = found_stash_info.unwrap_or((stash_id, "unknown".to_string()));
            
            // 记录详细错误信息
            eprintln!("Stash apply error for {}: {}", stash_info.0, error_msg);
            
            // 检查是否是重复应用的错误
            if error_msg.contains("already applied") || error_msg.contains("nothing to commit") {
                Ok(format!("Stash {} ({}) has already been applied or there are no changes to apply", 
                          stash_info.0, stash_info.1))
            } else if error_msg.contains("conflict") {
                Err(format!("Failed to apply stash {} ({}): Conflicts detected. Error: {}. Please resolve conflicts manually.", 
                           stash_info.0, stash_info.1, error_msg))
            } else {
                // 尝试不使用选项
                match repo.stash_apply(index, None) {
                    Ok(_) => {
                        Ok(format!("Successfully applied stash: {} ({})", stash_info.0, stash_info.1))
                    },
                    Err(e2) => {
                        let error_msg2 = e2.message();
                        eprintln!("Second stash apply attempt failed for {}: {}", stash_info.0, error_msg2);
                        
                        if error_msg2.contains("already applied") || error_msg2.contains("nothing to commit") {
                            Ok(format!("Stash {} ({}) has already been applied or there are no changes to apply", 
                                      stash_info.0, stash_info.1))
                        } else {
                            Err(format!("Failed to apply stash {} ({}): {}. This may be because the stash has already been applied, there are conflicts, or the working directory is in an unexpected state.", 
                                       stash_info.0, stash_info.1, error_msg2))
                        }
                    }
                }
            }
        }
    }
}

// 删除贮藏
#[tauri::command]
async fn delete_stash(repo_path: String, stash_id: String) -> Result<String, String> {
    let mut repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;

    // 查找贮藏的索引
    let mut stash_index = None;
    repo.stash_foreach(|index, _message, oid| {
        let oid_str = oid.to_string();
        if oid_str == stash_id || oid_str.starts_with(&stash_id) {
            stash_index = Some(index);
            false // 停止遍历
        } else {
            true // 继续遍历
        }
    }).map_err(|e| format!("Failed to find stash: {}", e))?;

    let index = stash_index.ok_or("Stash not found")?;

    repo.stash_drop(index)
        .map_err(|e| format!("Failed to delete stash: {}", e))?;
    
    Ok(format!("Successfully deleted stash: {}", stash_id))
}

// 创建系统托盘菜单
fn create_system_tray() -> SystemTray {
    let show = CustomMenuItem::new("show".to_string(), "显示窗口");
    let quit = CustomMenuItem::new("quit".to_string(), "退出");
    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);
    
    SystemTray::new().with_menu(tray_menu)
}

// 处理系统托盘事件
fn handle_system_tray_event(app: &tauri::AppHandle, event: SystemTrayEvent) {
    match event {
        SystemTrayEvent::LeftClick {
            position: _,
            size: _,
            ..
        } => {
            // 左键点击显示/隐藏窗口
            if let Some(window) = app.get_window("main") {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
        SystemTrayEvent::MenuItemClick { id, .. } => {
            match id.as_str() {
                "show" => {
                    if let Some(window) = app.get_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    std::process::exit(0);
                }
                _ => {}
            }
        }
        _ => {}
    }
}

// 处理窗口事件
fn handle_window_event(event: &GlobalWindowEvent) {
    match event.event() {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            // 阻止默认的关闭行为，改为隐藏到托盘
            api.prevent_close();
            let _ = event.window().hide();
        }
        _ => {}
    }
}

fn main() {
    let scheduler_state = Arc::new(SchedulerState::new());
    {
        let cfg = load_auto_snapshot_config();
        *scheduler_state.config.lock().unwrap() = cfg;
    }

    tauri::Builder::default()
        .manage(scheduler_state)
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3));
                restart_scheduler(handle);
            });
            Ok(())
        })
        .system_tray(create_system_tray())
        .on_system_tray_event(handle_system_tray_event)
        .on_window_event(|event| {
            handle_window_event(&event);
        })
        .invoke_handler(tauri::generate_handler![
            init_repository,
            clone_repository,
            get_remote_management_info,
            add_remote,
            update_remote,
            remove_remote,
            set_branch_upstream,
            open_repository,
            get_commits_paginated,
            get_commit_count_head,
            get_author_commit_stats,
            get_commit_activity_stats,
            get_diff_aggregate_stats,
            get_file_territory_stats,
            get_recent_changed_files_stats,
            get_branch_activity_lifecycle_stats,
            search_commits,
            get_commits_for_activity_bucket,
            get_head_file_paths,
            get_branch_ref_tips,
            get_commits_branch_labels,
            checkout_branch,
            create_branch,
            delete_branch,
            rename_branch,
            merge_branch,
            abort_merge,
            reset_to_commit,
            cherry_pick_commit,
            revert_commit,
            rebase_to_commit,
            get_file_diff,
            get_commit_files,
            get_single_file_diff,
            get_recent_repos,
            save_recent_repo,
            remove_recent_repo,
            rename_recent_repo,
            update_recent_repo_entry,
            get_workspace_status,
            remove_untracked_path,
            remove_all_untracked_paths,
            stage_file,
            unstage_file,
            discard_unstaged_file,
            discard_all_unstaged,
            commit_changes,
            push_changes,
            pull_changes,
            fetch_changes,
            fetch_changes_with_logs,
            push_changes_with_logs,
            push_changes_with_realtime_logs,
            pull_changes_with_logs,
            git_diagnostics,
            get_operation_logs,
            get_silent_stash_diff,
            restore_silent_stash,
            get_log_file_path,
            append_gitlite_log,
            open_log_dir,
            open_folder,
            open_external_url,
            get_staged_file_diff,
            get_unstaged_file_diff,
            get_untracked_file_content,
            get_file_content,
            get_head_or_worktree_file_text,
            get_stash_list,
            create_stash,
            apply_stash,
            delete_stash,
            get_proxy_config,
            save_proxy_config,
            get_ai_config,
            save_ai_config,
            test_ai_connection,
            generate_commit_message_ai,
            summarize_commits_ai_stream,
            get_auto_snapshot_config,
            save_auto_snapshot_config,
            set_current_repo_for_snapshot,
            trigger_auto_snapshot_now,
            get_git_config_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
