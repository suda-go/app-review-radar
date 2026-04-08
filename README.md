# Data Skills and MCP

数据分析 MCP 工具集，连接小米数据工场进行 SQL 查询、作业管理、元数据查看。

## 包含的 MCP 服务

| MCP | 说明 | 工具数 |
|---|---|---|
| [kyuubi-connector](mcps/kyuubi-connector/) | 数据查询 + 元数据 + 血缘 + 作业管理 + Notebook | 33 |
| [doris-connector](mcps/doris-connector/) | Doris 直连查询（MySQL 协议） | 5 |
| [kg-connector](mcps/kg-connector/) | 知识图谱查询（概念解析、定义、依赖、表 schema） | 5 |

## 快速开始

### 1. 克隆 & 安装依赖

```bash
git clone <repo-url>
cd data-skills-and-mcp
npm install
```

> dist 已预编译提交，不需要 build。如果修改了源码，运行 `npm run build` 重新编译。

### 2. 创建配置文件

```bash
# Kyuubi（必选）
cp mcps/kyuubi-connector/kyuubi-config.example.json kyuubi-config.json

# Doris（可选，需内网环境）
cp mcps/doris-connector/doris-config.example.json doris-config.json
```

### 3. 填写配置

**kyuubi-config.json** — 填入数据工场 workspace token（从 工作空间 → 设置 → Token 管理 获取）：

```json
{
  "tokens": [
    "workspace-token-1",
    "workspace-token-2"
  ]
}
```

启动时会自动识别每个 token 对应的区域和工作空间，支持跨区域多工作空间。

**doris-config.json** — 填入 Doris 连接信息：

```json
{
  "connections": {
    "singapore": {
      "host": "sgpprc-xiaomi-datalake.doris.srv",
      "port": 10000,
      "user": "your-user",
      "password": "your-password",
      "database": "paimon_alsgprc_hadoop.miuiads"
    }
  }
}
```

> Doris 需要内网或 VPN 环境才能连接。

### 3.5 安装 KG MCP（Python，可选）

```bash
# 需要 uv（Python 包管理器）
uv venv mcps/kg-connector/.venv
VIRTUAL_ENV=mcps/kg-connector/.venv uv pip install -e mcps/kg-connector
```

KG MCP 连接 `http://kg.ad.intl.xiaomi.com`，无需额外配置文件。

### 4. 配置 MCP 客户端

复制示例配置到你的 IDE：

```bash
# Kiro
cp .kiro/settings/mcp.example.json <你的工作区>/.kiro/settings/mcp.json
```

然后把路径改成你本机的绝对路径。参考 [mcp.example.json](.kiro/settings/mcp.example.json)。


### 5.（可选）飞书官方远程 MCP

如果只需要创建/搜索/编辑飞书云文档（不需要操作表格数据），可以用飞书官方 MCP，不需要创建应用：

1. 打开 https://open.feishu.cn/page/mcp/7618185159730482141
2. 登录飞书，生成个人 MCP URL
3. 添加到 mcp.json：

```json
"lark-mcp": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "https://mcp.feishu.cn/mcp/mcp_你的URL"],
  "disabled": false
}
```

## 功能概览

### Kyuubi MCP（32 个工具）

| 分类 | 工具 | 说明 |
|---|---|---|
| 区域管理 | `list_regions` | 列出所有区域及工作空间 |
| | `switch_region` | 切换活跃工作空间 |
| SQL 同步 | `execute_query` | 执行 SELECT/SHOW，10 分钟超时 |
| | `list_tables` | 列出 catalog.schema 下的表 |
| | `describe_table` | 查看表列定义 |
| SQL 异步 | `submit_query` | 提交长查询，返回 queryId |
| | `check_query` | 查看查询进度 |
| | `fetch_query_result` | 获取查询结果 |
| 元数据 | `get_table_detail` | 表详情（owner、描述、字段） |
| | `get_table_fields` | 字段定义 |
| | `get_table_ddl` | 建表 DDL |
| | `get_table_partitions` | 分区信息 |
| | `search_tables` | 搜索表 |
| | `list_databases` | 列出数据库 |
| | `list_catalogs` | 列出 catalog |
| 血缘 | `query_table_lineage` | 上下游作业血缘 |
| 作业创建 | `create_sparksql_job` | 创建 SparkSQL 作业（自动上线+执行） |
| | `create_data_push_job` | 创建数据推送作业（自动发布） |
| | `create_notebook_job` | 创建 Notebook 调度作业（自动上线+执行） |
| 作业修改 | `update_sparksql_job` | 修改 SparkSQL 作业 |
| | `update_data_push_job` | 修改数据推送作业 |
| | `update_notebook_job` | 修改 Notebook 作业 |
| Notebook | `create_notebook` | 创建 Notebook 文件 |
| 作业管理 | `list_jobs` | 查询作业列表 |
| | `get_job_detail` | 作业详情 |
| | `start_job` | 启动作业 |
| | `stop_job` | 停止作业 |
| | `delete_job` | 删除作业 |
| 调度 | `enable_job_schedule` | 启用调度 |
| | `disable_job_schedule` | 停用调度 |
| 任务实例 | `get_task_detail` | 任务实例详情（自动遍历工作空间） |
| | `get_task_log` | 任务实例日志（自动遍历工作空间） |

支持 4 个区域（新加坡/俄罗斯/荷兰/印度），根据 catalog 前缀自动路由。详见 [kyuubi-connector/README.md](mcps/kyuubi-connector/README.md)。

### Doris MCP（5 个工具）

| 工具 | 说明 |
|---|---|
| `list_connections` | 列出连接 |
| `execute_query` | 执行 SQL 查询 |
| `list_databases` | 列出数据库 |
| `list_tables` | 列出表 |
| `describe_table` | 查看表结构 |

> 需要内网环境，通过 MySQL 协议直连 Doris。

### KG MCP（5 个工具）

| 工具 | 说明 |
|---|---|
| `kg_resolve_concept` | 将自然语言查询映射到知识图谱节点 |
| `kg_get_definition` | 根据命名空间 ID 获取概念定义 |
| `kg_get_dependencies` | 获取概念的结构依赖关系 |
| `kg_get_table_schema` | 获取表节点的 schema |
| `kg_search_knowledge` | 在知识图谱中进行探索性搜索 |

> Python 包，通过代理模式连接 `http://kg.ad.intl.xiaomi.com`。详见 [kg-connector/README.md](mcps/kg-connector/README.md)。

## 项目结构

```
data-skills-and-mcp/
├── mcps/
│   ├── kyuubi-connector/    # 数据查询 + 作业管理 MCP
│   ├── doris-connector/     # Doris 直连 MCP
│   ├── kg-connector/        # 知识图谱 MCP（Python）
│   └── example-connector/   # 示例 MCP
├── shared/                  # 共享工具库
├── kyuubi-config.json       # Kyuubi 配置（gitignore）
└── doris-config.json        # Doris 配置（gitignore）
```

## 开发

```bash
npm run build              # 构建全部
npm run clean              # 清理
npm run build -w mcps/kyuubi-connector  # 单独构建
```

## 数据查询规范

项目内置了数据查询规范（`.kiro/steering/data-query.md`），包含查询前检查表结构、权限自动判断、引擎选择、分区安全等规则。

Kiro 用户打开项目自动生效。其他 AI 工具用户运行同步脚本：

```bash
bash scripts/sync-rules.sh
```

会自动将规则复制到 `.cursorrules`、`CLAUDE.md`、`.windsurfrules`、`.github/copilot-instructions.md`。

修改规则后重新运行脚本即可同步。
