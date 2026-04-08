# Kyuubi MCP Server

多区域数据查询 MCP 服务，支持 SQL 查询、表元数据、血缘分析和作业管理。

## 工具列表（29 个）

### 区域管理（2 个）

| 工具 | 说明 |
|---|---|
| `list_regions` | 列出所有已配置的区域及工作空间（含 ID、描述） |
| `switch_region` | 切换活跃工作空间，支持按 region + token_index 或 workspace_id |

### SQL 查询 — 同步（3 个）

| 工具 | 说明 |
|---|---|
| `list_tables` | 列出指定 catalog.schema 下的表 |
| `describe_table` | 查看表的列名和类型 |
| `execute_query` | 执行只读 SQL（SELECT/SHOW），10 分钟超时 |

### SQL 查询 — 异步（3 个）

| 工具 | 说明 |
|---|---|
| `submit_query` | 提交查询，立刻返回 queryId |
| `check_query` | 查看查询状态和进度百分比 |
| `fetch_query_result` | 获取已完成查询的结果 |

### 元数据（7 个）

| 工具 | 说明 |
|---|---|
| `get_table_detail` | 表详情（owner、描述、字段、分区等） |
| `get_table_fields` | 字段定义（名称、类型、注释） |
| `get_table_ddl` | 建表 DDL 语句 |
| `get_table_partitions` | 分区信息（记录数、文件大小） |
| `search_tables` | 按关键词、catalog、库名搜索表 |
| `list_databases` | 列出 catalog 下的数据库 |
| `list_catalogs` | 列出可用的 catalog |

### 血缘（1 个）

| 工具 | 说明 |
|---|---|
| `query_table_lineage` | 查询表的上下游作业血缘 |

### 作业创建（2 个）

| 工具 | 说明 |
|---|---|
| `create_sparksql_job` | 创建 SparkSQL 作业，自动上线调度+执行 |
| `create_data_push_job` | 创建数据推送作业，默认推送给自己飞书，自动发布 |

创建作业时自动处理：noticeList 填充、常规调度+手动触发、分组目录归类、上线调度并执行一次。

### 作业修改（2 个）

| 工具 | 说明 |
|---|---|
| `update_sparksql_job` | 修改 SparkSQL 作业配置 |
| `update_data_push_job` | 修改数据推送作业配置 |

### 作业管理（5 个）

| 工具 | 说明 |
|---|---|
| `list_jobs` | 查询作业列表（默认第 1 页，20 条） |
| `get_job_detail` | 获取作业详情 |
| `start_job` | 启动作业 |
| `stop_job` | 停止作业 |
| `delete_job` | 删除作业 |

### 调度管理（2 个）

| 工具 | 说明 |
|---|---|
| `enable_job_schedule` | 启用作业调度 |
| `disable_job_schedule` | 停用作业调度 |

### 任务实例（2 个）

| 工具 | 说明 |
|---|---|
| `get_task_detail` | 获取任务实例详情（不指定 workspace_id 自动遍历所有空间） |
| `get_task_log` | 获取任务实例日志（不指定 workspace_id 自动遍历所有空间） |

## 配置

### 1. 创建配置文件

```bash
cp mcps/kyuubi-connector/kyuubi-config.example.json kyuubi-config.json
```

### 2. 填入 token

token 从数据工场平台获取（工作空间 → 设置 → Token 管理）。直接填 token 数组：

```json
{
  "tokens": [
    "workspace-token-1",
    "workspace-token-2",
    "workspace-token-3"
  ]
}
```

启动时自动调用 API 识别每个 token 对应的区域和工作空间信息，不需要手动指定区域。

### 3. 配置 MCP 客户端

```json
{
  "kyuubi": {
    "command": "node",
    "args": [
      "/absolute/path/to/mcps/kyuubi-connector/dist/index.js",
      "--config",
      "/absolute/path/to/kyuubi-config.json"
    ],
    "disabled": false,
    "autoApprove": []
  }
}
```

> 路径需要使用绝对路径。

## 支持的区域

| 区域 | catalog 前缀 |
|---|---|
| 新加坡 | `alsgprc` |
| 俄罗斯 | `ksmosprc` |
| 荷兰 | `azamsprc` |
| 印度 | `azpnprc` |

传入表全名时根据 catalog 前缀自动路由，无需手动切换。

## 使用示例

```
# 查询（自动路由到对应区域）
SELECT * FROM iceberg_alsgprc_hadoop.ad_dim.dim_global_tag_pid_df LIMIT 10

# 获取表详情
get_table_detail("iceberg_ksmosprc_hadoop.miuiads.some_table")

# 查询血缘
query_table_lineage(["iceberg_alsgprc_hadoop.ad_dim.dim_global_ad_id_df"])

# 异步长查询
submit_query("SELECT count(*) FROM ...") → queryId
check_query(queryId) → 进度
fetch_query_result(queryId) → 结果

# 创建数据推送（自动发布+执行）
create_data_push_job(workspace_id=123, sql="SELECT ...", title="日报推送")

# 创建 SparkSQL 作业（自动上线+执行）
create_sparksql_job(workspace_id=123, sql="INSERT INTO ...")
```
