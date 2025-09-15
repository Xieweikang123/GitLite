// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use git2::{Repository, Oid};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::fs;
use anyhow::Result; 
use std::io::Write;
use std::str::FromStr;
use tauri::Manager;

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
pub struct StashInfo {
    pub id: String,
    pub message: String,
    pub timestamp: String,
    pub branch: String,
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
    pub remote_url: Option<String>, // 远程仓库URL
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

// 在默认浏览器中打开外部链接（跨平台）
#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
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
    
    // 获取远程仓库URL
    let remote_url = repo.find_remote("origin")
        .ok()
        .and_then(|remote| remote.url().map(|url| url.to_string()));
    
    Ok(RepoInfo {
        path: path.to_string(),
        current_branch,
        branches,
        commits,
        ahead,
        behind,
        remote_url,
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
            }
            true
        },
        None,
        None,
        None,
    ).map_err(|e| format!("Failed to iterate index->workdir diff: {}", e))?;
    
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

    // 获取 HEAD 对象
    let head_obj = repo.revparse_single("HEAD")
        .map_err(|e| format!("Failed to get HEAD object: {}", e))?;

    // 使用 reset_default 方法取消暂存指定文件
    // 这等价于 git reset HEAD <file>，会将文件从暂存区移除但不会标记为删除
    repo.reset_default(Some(&head_obj), &[Path::new(&file_path)])
        .map_err(|e| format!("Failed to unstage file: {}", e))?;
    
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
        log_message("DEBUG", &format!("push: credential callback | url={} username={:?} allowed={:?}", 
            url, username_from_url, allowed));
        
        if allowed.contains(git2::CredentialType::DEFAULT) {
            log_message("DEBUG", "push: trying default credentials");
            return git2::Cred::default();
        }
        if allowed.contains(git2::CredentialType::SSH_KEY) {
            log_message("DEBUG", "push: trying SSH key from agent");
            return git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"));
        }
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            log_message("DEBUG", "push: trying credential helper");
            if let Some(cfg) = cfg.as_ref() {
                if let Ok(cred) = git2::Cred::credential_helper(cfg, url, username_from_url) {
                    log_message("DEBUG", "push: credential helper success");
                    return Ok(cred);
                } else {
                    log_message("WARN", "push: credential helper failed");
                }
            }
        }
        log_message("ERROR", "push: no authentication method available");
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

