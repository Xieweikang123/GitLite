# GitLite 项目结构说明

## 📁 目录结构

```
GitLite/
├── 📁 src/                          # React 前端源码
│   ├── 📁 components/               # UI 组件
│   │   ├── 📁 ui/                  # 基础 UI 组件 (shadcn/ui)
│   │   │   ├── 📄 button.tsx       # 按钮组件
│   │   │   ├── 📄 card.tsx         # 卡片组件
│   │   │   └── 📄 badge.tsx        # 徽章组件
│   │   ├── 📄 CommitList.tsx       # 提交列表组件
│   │   ├── 📄 BranchList.tsx       # 分支列表组件
│   │   ├── 📄 DiffViewer.tsx       # 差异查看器组件
│   │   └── 📄 RepositorySelector.tsx # 仓库选择器组件
│   ├── 📁 hooks/                   # React Hooks
│   │   └── 📄 useGit.ts           # Git 操作 Hook
│   ├── 📁 types/                   # TypeScript 类型定义
│   │   └── 📄 git.ts              # Git 相关类型
│   ├── 📁 lib/                     # 工具函数
│   │   └── 📄 utils.ts            # 通用工具函数
│   ├── 📄 App.tsx                 # 主应用组件
│   ├── 📄 main.tsx                # 应用入口
│   └── 📄 index.css               # 全局样式
├── 📁 src-tauri/                   # Rust 后端源码
│   ├── 📁 src/
│   │   └── 📄 main.rs             # 主程序入口和 Git 操作
│   ├── 📁 icons/                  # 应用图标
│   │   └── 📄 icon.ico            # Windows 图标
│   ├── 📄 Cargo.toml              # Rust 依赖配置
│   ├── 📄 tauri.conf.json         # Tauri 配置
│   └── 📄 build.rs                # 构建脚本
├── 📁 scripts/                     # 脚本文件
│   ├── 📄 setup.sh                # Linux/macOS 设置脚本
│   └── 📄 setup.bat               # Windows 设置脚本
├── 📄 package.json                 # Node.js 依赖配置
├── 📄 tailwind.config.js           # TailwindCSS 配置
├── 📄 tsconfig.json                # TypeScript 配置
├── 📄 vite.config.ts               # Vite 配置
├── 📄 .eslintrc.cjs                # ESLint 配置
├── 📄 .prettierrc                  # Prettier 配置
├── 📄 .gitignore                   # Git 忽略文件
├── 📄 README.md                    # 项目说明
├── 📄 PACKAGING.md                 # 生产打包流程
├── 📄 ROADMAP.md                   # 开发路线图
└── 📄 PROJECT_STRUCTURE.md         # 项目结构说明 (本文件)
```

## 🏗️ 架构设计

### 前端架构 (React + TypeScript)

```
┌─────────────────────────────────────┐
│              App.tsx                │
│         (主应用组件)                  │
└─────────────────┬───────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐    ┌────▼────┐    ┌───▼───┐
│Repository│  │CommitList│  │DiffViewer│
│Selector │  │          │  │         │
└─────────┘  └──────────┘  └─────────┘
    │             │             │
    └─────────────┼─────────────┘
                  │
            ┌─────▼─────┐
            │ useGit.ts │
            │ (Git Hook)│
            └─────┬─────┘
                  │
            ┌─────▼─────┐
            │ Tauri API │
            │ (前后端通信)│
            └───────────┘
```

### 后端架构 (Rust + Tauri)

```
┌─────────────────────────────────────┐
│            main.rs                  │
│         (Tauri 应用入口)              │
└─────────────────┬───────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐    ┌────▼────┐    ┌───▼───┐
│open_  │    │checkout_│    │get_   │
│repository│  │branch   │  │file_diff│
└─────────┘  └──────────┘  └─────────┘
    │             │             │
    └─────────────┼─────────────┘
                  │
            ┌─────▼─────┐
            │   git2    │
            │ (libgit2) │
            └───────────┘
```

## 🔄 数据流

### 1. 打开仓库流程
```
用户点击"选择仓库" 
    ↓
RepositorySelector 调用 useGit.openRepository()
    ↓
useGit Hook 调用 Tauri API
    ↓
Rust 后端 open_repository() 函数
    ↓
使用 git2 库打开仓库
    ↓
返回 RepoInfo 数据
    ↓
前端更新 UI 显示仓库信息
```

### 2. 查看提交差异流程
```
用户点击提交项
    ↓
CommitList 调用 onCommitSelect()
    ↓
App 组件更新 selectedCommit 状态
    ↓
DiffViewer 检测到 commit 变化
    ↓
调用 useGit.getFileDiff()
    ↓
Rust 后端 get_file_diff() 函数
    ↓
使用 git2 生成差异
    ↓
返回差异文本
    ↓
DiffViewer 显示差异内容
```

## 🎨 UI 组件层次

```
App (主应用)
├── RepositorySelector (仓库选择器)
├── BranchList (分支列表)
├── CommitList (提交列表)
│   └── Card (卡片容器)
│       ├── CardHeader
│       ├── CardContent
│       └── Badge (提交 ID)
└── DiffViewer (差异查看器)
    └── Card (卡片容器)
        ├── CardHeader
        └── CardContent
            └── pre (代码显示)
```

## 🔧 技术栈说明

### 前端技术栈
- **React 18**: 用户界面框架
- **TypeScript**: 类型安全的 JavaScript
- **TailwindCSS**: 实用优先的 CSS 框架
- **shadcn/ui**: 基于 Radix UI 的组件库
- **Vite**: 快速的构建工具
- **Lucide React**: 图标库

### 后端技术栈
- **Rust**: 系统编程语言
- **Tauri**: 跨平台桌面应用框架
- **git2**: Rust 的 Git 库 (基于 libgit2)
- **serde**: 序列化/反序列化库
- **anyhow**: 错误处理库
- **chrono**: 日期时间处理库

### 开发工具
- **ESLint**: JavaScript/TypeScript 代码检查
- **Prettier**: 代码格式化
- **Clippy**: Rust 代码检查
- **Git**: 版本控制

## 🚀 构建和部署

### 开发环境
```bash
npm run tauri:dev    # 启动开发服务器
```

### 生产构建
```bash
npm run tauri:build  # 构建生产版本
```

### 输出文件
- Windows: `src-tauri/target/release/gitlite.exe`
- macOS: `src-tauri/target/release/bundle/osx/GitLite.app`
- Linux: `src-tauri/target/release/gitlite`

## 📝 开发规范

### 代码组织
- 组件按功能分组
- 类型定义集中管理
- 工具函数统一存放
- 样式使用 TailwindCSS 类名

### 命名规范
- 组件使用 PascalCase
- 函数和变量使用 camelCase
- 常量使用 UPPER_SNAKE_CASE
- 文件使用 kebab-case

### Git 提交规范
- feat: 新功能
- fix: 修复问题
- docs: 文档更新
- style: 代码格式调整
- refactor: 代码重构
- test: 测试相关
- chore: 构建过程或辅助工具的变动
