# GitLite 调试指南

## Thumbnail scrollbar mapping (diff bars) – engineering notes

Context: The miniature diff bars in `CodeDiff.tsx` must align with code lines across the entire file and naturally snap to the visual bottom when the last line changes. A series of fixes converged to these rules that remove edge cases and avoid rounding drift.

Principles
- Single coordinate system: map bars in the thumbnail container coordinate system (`thumbnailHeight`), not the track (`thumbnailHeight - indicatorHeightPx`). The indicator height only affects the blue viewport box, not bar positions.
- Pure mapping by total file pixels: map by `totalContentPx = fileLines.length * itemHeight` instead of `scrollMax`. This ensures the last line (endRatio = 1) lands at the container bottom.
- Deterministic rounding: use floor for the top and ceil for the bottom so each bar fully covers its range with minimum loss.
- Invariants: height >= 2px; 0 <= top <= containerHeight - height; clamp inputs.

Formulas (container coordinates)
- startTopPx = startIdx * itemHeight
- blockHeightPx = max(itemHeight, (endIdx - startIdx + 1) * itemHeight)
- startRatio = clamp01(startTopPx / totalContentPx)
- endRatio = clamp01((startTopPx + blockHeightPx) / totalContentPx)
- topPx = floor(thumbnailHeight * startRatio)
- bottomPx = ceil(thumbnailHeight * endRatio)
- heightPx = max(2, bottomPx - topPx)
- Clamp: if topPx + heightPx > thumbnailHeight → topPx = thumbnailHeight - heightPx

Do NOT
- Do not map bars using `trackHeight` (that includes the viewport box subtraction) or `scrollMax` (viewport dependent). Both caused bottom misalignment when the last change is near EOF.
- Do not special-case the last bar when formulas above are used; it snaps to bottom naturally.

Debugging
- Metrics log: `[ThumbMetrics]` prints `fileLinesLen, itemHeight, viewportPx, containerHeight, thumbnailHeight, indicatorHeightPx, trackHeight, totalContentPx`.
- Bar log: `[ThumbBar]` prints `idx, type, startIdx, endIdx, startTopPx, blockHeightPx, startRatio, endRatio, topPx, bottomPx, heightPx` (first and last by default).
- If a regression appears, verify: containerHeight used for mapping; endRatio equals 1 for last-line blocks; rounding is floor/ceil as above.

## 🔍 问题诊断步骤

### 1. 环境检查
首先运行环境检查脚本：
```bash
check-env.bat
```

### 2. 常见错误及解决方案

#### 错误 1: RC.EXE failed to compile
**解决方案：**
- 已禁用 bundle 功能，避免图标编译问题
- 如果仍有问题，确保安装了 Visual Studio Build Tools

#### 错误 2: npm install 卡住
**解决方案：**
```bash
# 设置国内镜像
npm config set registry https://registry.npmmirror.com

# 清除缓存
npm cache clean --force

# 重新安装
npm install
```

#### 错误 3: Rust 编译错误
**解决方案：**
```bash
# 更新 Rust
rustup update

# 检查工具链
rustup show

# 重新安装 Rust（如果需要）
rustup self uninstall
# 然后重新安装：https://rustup.rs/
```

#### 错误 4: Tauri 启动失败
**解决方案：**
```bash
# 重新安装 Tauri CLI
npm uninstall -g @tauri-apps/cli
npm install -g @tauri-apps/cli

# 或者使用 npx
npx @tauri-apps/cli dev
```

### 3. 分步启动

如果直接启动失败，尝试分步启动：

#### 步骤 1: 只启动前端
```bash
npm run dev
```
应该看到 Vite 开发服务器启动在 http://localhost:1420

#### 步骤 2: 启动 Tauri
```bash
npm run tauri:dev
```

### 4. 日志调试

启用详细日志：
```bash
# Windows
set RUST_BACKTRACE=1
set RUST_LOG=debug
npm run tauri:dev

# 或者
$env:RUST_BACKTRACE=1
$env:RUST_LOG=debug
npm run tauri:dev
```

### 5. 清理重建

如果问题持续，尝试清理重建：
```bash
# 清理 node_modules
rmdir /s node_modules
del package-lock.json

# 清理 Rust 缓存
cargo clean

# 重新安装
npm install
```

### 6. 最小化测试

创建一个最小化测试：
```bash
# 创建新的 Tauri 项目测试
npx create-tauri-app@latest test-app
cd test-app
npm run tauri:dev
```

如果这个能成功，说明环境没问题，可能是项目配置问题。

## 📋 检查清单

- [ ] Node.js 18+ 已安装
- [ ] Rust 已安装
- [ ] Git 已安装
- [ ] npm 镜像已设置
- [ ] 依赖已安装
- [ ] 端口 1420 未被占用
- [ ] 防火墙未阻止应用

