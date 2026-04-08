/**
 * Data Factory OpenAPI Client
 *
 * Calls the data factory REST API for metadata, lineage, etc.
 * Auth: Authorization header with "workspace-token/1.0 <token>" format.
 * Responses are wrapped in { status, code, msg, data } — we auto-unwrap.
 */
export declare class OpenApiClient {
    private readonly baseUrl;
    private token;
    constructor(config: {
        baseUrl: string;
        token?: string;
    });
    /** Switch workspace token at runtime */
    setToken(token: string): void;
    getToken(): string;
    /** GET /metadata/table/authorized/list — 列出授权表，支持多种表类型 */
    listAuthorizedTables(opts: {
        keyword?: string;
        catalog?: string;
        dbName?: string;
        service?: string;
        isGranted?: boolean;
        isIncludePartitionTable?: boolean;
    }): Promise<unknown>;
    /** GET /metadata/table/get — 获取表详情 */
    getTableDetail(catalog: string, dbName: string, tableName: string): Promise<unknown>;
    /** GET /metadata/table/field/list — 获取表字段 */
    getTableFields(catalog: string, dbName: string, tableName: string): Promise<unknown>;
    /** GET /metadata/table/table/show/ddl — 获取建表 DDL */
    getTableDDL(catalog: string, dbName: string, tableName: string): Promise<unknown>;
    /** GET /metadata/table/partition/list — 获取表分区 */
    getTablePartitions(catalog: string, dbName: string, tableName: string): Promise<unknown>;
    /** GET /metadata/table/log/get — 获取表变更日志 */
    getTableLog(catalog: string, dbName: string, tableName: string): Promise<unknown>;
    /** GET /metadata/catalog/list — 有资源的 catalog */
    listCatalogs(engine?: string, service?: string): Promise<unknown>;
    /** GET /database/list — 库列表 */
    listDatabases(catalog: string, keyword?: string): Promise<unknown>;
    /** POST /develop/lineage/queryTableJobLineageV2 — 查询表血缘 */
    queryTableLineage(body: Record<string, unknown>): Promise<unknown>;
    /** POST /develop/jobs/op/sparksql — 新建 SparkSQL 作业 */
    createSparkSQLJob(body: Record<string, unknown>): Promise<unknown>;
    /** PUT /develop/jobs/{jobId}/op/sparksql — 修改 SparkSQL 作业 */
    updateSparkSQLJob(jobId: string, body: Record<string, unknown>): Promise<unknown>;
    /** POST /develop/jobs/op/data/push — 新建数据推送作业 */
    createDataPushJob(body: Record<string, unknown>): Promise<unknown>;
    /** POST /develop/jobs/op/notebook — 新建 Notebook 作业 */
    createNotebookJob(body: Record<string, unknown>): Promise<unknown>;
    /** PUT /develop/jobs/{jobId}/op/notebook — 修改 Notebook 作业 */
    updateNotebookJob(jobId: string, body: Record<string, unknown>): Promise<unknown>;
    /** POST /develop/notebook/create — 创建 Notebook 文件 */
    createNotebook(body: Record<string, unknown>, user: string, workspaceId: number): Promise<unknown>;
    /** POST /permission/table/check — 检查用户是否有表权限 */
    checkTablePermission(catalog: string, dbName: string, tableName: string, userName: string, workspaceId: number): Promise<unknown>;
    /** POST /resource/table/create — 创建表（通过 OpenAPI，支持审批） */
    createTable(body: Record<string, unknown>): Promise<unknown>;
    /** PUT /develop/jobs/{jobId}/op/data/push — 修改数据推送作业 */
    updateDataPushJob(jobId: string, body: Record<string, unknown>): Promise<unknown>;
    /** GET /develop/jobs/{jobId} — 作业详情 */
    getJobDetail(jobId: string, version?: number): Promise<unknown>;
    /** POST /develop/jobs/{jobId}/delete — 删除作业 */
    deleteJob(jobId: string, version?: number): Promise<unknown>;
    /** POST /develop/jobs/{jobId}/start — 启动作业 */
    startJob(jobId: string, version?: number): Promise<unknown>;
    /** POST /develop/jobs/{jobId}/stop — 停止作业 */
    stopJob(jobId: string, taskId?: string): Promise<unknown>;
    /** GET /develop/jobs/op/list — 查询作业列表 */
    listJobs(opts: {
        searchKey?: string;
        jobId?: string;
        jobTypes?: string;
        lastScheduleStatus?: string;
        owner?: boolean;
        page?: number;
        pageSize?: number;
    }): Promise<unknown>;
    /** POST /develop/jobs/{jobId}/op/scheduler/start — 启用调度 */
    enableJobSchedule(jobId: string): Promise<unknown>;
    /** POST /develop/jobs/{jobId}/op/scheduler/stop — 停用调度 */
    disableJobSchedule(jobId: string): Promise<unknown>;
    /** GET /develop/jobs/{jobId}/dagNodes — 作业 dagNode 列表 */
    listJobDagNodes(jobId: string, page?: number, pageSize?: number): Promise<unknown>;
    /** GET /develop/dagNodes/{dagNodeId} — dagNode 详情 */
    getDagNodeDetail(dagNodeId: string): Promise<unknown>;
    /** GET /develop/dagNodes/{dagNodeId}/tasks — dagNode 下的 task 实例列表 */
    listDagNodeTasks(dagNodeId: string, page?: number, pageSize?: number): Promise<unknown>;
    /** GET /develop/tasks/{taskId}/detail — 任务实例详情 */
    getTaskDetail(taskId: string): Promise<unknown>;
    /** GET /develop/tasks/{taskId}/log — 任务日志 */
    getTaskLog(taskId: string): Promise<unknown>;
    /** GET /develop/dir/view — 查看分组（目录树） */
    viewDirs(): Promise<unknown>;
    /** POST /develop/dir/new — 新建分组 */
    createDir(name: string, parentDirId?: number): Promise<unknown>;
    /** POST /develop/dir/move/batch/job — 批量移动作业到目录 */
    moveJobsToDir(dirId: number, jobIds: string[]): Promise<unknown>;
    /** GET /workspace/info — 当前空间详情 */
    getWorkspaceInfo(): Promise<{
        id: number;
        workspaceName: string;
        description: string;
        owner: string;
        role: string;
        department: string;
    }>;
    /** GET /workspace/token/detail — 获取当前 Token 信息（含 token 对应的用户名） */
    getTokenDetail(): Promise<{
        user: string;
        role: string;
        workspaceId: number;
    }>;
    /** GET /common/workspace/detail — 获取空间基本信息（含 regionId/regionName） */
    getWorkspaceDetail(): Promise<{
        id: number;
        workspaceName: string;
        regionId: string;
        regionName: string;
        owner: string;
        description: string;
    }>;
    /** GET /common/region/list — 区域列表 */
    listRegions(): Promise<unknown>;
    private get;
    private post;
    /** POST without body (for action endpoints like start/stop/delete) */
    private postRaw;
    private put;
    private headers;
    private handleResponse;
}
