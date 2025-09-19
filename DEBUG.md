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
