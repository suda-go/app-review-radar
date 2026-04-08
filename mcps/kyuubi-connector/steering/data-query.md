# 数据查询规范

## 查询前必须先了解表结构

在对任何表执行查询之前，必须先调用 `describe_table` 或 `get_table_fields` 获取表结构，确认：
1. 分区字段名称和类型（避免猜错分区字段导致全表扫描）
2. 字段名称拼写（避免 SQL 报错）
3. 字段类型（避免类型不匹配的过滤条件）

表结构信息仅供内部构建 SQL 使用，不需要展示给用户。除非用户明确要求"看下表结构"。

## 查询方式自动选择

收到查询请求后，按以下流程自动判断：

1. 直接尝试同步查询（`execute_query`）
2. 根据查询结果判断：
   - 查询成功 → 展示结果给用户并进行分析
   - 查询失败且错误信息包含 "permission"/"do not have permission"/"权限" → 权限不足，自动降级到数据推送（`create_data_push_job`），告知用户没有直接查询权限，结果会以 CSV 发到飞书
   - 查询失败但不是权限问题 → 展示错误信息，帮用户排查
3. 告诉用户本次使用的方式和原因
4. 同步查询结果返回后，直接展示结果，不需要额外提示其他查询方式。

写入飞书的方式：
- 飞书 MCP（lark-mcp）→ 通过 `create-doc` 创建飞书文档写入
- feishu CLI（`@mi/feishu`）→ 通过 `feishu docx create` 或 `feishu sheet create` + `feishu sheet write` 写入

注意：不要依赖 `check_table_permission` 接口判断权限，该接口结果与实际 Ranger 权限校验不一致。以查询时的实际报错为准。

如果用户明确指定了方式（如"异步查询"、"推到飞书"、"写到飞书表格"），直接按用户要求执行，不走自动判断。

支持的查询方式：
1. 同步查询 — 直接返回结果（适合 10 分钟内的查询）
2. 异步查询 — 提交后返回 queryId，稍后可查询结果（适合长时间查询）
3. 数据推送 — 创建推送作业，结果以 CSV 附件发送到飞书，需要到飞书消息中下载
4. 写入飞书文档 — 同步查询 + 通过飞书 MCP 创建文档写入（需要 lark-mcp）
5. 写入本地文件 — 同步查询 + 将结果保存为 CSV 文件到工作区 `output/` 目录

## 同步/异步自动选择

查询前通过 `get_table_partitions` 估算数据量，自动选择同步或异步：

- 涉及的分区数据量 < 1 亿行，且 SQL 简单（单表、简单聚合）→ 直接走同步查询（默认 trino 引擎）
- 涉及的分区数据量 > 1 亿行，或多表 JOIN，或跨多天大范围扫描 → 直接走异步查询（默认 spark 引擎）
- 无法估算时默认走同步，超时后自动切换异步重试

选定后直接执行，不需要向用户确认。执行后简短告知用户用了哪种方式和原因即可。

## 异步查询行为

异步查询提交后，不要自动轮询状态。只需：
1. 调用 `submit_query` 提交 SQL
2. 告诉用户 queryId
3. 给出预估耗时（根据数据量和 SQL 复杂度估算）：
   - 单分区简单聚合：约 30 秒~1 分钟
   - 跨几天 + GROUP BY：约 1~3 分钟
   - 跨月/跨年 + 多条件过滤：约 2~5 分钟
   - 多表 JOIN + 大范围扫描：约 5~10 分钟
4. 告诉用户获取结果的方法：
   - 在同一个聊天窗口里说"帮我看下刚才的查询结果"
   - 或者说"查下 queryId xxx 的状态"
   - 换了新聊天窗口需要提供 queryId

## 查询安全

- SELECT 查询必须带分区条件，禁止全表扫描（仅针对有分区字段的表）
- 如果表本身没有分区字段（通过 describe_table 确认），则不需要检查分区条件
- 如果用户给的 SQL 或用户的需求无法确定分区条件（且表有分区字段），必须拒绝执行，并告知用户：该查询没有分区过滤，可能导致全表扫描，请补充分区条件后重试
- 如果用户说"查最近的数据量"，应该先用 `get_table_partitions` 查看最近的分区，再带分区条件查询，而不是用全表 GROUP BY
- 默认不加 LIMIT，用户的 SQL 原样执行
- 大表查询优先用 `submit_query`（异步），避免超时
- 用户给的 SQL 原样提交，不要擅自改写语法。Trino 和 Spark 的 SQL 语法有差异（如 varchar vs string），改写可能导致报错