// 拉取更改
#[tauri::command]
async fn pull_changes(repo_path: String) -> Result<String, String> {
    log_message("INFO", &format!("pull: attempt start | path={}", repo_path));
    let repo = match Repository::open(&repo_path) {
        Ok(r) => r,
        Err(e) => {
            log_message("ERROR", &format!("pull: open repository failed: {} | path={}", e, repo_path));
            return Err(format!("Failed to open repository: {}", e));
        }
    };

    let head = match repo.head() {
        Ok(h) => h,
        Err(e) => {
            log_message("ERROR", &format!("pull: get HEAD failed: {}", e));
            return Err(format!("Failed to get HEAD: {}", e));
        }
    };
    let branch_name = head.shorthand().unwrap_or("main");

    let mut remote = match repo.find_remote("origin") {
        Ok(r) => r,
        Err(e) => {
            log_message("ERROR", &format!("pull: find remote 'origin' failed: {}", e));
            return Err(format!("Failed to find remote 'origin': {}", e));
        }
    };

    // 认证与 Fetch 选项
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

    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);

    // 首先执行 fetch
    let refspec = format!("refs/heads/{}:refs/remotes/origin/{}", branch_name, branch_name);
    if let Err(e) = remote.fetch(&[&refspec], Some(&mut fetch_opts), None) {
        let url = remote.url().unwrap_or("");
        log_message("ERROR", &format!("pull: git fetch failed: {} | url={} refspec={} branch={}", e, url, refspec, branch_name));
        let log_path = get_config_dir().join("logs").join("gitlite.log");
        return Err(format!("Failed to fetch: {} (see log: {})", e, log_path.display()));
    }

    // 获取远程分支引用
    let remote_branch_ref = format!("refs/remotes/origin/{}", branch_name);
    let remote_branch_oid = match repo.refname_to_id(&remote_branch_ref) {
        Ok(oid) => oid,
        Err(e) => {
            log_message("ERROR", &format!("pull: get remote branch OID failed: {} | ref={}", e, remote_branch_ref));
            return Err(format!("Failed to get remote branch reference: {}", e));
        }
    };

    // 获取本地HEAD的OID
    let local_head_oid = match repo.refname_to_id("HEAD") {
        Ok(oid) => oid,
        Err(e) => {
            log_message("ERROR", &format!("pull: get local HEAD OID failed: {}", e));
            return Err(format!("Failed to get local HEAD reference: {}", e));
        }
    };

    // 检查是否需要合并
    if remote_branch_oid == local_head_oid {
        log_message("INFO", &format!("pull: already up to date | branch={}", branch_name));
        return Ok("Already up to date".to_string());
    }

    // 检查工作区是否有未提交的更改
    let mut index = match repo.index() {
        Ok(i) => i,
        Err(e) => {
            log_message("ERROR", &format!("pull: get index failed: {}", e));
            return Err(format!("Failed to get index: {}", e));
        }
    };

    // 检查是否有未暂存的更改
    let diff_count = repo.diff_index_to_workdir(Some(&index), None)
        .map_err(|e| format!("Failed to create diff: {}", e))?
        .stats()
        .map_err(|e| format!("Failed to get diff stats: {}", e))?
        .files_changed();

    if diff_count > 0 {
        log_message("WARN", &format!("pull: uncommitted changes detected | files_changed={}", diff_count));
        return Err("Cannot pull: You have uncommitted changes. Please commit or stash them first.".to_string());
    }

    // 执行合并
    let remote_commit = match repo.find_commit(remote_branch_oid) {
        Ok(c) => c,
        Err(e) => {
            log_message("ERROR", &format!("pull: find remote commit failed: {}", e));
            return Err(format!("Failed to find remote commit: {}", e));
        }
    };

    let local_commit = match repo.find_commit(local_head_oid) {
        Ok(c) => c,
        Err(e) => {
            log_message("ERROR", &format!("pull: find local commit failed: {}", e));
            return Err(format!("Failed to find local commit: {}", e));
        }
    };

    // 检查是否是快进合并
    let is_ff = match repo.merge_base(local_head_oid, remote_branch_oid) {
        Ok(base) => base == local_head_oid,
        Err(_) => false,
    };

    if is_ff {
        // 快进合并
        let mut reference = match repo.find_reference("HEAD") {
            Ok(r) => r,
            Err(e) => {
                log_message("ERROR", &format!("pull: find HEAD reference failed: {}", e));
                return Err(format!("Failed to find HEAD reference: {}", e));
            }
        };

        if let Err(e) = reference.set_target(remote_branch_oid, "Fast-forward merge") {
            log_message("ERROR", &format!("pull: fast-forward failed: {}", e));
            return Err(format!("Failed to fast-forward: {}", e));
        }

        log_message("INFO", &format!("pull: fast-forward success | branch={}", branch_name));
        Ok("Successfully pulled (fast-forward)".to_string())
    } else {
        // 需要创建合并提交
        let mut merge_index = match repo.merge_commits(&local_commit, &remote_commit, None) {
            Ok(index) => index,
            Err(e) => {
                log_message("ERROR", &format!("pull: merge commits failed: {}", e));
                return Err(format!("Failed to merge: {}", e));
            }
        };

        // 将合并结果写入工作区
        let merge_tree = repo.find_tree(merge_index.write_tree().map_err(|e| format!("Failed to write merge tree: {}", e))?)
            .map_err(|e| format!("Failed to find merge tree: {}", e))?;

        // 创建合并提交
        let signature = git2::Signature::now("GitLite User", "gitlite@example.com")
            .map_err(|e| format!("Failed to create signature: {}", e))?;

        let merge_commit_id = repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &format!("Merge branch 'origin/{}'", branch_name),
            &merge_tree,
            &[&local_commit, &remote_commit],
        ).map_err(|e| format!("Failed to create merge commit: {}", e))?;

        log_message("INFO", &format!("pull: merge success | branch={} merge_commit={}", branch_name, merge_commit_id));
        Ok(format!("Successfully pulled and merged (commit: {})", merge_commit_id))
    }
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

    let mut remote = match repo.find_remote("origin") {
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
    logs.push((timestamp, "INFO".to_string(), "正在设置认证...".to_string()));

    // 认证与 Fetch 选项
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

    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "开始获取远程更改...".to_string()));

    // 执行 fetch 操作
    match remote.fetch::<&str>(&[], Some(&mut fetch_opts), None) {
        Ok(_) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "获取成功！".to_string()));
            
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "SUCCESS".to_string(), "操作完成 - 已获取远程仓库最新信息".to_string()));
            
            Ok(logs)
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("获取失败: {}", e)));
            
            let url = remote.url().unwrap_or("");
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("远程仓库URL: {}", url)));
            
            return Err(format!("Failed to fetch: {}", e));
        }
    }
}

