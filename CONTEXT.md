# GitLite

一个基于 Tauri 的轻量级 Git GUI 客户端，作为 SourceTree 的开源替代品。核心领域是 Git 仓库的可视化操作。

## Language

**Repository**:
一个被 GitLite 打开的本地 Git 仓库，是领域中的唯一核心实体。`DirectoryRepoEntry`、`RecentRepo` 等是它的不同来源或视图，不是独立概念。
_Avoid_: repo, 仓库视图

**Upstream**:
本地分支所跟踪的远端分支。`ahead`/`behind` 是相对上游的偏移量，不是相对 origin 的偏移量。当分支未设置上游时，ahead/behind 不代表与远端的同步程度。
_Avoid_: 远端分支, origin

**Staged**:
已加入暂存区、准备提交的文件状态。
_Avoid_: 已暂存

**Unstaged**:
已修改但尚未加入暂存区的文件状态。
_Avoid_: 未暂存

**Untracked**:
尚未被 Git 跟踪的新文件状态。
_Avoid_: 未跟踪

**Conflicted**:
合并冲突中、需要人工解决的文件状态。
_Avoid_: 冲突

**Workspace**:
用户看到的"当前未提交变更"的整体视图，聚合了 Staged、Unstaged、Untracked、Conflicted 四类文件。对应 Git 的 working tree。
_Avoid_: 变更集, changeset

**Commit**:
把暂存区内容固化为本地历史记录的操作。是本地操作，与网络无关。
_Avoid_: 提交

**Push**:
把本地提交上传到远端仓库的操作。是网络操作，与 Commit 语义不同。
_Avoid_: 推送

**Stash**:
把未提交变更临时保存起来、使工作区变干净的操作。`SilentStashBackup` 是它的自动变体，用于操作前备份，用户不可见。
_Avoid_: 贮藏

**Branch Graph**:
提交历史中展示分支分叉/合并拓扑的视图，在提交列表上以 DAG 连线标注分支与远程引用。是 SourceTree 的核心视图。
_Avoid_: 提交图, commit graph

**Sync Status**:
本地分支相对其 Upstream 的同步程度，由 `ahead`/`behind` 两个数值刻画。未设置上游时无意义。
_Avoid_: 领先/落后, ahead-behind

**Incoming Commits**:
Upstream 有而本地尚未拉取合并的提交，对应 `git log HEAD..@{upstream}`，展示在提交列表顶部。
_Avoid_: 待拉取, pending pull

**Remote**:
一个命名的远端仓库引用（如 origin），有独立的 fetch/push URL。是仓库的配置项，不是分支。
_Avoid_: 远端, 远端仓库
