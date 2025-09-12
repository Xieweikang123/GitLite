// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use git2::{Repository, Oid};
use git2::build::CheckoutBuilder;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::fs;
use anyhow::Result;
use std::io::Write;

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitInfo {
    pub id: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub short_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct RepoInfo {
    pub path: String,
    pub current_branch: String,
    pub branches: Vec<BranchInfo>,
    pub commits: Vec<CommitInfo>,
    pub ahead: u32,   // 本地比远端超前的提交数（待推送）
    pub behind: u32,  // 本地比远端落后的提交数（待拉取）
}

// 判断某路径是否在 HEAD（上一次提交）中被追踪
fn path_tracked_in_head(repo: &Repository, file_path: &str) -> bool {
    if let Ok(head) = repo.head() {
        if let Ok(tree) = head.peel_to_tree() {
            if let Ok(path) = std::path::Path::new(file_path).strip_prefix("./") {
                // normalize leading ./ if any
                if tree.get_path(path).is_ok() {
                    return true;
                }
            }
            // try original path
            if tree.get_path(Path::new(file_path)).is_ok() {
                return true;
            }
        }
    }
    false
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
        serde_json::from_str::<Vec<RecentRepo>>(&content)
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    
    // 获取仓库名称
    let repo_name = Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Unknown")
        .to_string();
    
    // 移除已存在的相同路径
    repos.retain(|repo| repo.path != path);
    
    // 添加新的仓库到列表开头
    let recent_repo = RecentRepo {
        path: path.clone(),
        name: repo_name,
        last_opened: chrono::Utc::now().to_rfc3339(),
    };
    repos.insert(0, recent_repo);
    
    // 限制最多保存10个
    if repos.len() > 10 {
        repos.truncate(10);
    }
    
    // 保存到文件
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

// 打开 Git 仓库
#[tauri::command]
async fn open_repository(path: String) -> Result<RepoInfo, String> {
    let repo = Repository::open(&path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let repo_info = get_repository_info(&repo, &path)
        .map_err(|e| format!("Failed to get repository info: {}", e))?;
    
    // 保存到最近打开的仓库列表
    if let Err(e) = save_recent_repo(path).await {
        eprintln!("Failed to save recent repo: {}", e);
    }
    
    Ok(repo_info)
}

// 获取仓库信息
fn get_repository_info(repo: &Repository, path: &str) -> Result<RepoInfo> {
    // 获取当前分支
    let head = repo.head().map_err(|e| anyhow::anyhow!("Failed to get HEAD: {}", e))?;
    let current_branch = head.shorthand().unwrap_or("detached").to_string();
    
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
    let commits = get_commit_history(repo)?;

    // 计算当前分支与上游的 ahead/behind
    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;
    // 通过分支名找到本地与上游引用
    if let Ok(mut branch) = repo.find_branch(&current_branch, git2::BranchType::Local) {
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
    
    Ok(RepoInfo {
        path: path.to_string(),
        current_branch,
        branches,
        commits,
        ahead,
        behind,
    })
}

// 获取提交历史（初始加载，只获取前50个）
fn get_commit_history(repo: &Repository) -> Result<Vec<CommitInfo>> {
    get_commit_history_paginated(repo, Some(50), Some(0))
}

// 获取分页提交历史
fn get_commit_history_paginated(repo: &Repository, limit: Option<usize>, offset: Option<usize>) -> Result<Vec<CommitInfo>> {
    let mut revwalk = repo.revwalk()
        .map_err(|e| anyhow::anyhow!("Failed to create revwalk: {}", e))?;
    
    revwalk.push_head()
        .map_err(|e| anyhow::anyhow!("Failed to push HEAD: {}", e))?;
    
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
        let date = chrono::DateTime::from_timestamp(commit.time().seconds(), 0)
            .unwrap_or_default()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        
        commits.push(CommitInfo {
            id: oid.to_string(),
            short_id: format!("{:.7}", oid),
            message: message.lines().next().unwrap_or("").to_string(),
            author: author.name().unwrap_or("Unknown").to_string(),
            email: author.email().unwrap_or("").to_string(),
            date,
        });
        
        count += 1;
    }
    
    Ok(commits)
}

// 获取分页提交历史
#[tauri::command]
async fn get_commits_paginated(repo_path: String, limit: Option<usize>, offset: Option<usize>) -> Result<Vec<CommitInfo>, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let commits = get_commit_history_paginated(&repo, limit, offset)
        .map_err(|e| format!("Failed to get commit history: {}", e))?;
    
    Ok(commits)
}

// 切换分支
#[tauri::command]
async fn checkout_branch(repo_path: String, branch_name: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let (object, reference) = repo.revparse_ext(&branch_name)
        .map_err(|e| format!("Failed to find branch: {}", e))?;
    
    repo.checkout_tree(&object, None)
        .map_err(|e| format!("Failed to checkout tree: {}", e))?;
    
    if let Some(reference) = reference {
        repo.set_head(reference.name().unwrap())
            .map_err(|e| format!("Failed to set HEAD: {}", e))?;
    } else {
        repo.set_head_detached(object.id())
            .map_err(|e| format!("Failed to set HEAD detached: {}", e))?;
    }
    
    Ok(format!("Successfully checked out to {}", branch_name))
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
    
    // 创建差异，然后过滤特定文件
    let diff = repo.diff_tree_to_tree(parent.as_ref(), Some(&tree), None)
        .map_err(|e| format!("Failed to create diff: {}", e))?;
    
    let mut diff_text = String::new();
    diff.print(git2::DiffFormat::Patch, |delta, _hunk, line| {
        // 检查是否是目标文件
        let current_file = delta.new_file().path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        
        if current_file == file_path {
            diff_text.push_str(&format!("{}\n", std::str::from_utf8(line.content()).unwrap_or("")));
        }
        true
    }).map_err(|e| format!("Failed to print diff: {}", e))?;
    
    Ok(diff_text)
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

// 获取工作区状态
#[tauri::command]
async fn get_workspace_status(repo_path: String) -> Result<WorkspaceStatus, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let mut staged_files = Vec::new();
    let mut unstaged_files = Vec::new();
    let mut untracked_files = Vec::new();
    
    
    // 使用 git status 来获取更准确的状态信息
    let mut status_options = git2::StatusOptions::new();
    status_options.include_untracked(true);
    status_options.include_ignored(false);
    status_options.include_unmodified(false);
    
    let statuses = repo.statuses(Some(&mut status_options))
        .map_err(|e| format!("Failed to get statuses: {}", e))?;
    
    for entry in statuses.iter() {
        let file_path = entry.path().unwrap_or("").to_string();
        let status = entry.status();
        
        // 优先处理暂存状态，如果文件在暂存区，就不处理工作区状态
        if status.contains(git2::Status::INDEX_NEW) {
            staged_files.push(FileChange {
                path: file_path.clone(),
                status: "added".to_string(),
                additions: 1,
                deletions: 0,
            });
        } else if status.contains(git2::Status::INDEX_MODIFIED) {
            staged_files.push(FileChange {
                path: file_path.clone(),
                status: "modified".to_string(),
                additions: 1,
                deletions: 0,
            });
        } else if status.contains(git2::Status::INDEX_DELETED) {
            // 与 git status 保持一致：即便工作区有 WT_NEW，也要在暂存区显示 deleted
            staged_files.push(FileChange {
                path: file_path.clone(),
                status: "deleted".to_string(),
                additions: 0,
                deletions: 1,
            });
        } else if status.contains(git2::Status::INDEX_RENAMED) {
            staged_files.push(FileChange {
                path: file_path.clone(),
                status: "renamed".to_string(),
                additions: 1,
                deletions: 0,
            });
        }
        
        // 处理工作区状态（无论文件是否在暂存区）
        if status.contains(git2::Status::WT_NEW) {
            // 与 git status 对齐：若该路径在 HEAD 存在且索引为 deleted，则工作区提示应为 Untracked
            if path_tracked_in_head(&repo, &file_path) && status.contains(git2::Status::INDEX_DELETED) {
                if !untracked_files.contains(&file_path) {
                    untracked_files.push(file_path);
                }
            } else if path_tracked_in_head(&repo, &file_path) {
                // HEAD 有且索引未删除，才视为修改
                if !unstaged_files.iter().any(|f: &FileChange| f.path == file_path) {
                    unstaged_files.push(FileChange {
                        path: file_path.clone(),
                        status: "modified".to_string(),
                        additions: 1,
                        deletions: 0,
                    });
                }
            } else if !untracked_files.contains(&file_path) {
                untracked_files.push(file_path);
            }
        } else if status.contains(git2::Status::WT_MODIFIED) {
            // 如果文件在工作区被修改但没有暂存，添加到未暂存列表
            if !status.contains(git2::Status::INDEX_MODIFIED) {
                unstaged_files.push(FileChange {
                    path: file_path.clone(),
                    status: "modified".to_string(),
                    additions: 1,
                    deletions: 0,
                });
            }
        } else if status.contains(git2::Status::WT_DELETED) {
            // 如果文件在工作区被删除但没有暂存，添加到未暂存列表
            if !status.contains(git2::Status::INDEX_DELETED) {
                unstaged_files.push(FileChange {
                    path: file_path.clone(),
                    status: "deleted".to_string(),
                    additions: 0,
                    deletions: 1,
                });
            }
        } else if status.contains(git2::Status::WT_TYPECHANGE) {
            // 文件类型改变
            unstaged_files.push(FileChange {
                path: file_path.clone(),
                status: "modified".to_string(),
                additions: 1,
                deletions: 0,
            });
        }
    }
    
    // 使用 index 到 workdir 的差异更可靠地获取"未暂存"
    log_message("DEBUG", &format!("workspace_status: starting index->workdir diff | staged_count={} unstaged_count={}", staged_files.len(), unstaged_files.len()));
    let index = repo.index().map_err(|e| format!("Failed to get index: {}", e))?;
    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.include_untracked(true).recurse_untracked_dirs(true);
    let diff = repo.diff_index_to_workdir(Some(&index), Some(&mut diff_opts))
        .map_err(|e| format!("Failed to create index->workdir diff: {}", e))?;
    
     
    let mut diff_count = 0;
    diff.foreach(
        &mut |delta, _| {
            diff_count += 1;
            let file_path = delta.new_file().path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            let delta_status = format!("{:?}", delta.status());
            log_message("DEBUG", &format!("workspace_status: delta[{}] {} | path={}", diff_count, delta_status, file_path));
            // 注意：同一文件可以同时有暂存和未暂存的修改，所以不跳过
            // 识别类型
            let status = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Modified => "modified",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Renamed => "renamed",
                git2::Delta::Untracked => {
                    if !untracked_files.contains(&file_path) {
                        untracked_files.push(file_path.clone());
                        log_message("DEBUG", &format!("workspace_status: added untracked | path={}", file_path));
                    }
                    return true;
                },
                _ => "modified",
            };
            if !unstaged_files.iter().any(|f| f.path == file_path) {
                unstaged_files.push(FileChange {
                    path: file_path.clone(),
                    status: status.to_string(),
                    additions: 1,
                    deletions: 0,
                });
                log_message("DEBUG", &format!("workspace_status: added unstaged | path={} status={}", file_path, status));
            }
            true
        },
        None,
        None,
        None,
    ).map_err(|e| format!("Failed to iterate index->workdir diff: {}", e))?;
    log_message("DEBUG", &format!("workspace_status: completed | total_deltas={} final_unstaged={} final_untracked={}", diff_count, unstaged_files.len(), untracked_files.len()));
    
    Ok(WorkspaceStatus {
        staged_files,
        unstaged_files,
        untracked_files,
    })
}

// 暂存文件
#[tauri::command]
async fn stage_file(repo_path: String, file_path: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let mut index = repo.index().map_err(|e| format!("Failed to get index: {}", e))?;
    
    index.add_path(Path::new(&file_path))
        .map_err(|e| format!("Failed to add file to index: {}", e))?;
    
    index.write().map_err(|e| format!("Failed to write index: {}", e))?;
    
    Ok(format!("Successfully staged {}", file_path))
}

// 取消暂存文件
#[tauri::command]
async fn unstage_file(repo_path: String, file_path: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;

    // 等价于：git restore --staged <path>（将索引恢复到 HEAD）
    let head_obj = repo.revparse_single("HEAD")
        .map_err(|e| format!("Failed to get HEAD object: {}", e))?;

    let mut checkout = CheckoutBuilder::new();
    // 仅重置指定路径的索引条目
    checkout.path(&file_path);

    repo.reset(&head_obj, git2::ResetType::Mixed, Some(&mut checkout))
        .map_err(|e| format!("Failed to reset index for path: {}", e))?;
    
    Ok(format!("Successfully unstaged {}", file_path))
}

// 提交更改
#[tauri::command]
async fn commit_changes(repo_path: String, message: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let mut index = repo.index().map_err(|e| format!("Failed to get index: {}", e))?;
    
    // 检查是否有暂存的文件
    if index.len() == 0 {
        return Err("No files staged for commit".to_string());
    }
    
    let tree_id = index.write_tree().map_err(|e| format!("Failed to write tree: {}", e))?;
    let tree = repo.find_tree(tree_id).map_err(|e| format!("Failed to find tree: {}", e))?;
    
    let head = repo.head().ok();
    let parent_commit = if let Some(head) = head {
        head.peel_to_commit().ok()
    } else {
        None
    };
    
    let signature = git2::Signature::now("GitLite User", "gitlite@example.com")
        .map_err(|e| format!("Failed to create signature: {}", e))?;
    
    let commit_id = repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        &message,
        &tree,
        &parent_commit.iter().collect::<Vec<_>>(),
    ).map_err(|e| format!("Failed to commit: {}", e))?;
    
    Ok(format!("Successfully committed with ID: {}", commit_id))
}

