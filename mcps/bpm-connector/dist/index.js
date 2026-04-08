#!/usr/bin/env ts-node
/**
 * MCP Server: BPM Connector
 *
 * MiPaaS-BPM Open API connector for process and approval management.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ok(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function fail(msg) {
    return { content: [{ type: 'text', text: msg }], isError: true };
}
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function loadConfig(configPath = 'bpm-config.json') {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.domain || !parsed.appId || !parsed.appSecret) {
        throw new Error('Config must define domain, appId, and appSecret');
    }
    return parsed;
}
// ---------------------------------------------------------------------------
// BPM Client
// ---------------------------------------------------------------------------
class BpmClient {
    config;
    tokenInfo = null;
    constructor(config) {
        this.config = config;
    }
    async getToken() {
        if (this.tokenInfo && Date.now() < this.tokenInfo.expireTime) {
            return this.tokenInfo.token;
        }
        const resp = await fetch(`${this.config.domain}/runtime/api/v1/auth/open`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId: this.config.appId, appSecret: this.config.appSecret }),
        });
        if (!resp.ok) {
            throw new Error(`BPM auth HTTP error: ${resp.status} ${resp.statusText}`);
        }
        const json = await resp.json();
        if (!json.data?.token || !json.data?.expire) {
            throw new Error(json.message || 'BPM auth failed: no token returned');
        }
        this.tokenInfo = {
            token: json.data.token,
            expireTime: json.data.expire - 30 * 60 * 1000,
        };
        return this.tokenInfo.token;
    }
    async post(path, body) {
        const token = await this.getToken();
        const resp = await fetch(`${this.config.domain}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            throw new Error(`BPM API HTTP error: ${resp.status} ${resp.statusText}`);
        }
        const json = await resp.json();
        if (json.code !== 0) {
            throw new Error(json.message || `BPM API error: code ${json.code}`);
        }
        return json.data;
    }
    async get(path, params) {
        const token = await this.getToken();
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined)
                qs.set(k, v);
        }
        const url = `${this.config.domain}${path}?${qs.toString()}`;
        const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
            throw new Error(`BPM API HTTP error: ${resp.status} ${resp.statusText}`);
        }
        const json = await resp.json();
        if (json.code !== 0) {
            throw new Error(json.message || `BPM API error: code ${json.code}`);
        }
        return json.data;
    }
    // --- Process Instance APIs ---
    async createProcess(params) {
        return this.post('/runtime/openapi/v2/proc-insts/create', params);
    }
    async getProcess(businessKey) {
        return this.get('/runtime/openapi/v2/proc-insts/get', { businessKey });
    }
    async listProcessIds(params) {
        return this.post('/runtime/openapi/v2/proc-insts/list', params);
    }
    async terminateProcess(params) {
        return this.post('/runtime/openapi/v2/proc-insts/terminate', params);
    }
    async recallProcess(params) {
        const qs = new URLSearchParams();
        qs.set('businessKey', params.businessKey);
        qs.set('operator', params.operator);
        if (params.comment)
            qs.set('comment', params.comment);
        return this.post(`/runtime/openapi/v2/proc-insts/recall?${qs.toString()}`, {});
    }
    async listProcessHistory(params) {
        return this.get('/runtime/openapi/v2/proc-insts/history', params);
    }
    // --- Task APIs ---
    async getTaskHistory(businessKey, needPredict) {
        return this.get('/runtime/openapi/v2/task/history', {
            businessKey,
            needPredict: needPredict !== undefined ? String(needPredict) : undefined,
        });
    }
    async getCurrentTasks(businessKey) {
        return this.get('/runtime/openapi/v2/task/current', { businessKey });
    }
    async approveTask(params) {
        return this.post('/runtime/openapi/v2/task/approve', params);
    }
    async rejectTask(params) {
        return this.post('/runtime/openapi/v2/task/reject', params);
    }
    async transferTask(params) {
        return this.post('/runtime/openapi/v2/task/transfer', params);
    }
    async ccTask(params) {
        return this.post('/runtime/openapi/v2/task/cc', params);
    }
    async signTask(params) {
        return this.post('/runtime/openapi/v2/task/sign', params);
    }
    async submitTask(params) {
        return this.post('/runtime/openapi/v2/task/submit', params);
    }
    async getReturnActivities(taskId) {
        return this.get(`/runtime/openapi/v2/task/${taskId}/returns/activities`, {});
    }
    async returnTask(params) {
        return this.post('/runtime/openapi/v2/task/returns', params);
    }
    async delegateTask(params) {
        return this.post('/runtime/openapi/v2/task/delegate', params);
    }
    async getTaskDetailLink(businessKey, assignee) {
        return this.get('/runtime/openapi/v2/task/detail/link', { businessKey, assignee });
    }
    async receiveTask(params) {
        return this.post('/runtime/openapi/v2/task/receive', params);
    }
    async claimTask(params) {
        return this.post('/runtime/openapi/v2/task/claim', params);
    }
    // --- Form APIs ---
    async getFormDefinition(formDefinitionId, taskDefinitionKey) {
        return this.get('/runtime/openapi/v2/forms/definitions', {
            formDefinitionId,
            taskDefinitionKey,
        });
    }
    async getFormInstance(businessKey, taskDefinitionKey) {
        return this.get('/runtime/openapi/v2/forms/instances', {
            businessKey,
            taskDefinitionKey,
        });
    }
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const configArg = process.argv.indexOf('--config');
    const configPath = configArg !== -1 ? process.argv[configArg + 1] : undefined;
    const config = loadConfig(configPath);
    const client = new BpmClient(config);
    const server = new McpServer({ name: 'bpm', version: '1.0.0' });
    // =========================================================================
    // Process Instance Tools
    // =========================================================================
    server.tool('create_process', 'Create a new BPM approval process instance.', {
        model_code: z.string().describe('Process model code (e.g. bpmn_867817050974842880)'),
        start_user_id: z.string().describe('User ID of the process initiator'),
        form_data: z.record(z.unknown()).describe('Form data as key-value pairs'),
        business_key: z.string().optional().describe('Business key (auto-generated if omitted)'),
        process_instance_name: z.string().optional().describe('Process instance name'),
        variables: z.record(z.unknown()).optional().describe('Process variables'),
    }, async ({ model_code, start_user_id, form_data, business_key, process_instance_name, variables }) => {
        try {
            const data = await client.createProcess({
                modelCode: model_code, startUserId: start_user_id, formData: form_data,
                businessKey: business_key, processInstanceName: process_instance_name, variables,
            });
            return ok(data);
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('get_process', 'Get details of a single process instance by businessKey.', { business_key: z.string().describe('Business key of the process') }, async ({ business_key }) => {
        try {
            return ok(await client.getProcess(business_key));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('list_process_ids', 'Batch list process instance IDs by modelCode and time range (max 7 days).', {
        model_code: z.string().describe('Process model code'),
        page_num: z.number().describe('Page number'),
        page_size: z.number().describe('Page size'),
        start_time_begin: z.string().describe('Start time begin (unix ms timestamp)'),
        start_time_end: z.string().describe('Start time end (unix ms timestamp, max 7 days span)'),
    }, async ({ model_code, page_num, page_size, start_time_begin, start_time_end }) => {
        try {
            return ok(await client.listProcessIds({
                modelCode: model_code, pageNum: page_num, pageSize: page_size,
                startTimeBegin: start_time_begin, startTimeEnd: start_time_end,
            }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('list_process_history', 'Query process instance list with filters (pagination, status, time range).', {
        username: z.string().optional().describe('Process initiator'),
        model_code: z.string().optional().describe('Model code'),
        business_key: z.string().optional().describe('Business key'),
        process_instance_name: z.string().optional().describe('Process instance name'),
        status: z.enum(['COMPLETED', 'REJECTED', 'RUNNING', 'TERMINATED']).optional().describe('Process status'),
        create_time_start: z.string().optional().describe('Create time start (unix ms)'),
        create_time_end: z.string().optional().describe('Create time end (unix ms, max 7 days span)'),
        page_num: z.number().optional().describe('Page number'),
        page_size: z.number().optional().describe('Page size (max 10)'),
    }, async (params) => {
        try {
            return ok(await client.listProcessHistory({
                username: params.username, modelCode: params.model_code,
                businessKey: params.business_key, processInstanceName: params.process_instance_name,
                status: params.status, createTimeStart: params.create_time_start,
                createTimeEnd: params.create_time_end,
                pageNum: params.page_num?.toString(), pageSize: params.page_size?.toString(),
            }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('terminate_process', 'Terminate a running process instance. Only initiator or process admin can operate.', {
        business_key: z.string().describe('Business key'),
        operator: z.string().describe('Operator user ID (initiator or admin)'),
        comment: z.string().optional().describe('Comment'),
    }, async ({ business_key, operator, comment }) => {
        try {
            return ok(await client.terminateProcess({ businessKey: business_key, operator, comment }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('recall_process', 'Recall a process instance. Only initiator or process admin can operate.', {
        business_key: z.string().describe('Business key'),
        operator: z.string().describe('Operator user ID'),
        comment: z.string().optional().describe('Comment'),
    }, async ({ business_key, operator, comment }) => {
        try {
            return ok(await client.recallProcess({ businessKey: business_key, operator, comment }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    // =========================================================================
    // Task Tools
    // =========================================================================
    server.tool('get_task_history', 'Get approval history records for a process instance.', {
        business_key: z.string().describe('Business key'),
        need_predict: z.boolean().optional().describe('Include prediction results (for display only)'),
    }, async ({ business_key, need_predict }) => {
        try {
            return ok(await client.getTaskHistory(business_key, need_predict));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('get_current_tasks', 'Get current pending tasks and assignees for a process instance.', { business_key: z.string().describe('Business key') }, async ({ business_key }) => {
        try {
            return ok(await client.getCurrentTasks(business_key));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('approve_task', 'Approve (agree) a BPM task.', {
        task_id: z.string().describe('Task ID'),
        operator: z.string().describe('Approver user ID'),
        comment: z.string().optional().describe('Approval comment'),
        form_data: z.record(z.unknown()).optional().describe('Form data'),
        variables: z.record(z.unknown()).optional().describe('Process variables'),
    }, async ({ task_id, operator, comment, form_data, variables }) => {
        try {
            return ok(await client.approveTask({ taskId: task_id, operator, comment, formData: form_data, variables }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('reject_task', 'Reject a BPM task.', {
        task_id: z.string().describe('Task ID'),
        operator: z.string().describe('Rejector user ID'),
        comment: z.string().optional().describe('Rejection reason'),
    }, async ({ task_id, operator, comment }) => {
        try {
            return ok(await client.rejectTask({ taskId: task_id, operator, comment }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('transfer_task', 'Transfer a task to another user.', {
        task_id: z.string().describe('Task ID'),
        assignee: z.string().describe('Target user ID'),
        operator: z.string().describe('Operator user ID'),
        comment: z.string().optional().describe('Comment'),
        variables: z.record(z.unknown()).optional().describe('Process variables'),
    }, async ({ task_id, assignee, operator, comment, variables }) => {
        try {
            return ok(await client.transferTask({ taskId: task_id, assignee, operator, comment, variables }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('cc_task', 'Send a task as CC (carbon copy) to users.', {
        task_id: z.string().describe('Task ID'),
        assignee: z.array(z.string()).describe('CC target user IDs'),
        operator: z.string().describe('Operator user ID'),
        comment: z.string().optional().describe('Comment'),
    }, async ({ task_id, assignee, operator, comment }) => {
        try {
            return ok(await client.ccTask({ taskId: task_id, assignee, operator, comment }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('sign_task', 'Add co-signers to a task (before or after current approver).', {
        task_id: z.string().describe('Task ID'),
        assignee: z.array(z.string()).describe('Co-signer user IDs'),
        operator: z.string().describe('Operator user ID'),
        sign_type: z.enum(['signBefore', 'signAfter']).describe('Sign type: signBefore or signAfter'),
        comment: z.string().optional().describe('Comment'),
    }, async ({ task_id, assignee, operator, sign_type, comment }) => {
        try {
            return ok(await client.signTask({ taskId: task_id, assignee, operator, signType: sign_type, comment }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('submit_task', 'Resubmit a task (after return/sign back).', {
        task_id: z.string().describe('Task ID'),
        operator: z.string().describe('Operator user ID'),
        comment: z.string().optional().describe('Comment'),
        form_data: z.record(z.unknown()).optional().describe('Updated form data'),
        variables: z.record(z.unknown()).optional().describe('Process variables'),
    }, async ({ task_id, operator, comment, form_data, variables }) => {
        try {
            return ok(await client.submitTask({ taskId: task_id, operator, comment, formData: form_data, variables }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('get_return_activities', 'Get the list of activities a task can be returned to.', { task_id: z.string().describe('Task ID') }, async ({ task_id }) => {
        try {
            return ok(await client.getReturnActivities(task_id));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('return_task', 'Return a task to a previous activity node.', {
        task_id: z.string().describe('Task ID'),
        target_activity_id: z.string().describe('Target activity ID (from get_return_activities)'),
        operator: z.string().describe('Operator user ID'),
        comment: z.string().optional().describe('Comment'),
    }, async ({ task_id, target_activity_id, operator, comment }) => {
        try {
            return ok(await client.returnTask({ taskId: task_id, targetActivityId: target_activity_id, operator, comment }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('delegate_task', 'Delegate a task to another user.', {
        task_id: z.string().describe('Task ID'),
        assignee: z.string().describe('Delegate target user ID'),
        operator: z.string().describe('Operator user ID'),
        comment: z.string().optional().describe('Comment'),
        variables: z.record(z.unknown()).optional().describe('Process variables'),
    }, async ({ task_id, assignee, operator, comment, variables }) => {
        try {
            return ok(await client.delegateTask({ taskId: task_id, assignee, operator, comment, variables }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('get_task_detail_link', 'Get the approval task detail page URL.', {
        business_key: z.string().describe('Business key'),
        assignee: z.string().optional().describe('User ID to get the link for'),
    }, async ({ business_key, assignee }) => {
        try {
            return ok(await client.getTaskDetailLink(business_key, assignee));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('receive_task', 'Trigger a receive task to continue process flow.', {
        business_key: z.string().describe('Business key'),
        task_def_key: z.string().describe('Task definition key'),
        variables: z.record(z.unknown()).optional().describe('Process variables'),
    }, async ({ business_key, task_def_key, variables }) => {
        try {
            return ok(await client.receiveTask({ businessKey: business_key, taskDefKey: task_def_key, variables }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('claim_task', 'Claim a task (for competitive signing scenarios).', {
        task_id: z.string().describe('Task ID'),
        operator: z.string().describe('Operator user ID'),
    }, async ({ task_id, operator }) => {
        try {
            return ok(await client.claimTask({ taskId: task_id, operator }));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    // =========================================================================
    // Form Tools
    // =========================================================================
    server.tool('get_form_definition', 'Get form definition (UI schema) for a process.', {
        form_definition_id: z.string().describe('Form definition ID (or process definition ID for process forms)'),
        task_definition_key: z.string().optional().describe('Task definition key (for process forms)'),
    }, async ({ form_definition_id, task_definition_key }) => {
        try {
            return ok(await client.getFormDefinition(form_definition_id, task_definition_key));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    server.tool('get_form_instance', 'Get form instance data for a process instance.', {
        business_key: z.string().describe('Business key (or processInstanceId for process forms)'),
        task_definition_key: z.string().optional().describe('Task definition key'),
    }, async ({ business_key, task_definition_key }) => {
        try {
            return ok(await client.getFormInstance(business_key, task_definition_key));
        }
        catch (err) {
            return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
    // ---- Start ----
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error('Failed to start BPM MCP server:', err);
    process.exit(1);
});
