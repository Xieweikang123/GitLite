#!/bin/bash

# GitLite 项目设置脚本

echo "🚀 设置 GitLite 开发环境..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js 18+"
    exit 1
fi

# 检查 Rust
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust 未安装，请先安装 Rust"
    exit 1
fi

# 检查 Git
if ! command -v git &> /dev/null; then
    echo "❌ Git 未安装，请先安装 Git"
    exit 1
fi

echo "✅ 环境检查通过"

# 安装前端依赖
echo "📦 安装前端依赖..."
npm install

# 检查 Tauri CLI
if ! command -v tauri &> /dev/null; then
    echo "📦 安装 Tauri CLI..."
    npm install -g @tauri-apps/cli
fi

echo "🎉 设置完成！"
echo ""
echo "运行以下命令启动开发服务器："
echo "  npm run tauri:dev"
echo ""
echo "运行以下命令构建应用："
echo "  npm run tauri:build"
