// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use git2::{Repository, Oid};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::fs;
use anyhow::Result;

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
    
    Ok(RepoInfo {
        path: path.to_string(),
        current_branch,
        branches,
        commits,
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
    
    // 获取暂存区的文件
    let head = repo.head().ok();
    let head_tree = head.as_ref().and_then(|h| h.peel_to_tree().ok());
    let mut index = repo.index().map_err(|e| format!("Failed to get index: {}", e))?;
    let index_tree = repo.find_tree(index.write_tree().map_err(|e| format!("Failed to write tree: {}", e))?)
        .map_err(|e| format!("Failed to find tree: {}", e))?;
    
    let staged_diff = repo.diff_tree_to_tree(head_tree.as_ref(), Some(&index_tree), None)
        .map_err(|e| format!("Failed to create staged diff: {}", e))?;
    
    staged_diff.foreach(
        &mut |delta, _progress| {
            let file_path = delta.new_file().path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            
            let status = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Modified => "modified",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Renamed => "renamed",
                _ => "unknown",
            };
            
            staged_files.push(FileChange {
                path: file_path,
                status: status.to_string(),
                additions: 1,
                deletions: 0,
            });
            
            true
        },
        None,
        None,
        None,
    ).map_err(|e| format!("Failed to iterate staged diff: {}", e))?;
    
    // 获取工作区的文件
    let workdir_diff = repo.diff_index_to_workdir(None, None)
        .map_err(|e| format!("Failed to create workdir diff: {}", e))?;
    
    workdir_diff.foreach(
        &mut |delta, _progress| {
            let file_path = delta.new_file().path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            
            let status = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Modified => "modified",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Renamed => "renamed",
                git2::Delta::Untracked => {
                    untracked_files.push(file_path);
                    return true;
                },
                _ => "unknown",
            };
            
            unstaged_files.push(FileChange {
                path: file_path,
                status: status.to_string(),
                additions: 1,
                deletions: 0,
            });
            
            true
        },
        None,
        None,
        None,
    ).map_err(|e| format!("Failed to iterate workdir diff: {}", e))?;
    
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
    
    let mut index = repo.index().map_err(|e| format!("Failed to get index: {}", e))?;
    
    index.remove_path(Path::new(&file_path))
        .map_err(|e| format!("Failed to remove file from index: {}", e))?;
    
    index.write().map_err(|e| format!("Failed to write index: {}", e))?;
    
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

// 推送更改
#[tauri::command]
async fn push_changes(repo_path: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let head = repo.head().map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let branch_name = head.shorthand().unwrap_or("main");
    
    let mut remote = repo.find_remote("origin")
        .map_err(|e| format!("Failed to find remote 'origin': {}", e))?;
    
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name);
    
    remote.push(&[&refspec], None)
        .map_err(|e| format!("Failed to push: {}", e))?;
    
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
            push_changes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