## 创建作业规范

### 默认参数

创建作业时如果用户不指定，使用以下默认值：

SparkSQL 作业：
| 参数 | 默认值 |
|------|--------|
| Spark 版本 | 3.3 |
| Driver 内存 | 2g |
| Executor 内存 | 4g |
| Executor 数量 | 1（动态分配开启，最大 100） |
| 动态分配 | 开启 |
| 调度方式 | 手动触发（一次性） |
| 重试次数 | 0 |

数据推送作业：
| 参数 | 默认值 |
|------|--------|
| 执行引擎 | TRINO |
| 推送方式 | LARK（飞书） |
| 接收人 | 当前 token 用户（自己） |
| 数据格式 | CSV 附件 |
| 调度方式 | 手动触发（一次性） |

Notebook 作业：
| 参数 | 默认值 |
|------|--------|
| Driver 内存 | 2g |
| Executor 内存 | 4g |
| Executor 数量 | 2 |
| 调度方式 | 手动触发（一次性） |

展示配置摘要时，把默认值也列出来，让用户知道实际会用什么参数。

### 引导式创建

收到"创建作业"请求后，分步引导用户确认：

1. 确认作业类型：
   - SparkSQL — 执行 SQL 查询/ETL
   - 数据推送 — SQL 结果以 CSV 推送到飞书
   - Notebook — 运行 Python/Spark notebook

2. 确认核心参数：
   - SparkSQL：SQL 语句、作业名
     - ⚠️ SparkSQL 作业的 SQL 必须包含 INSERT INTO 或 CREATE TABLE AS SELECT（CTAS）等写入语句，纯 SELECT 查询不能配置为 SparkSQL 作业。纯查询请使用同步查询（execute_query）或数据推送作业
   - 数据推送：SQL 语句、推送标题、接收人
   - Notebook：notebook 文件路径、作业名
     - 必须确认 notebook 来源：工场已有的 notebook 文件路径，还是 Git 仓库中的 notebook
     - 如果来自 Git，需要确认 git_url 和 git_ref（分支/tag）
     - 如果用户没有现成的 notebook，可以先用 `create_notebook` 创建一个空的 notebook 文件
     - 确认是否需要 Python 依赖包（python_packages）
     - 确认运行时队列（queue），不确定时用默认值

3. 确认调度方式：
   - 一次性执行（默认）
   - 定时调度（需要 cron 表达式）
     - ⚠️ 如果 SQL 是纯 SELECT 查询，不适合配置周期调度，必须提醒用户：纯查询没有输出目标，周期执行没有意义且浪费资源
     - 周期调度仅适合 INSERT INTO / CTAS 等有写入目标的 SQL

4. 确认资源配置（默认值通常够用，用户有特殊需求再调整）：
   - Driver 内存（默认 2g）
   - Executor 内存（默认 4g）
   - Executor 数量（默认动态分配）

5. 展示完整配置摘要，用户确认后再创建

### 创建后提示

作业创建成功后，必须告知用户：
- 作业 ID
- 任务 ID（如果已触发执行）
- 当前状态（上线成功/失败、执行中/失败）
- 如何查看：可以问我"查下作业 xxx 的状态"或"看下任务 xxx 的日志"

### 数据推送作业自动清理

通过权限自动判断走数据推送的一次性作业，执行完成后自动删除：
1. `create_data_push_job` 创建并执行
2. 用 `get_task_detail(taskId)` 查看执行状态
3. 状态变为 SUCCEEDED 或 FAILED 后，调用 `delete_job(jobId)` 删除作业
4. 告诉用户：结果已推送到飞书，作业已自动清理

判断是否自动清理的标准：没有配置定时调度（cron）的一次性推送作业 → 自动清理。配置了定时调度的推送作业 → 不清理。

### 安全规则

- 不要自动发布到生产环境，除非用户明确要求
- 创建前必须让用户确认 SQL 和配置
- 权限不足时给出清晰提示，引导用户联系管理员

## 跨区域查询

- 查询前确认当前活跃工作空间是否匹配目标表的区域
- catalog 前缀对应关系：`alsgprc`=新加坡、`azamsprc`=荷兰、`ksmosprc`=俄罗斯、`azpnprc`=印度
- 如果表的 catalog 和当前区域不匹配，先 `switch_region`