## 🆘 获取帮助

如果以上方法都无效：

1. 复制完整的错误信息
2. 运行 `check-env.bat` 并截图结果
3. 提供操作系统版本信息
4. 在 GitHub 上创建 Issue

## 🔧 临时解决方案

如果 Tauri 启动有问题，可以先使用纯前端版本：

```bash
# 只启动前端开发服务器
npm run dev
```

然后在浏览器中访问 http://localhost:1420 查看界面（但 Git 功能不可用）。

## Branch switch flicker (repo metadata refresh storm) — engineering notes

Context: Switching branches made the UI visibly flash several times. The switch itself
was fast (~130ms, `checkout_branch: success` logged once); the flicker came entirely from
repo metadata being re-read and re-rendered multiple times per switch. Traced from
`%APPDATA%\GitLite\logs\gitlite.log` by counting `open_repository` / `hydrate check` /
`setRepoInfo` occurrences inside one switch window.

### Root cause

`RepoInfo` is a god object mixing three change frequencies: identity (`path`), light state
(`current_branch`, `head_short_id`, `ahead`, `behind`), and heavy data (`commits[]`,
`incoming_commits[]`, `branches[]`). Every refresh returns a **new object**, so one
`setRepoInfo` invalidates the whole subtree even when nothing changed. On top of that, the
same "something changed" signal was consumed by several independent paths, each of which
re-ran the heavy `open_repository` (which recomputes the full commit history via
`get_commit_history`).

### Principles

- **Metadata is driven by operation results, not by filesystem events.** `checkout` /
  `pull` / `push` / `commit` each know what they changed and have a return value. The
  `workspace-changed` event only says "files changed" — it cannot say *what* changed.
  Editor saves, build artifacts, and unrelated git operations all fire it.
- **The file watcher refreshes the workspace only.** `WorkspaceStatus` owns
  `get_workspace_status` + `get_stash_list` on that event. Nothing else.
- **Never write an equivalent `RepoInfo`.** Compare key fields before `setRepoInfo` and
  keep the old reference when equivalent, so React skips the update.
- **Effect deps must be the narrowest stable value.** Use `repoInfo?.path` (string), never
  the `repoInfo` object, or every refresh tears down and rebuilds timers/listeners and
  re-runs non-silent fetches.

### Leaks found (all consumed the same signal)

| # | Leak | Effect per switch |
|---|---|---|
| 1 | `WorkspaceStatus` `workspace-changed` → `onRefresh()` → **heavy** `open_repository` with `recordRecent=true` (+`loadRecentRepos`) | ~6x |
| 2 | `useGit` `workspace-changed` → `refreshRepoInfo()` | ~6x |
| 3 | `checkoutBranch` called `invokeOpenRepository` directly, bypassing coalescing | 1x |
| 4 | `useEffect([repoInfo, ...])` in `WorkspaceStatus` → rebuilt 10s timer + immediate non-silent `runPull(false)` | every write |
| 5 | Untagged `origin=unknown` callers (stack trace added to locate) | 1x |

Result: `setRepoInfo` writes per switch went **4 → 1**.

### Do NOT

- Do not call `onRefresh` / `openRepositoryByPath` from a filesystem-event handler. It is
  the `recordRecent=true` path: it recomputes commit history and rewrites the recent-repos
  list. A `git switch` rewrites hundreds of files, so this is amplified into many full
  repo re-reads.
- Do not list the whole `repoInfo` object in a `useEffect` dependency array.
- Do not assume "the refresh was skipped" means "nothing happened" — a `skip hydrate`
  line still means a full-tree re-render already occurred. Optimizing IPC count is not the
  same as optimizing render count; **the user sees renders, not IPC calls**.
- Do not use `Set-Content`/`>` with a PowerShell generic collection to rewrite source
  files. Under the sandbox's ConstrainedLanguage mode the collection silently fails and
  **truncates the file**. Use the editor tools, and recover with
  `git checkout -- <path>`.

### Debugging

- Trace lives in `useGit.ts`: `diag()` writes `[DIAG][repoinfo]` lines via
  `append_gitlite_log`. Every `open_repository` logs `origin=` (caller tag), duration, and
  the returned branch/HEAD/commit count; every write logs
  `setRepoInfo ← origin=` or `setRepoInfo SKIPPED equivalent`.
- Set `DIAG_ENABLED = false` in `useGit.ts` to silence it, or delete the `diag` block and
  call sites once the storm is gone.
- `origin=unknown` prints a stack (` stack=...`) to identify callers that bypass the
  tagged wrapper.