// 推送更改 - 实时日志流
#[tauri::command]
async fn push_changes_with_realtime_logs(
    repo_path: String,
    app_handle: tauri::AppHandle
) -> Result<String, String> {
    let window = app_handle.get_window("main").unwrap();
    
    // 发送开始日志
    let _ = window.emit("push-log", serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO",
        "message": "开始推送操作..."
    }));
    
    let _ = window.emit("push-log", serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO", 
        "message": format!("正在打开仓库: {}", repo_path)
    }));
    
    let repo = match Repository::open(&repo_path) {
        Ok(r) => {
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "SUCCESS",
                "message": "仓库打开成功"
            }));
            r
        },
        Err(e) => {
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "ERROR",
                "message": format!("打开仓库失败: {}", e)
            }));
            return Err(format!("Failed to open repository: {}", e));
        }
    };

    let _ = window.emit("push-log", serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO",
        "message": "正在获取HEAD引用..."
    }));

    let head = match repo.head() {
        Ok(h) => {
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "SUCCESS",
                "message": "获取HEAD引用成功"
            }));
            h
        },
        Err(e) => {
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "ERROR",
                "message": format!("获取HEAD失败: {}", e)
            }));
            return Err(format!("Failed to get HEAD: {}", e));
        }
    };
    
    let branch_name = head.shorthand().unwrap_or("main");
    let _ = window.emit("push-log", serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO",
        "message": format!("当前分支: {}", branch_name)
    }));

    let _ = window.emit("push-log", serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO",
        "message": "正在查找远程仓库 origin..."
    }));

    let mut remote = match repo.find_remote("origin") {
        Ok(r) => {
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "SUCCESS",
                "message": "找到远程仓库 origin"
            }));
            r
        },
        Err(e) => {
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "ERROR",
                "message": format!("未找到远程仓库 origin: {}", e)
            }));
            return Err(format!("Failed to find remote 'origin': {}", e));
        }
    };

    let _ = window.emit("push-log", serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO",
        "message": "正在设置认证..."
    }));

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
    let _ = window.emit("push-log", serde_json::json!({
        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        "level": "INFO",
        "message": format!("开始推送分支 {} 到 origin...", branch_name)
    }));

    // 执行推送
    match remote.push(&[&refspec], Some(&mut push_opts)) {
        Ok(_) => {
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "SUCCESS",
                "message": "推送成功！"
            }));
            
            // 若本地分支没有上游，自动设置到 origin/<branch>
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "INFO",
                "message": "正在检查上游分支设置..."
            }));
            
            if let Ok(mut branch) = repo.find_branch(branch_name, git2::BranchType::Local) {
                if branch.upstream().is_err() {
                    if let Err(e) = branch.set_upstream(Some(&format!("origin/{}", branch_name))) {
                        let _ = window.emit("push-log", serde_json::json!({
                            "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                            "level": "WARN",
                            "message": format!("设置上游分支失败: {}", e)
                        }));
                    } else {
                        let _ = window.emit("push-log", serde_json::json!({
                            "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                            "level": "SUCCESS",
                            "message": format!("已设置上游分支: origin/{}", branch_name)
                        }));
                    }
                } else {
                    let _ = window.emit("push-log", serde_json::json!({
                        "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                        "level": "INFO",
                        "message": "上游分支已存在"
                    }));
                }
            }
            
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "SUCCESS",
                "message": format!("操作完成 - 已推送到 origin/{}", branch_name)
            }));
            
            Ok(format!("Successfully pushed to origin/{}", branch_name))
        },
        Err(e) => {
            let url = remote.url().unwrap_or("");
            let error_msg = format!("推送失败: {}", e);
            let detailed_msg = format!("详细错误信息: {}", e);
            let url_msg = format!("远程仓库URL: {}", url);
            
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "ERROR",
                "message": error_msg
            }));
            
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "ERROR",
                "message": detailed_msg
            }));
            
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "ERROR",
                "message": url_msg
            }));
            
            // 根据错误类型提供更具体的建议
            let suggestion = if e.message().contains("authentication") {
                "建议：检查Git凭据配置，确保有推送权限"
            } else if e.message().contains("network") || e.message().contains("timeout") {
                "建议：检查网络连接，或尝试使用代理"
            } else if e.message().contains("rejected") {
                "建议：远程仓库可能已更新，请先拉取最新更改"
            } else {
                "建议：查看详细错误信息，或尝试使用命令行推送"
            };
            
            let _ = window.emit("push-log", serde_json::json!({
                "timestamp": chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                "level": "INFO",
                "message": suggestion
            }));
            
            return Err(format!("Failed to push: {}", e));
        }
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
    logs.push((timestamp, "INFO".to_string(), "正在获取HEAD引用...".to_string()));

    let head = match repo.head() {
        Ok(h) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "获取HEAD引用成功".to_string()));
            h
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("获取HEAD失败: {}", e)));
            return Err(format!("Failed to get HEAD: {}", e));
        }
    };
    
    let branch_name = head.shorthand().unwrap_or("main");
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), format!("当前分支: {}", branch_name)));

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "正在查找远程仓库 origin...".to_string()));

    let mut remote = match repo.find_remote("origin") {
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
    logs.push((timestamp, "INFO".to_string(), "正在设置认证...".to_string()));

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
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), format!("开始推送分支 {} 到 origin...", branch_name)));

    // 执行推送
    match remote.push(&[&refspec], Some(&mut push_opts)) {
        Ok(_) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "推送成功！".to_string()));
            
            // 若本地分支没有上游，自动设置到 origin/<branch>
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "正在检查上游分支设置...".to_string()));
            
            if let Ok(mut branch) = repo.find_branch(branch_name, git2::BranchType::Local) {
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
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("推送失败: {}", e)));
            
            let url = remote.url().unwrap_or("");
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("远程仓库URL: {}", url)));
            
            return Err(format!("Failed to push: {}", e));
        }
    }
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
async fn pull_changes_with_logs(repo_path: String) -> Result<Vec<(String, String, String)>, String> {
    let mut logs = Vec::new();
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    
    logs.push((timestamp, "INFO".to_string(), format!("pull: attempt start | path={}", repo_path)));
    
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
    logs.push((timestamp, "INFO".to_string(), "正在获取HEAD引用...".to_string()));

    let head = match repo.head() {
        Ok(h) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "获取HEAD引用成功".to_string()));
            h
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("获取HEAD失败: {}", e)));
            return Err(format!("Failed to get HEAD: {}", e));
        }
    };
    
    let branch_name = head.shorthand().unwrap_or("main");
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), format!("当前分支: {}", branch_name)));

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "正在查找远程仓库 origin...".to_string()));

    let mut remote = match repo.find_remote("origin") {
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
    logs.push((timestamp, "INFO".to_string(), "正在设置认证...".to_string()));

    // 认证与 Fetch 选项
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

    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);

    // 首先执行 fetch
    let refspec = format!("refs/heads/{}:refs/remotes/origin/{}", branch_name, branch_name);
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), format!("开始获取远程分支 {}...", branch_name)));

    match remote.fetch::<&str>(&[&refspec], Some(&mut fetch_opts), None) {
        Ok(_) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "获取远程信息成功".to_string()));
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("获取远程信息失败: {}", e)));
            return Err(format!("Failed to fetch: {}", e));
        }
    }

    // 获取远程分支引用
    let remote_branch_ref = format!("refs/remotes/origin/{}", branch_name);
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), format!("正在获取远程分支引用: {}", remote_branch_ref)));

    let remote_branch_oid = match repo.refname_to_id(&remote_branch_ref) {
        Ok(oid) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "获取远程分支引用成功".to_string()));
            oid
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("获取远程分支引用失败: {}", e)));
            return Err(format!("Failed to get remote branch reference: {}", e));
        }
    };

    // 获取本地HEAD的OID
    let local_head_oid = match repo.refname_to_id("HEAD") {
        Ok(oid) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "获取本地HEAD引用成功".to_string()));
            oid
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("获取本地HEAD引用失败: {}", e)));
            return Err(format!("Failed to get local HEAD reference: {}", e));
        }
    };

    // 检查是否需要合并
    if remote_branch_oid == local_head_oid {
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "INFO".to_string(), "本地分支已是最新状态".to_string()));
        
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "SUCCESS".to_string(), "操作完成 - 无需拉取".to_string()));
        
        return Ok(logs);
    }

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "检测到远程更新，准备合并...".to_string()));

    // 检查工作区是否有未提交的更改
    let index = match repo.index() {
        Ok(i) => i,
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("获取索引失败: {}", e)));
            return Err(format!("Failed to get index: {}", e));
        }
    };

    // 检查是否有未暂存的更改
    let diff_count = repo.diff_index_to_workdir(Some(&index), None)
        .map_err(|e| format!("Failed to create diff: {}", e))?
        .stats()
        .map_err(|e| format!("Failed to get diff stats: {}", e))?
        .files_changed();

    if diff_count > 0 {
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "WARN".to_string(), format!("检测到 {} 个未提交的更改", diff_count)));
        
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "ERROR".to_string(), "无法拉取：存在未提交的更改，请先提交或贮藏".to_string()));
        
        return Err("Cannot pull: You have uncommitted changes. Please commit or stash them first.".to_string());
    }

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "工作区状态检查通过，开始合并...".to_string()));

    // 执行合并
    let remote_commit = match repo.find_commit(remote_branch_oid) {
        Ok(c) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "找到远程提交".to_string()));
            c
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("查找远程提交失败: {}", e)));
            return Err(format!("Failed to find remote commit: {}", e));
        }
    };

    let local_commit = match repo.find_commit(local_head_oid) {
        Ok(c) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "INFO".to_string(), "找到本地提交".to_string()));
            c
        },
        Err(e) => {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("查找本地提交失败: {}", e)));
            return Err(format!("Failed to find local commit: {}", e));
        }
    };

    // 检查是否是快进合并
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    logs.push((timestamp, "INFO".to_string(), "正在检查合并类型...".to_string()));

    let is_ff = match repo.merge_base(local_head_oid, remote_branch_oid) {
        Ok(base) => base == local_head_oid,
        Err(_) => false,
    };

    if is_ff {
        // 快进合并
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "INFO".to_string(), "检测到快进合并，执行快进操作...".to_string()));

        let mut reference = match repo.find_reference("HEAD") {
            Ok(r) => {
                let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                logs.push((timestamp, "INFO".to_string(), "找到HEAD引用".to_string()));
                r
            },
            Err(e) => {
                let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                logs.push((timestamp, "ERROR".to_string(), format!("查找HEAD引用失败: {}", e)));
                return Err(format!("Failed to find HEAD reference: {}", e));
            }
        };

        if let Err(e) = reference.set_target(remote_branch_oid, "Fast-forward merge") {
            let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
            logs.push((timestamp, "ERROR".to_string(), format!("快进合并失败: {}", e)));
            return Err(format!("Failed to fast-forward: {}", e));
        }

        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "INFO".to_string(), "快进合并成功".to_string()));
        
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "SUCCESS".to_string(), "操作完成 - 快进合并成功".to_string()));
        
        Ok(logs)
    } else {
        // 需要创建合并提交
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "INFO".to_string(), "检测到需要合并提交，开始合并操作...".to_string()));

        let mut merge_index = match repo.merge_commits(&local_commit, &remote_commit, None) {
            Ok(index) => {
                let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                logs.push((timestamp, "INFO".to_string(), "合并提交创建成功".to_string()));
                index
            },
            Err(e) => {
                let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                logs.push((timestamp, "ERROR".to_string(), format!("合并提交失败: {}", e)));
                return Err(format!("Failed to merge: {}", e));
            }
        };

        // 将合并结果写入工作区
        let merge_tree = repo.find_tree(merge_index.write_tree().map_err(|e| format!("Failed to write merge tree: {}", e))?)
            .map_err(|e| format!("Failed to find merge tree: {}", e))?;

        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "INFO".to_string(), "正在创建合并提交...".to_string()));

        // 创建合并提交
        let signature = git2::Signature::now("GitLite User", "gitlite@example.com")
            .map_err(|e| format!("Failed to create signature: {}", e))?;

        let merge_commit_id = repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &format!("Merge branch 'origin/{}'", branch_name),
            &merge_tree,
            &[&local_commit, &remote_commit],
        ).map_err(|e| format!("Failed to create merge commit: {}", e))?;

        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "INFO".to_string(), "合并提交创建成功".to_string()));
        
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        logs.push((timestamp, "SUCCESS".to_string(), format!("操作完成 - 合并提交成功 (commit: {})", merge_commit_id)));

        Ok(logs)
    }
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
    
    let mut index = repo.index()
        .map_err(|e| format!("Failed to get index: {}", e))?;
    
    let index_tree = repo.find_tree(index.write_tree().map_err(|e| format!("Failed to write tree: {}", e))?)
        .map_err(|e| format!("Failed to find index tree: {}", e))?;
    
    let diff = repo.diff_tree_to_tree(Some(&head_tree), Some(&index_tree), None)
        .map_err(|e| format!("Failed to create diff: {}", e))?;
    
    let mut diff_text = String::new();
    diff.print(git2::DiffFormat::Patch, |delta, _hunk, line| {
        // 检查是否是目标文件
        let current_file = delta.new_file().path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        
        if current_file == file_path {
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
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let index = repo.index()
        .map_err(|e| format!("Failed to get index: {}", e))?;
    
    let diff = repo.diff_index_to_workdir(Some(&index), None)
        .map_err(|e| format!("Failed to create diff: {}", e))?;
    
    let mut diff_text = String::new();
    diff.print(git2::DiffFormat::Patch, |delta, _hunk, line| {
        // 检查是否是目标文件
        let current_file = delta.new_file().path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        
        if current_file == file_path {
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

// 获取未跟踪文件的内容
#[tauri::command]
async fn get_untracked_file_content(repo_path: String, file_path: String) -> Result<String, String> {
    let full_path = Path::new(&repo_path).join(&file_path);
    
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
    
    for (i, line) in lines.iter().enumerate() {
        diff_text.push_str(&format!("@@ -0,0 +{},1 @@\n", i + 1));
        diff_text.push_str(&format!("+{}\n", line));
    }
    
    Ok(diff_text)
}

// 获取文件内容
#[tauri::command]
async fn get_file_content(repo_path: String, file_path: String) -> Result<String, String> {
    let full_path = Path::new(&repo_path).join(&file_path);
    
    if full_path.is_dir() {
        return Err("Cannot read content of directory".to_string());
    }
    
    let content = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    
    Ok(content)
}

// 获取贮藏列表
#[tauri::command]
async fn get_stash_list(repo_path: String) -> Result<Vec<StashInfo>, String> {
    let mut repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;

    let mut stashes = Vec::new();
    
    // 获取当前分支名
    let current_branch = match repo.head() {
        Ok(head) => {
            if let Some(name) = head.shorthand() {
                name.to_string()
            } else {
                "detached".to_string()
            }
        },
        Err(_) => "unknown".to_string(),
    };
    
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
        let timestamp = match repo.find_commit(oid) {
            Ok(commit) => commit.time().seconds().to_string(),
            Err(_) => "0".to_string(),
        };
        
        stashes.push(StashInfo {
            id: stash_id,
            message: stash_message,
            timestamp,
            branch: current_branch.clone(),
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

    // 尝试从仓库获取签名，如果失败则使用默认签名
    let signature = match repo.signature() {
        Ok(sig) => {
            log_message("DEBUG", &format!("create_stash: using repo signature | name={} email={}", 
                sig.name().unwrap_or("unknown"), 
                sig.email().unwrap_or("unknown")));
            sig
        },
        Err(e) => {
            log_message("WARN", &format!("create_stash: failed to get repo signature: {}, using default", e));
            git2::Signature::now("GitLite User", "gitlite@example.com")
                .map_err(|e| {
                    let error_msg = format!("Failed to create default signature: {}", e);
                    log_message("ERROR", &format!("create_stash: {}", error_msg));
                    error_msg
                })?
        }
    };

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
    
    log_message("DEBUG", "create_stash: changes detected, proceeding with stash");

    let stash_id = repo.stash_save(&signature, &message, None)
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
        if oid.to_string() == stash_id {
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
            pull_changes,
            fetch_changes_with_logs,
            push_changes_with_logs,
            push_changes_with_realtime_logs,
            pull_changes_with_logs,
            git_diagnostics,
            get_log_file_path,
            open_log_dir,
            open_external_url,
            get_staged_file_diff,
            get_unstaged_file_diff,
            get_untracked_file_content,
            get_file_content,
            get_stash_list,
            create_stash,
            apply_stash,
            delete_stash
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
