# GitLite 打包流程

当前产物是 **单个可执行文件**，不生成 MSI/NSIS 安装包。版本号以 `src-tauri/tauri.conf.json` 的 `package.version` 为准（与 `package.json`、`src-tauri/Cargo.toml` 保持一致，现为 `0.1.0`）。

## 产物

| 项 | 说明 |
| --- | --- |
| 命令 | `npm run tauri:build` |
| 输出 | `src-tauri/target/release/GitLite.exe` |
| 安装包 | 无。`tauri.conf.json` 里 `tauri.bundle.active` 为 `false`，避免 Windows 资源编译（RC.EXE）和图标问题 |
| 调试符号 | 同目录 `gitlite.pdb`，分发时可忽略 |

## 环境要求

- Node.js 18+
- Rust stable（MSVC 工具链：`x86_64-pc-windows-msvc`）
- Visual Studio Build Tools：C++ 生成工具 + Windows 10/11 SDK
- Git
- 已执行过 `npm install`

构建前建议确认：

```powershell
node --version
npm --version
git --version
# 若 cargo/rustc 报「无法执行」，见下文「rustup 代理符号链接」
cargo --version
rustc --version
```

国内网络可使用：

```powershell
npm config set registry https://registry.npmmirror.com
# Rust 镜像（若已配置则不必改）
# RUSTUP_DIST_SERVER / RUSTUP_UPDATE_ROOT
```

## 步骤

1. 在仓库根目录安装前端依赖（首次或依赖变更后）：`npm install`
2. 打生产包：`npm run tauri:build`
3. 等待前端 Vite 构建与 Rust release 编译结束（增量大约数分钟，全量更久）
4. 复制 `src-tauri/target/release/GitLite.exe` 分发

脚本对应关系：

```
npm run tauri:build
  └─ tauri build
       ├─ beforeBuildCommand → npm run build → tsc && vite build  （输出 dist/）
       └─ cargo build --release                                    （嵌入 dist/，输出 GitLite.exe）
```

详细日志：

```powershell
npm run tauri:build -- --verbose
```

## Windows：rustup 代理符号链接

rustup **1.28+** 在开启「开发人员模式」的 Windows 上，会把 `~/.cargo/bin` 下的 `cargo.exe`、`rustc.exe` 做成指向 `rustup.exe` 的 **文件符号链接**。PowerShell / cmd 启动这类 `.exe` 时常见：

- 没有应用程序与此操作的指定文件关联
- 系统无法执行指定的程序

真正的编译器仍在：

`%USERPROFILE%\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin\`

**当次构建**（不改 rustup 安装）把真实 toolchain 放到 `PATH` 最前：

```powershell
$env:Path = "$env:USERPROFILE\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin;$env:USERPROFILE\.cargo\bin;$env:Path"
rustc --version
cargo --version
npm run tauri:build
```

**长期修复**（改回硬链接/拷贝代理）：

```powershell
$env:RUSTUP_HARDLINK_PROXIES = "1"
# 删除 ~/.cargo/bin 里指向 rustup.exe 的 0 字节符号链接后再执行：
rustup default stable
```

可用 `cmd /c "dir /al %USERPROFILE%\.cargo\bin"` 确认：若仍是 `<SYMLINK> ... [rustup.exe]`，代理未修好。

## 配置说明

- `src-tauri/tauri.conf.json`：`beforeBuildCommand`、`distDir`、`package.version`、`bundle.active`
- `src-tauri/Cargo.toml`：Rust crate 版本与依赖
- `package.json`：`tauri:build` 脚本与前端版本字段

改版本时三处一起改，再重新 `npm run tauri:build`。

## 不要做的事

- 不要把 `src-tauri/target/` 提交进 Git
- 不要在未安装 Windows SDK / Build Tools 时打开 `bundle.active`
- 不要只更新 `package.json` 版本却不改 `tauri.conf.json`

## 相关文档

- 环境与 RC.EXE 等问题：[TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- 开发启动：[README.md](README.md)
