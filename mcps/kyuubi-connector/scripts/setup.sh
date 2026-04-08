#!/bin/bash
# @mi/kyuubi-mcp 一键安装脚本
# 用法: curl -s <script-url> | bash
# 或者: bash setup.sh <your-workspace-token>

set -e

REGISTRY="https://pkgs.d.xiaomi.net/artifactory/api/npm/mi-npm/"
CONFIG_DIR="$HOME/.kyuubi-mcp"
CONFIG_FILE="$CONFIG_DIR/config.json"

echo "🚀 安装 @mi/kyuubi-mcp ..."

# 1. 全局安装
npm install -g @mi/kyuubi-mcp --registry "$REGISTRY" 2>/dev/null || {
  echo "❌ npm install 失败，请确认 Node.js 已安装且内网可访问"
  exit 1
}
echo "✅ 安装成功"

# 2. 创建配置文件
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_FILE" ]; then
  TOKEN="${1:-your-workspace-token}"
  cat > "$CONFIG_FILE" << EOF
{
  "tokens": [
    "$TOKEN"
  ]
}
EOF
  if [ "$TOKEN" = "your-workspace-token" ]; then
    echo "⚠️  请编辑 $CONFIG_FILE 填入你的 workspace token"
  else
    echo "✅ 配置文件已创建: $CONFIG_FILE"
  fi
else
  echo "✅ 配置文件已存在: $CONFIG_FILE"
fi

# 3. 自动配置各 AI 工具的 MCP
MCP_CONFIG='{
  "kyuubi": {
    "command": "kyuubi-mcp",
    "disabled": false
  }
}'

# Kiro
KIRO_DIR="$HOME/.kiro/settings"
KIRO_FILE="$KIRO_DIR/mcp.json"
mkdir -p "$KIRO_DIR"
if [ -f "$KIRO_FILE" ]; then
  # 检查是否已配置
  if grep -q "kyuubi" "$KIRO_FILE" 2>/dev/null; then
    echo "✅ Kiro MCP 已配置"
  else
    # 用 node 合并 JSON
    node -e "
      const fs = require('fs');
      const existing = JSON.parse(fs.readFileSync('$KIRO_FILE', 'utf-8'));
      existing.mcpServers = existing.mcpServers || {};
      existing.mcpServers.kyuubi = { command: 'kyuubi-mcp', disabled: false };
      fs.writeFileSync('$KIRO_FILE', JSON.stringify(existing, null, 2));
    " 2>/dev/null && echo "✅ Kiro MCP 已添加" || echo "⚠️  Kiro 配置合并失败，请手动添加"
  fi
else
  echo '{"mcpServers":{"kyuubi":{"command":"kyuubi-mcp","disabled":false}}}' | node -e "
    const fs = require('fs');
    let d = '';
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => fs.writeFileSync('$KIRO_FILE', JSON.stringify(JSON.parse(d), null, 2)));
  " && echo "✅ Kiro MCP 配置已创建"
fi

# Claude Code
if command -v claude &>/dev/null; then
  claude mcp add kyuubi -- kyuubi-mcp 2>/dev/null && echo "✅ Claude Code MCP 已添加" || echo "⚠️  Claude Code 配置失败"
fi

# Claude Desktop
CLAUDE_DIR="$HOME/Library/Application Support/Claude"
CLAUDE_FILE="$CLAUDE_DIR/claude_desktop_config.json"
if [ -d "$CLAUDE_DIR" ]; then
  if [ -f "$CLAUDE_FILE" ] && grep -q "kyuubi" "$CLAUDE_FILE" 2>/dev/null; then
    echo "✅ Claude Desktop MCP 已配置"
  else
    mkdir -p "$CLAUDE_DIR"
    if [ -f "$CLAUDE_FILE" ]; then
      node -e "
        const fs = require('fs');
        const existing = JSON.parse(fs.readFileSync('$CLAUDE_FILE', 'utf-8'));
        existing.mcpServers = existing.mcpServers || {};
        existing.mcpServers.kyuubi = { command: 'kyuubi-mcp' };
        fs.writeFileSync('$CLAUDE_FILE', JSON.stringify(existing, null, 2));
      " 2>/dev/null && echo "✅ Claude Desktop MCP 已添加" || echo "⚠️  Claude 配置合并失败"
    else
      echo '{"mcpServers":{"kyuubi":{"command":"kyuubi-mcp"}}}' > "$CLAUDE_FILE"
      echo "✅ Claude Desktop MCP 配置已创建"
    fi
  fi
fi

# Cursor
CURSOR_DIR="$HOME/.cursor"
CURSOR_FILE="$CURSOR_DIR/mcp.json"
if [ -d "$CURSOR_DIR" ]; then
  mkdir -p "$CURSOR_DIR"
  if [ -f "$CURSOR_FILE" ] && grep -q "kyuubi" "$CURSOR_FILE" 2>/dev/null; then
    echo "✅ Cursor MCP 已配置"
  else
    if [ -f "$CURSOR_FILE" ]; then
      node -e "
        const fs = require('fs');
        const existing = JSON.parse(fs.readFileSync('$CURSOR_FILE', 'utf-8'));
        existing.mcpServers = existing.mcpServers || {};
        existing.mcpServers.kyuubi = { command: 'kyuubi-mcp' };
        fs.writeFileSync('$CURSOR_FILE', JSON.stringify(existing, null, 2));
      " 2>/dev/null && echo "✅ Cursor MCP 已添加" || echo "⚠️  Cursor 配置合并失败"
    else
      echo '{"mcpServers":{"kyuubi":{"command":"kyuubi-mcp"}}}' > "$CURSOR_FILE"
      echo "✅ Cursor MCP 配置已创建"
    fi
  fi
fi

echo ""
echo "🎉 安装完成！"
echo ""
echo "下一步："
if [ "${1:-your-workspace-token}" = "your-workspace-token" ]; then
  echo "  1. 编辑 $CONFIG_FILE 填入你的 workspace token"
  echo "  2. 重启你的 AI 工具"
else
  echo "  重启你的 AI 工具即可使用"
fi
