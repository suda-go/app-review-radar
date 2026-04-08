---
inclusion: manual
---

# 数据表验收 Skill

用户提供 PRD、TRD（技术方案）、项目信息后，Kiro 自动完成从撰写验收文档到执行验收的全流程。

## 输入要求

用户需提供以下信息（飞书链接或文字描述均可）：

1. **PRD**：产品需求文档，包含数据字典、字段定义、业务逻辑
2. **TRD / 研发设计文档**：技术方案，包含表结构、ETL 逻辑、数据流向、JOIN 关系
3. **项目信息**：目标表名、所在集群、上线日期等基本信息

## 全流程步骤

### 第一步：读取输入文档

1. 使用 `fetch-doc` 读取用户提供的 PRD 和 TRD 飞书文档
2. 从 PRD 中提取：
   - 目标表清单及其用途
   - 数据字典（字段名、字段类型、业务含义）
   - 业务逻辑规则（如优先级填充、过滤条件、时间范围等）
   - 特殊处理要求（如大写转换、去重规则等）
3. 从 TRD 中提取：
   - 数据流向：ODS → 中间表 → DWD → DWS 的完整链路
   - 各表之间的 JOIN 关系和关联键
   - 分区策略（全量表 vs 增量表）
   - 各层表的主键定义

### 第二步：探查表结构

1. 使用 `switch-region` 切换到目标集群
2. 对数据链路中涉及的每张表：
   - 使用 `describe-table` 获取字段结构
   - 确认分区字段名（`date` / `dt`）和类型（integer / string）
   - 如果原始 ODS 表无权限，使用 `search-tables` 在 `iib_dw` schema 下查找研发中间表（通常命名为 `xxx_v2`）
3. 记录实际可用的表名映射，用于后续 SQL 编写

### 第三步：生成验收文档

根据 PRD + TRD + 表结构信息，使用 `create-doc` 在飞书创建验收文档。

#### 文档结构模板

```
一、验收背景
  - 验收目标表及其用途
  - 验收原则

二、验收思路总览
  - 总览表格：验收对象 × 验收维度 × 核心验收点 × 是否通过

三、中间表验收（按数据链路从上游到下游）
  对每张 ODS / 中间表：
  3.x {表名}
    - 字段完整性：核心字段非空率 SQL
    - 数据量合理性：趋势 SQL（全量表逐日递增 / 增量表日波动 <5%）
    - 主键唯一性：去重 SQL（如适用）
    - 过滤条件正确性：边界检查 SQL（如适用）

四、目标表验收
  对每张 DWD / DWS 表：
  4.x {表名}
    完整性验收：
      - 表结构完整性（DESCRIBE 对照 PRD）
      - 数据量合理性（趋势 + 与上游对比）
      - 各集群数据完整性（如多集群部署）
    准确性验收：
      - 各事件数量与 ODS 一致性（逐事件对比）
      - 主键唯一性
      - 维度优先级填充逻辑（如 PRD 有定义）
      - 特殊处理验证（大写、去重等）
      - DWS 与 DWD 聚合一致性（DWS 表适用）
      - 漏斗合理性（漏斗表适用）

五、验收结论
  - 汇总表格：验收项 × 验收结论 × 问题描述 × 修复时间
```

#### SQL 编写规范

- 使用实际可用的表名（第二步确认的），不用无权限的原始表
- 分区条件使用正确的字段名和格式
- DWD 表主键已去重时，DWD 侧用 `COUNT(*)` 代替 `COUNT(DISTINCT CONCAT(...))`
- 避免对超大表做 `COUNT(DISTINCT CONCAT(...))` — 容易 OOM
- 每个验收项的 SQL 放在代码块中，附带注释说明预期结果
- 对比类 SQL 使用 UNION ALL 格式，输出 event_name + source + cnt 便于对照

#### 飞书文档格式要求

- 使用 `<lark-table>` 组织验收项，列为：验收项 / 验收口径思路 / SQL 思路 / 是否通过
- 使用 `<callout>` 标注重要说明（如增量表需制作全量表、数据源待确认等）
- "是否通过"列初始留空，后续回填

### 第四步：逐项执行验收

对验收文档中每个验收项：

1. **验证 SQL**：
   - 使用 `execute-query` 加 `LIMIT` 试跑，确认无语法错误和权限问题
   - 如有问题，修正 SQL 并更新文档

2. **创建数据推送任务**：
   - 使用 `create-data-push-job` 创建任务
   - `workspace_id`：根据表所在集群选择
   - `title`：`{章节号} {验收项名称}`
   - `subtitle`：简要说明对比的表
   - `sql`：验证通过的 SQL
   - 记录 jobId

3. **回填文档**：
   - 使用 `update-doc` 将任务链接填入"是否通过"列
   - 链接格式：`https://data.mioffice.cn/workspace/?wid={workspace_id}#/workspace/{workspace_id}/offlineJob?mode=group&type=jobDetail&jobId={jobId}`

4. **检查结果**：
   - 任务完成后，根据推送结果判断是否通过
   - 通过：标注"是"并附简要说明
   - 不通过：标红说明问题，如 `<text color="red">不通过，xxx</text>`

### 第五步：汇总验收结论

所有验收项完成后，更新文档"五、验收结论"部分的汇总表格。

## 集群与 Workspace 映射

| 集群 | workspace_id | catalog 前缀 |
|------|-------------|-------------|
| 新加坡 | 11188 | alsgprc |
| 北京 | 11633 | zjyprc |
| 荷兰 | 11255 | azamsprc |
| 俄罗斯 | 11189 | ksmosprc |
| 印度 | 14195 | azpnprc |

## 常用表权限替代方案

当原始 ODS 表无权限时，优先查找 `iceberg_{catalog_prefix}_hadoop.iib_dw` 下的研发中间表：

| 原始表 | 替代表 |
|--------|--------|
| `dw.dwd_preload_base_detail_oversea_df` | `iib_dw.dwd_preload_base_detail_oversea_df_v2` |
| `dw.dwm_device_register_df` | `iib_dw.dwd_device_register_df_v2` |
| `dw.dwd_active_log_di` | `iib_dw.dwd_active_log_di_full` |
| `dwm.dwm_app_detail_history_df` | `iib_dw.dwd_preload_oneid_mid_table_v2` |
| `miuiads.global_miuiads_m3rd_mediate_data` | `iib_dw.dwd_m3rd_mediate_data_full` |

## 注意事项

- 执行查询前先用 `switch-region` 切换到正确的集群
- 大查询优先用 `submit-query`（异步），避免超时
- 单个 UNION ALL 查询如果涉及多个大表，考虑拆成多个独立的数据推送任务
- 日期参数：注意区分 `date` (integer, 如 20260318) 和 `dt` (string, 如 '2026-03-18')
- 验收文档创建时如果用户指定了 wiki_node，则在该节点下创建；否则创建在个人空间
- 每完成一个验收项就及时回填文档，不要等全部完成再回填
