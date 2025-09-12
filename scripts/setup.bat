@echo off
echo 🚀 设置 GitLite 开发环境...

REM 检查 Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js 未安装，请先安装 Node.js 18+
    pause
    exit /b 1
)

REM 检查 Rust
cargo --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Rust 未安装，请先安装 Rust
    pause
    exit /b 1
)

REM 检查 Git
git --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Git 未安装，请先安装 Git
    pause
    exit /b 1
)

echo ✅ 环境检查通过

REM 安装前端依赖
echo 📦 安装前端依赖...
npm install

REM 检查 Tauri CLI
tauri --version >nul 2>&1
if errorlevel 1 (
    echo 📦 安装 Tauri CLI...
    npm install -g @tauri-apps/cli
)

echo 🎉 设置完成！
echo.
echo 运行以下命令启动开发服务器：
echo   npm run tauri:dev
echo.
echo 运行以下命令构建应用：
echo   npm run tauri:build
pause
