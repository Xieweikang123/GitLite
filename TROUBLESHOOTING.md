# GitLite 故障排除指南

## 🚨 常见问题及解决方案

### 1. Windows 构建错误：RC.EXE failed to compile specified resource file

**错误信息：**
```
thread 'main' panicked at C:\Users\57031\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\embed-resource-2.5.2\src\windows_msvc.rs:39:13:
RC.EXE failed to compile specified resource file
```

**原因：**
- 缺少 Windows 资源编译器 (RC.EXE)
- 图标文件不存在或格式不正确

**解决方案：**

#### 方案 1：移除图标配置（推荐）
已自动修复 - 在 `src-tauri/tauri.conf.json` 中移除了图标配置。

#### 方案 2：安装 Windows SDK
```bash
# 安装 Visual Studio Build Tools
# 下载地址：https://visualstudio.microsoft.com/visual-cpp-build-tools/
# 确保安装 "C++ build tools" 和 "Windows 10/11 SDK"
```

#### 方案 3：创建简单图标
```bash
# 创建一个简单的 32x32 PNG 图标
# 然后转换为 ICO 格式
# 在线转换工具：https://convertio.co/png-ico/
```

### 2. npm install 卡住

**解决方案：**
```bash
# 使用国内镜像
npm config set registry https://registry.npmmirror.com

# 或者使用 cnpm
npm install -g cnpm --registry=https://registry.npmmirror.com
cnpm install
```

### 3. cargo / rustc：没有应用程序关联，或系统无法执行指定的程序

**原因：** rustup 1.28+ 在 Windows 上把 `~/.cargo/bin` 的 `cargo.exe`、`rustc.exe` 做成指向 `rustup.exe` 的符号链接，PowerShell/cmd 无法按普通 exe 启动。

**当次绕过：** 将真实 toolchain 放到 PATH 最前后再打包，详见 [PACKAGING.md](PACKAGING.md)。

```powershell
$env:Path = "$env:USERPROFILE\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin;$env:USERPROFILE\.cargo\bin;$env:Path"
cargo --version
```

**长期：** 设置 `RUSTUP_HARDLINK_PROXIES=1`，删掉上述符号链接后执行 `rustup default stable`。

### 4. Rust 编译错误

**解决方案：**
```bash
# 更新 Rust
rustup update

# 检查工具链
rustup show

# 安装 Windows 目标
rustup target add x86_64-pc-windows-msvc
```

### 5. Tauri CLI 未找到

**解决方案：**
```bash
# 全局安装 Tauri CLI
npm install -g @tauri-apps/cli

# 或者使用 npx
npx @tauri-apps/cli dev
```

### 6. Git 操作权限错误

**解决方案：**
```bash
# 确保 Git 已正确安装
git --version

# 配置 Git 用户信息
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

## 🛠️ 开发环境设置

### Windows 环境
1. 安装 Node.js 18+
2. 安装 Rust
3. 安装 Visual Studio Build Tools（包含 Windows SDK）
4. 安装 Git

### 快速验证
```bash
# 检查环境
node --version
npm --version
cargo --version
rustc --version
git --version
```

## 🚀 启动项目

### 开发模式
```bash
npm run tauri:dev
```

### 构建应用
完整流程见 [PACKAGING.md](PACKAGING.md)。

```bash
npm run tauri:build
```

## 📝 日志调试

### 启用详细日志
```bash
# Windows
set RUST_BACKTRACE=1
npm run tauri:dev

# Linux/macOS
RUST_BACKTRACE=1 npm run tauri:dev
```

### 查看构建日志
```bash
# 查看详细构建信息
npm run tauri:build -- --verbose
```

## 🔧 配置文件说明

### tauri.conf.json
- 应用配置
- 权限设置
- 构建选项

### Cargo.toml
- Rust 依赖
- 构建配置

### package.json
- Node.js 依赖
- 脚本命令

## 📞 获取帮助

如果遇到其他问题：

1. 查看 [Tauri 官方文档](https://tauri.app/)
2. 检查 [GitHub Issues](https://github.com/tauri-apps/tauri/issues)
3. 查看项目 README.md
4. 提交新的 Issue

## ✅ 验证安装

运行以下命令验证环境：
```bash
# 检查所有依赖
npm run tauri:dev
```

如果成功启动，你应该看到：
- 浏览器窗口打开 (开发模式)
- 或者桌面应用启动
- 控制台显示 "GitLite" 界面