## 输出规范

- 查询结果写入飞书时，标注查询时间、SQL、数据源表名
- 数据量大时用千分位格式化（如 124,801,109）
- 数据量类查询标注单位（万、亿）
- 结果行数 ≤ 500 行：直接在聊天中用表格展示全量数据
- 结果行数 > 500 行：在聊天中展示摘要（总行数、TOP 100），提示用户选择写入飞书文档或保存到本地 CSV。用户选择后，必须将全量数据完整写入，不能只写摘要或 TOP N

## 建表规范（Iceberg）

⚠️ 目前只支持创建 Iceberg 表。如果用户要求创建 Hive、Paimon、Doris 等其他类型的表，拒绝并告知：当前只支持 Iceberg 表，其他类型请到数据工场页面操作。

### 用户输入方式

支持三种方式：
1. 给完整 DDL — 直接解析校验
2. 描述需求 — "建一张广告日志表，有 gaid、ad_id、fee 字段"，AI 生成 DDL
3. 参考已有表 — "建一张和 xxx 表结构一样的表"，AI 调 describe_table 获取源表结构

### 用户只需提供

- 表名（catalog.库名.表名）
- 字段定义（字段名、类型、描述）
- 分区字段

其他 TBLPROPERTIES 全部自动生成，使用默认值。用户有特殊需求时可以明确说出来再调整。

### 校验规则

字段名校验：
- 只允许小写字母、数字、下划线，不能以数字开头
- 不能用 SQL 保留字（select、from、table、order、group、where、having、join、on、as、and、or、not、in、is、null、like、between、case、when、then、else、end、create、drop、alter、insert、update、delete、into、values、set、limit、offset、union、all、distinct、exists）
- 不能重复

字段类型白名单：
- 基础：STRING、INT、BIGINT、DOUBLE、FLOAT、BOOLEAN、BINARY、DATE、TIMESTAMP、DECIMAL
- 复杂：STRUCT<...>、ARRAY<...>、MAP<...>
- 不在白名单内的类型拒绝，提示用户修正

分区字段校验：
- 分区字段必须在字段列表里存在
- 分区字段类型只允许 INT、BIGINT、STRING、DATE，不支持 BINARY/STRUCT/ARRAY/MAP
- 分区字段不宜超过 3 个，超过时提醒用户可能导致小文件问题
- 分区字段顺序：粗粒度在前（如 date → hour → event_name）

表名/库名校验：
- 只允许小写字母、数字、下划线
- catalog 必须以 `iceberg_` 开头
- 库名调 `list_databases` 验证是否存在

### TBLPROPERTIES 自动生成

所有属性使用默认值，用户不需要填：

| 属性 | 默认值 |
|------|--------|
| format-version | 2 |
| format | iceberg/parquet |
| table-optimize-priority | balanced-priority |
| write.parquet.compression-codec | zstd |
| write.parquet.compression-level | 1 |
| write.target-file-size-bytes | 536870912 (512MB) |
| read.split.target-size | 134217728 (128MB) |
| snapshot.lifecycle.minutes | 2880 |
| metacat.reserved.lifecycle.day | 550 |
| write.distribution-mode | none |
| read.parquet.vectorization.enabled | true |
| write.avro.compression-codec | zstd |

安全等级默认所有字段为 L2（内部级）。

### 建表流程

1. 确定 catalog 和库名：
   - 用户明确指定了 → 直接用
   - 用户没说 catalog → 用当前工作空间对应的 iceberg catalog（新加坡→iceberg_alsgprc_hadoop，荷兰→iceberg_azamsprc_hadoop，俄罗斯→iceberg_ksmosprc_hadoop，印度→iceberg_azpnprc_hadoop）
   - 用户没说库名 → 调 `list_databases` 列出该 catalog 下用户有权限的库（hasPermission=true），展示给用户选择，不能猜
   - 参考已有表建新表 → catalog 和库名默认跟源表一致，除非用户指定不同的
2. 解析用户输入（DDL/描述/参考表）
3. 运行校验规则
4. 有问题 → 告诉用户哪里不对，建议修正
5. 没问题 → 生成完整 DDL 预览，展示给用户确认
6. 用户确认后通过 OpenAPI 提交建表请求
