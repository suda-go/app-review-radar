/**
 * Data Factory OpenAPI Client
 *
 * Calls the data factory REST API for metadata, lineage, etc.
 * Auth: Authorization header with "workspace-token/1.0 <token>" format.
 * Responses are wrapped in { status, code, msg, data } — we auto-unwrap.
 */
import { ErrorType, KyuubiError } from './kyuubi-types.js';
export class OpenApiClient {
    baseUrl;
    token;
    constructor(config) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, '');
        this.token = config.token || '';
    }
    /** Switch workspace token at runtime */
    setToken(token) {
        this.token = token;
    }
    getToken() {
        return this.token;
    }
    // =========================================================================
    // Metadata — Tables
    // =========================================================================
    /** GET /metadata/table/authorized/list — 列出授权表，支持多种表类型 */
    async listAuthorizedTables(opts) {
        return this.get('/metadata/table/authorized/list', opts);
    }
    /** GET /metadata/table/get — 获取表详情 */
    async getTableDetail(catalog, dbName, tableName) {
        return this.get('/metadata/table/get', { catalog, dbName, tableNameEn: tableName });
    }
    /** GET /metadata/table/field/list — 获取表字段 */
    async getTableFields(catalog, dbName, tableName) {
        return this.get('/metadata/table/field/list', { catalog, dbName, tableName });
    }
    /** GET /metadata/table/table/show/ddl — 获取建表 DDL */
    async getTableDDL(catalog, dbName, tableName) {
        return this.get('/metadata/table/table/show/ddl', { catalog, dbName, tableName });
    }
    /** GET /metadata/table/partition/list — 获取表分区 */
    async getTablePartitions(catalog, dbName, tableName) {
        return this.get('/metadata/table/partition/list', { catalog, dbName, tableName });
    }
    /** GET /metadata/table/log/get — 获取表变更日志 */
    async getTableLog(catalog, dbName, tableName) {
        return this.get('/metadata/table/log/get', { catalog, dbName, tableName });
    }
    // =========================================================================
    // Metadata — Catalog & Database
    // =========================================================================
    /** GET /metadata/catalog/list — 有资源的 catalog */
    async listCatalogs(engine, service) {
        return this.get('/metadata/catalog/list', { engine, service });
    }
    /** GET /database/list — 库列表 */
    async listDatabases(catalog, keyword) {
        return this.get('/database/list', { catalog, keyword });
    }
    // =========================================================================
    // Lineage
    // =========================================================================
    /** POST /develop/lineage/queryTableJobLineageV2 — 查询表血缘 */
    async queryTableLineage(body) {
        return this.post('/develop/lineage/queryTableJobLineageV2', body);
    }
    // =========================================================================
    // Jobs — lifecycle
    // =========================================================================
    /** POST /develop/jobs/op/sparksql — 新建 SparkSQL 作业 */
    async createSparkSQLJob(body) {
        console.error('[kyuubi-mcp] createSparkSQLJob body:', JSON.stringify(body, null, 2));
        return this.post('/develop/jobs/op/sparksql', body);
    }
    /** PUT /develop/jobs/{jobId}/op/sparksql — 修改 SparkSQL 作业 */
    async updateSparkSQLJob(jobId, body) {
        return this.put(`/develop/jobs/${jobId}/op/sparksql`, body);
    }
    /** POST /develop/jobs/op/data/push — 新建数据推送作业 */
    async createDataPushJob(body) {
        return this.post('/develop/jobs/op/data/push', body);
    }
    /** POST /develop/jobs/op/notebook — 新建 Notebook 作业 */
    async createNotebookJob(body) {
        return this.post('/develop/jobs/op/notebook', body);
    }
    /** PUT /develop/jobs/{jobId}/op/notebook — 修改 Notebook 作业 */
    async updateNotebookJob(jobId, body) {
        return this.put(`/develop/jobs/${jobId}/op/notebook`, body);
    }
    /** POST /develop/notebook/create — 创建 Notebook 文件 */
    async createNotebook(body, user, workspaceId) {
        const url = `${this.baseUrl}/develop/notebook/create`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { ...this.headers(), 'x-dp-user': user, 'x-dp-workspace': String(workspaceId) },
            body: JSON.stringify(body),
        });
        return this.handleResponse(resp);
    }
    /** POST /permission/table/check — 检查用户是否有表权限 */
    async checkTablePermission(catalog, dbName, tableName, userName, workspaceId) {
        return this.post('/permission/table/check', {
            tableDTO: { catalog, dbName, tableNameEn: tableName },
            userName,
            workspaceId,
        });
    }
    /** POST /resource/table/create — 创建表（通过 OpenAPI，支持审批） */
    async createTable(body) {
        return this.post('/resource/table/create', body);
    }
    /** PUT /develop/jobs/{jobId}/op/data/push — 修改数据推送作业 */
    async updateDataPushJob(jobId, body) {
        return this.put(`/develop/jobs/${jobId}/op/data/push`, body);
    }
    /** GET /develop/jobs/{jobId} — 作业详情 */
    async getJobDetail(jobId, version) {
        return this.get(`/develop/jobs/${jobId}`, version !== undefined ? { version } : undefined);
    }
    /** POST /develop/jobs/{jobId}/delete — 删除作业 */
    async deleteJob(jobId, version) {
        const params = version !== undefined ? `?version=${version}` : '';
        return this.postRaw(`/develop/jobs/${jobId}/delete${params}`);
    }
    /** POST /develop/jobs/{jobId}/start — 启动作业 */
    async startJob(jobId, version) {
        const params = version !== undefined ? `?version=${version}` : '';
        return this.postRaw(`/develop/jobs/${jobId}/start${params}`);
    }
    /** POST /develop/jobs/{jobId}/stop — 停止作业 */
    async stopJob(jobId, taskId) {
        const qs = new URLSearchParams();
        if (taskId)
            qs.set('taskId', taskId);
        const params = qs.toString() ? `?${qs.toString()}` : '';
        return this.postRaw(`/develop/jobs/${jobId}/stop${params}`);
    }
    /** GET /develop/jobs/op/list — 查询作业列表 */
    async listJobs(opts) {
        return this.get('/develop/jobs/op/list', opts);
    }
    // =========================================================================
    // Jobs — scheduler
    // =========================================================================
    /** POST /develop/jobs/{jobId}/op/scheduler/start — 启用调度 */
    async enableJobSchedule(jobId) {
        return this.postRaw(`/develop/jobs/${jobId}/op/scheduler/start`);
    }
    /** POST /develop/jobs/{jobId}/op/scheduler/stop — 停用调度 */
    async disableJobSchedule(jobId) {
        return this.postRaw(`/develop/jobs/${jobId}/op/scheduler/stop`);
    }
    // =========================================================================
    // DagNodes & Tasks
    // =========================================================================
    /** GET /develop/jobs/{jobId}/dagNodes — 作业 dagNode 列表 */
    async listJobDagNodes(jobId, page, pageSize) {
        return this.get(`/develop/jobs/${jobId}/dagNodes`, { page: page ?? 1, pageSize: pageSize ?? 20 });
    }
    /** GET /develop/dagNodes/{dagNodeId} — dagNode 详情 */
    async getDagNodeDetail(dagNodeId) {
        return this.get(`/develop/dagNodes/${dagNodeId}`);
    }
    /** GET /develop/dagNodes/{dagNodeId}/tasks — dagNode 下的 task 实例列表 */
    async listDagNodeTasks(dagNodeId, page, pageSize) {
        return this.get(`/develop/dagNodes/${dagNodeId}/tasks`, { page: page ?? 1, pageSize: pageSize ?? 20 });
    }
    /** GET /develop/tasks/{taskId}/detail — 任务实例详情 */
    async getTaskDetail(taskId) {
        return this.get(`/develop/tasks/${taskId}/detail`);
    }
    /** GET /develop/tasks/{taskId}/log — 任务日志 */
    async getTaskLog(taskId) {
        return this.get(`/develop/tasks/${taskId}/log`);
    }
    // =========================================================================
    // Directory management
    // =========================================================================
    /** GET /develop/dir/view — 查看分组（目录树） */
    async viewDirs() {
        return this.get('/develop/dir/view');
    }
    /** POST /develop/dir/new — 新建分组 */
    async createDir(name, parentDirId) {
        const qs = new URLSearchParams();
        qs.set('name', name);
        if (parentDirId !== undefined)
            qs.set('parentDirId', String(parentDirId));
        return this.postRaw(`/develop/dir/new?${qs.toString()}`);
    }
    /** POST /develop/dir/move/batch/job — 批量移动作业到目录 */
    async moveJobsToDir(dirId, jobIds) {
        const qs = new URLSearchParams();
        qs.set('dirId', String(dirId));
        qs.set('jobIdArrStr', jobIds.join(','));
        return this.postRaw(`/develop/dir/move/batch/job?${qs.toString()}`);
    }
    // =========================================================================
    // Workspace
    // =========================================================================
    /** GET /workspace/info — 当前空间详情 */
    async getWorkspaceInfo() {
        return this.get('/workspace/info');
    }
    /** GET /workspace/token/detail — 获取当前 Token 信息（含 token 对应的用户名） */
    async getTokenDetail() {
        return this.get('/workspace/token/detail');
    }
    /** GET /common/workspace/detail — 获取空间基本信息（含 regionId/regionName） */
    async getWorkspaceDetail() {
        return this.get('/common/workspace/detail');
    }
    /** GET /common/region/list — 区域列表 */
    async listRegions() {
        return this.get('/common/region/list');
    }
    // =========================================================================
    // Internal HTTP helpers
    // =========================================================================
    async get(path, params) {
        const url = new URL(`${this.baseUrl}${path}`);
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined && v !== null)
                    url.searchParams.set(k, String(v));
            }
        }
        const resp = await fetch(url.toString(), {
            method: 'GET',
            headers: this.headers(),
        });
        return this.handleResponse(resp);
    }
    async post(path, body) {
        const url = `${this.baseUrl}${path}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return this.handleResponse(resp);
    }
    /** POST without body (for action endpoints like start/stop/delete) */
    async postRaw(path) {
        const url = `${this.baseUrl}${path}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: this.headers(),
        });
        return this.handleResponse(resp);
    }
    async put(path, body) {
        const url = `${this.baseUrl}${path}`;
        const resp = await fetch(url, {
            method: 'PUT',
            headers: { ...this.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return this.handleResponse(resp);
    }
    headers() {
        return { Authorization: `workspace-token/1.0 ${this.token}` };
    }
    async handleResponse(resp) {
        if (resp.status === 401 || resp.status === 403) {
            throw new KyuubiError(ErrorType.AUTH_ERROR, `OpenAPI auth failed (HTTP ${resp.status})`, {}, false);
        }
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new KyuubiError(ErrorType.SYSTEM_ERROR, `OpenAPI HTTP ${resp.status}: ${text}`, {}, false);
        }
        const json = await resp.json();
        // Auto-unwrap { status, code, msg, data } wrapper
        if (json && typeof json === 'object' && !Array.isArray(json) && ('status' in json || 'code' in json) && 'msg' in json) {
            const wrapped = json;
            const hasError = (wrapped.status !== undefined && wrapped.status !== 0) ||
                (wrapped.code !== undefined && wrapped.code !== 0);
            if (hasError) {
                throw new KyuubiError(ErrorType.SYSTEM_ERROR, `API Error: ${wrapped.msg || 'unknown'} (status: ${wrapped.status}, code: ${wrapped.code})`, { traceId: wrapped.traceId }, false);
            }
            return wrapped.data;
        }
        return json;
    }
}