- Healthy signature for one switch: exactly one
  `open_repository → origin=refreshRepoInfo/force`, one `setRepoInfo`, one `do hydrate`,
  and zero `[recent] open_repository 记录到最近列表` lines. Any `[recent]` line means a
  heavy `recordRecent=true` path is still being hit.
- Render-side counters already exist in `App.tsx` as `[DIAG][pull][App] hydrate check` /
  `do hydrate` / `skip hydrate`.

## Duplicate "N 待拉取" badges (one number rendered twice) — engineering notes

Context: the workspace page showed `4 待拉取` twice at the same time — once in the top
toolbar, once in the sync bar above the commit card.

Root cause: two independent components each render `repoInfo.behind`:

| Renderer | Source | Style |
| --- | --- | --- |
| `TopToolbar` | `repoInfo.behind > 0` | amber text badge, popover trigger only |
| `WorkspaceStatus` → `RemoteSyncBar` | `behindN > 0` | amber icon + text, next to the 「拉取 (N)」 button |

Both read the same field of the same object, so they can never disagree — always same
value, same visibility. Not two perspectives on one fact: one fact drawn twice.
Introduced by `314f247`, which added the toolbar badge without removing the sync-bar
status that already existed.

Principle: **a piece of state should have exactly one canonical display per screen.**
When two widgets show a derived number, either delete one or make the second a strictly
different affordance (action vs. read-only). "Same number, two places" is always a bug,
never redundancy-by-design.

Resolution: kept `RemoteSyncBar`, because its status sits beside the 「拉取 (N)」 button
(actionable) while the toolbar badge was read-only — the toolbar has no pull button, so
acting on it meant navigating back to the workspace. The status is lost on the
commits/files/stats tabs, which was accepted (the toolbar is hidden there anyway when
`activeTab === 'multi'`, and per-tab sync context lives in `UnifiedCommitView`).

Do NOT:
- Do not dedupe by hiding one with CSS (`hidden`, responsive breakpoints). The condition
  `behind > 0` must not be evaluated in two places at all.
- Do not "unify" the two by extracting a shared badge component while leaving both call
  sites — that preserves the duplicate, it only shares the markup.
- Grep by the user-visible string (`待拉取`), not by prop name: the two sites use
  different variables (`repoInfo.behind` vs. `behindN`), so a prop-based grep misses one.
  Also check `RemoteSyncBar` itself — it is mounted from three places
  (`WorkspaceStatus`, `UnifiedCommitView`, plus its own compact branches), so the
  duplicate may be *within* one component across densities.

## Unreadable icon-only sync buttons — engineering notes

Context: the commit view's `compact` `RemoteSyncBar` rendered a row of unlabelled icons
(`⚠ 4`, `⬇`, a branch glyph, `⬆`, `↻`) that users could not tell apart.

Root cause was **not** merely "icons are small". Three distinct defects:

1. **Wrong icon semantics.** `GitPullRequest` is GitHub's *Pull Request* glyph (two arrows
   merging into a bar) — it means "open a merge request", not "download commits". Pull
   and fetch *both* rendered downward arrows (`GitPullRequest` + `Download`), so shape
   could not disambiguate them. Icon choice must encode the *verb*, not the domain.
2. **State encoded as enablement.** Pull/push had two branches — `behind > 0` rendered a
   filled `default` button, `behind === 0` a faded `ghost` one — but *the action was
   identical*. A faded button reads as disabled/unavailable, so users believed there was
   nothing to do when pull was in fact still valid. Vary the *emphasis*, never the
   *apparent availability*, when the action is unchanged.
3. **Icon-only in a dense row.** Five glyphs in `gap-0.5` rely entirely on hover tooltips.
   Touch devices have no hover, so the affordances were effectively unlabelled.

Principles:
- One glyph per verb, and the glyph must differ *in shape* from every neighbouring verb.
  `ArrowDownToLine` (pull: into working tree) vs `DownloadCloud` (fetch: into local cache)
  vs `ArrowUpFromLine` (push) vs `RotateCw` (refresh) are distinguishable at 14px.
- Fold the count into the button that acts on it. A count floating beside its own action
  button is a second place to look for one fact.
- Tooltips follow a fixed shape: `动名词：说明（是否联网 / 是否改动工作区）`. This is what
  makes fetch-vs-refresh learnable — they are the same to a user who does not care about
  remote-tracking refs, so the tooltip must say "不联网" vs "联网".

Do NOT:
- Do not collapse `behind > 0` / `behind === 0` by hiding a button with CSS; merge the two
  JSX branches and vary only `variant`, so the affordance count is stable.
- Do not put a count badge in a `default` (solid) button using a background token meant for
  a light surface (`bg-background/25`) — on the solid fill it disappears. Use
  `bg-primary-foreground/20`, which inverts with the variant.
