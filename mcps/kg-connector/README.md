# KG MCP Server

知识图谱 MCP 服务，通过代理模式连接远程 KG API，提供概念解析、定义查询、依赖分析等能力。

## 工具列表（5 个）

| 工具 | 说明 |
|---|---|
| `kg_resolve_concept` | 将自然语言查询映射到知识图谱节点 |
| `kg_get_definition` | 根据命名空间 ID 获取概念定义 |
| `kg_get_dependencies` | 获取概念的结构依赖关系 |
| `kg_get_table_schema` | 获取表节点的 schema |
| `kg_search_knowledge` | 在知识图谱中进行探索性搜索 |

## 安装

需要 Python >= 3.10 和 [uv](https://docs.astral.sh/uv/)。

```bash
# 创建虚拟环境
uv venv mcps/kg-connector/.venv

# 安装
VIRTUAL_ENV=mcps/kg-connector/.venv uv pip install -e mcps/kg-connector
```

## 配置 MCP 客户端

```json
{
  "kg": {
    "command": "/absolute/path/to/mcps/kg-connector/.venv/bin/kg-mcp",
    "args": [],
    "env": {
      "KG_API_URL": "http://kg.ad.intl.xiaomi.com"
    },
    "disabled": false,
    "autoApprove": []
  }
}
```

> 路径需要使用绝对路径。

也可以通过命令行参数指定 API 地址：

```bash
kg-mcp --api-url http://kg.ad.intl.xiaomi.com
```

## 使用示例

```
# 搜索知识图谱
kg_search_knowledge(query="DAU", business="video")

# 解析概念
kg_resolve_concept(query="7日留存", business="video")

# 获取概念定义
kg_get_definition(concept_id="video.metric.video_dau")

# 获取依赖关系
kg_get_dependencies(concept_id="video.metric.video_dau")

# 获取表 schema
kg_get_table_schema(table_id="video.table.video_events")
```
