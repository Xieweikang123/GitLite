@echo off
echo 🔍 GitLite 环境检查
echo.

echo 检查 Node.js...
node --version
if errorlevel 1 (
    echo ❌ Node.js 未安装或版本过低
    echo 请安装 Node.js 18+ 版本
) else (
    echo ✅ Node.js 已安装
)

echo.
echo 检查 npm...
npm --version
if errorlevel 1 (
    echo ❌ npm 未安装
) else (
    echo ✅ npm 已安装
)

echo.
echo 检查 Rust...
cargo --version
if errorlevel 1 (
    echo ❌ Rust 未安装
    echo 请访问 https://rustup.rs/ 安装 Rust
) else (
    echo ✅ Rust 已安装
)

echo.
echo 检查 Git...
git --version
if errorlevel 1 (
    echo ❌ Git 未安装
    echo 请安装 Git
) else (
    echo ✅ Git 已安装
)

echo.
echo 检查 Tauri CLI...
tauri --version
if errorlevel 1 (
    echo ⚠️  Tauri CLI 未安装，将自动安装
    npm install -g @tauri-apps/cli
) else (
    echo ✅ Tauri CLI 已安装
)

echo.
echo 环境检查完成！
echo 如果所有项目都显示 ✅，可以运行 start-dev.bat 启动项目
echo.
pause