// 推送更改（支持认证与自动设置上游）
#[tauri::command]
async fn push_changes(repo_path: String) -> Result<String, String> {
    log_message("INFO", &format!("push: attempt start | path={}", repo_path));
    let repo = match Repository::open(&repo_path) {
        Ok(r) => r,
        Err(e) => {
            log_message("ERROR", &format!("push: open repository failed: {} | path={}", e, repo_path));
            return Err(format!("Failed to open repository: {}", e));
        }
    };

    let head = match repo.head() {
        Ok(h) => h,
        Err(e) => {
            log_message("ERROR", &format!("push: get HEAD failed: {}", e));
            return Err(format!("Failed to get HEAD: {}", e));
        }
    };
    let branch_name = head.shorthand().unwrap_or("main");

    let mut remote = match repo.find_remote("origin") {
        Ok(r) => r,
        Err(e) => {
            log_message("ERROR", &format!("push: find remote 'origin' failed: {}", e));
            return Err(format!("Failed to find remote 'origin': {}", e));
        }
    };

    // 认证与 Push 选项
    let cfg = repo.config().ok();
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(move |url, username_from_url, allowed| {
        if allowed.contains(git2::CredentialType::DEFAULT) {
            return git2::Cred::default();
        }
        if allowed.contains(git2::CredentialType::SSH_KEY) {
            return git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"));
        }
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            if let Some(cfg) = cfg.as_ref() {
                if let Ok(cred) = git2::Cred::credential_helper(cfg, url, username_from_url) {
                    return Ok(cred);
                }
            }
        }
        Err(git2::Error::from_str("No authentication method available"))
    });

    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    let refspec = format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name);
    if let Err(e) = remote.push(&[&refspec], Some(&mut push_opts)) {
        let url = remote.url().unwrap_or("");
        log_message("ERROR", &format!("push: git push failed: {} | url={} refspec={} branch={}", e, url, refspec, branch_name));
        let log_path = get_config_dir().join("logs").join("gitlite.log");
        return Err(format!("Failed to push: {} (see log: {})", e, log_path.display()));
    }

    // 若本地分支没有上游，自动设置到 origin/<branch>
    if let Ok(mut branch) = repo.find_branch(branch_name, git2::BranchType::Local) {
        if branch.upstream().is_err() {
            if let Err(e) = branch.set_upstream(Some(&format!("origin/{}", branch_name))) {
                log_message("WARN", &format!("push: set upstream failed but push succeeded: {}", e));
            }
        }
    }

    log_message("INFO", &format!("push: success | branch={} refspec={}", branch_name, refspec));
    Ok(format!("Successfully pushed to origin/{}", branch_name))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_repository,
            get_commits_paginated,
            checkout_branch,
            get_file_diff,
            get_commit_files,
            get_single_file_diff,
            get_recent_repos,
            save_recent_repo,
            get_workspace_status,
            stage_file,
            unstage_file,
            commit_changes,
            push_changes,
            get_log_file_path,
            open_log_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
