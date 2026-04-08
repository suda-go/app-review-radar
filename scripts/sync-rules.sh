#!/bin/bash
# 将数据查询规范同步到各 AI 工具的规则文件
# 用法: bash scripts/sync-rules.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE="$PROJECT_DIR/.kiro/steering/data-query.md"

if [ ! -f "$SOURCE" ]; then
  echo "❌ 找不到规则文件: $SOURCE"
  exit 1
fi

echo "📋 同步数据查询规范到各 AI 工具..."

# Kiro (已在 .kiro/steering/ 中，无需复制)
echo "✅ Kiro — 已在 .kiro/steering/data-query.md（自动生效）"

# Cursor
TARGET="$PROJECT_DIR/.cursorrules"
cp "$SOURCE" "$TARGET"
echo "✅ Cursor — 已写入 .cursorrules"

# Claude Code
TARGET="$PROJECT_DIR/CLAUDE.md"
cp "$SOURCE" "$TARGET"
echo "✅ Claude Code — 已写入 CLAUDE.md"

# Windsurf
TARGET="$PROJECT_DIR/.windsurfrules"
cp "$SOURCE" "$TARGET"
echo "✅ Windsurf — 已写入 .windsurfrules"

# GitHub Copilot
mkdir -p "$PROJECT_DIR/.github"
TARGET="$PROJECT_DIR/.github/copilot-instructions.md"
cp "$SOURCE" "$TARGET"
echo "✅ GitHub Copilot — 已写入 .github/copilot-instructions.md"

echo ""
echo "🎉 同步完成！所有工具的规则文件已更新。"