- Do not rely on tooltips for primary actions in a compact toolbar; add a text label
  (`compact` mode now renders 获取 / 拉取 / 推送 / 刷新 next to the icons).

## Destructive checkout rollback (failed switch wiped uncommitted work) — engineering notes

Context: switching branches felt unreliable — sometimes "切个分支把我改的东西弄没了".
The switch itself was fine; the damage happened on the **failure** path.

Root cause: `checkout_branch` always created a silent stash backup, then ran
`git switch`, and on **any** failure called `rollback_workdir_to_head`, which runs
`git restore --source=HEAD --staged --worktree -- .`. That restores the entire
index + worktree to HEAD, so a failed switch that was caused by "your local changes
would be overwritten" ended by **destroying exactly those local changes**. The error
text (`format_checkout_failure` → "有未提交的修改，无法切换分支") never mentioned the
backup, so users saw data vanish with no explanation. Confirmed by the project's own
test `rollback_workdir_to_head_restores_deleted_tracked_files`, which asserts
`unstaged_files.is_empty()` after rollback, and by a real log line:
`checkout_branch: failed | ... err=有未提交的修改，无法切换分支`.

Principle: **rollback must never be broader than the damage it repairs.** A rollback
is only safe when the pre-operation state is known to be clean (nothing for it to
destroy). When the workspace is dirty, preserving it is always correct even if that
leaves a half-finished checkout — the silent stash already holds a recoverable copy.

Resolution:
- Snapshot `workspace_was_clean` (all four buckets empty) **before** `git switch`.
- Failure + clean → rollback (safe cleanup of any half-checkout residue).
- Failure + dirty → **skip rollback**, keep the worktree as-is, log
  `skip rollback (dirty workspace preserved)`, and append to the error:
  "（你的未提交改动已保留，并已生成静默备份；可在「可靠性面板 → 恢复静默贮藏」找回）".
- Regression test: `checkout_failure_preserves_dirty_workspace`.

Do NOT:
- Do not "just remove the rollback". A half-finished `git switch` can leave tracked
  files deleted/modified in the worktree (see `checkout-rollback` test); a clean
  workspace still needs the restore to recover.
- Do not detect dirty from the silent-stash return value alone —
  `create_silent_stash_backup` returns `None` when clean, which is a valid clean signal,
  but the explicit workspace snapshot keeps the intent readable and decoupled.
- Do not report a failure without telling the user their work is backed up and where
  to find it; the silent stash is worthless if the error text doesn't point at it.

## Pre-flight branch-switch eligibility (check_checkout_preflight) — engineering notes

Context: GitLite used to be entirely *optimistic* about branch switching: the UI let you
click any branch, and only after `git switch` refused did
`format_checkout_failure` turn the stderr into "有未提交的修改，无法切换分支". The
frustration was that nothing told you *in advance* which branches were reachable.

Root cause: there was no read-only predicate. `checkout_branch` computed
`workspace_was_clean`, but that flag only decides whether a *failed* switch may be rolled
back — it is far too blunt to gate the UI: a dirty workspace does **not** imply a switch
is impossible.

Principle: mirror Git's actual rule, which is path-level, not workspace-level. A switch
is refused only when a locally-modified tracked path (or an untracked path) also differs
between `HEAD` and the target branch's tree ("local changes would be overwritten").

Resolution:
- `check_checkout_preflight(repo_path, branch_names)` — batch, **read-only**; returns
  `[{ branch, can_switch, branch_exists, blocking_files, reason }]`.
- `blocking = (staged ∪ unstaged ∪ conflicted ∪ untracked) ∩ diff(HEAD, target_tree)`;
  empty ⇒ switchable. `branch_diff_cache` dedupes tree diffs across branches, and a
  fully-clean workspace short-circuits before computing any diff.
- Branch resolution is pure (`find_branch`, no `checkout_target_branch_name`) so a remote
  branch listed in the UI never gets a local branch created just by opening the popover.
- Frontend (`BranchSwitcher`) fetches the preflight when the panel opens / the branch
  list changes, marks blocked rows with a 「有改动」 badge + disabled cursor, and on click
  shows the reason instead of firing a doomed checkout. The preflight is advisory: the
  click still falls through to `checkout_branch` when no verdict is known.

Do NOT:
- Do not gate on `workspace_was_clean`. Reusing it here would forbid switching away from
  a branch whose dirty files are identical on the target — a legal, everyday operation.
- Do not make the preflight create refs/objects. It is queried on hover/popover-open; a
  mutating resolver (`checkout_target_branch_name`) would litter local branches.
- Do not block the click when the preflight is unknown (query failed / not yet returned).
  The preflight is a hint; `checkout_branch` remains the authority, and a stale verdict
  must not strand the user.

