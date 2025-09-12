// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use git2::{Repository, Commit, Oid};
use std::str::FromStr;
use serde::{Deserialize, Serialize};
use std::path::Path;
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
pub struct RepoInfo {
    pub path: String,
    pub current_branch: String,
    pub branches: Vec<BranchInfo>,
    pub commits: Vec<CommitInfo>,
}

// 打开 Git 仓库
#[tauri::command]
async fn open_repository(path: String) -> Result<RepoInfo, String> {
    let repo = Repository::open(&path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let repo_info = get_repository_info(&repo, &path)
        .map_err(|e| format!("Failed to get repository info: {}", e))?;
    
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
        let (branch, branch_type) = branch_result
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

// 获取提交历史
fn get_commit_history(repo: &Repository) -> Result<Vec<CommitInfo>> {
    let mut revwalk = repo.revwalk()
        .map_err(|e| anyhow::anyhow!("Failed to create revwalk: {}", e))?;
    
    revwalk.push_head()
        .map_err(|e| anyhow::anyhow!("Failed to push HEAD: {}", e))?;
    
    let mut commits = Vec::new();
    
    for oid_result in revwalk {
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
        
        // 限制提交数量，避免性能问题
        if commits.len() >= 100 {
            break;
        }
    }
    
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

// 获取文件差异
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_repository,
            checkout_branch,
            get_file_diff
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
