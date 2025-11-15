# GitLite
 1
一个基于 Tauri 的轻量级 Git GUI 客户端，作为 SourceTree 的开源替代品。

## 特性

- 🚀 **轻量快速** - 基于 Tauri 构建，启动速度快，内存占用低
- 🎨 **现代 UI** - 使用 React + TailwindCSS + shadcn/ui 构建的美观界面
- 🔧 **跨平台** - 支持 Windows、macOS 和 Linux
- 📦 **单文件分发** - 打包为单个可执行文件，无需安装

## 技术栈

- **前端**: React 18 + TypeScript + TailwindCSS + shadcn/ui
- **后端**: Rust + Tauri + git2 (libgit2)
- **构建工具**: Vite + Tauri CLI
- **代码规范**: ESLint + Prettier + Clippy

## 当前功能

- ✅ 打开本地 Git 仓库
- ✅ 显示提交历史列表
- ✅ 切换分支
- ✅ 显示分支信息（ahead 提示）
- ✅ 工作区状态视图：已暂存/未暂存/未跟踪 分组显示
- ✅ 暂存区管理：暂存、取消暂存、批量暂存/取消暂存
- ✅ 提交与推送：编辑提交信息、一键提交与推送
- ✅ 贮藏管理：创建、列表、应用、删除（弹窗管理）
- ✅ 文件差异查看：统一视图/并排视图、语法高亮、字符级对比
- ✅ 大文件优化：虚拟滚动、缩略图滚动条与可视窗口指示
- ✅ 代理配置：读取 Git 全局代理，可配置 HTTP/HTTPS/SOCKS5，并支持测试与保存
- ✅ 自动刷新：工作区状态定时刷新与手动刷新
- ✅ 诊断工具：一键触发诊断日志（用于问题定位）

## 快速开始

### 环境要求

- Node.js 18+ 
- Rust 1.70+
- Git

### 安装依赖

```bash
# 安装前端依赖
npm install

# 安装 Tauri CLI (如果未安装)
npm install -g @tauri-apps/cli
```

### 开发模式

```bash
# 启动开发服务器
npm run tauri:dev
```

### 构建应用

```bash
# 构建生产版本
npm run tauri:build
```

构建完成后，可执行文件位于 `src-tauri/target/release/` 目录。

## 使用指南（核心模块）

### 工作区状态与暂存

- 在工作区视图中查看已暂存、未暂存、未跟踪文件
- 支持单个/批量 暂存与取消暂存
- 支持查看文件差异（支持未跟踪文件的预览）

### 提交与推送

- 在提交区域输入提交信息后即可提交
- 若当前分支领先远端，将在“推送”按钮显示数字徽标，可一键推送

### 贮藏管理（Stash）

- 在“贮藏”弹窗中创建、查看、应用、删除贮藏
- 应用贮藏时自动刷新状态；对重复应用、冲突等场景提供更友好的错误提示

### 文件差异查看

- 统一视图与并排视图切换
- 支持语法高亮与字符级对比，空白字符有弱提示样式
- 大文件采用虚拟滚动；右侧缩略图提供更改分布与可视窗口指示，可点击/拖拽快速定位

### 代理配置

- 自动读取 Git 全局代理（如 `git config --global http.proxy`）
- 可在应用内启用/关闭代理，选择协议（HTTP/HTTPS/SOCKS5）、设置主机与端口、可选用户名密码
- 保存后应用于 Git 网络操作（推送/拉取/获取等），不污染外部工具环境

### 自动刷新与诊断

- 工作区状态支持 10 秒倒计时自动刷新，可随时手动刷新
- 提供诊断按钮，帮助快速定位常见问题

## 项目结构

```
GitLite/
├── src/                    # React 前端源码
│   ├── components/         # UI 组件
│   │   ├── ui/            # 基础 UI 组件 (shadcn/ui)
│   │   ├── CommitList.tsx # 提交列表组件
│   │   ├── BranchList.tsx # 分支列表组件
│   │   ├── DiffViewer.tsx # 差异查看器
│   │   └── RepositorySelector.tsx # 仓库选择器
│   ├── hooks/             # React Hooks
│   │   └── useGit.ts      # Git 操作 Hook
│   ├── types/             # TypeScript 类型定义
│   │   └── git.ts         # Git 相关类型
│   ├── lib/               # 工具函数
│   │   └── utils.ts       # 通用工具函数
│   ├── App.tsx            # 主应用组件
│   └── main.tsx           # 应用入口
├── src-tauri/             # Rust 后端源码
│   ├── src/
│   │   └── main.rs        # 主程序入口和 Git 操作
│   ├── Cargo.toml         # Rust 依赖配置
│   ├── tauri.conf.json    # Tauri 配置
│   └── build.rs           # 构建脚本
├── package.json           # Node.js 依赖配置
├── tailwind.config.js     # TailwindCSS 配置
├── tsconfig.json          # TypeScript 配置
└── vite.config.ts         # Vite 配置
```

## 开发指南

### 添加新的 Git 操作

1. 在 `src-tauri/src/main.rs` 中添加新的 Tauri 命令函数
2. 在 `src/hooks/useGit.ts` 中添加对应的前端调用函数
3. 在 `src/types/git.ts` 中定义相关的 TypeScript 类型

### 添加新的 UI 组件

1. 在 `src/components/` 目录下创建新组件
2. 使用 shadcn/ui 的基础组件构建界面
3. 在 `src/App.tsx` 中集成新组件

## 路线图

### 短期目标 (v0.2.0)

- [ ] 分支图可视化
- [ ] 文件树视图
- [x] 暂存区管理 (git add/rm)
- [x] 提交创建界面
- [ ] 远程仓库操作 (pull/fetch)
- [x] 远程仓库操作 (push)

### 中期目标 (v0.3.0)

- [ ] 合并冲突处理界面
- [ ] 历史记录搜索和过滤
- [x] 文件差异高亮显示（基础语法高亮与字符级对比）
- [ ] 快捷键支持
- [ ] 主题切换 (深色/浅色)

### 长期目标 (v0.4.0+)

- [ ] GitHub/GitLab API 集成
- [ ] 插件系统
- [ ] 多仓库管理
- [x] 性能优化和大型仓库支持（虚拟滚动/缩略图指示）
- [ ] 国际化支持

## 故障排除

如果遇到构建问题，请查看 [故障排除指南](TROUBLESHOOTING.md)。

### 常见问题

1. **Windows 构建错误**: 确保安装了 Visual Studio Build Tools 和 Windows SDK
2. **npm install 卡住**: 使用国内镜像 `npm config set registry https://registry.npmmirror.com`
3. **图标错误**: 已自动移除图标配置，避免构建问题
4. **网络访问慢/失败**: 尝试在“代理配置”中启用并测试代理，或检查系统 Git 的全局代理配置

## 贡献

欢迎提交 Issue 和 Pull Request！

### 开发环境设置

1. Fork 本仓库
2. 克隆你的 Fork: `git clone <your-fork-url>`
3. 安装依赖: `npm install`
4. 启动开发服务器: `npm run tauri:dev`

### 代码规范

- 使用 ESLint 和 Prettier 格式化代码
- Rust 代码使用 Clippy 检查
- 提交信息遵循 Conventional Commits 规范

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 致谢

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [shadcn/ui](https://ui.shadcn.com/) - 美观的 UI 组件库
- [libgit2](https://libgit2.org/) - Git 核心库
- [SourceTree](https://www.sourcetreeapp.com/) - 灵感来源
