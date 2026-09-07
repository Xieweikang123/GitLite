# 破坏性操作前自动创建静默贮藏备份

在 checkout、merge、reset-hard、rebase、discard、pull 等可能覆盖或丢失工作区变更的操作执行前，GitLite 自动创建一个用户不可见的备份（`SilentStashBackup`）：用 `git diff --binary HEAD` 生成 tracked 文件的 patch，并复制 untracked 文件到独立目录，连同元数据写入 `silent_stashes_dir()`。操作完成后可经 `restore_silent_stash` 恢复。

选择"操作前自动备份"而非"操作前强制用户确认"或"依赖 Git 自身的 reflog"，是因为：破坏性操作一旦执行，工作区变更可能无法从 reflog 恢复（尤其 untracked 文件与 reset-hard），而强制确认会打断流畅的 GUI 工作流。备份是静默的，用户无感知，仅在需要时通过恢复入口可见。代价是每次破坏性操作多一次 diff 与磁盘写入，通过 `cleanup_old_silent_stashes` 限制备份数量来控制。
