/**
 * Kyuubi / Mill Data Service REST Client
 *
 * Implements the Mill Data Service API v2:
 *   POST /olap/api/v2/statement/query         — submit SQL
 *   POST /olap/api/v2/statement/getStatusAndLog — poll status
 *   POST /olap/api/v2/statement/fetchResult    — fetch results
 *
 * Auth via custom headers: X-SqlProxy-User, X-SqlProxy-Engine,
 * X-SqlProxy-Catalog, X-SqlProxy-Schema.
 */
import { QueryState, ErrorType, KyuubiError, } from './kyuubi-types.js';
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const WAITING_MESSAGES = [
    '查询已提交，正在排队中…',
    '您别着急，我已经在尽力了 🏃',
    '还在跑，数据量可能比较大…',
    '仍在努力查询中，请耐心等待 ☕',
    '快了快了，再给我一点时间…',
    '数据正在路上，马上就到 🚀',
    '还没跑完，但我不会放弃的 💪',
];
export class KyuubiRestClient {
    baseUrl;
    token;
    engine;
    defaultTimeoutMs;
    pollIntervalMs;
    catalog = '';
    schema = '';
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.token = options.token;
        this.engine = options.engine ?? 'auto';
        this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    }
    setCatalog(catalog) {
        this.catalog = catalog;
    }
    setEngine(engine) {
        this.engine = engine;
    }
    setSchema(schema) {
        this.schema = schema;
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    async executeQuery(sql, catalog, schema, timeoutMs, engine) {
        if (catalog)
            this.setCatalog(catalog);
        if (schema)
            this.setSchema(schema);
        if (engine)
            this.setEngine(engine);
        const queryId = await this.submitQuery(sql, timeoutMs);
        const { resultId, waitMessages } = await this.waitForCompletion(queryId, timeoutMs);
        const result = await this.fetchAllResults(resultId, timeoutMs);
        if (waitMessages.length > 0) {
            result.waitMessages = waitMessages;
        }
        return result;
    }
    async testConnection() {
        try {
            await this.executeQuery('SELECT 1');
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Submit SQL without waiting — returns queryId immediately.
     * Use getQueryStatus() to poll, then fetchAllResults() when done.
     */
    async submitQueryAsync(sql, catalog, schema, engine) {
        if (catalog)
            this.setCatalog(catalog);
        if (schema)
            this.setSchema(schema);
        if (engine)
            this.setEngine(engine);
        return this.submitQuery(sql);
    }
    /**
     * Check query status by queryId. Returns state + resultId when finished.
     */
    async getQueryStatus(queryId) {
        const url = `${this.baseUrl}/olap/api/v2/statement/getStatusAndLog`;
        const response = await this.doFetch(url, {
            method: 'POST',
            headers: this.buildHeaders(),
            params: { queryId },
            timeoutMs: 60_000,
        });
        const body = await this.parseJson(response);
        this.checkApiResponse(body);
        const data = body?.data ?? {};
        const state = data.state;
        const nextId = data.nextQueryId;
        const exceptionMsg = (data.exceptionMsg || data.simpleExceptionMsg || '');
        const progress = data.progress;
        if (state === QueryState.FINISHED) {
            return { state, resultId: nextId || queryId, progress: '100%' };
        }
        else if (state === QueryState.FAILED) {
            return { state, error: exceptionMsg || 'unknown error' };
        }
        else if (state === QueryState.CANCELLED) {
            return { state, error: 'Query was cancelled' };
        }
        const result = { state };
        if (progress)
            result.progress = progress;
        if (data.start)
            result.startTime = data.start;
        if (data.logger)
            result.log = typeof data.logger === 'string' ? data.logger.slice(-1000) : data.logger;
        return result;
    }
    /**
     * Fetch results for a completed query. Public wrapper.
     */
    async fetchResults(queryId, timeoutMs) {
        return this.fetchAllResults(queryId, timeoutMs);
    }
    // ---------------------------------------------------------------------------
    // Step 1: Submit query
    // ---------------------------------------------------------------------------
    async submitQuery(sql, timeoutMs) {
        const timeout = timeoutMs ?? this.defaultTimeoutMs;
        const url = `${this.baseUrl}/olap/api/v2/statement/query`;
        const response = await this.doFetch(url, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: sql,
            timeoutMs: timeout,
        });
        const body = await this.parseJson(response);
        this.checkApiResponse(body);
        const queryId = body?.data?.queryId;
        if (!queryId) {
            throw new KyuubiError(ErrorType.QUERY_ERROR, 'No query ID returned from server', { responseBody: JSON.stringify(body) }, false);
        }
        return queryId;
    }
    // ---------------------------------------------------------------------------
    // Step 2: Poll for completion
    // ---------------------------------------------------------------------------
    async waitForCompletion(queryId, timeoutMs) {
        const url = `${this.baseUrl}/olap/api/v2/statement/getStatusAndLog`;
        let currentId = queryId;
        const overallTimeout = timeoutMs ?? this.defaultTimeoutMs;
        const perRequestTimeout = Math.min(overallTimeout, 60_000);
        const overallDeadline = Date.now() + overallTimeout;
        const waitMessages = [];
        let pollCount = 0;
        let lastMsgIndex = -1;
        while (true) {
            if (Date.now() > overallDeadline) {
                throw new KyuubiError(ErrorType.CONNECTION_ERROR, `查询超时了（已等待 ${Math.round(overallTimeout / 1000)} 秒），queryId: ${currentId}`, { queryId: currentId }, true);
            }
            const response = await this.doFetch(url, {
                method: 'POST',
                headers: this.buildHeaders(),
                params: { queryId: currentId },
                timeoutMs: perRequestTimeout,
            });
            const body = await this.parseJson(response);
            this.checkApiResponse(body);
            const data = body?.data ?? {};
            const state = data.state;
            const nextId = data.nextQueryId;
            const exceptionMsg = (data.exceptionMsg || data.simpleExceptionMsg || '');
            if (state === QueryState.FINISHED) {
                return { resultId: nextId || currentId, waitMessages };
            }
            else if (state === QueryState.FAILED) {
                throw new KyuubiError(ErrorType.QUERY_ERROR, `Query failed: ${exceptionMsg || 'unknown error'}`, { queryId: currentId, state }, false);
            }
            else if (state === QueryState.CANCELLED) {
                throw new KyuubiError(ErrorType.QUERY_ERROR, 'Query was cancelled', { queryId: currentId, state }, false);
            }
            else if (state === QueryState.QUEUED || state === QueryState.RUNNING) {
                pollCount++;
                // 每 5 次 poll（约 10 秒）输出一条等待提示
                if (pollCount % 5 === 0) {
                    lastMsgIndex = (lastMsgIndex + 1) % WAITING_MESSAGES.length;
                    const elapsed = Math.round((Date.now() + overallTimeout - overallDeadline) / 1000);
                    const msg = `[${elapsed}s] ${WAITING_MESSAGES[lastMsgIndex]}`;
                    waitMessages.push(msg);
                    console.error(msg); // stderr 不影响 MCP stdout
                }
                if (nextId)
                    currentId = nextId;
                await this.sleep(this.pollIntervalMs);
            }
            else {
                throw new KyuubiError(ErrorType.QUERY_ERROR, `Unknown query state: ${state}`, { queryId: currentId, state, exceptionMsg }, false);
            }
        }
    }
    // ---------------------------------------------------------------------------
    // Step 3: Fetch results (paginated)
    // ---------------------------------------------------------------------------
    async fetchAllResults(queryId, timeoutMs) {
        const url = `${this.baseUrl}/olap/api/v2/statement/fetchResult`;
        let currentId = queryId;
        const allColumns = [];
        const allRows = [];
        let lastState = QueryState.FINISHED;
        while (currentId) {
            const response = await this.doFetch(url, {
                method: 'POST',
                headers: this.buildHeaders(),
                params: { queryId: currentId },
                timeoutMs: timeoutMs ?? this.defaultTimeoutMs,
            });
            const body = await this.parseJson(response);
            this.checkApiResponse(body);
            const data = body?.data ?? {};
            if (allColumns.length === 0 && Array.isArray(data.columns)) {
                for (const col of data.columns) {
                    allColumns.push({
                        name: col.name ?? '',
                        type: col.type ?? '',
                        comment: col.comment ?? '',
                    });
                }
            }
            if (Array.isArray(data.rows)) {
                allRows.push(...data.rows);
            }
            lastState = data.state ?? QueryState.FINISHED;
            currentId = data.nextResultQueryId;
        }
        return {
            columns: allColumns,
            rows: allRows,
            state: lastState,
            queryId,
        };
    }
    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------
    buildHeaders() {
        const headers = {
            'X-SqlProxy-User': this.token,
            'X-SqlProxy-Engine': this.engine,
            'Content-Type': 'text/plain;charset=utf-8',
        };
        if (this.catalog)
            headers['X-SqlProxy-Catalog'] = this.catalog;
        if (this.schema)
            headers['X-SqlProxy-Schema'] = this.schema;
        return headers;
    }
    async doFetch(url, opts) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
        let fullUrl = url;
        if (opts.params) {
            const qs = new URLSearchParams(opts.params).toString();
            fullUrl = `${url}?${qs}`;
        }
        try {
            const response = await fetch(fullUrl, {
                method: opts.method,
                headers: opts.headers,
                body: opts.body,
                signal: controller.signal,
            });
            if (response.status === 401) {
                throw new KyuubiError(ErrorType.AUTH_ERROR, 'Authentication failed: invalid token (HTTP 401)', { status: 401 }, false);
            }
            if (response.status === 403) {
                throw new KyuubiError(ErrorType.AUTH_ERROR, 'Authentication failed: token expired (HTTP 403)', { status: 403 }, false);
            }
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new KyuubiError(ErrorType.SYSTEM_ERROR, `HTTP ${response.status}: ${text}`, { status: response.status, body: text }, false);
            }
            return response;
        }
        catch (error) {
            if (error instanceof KyuubiError)
                throw error;
            if (error instanceof DOMException || (error instanceof Error && error.name === 'AbortError')) {
                throw new KyuubiError(ErrorType.CONNECTION_ERROR, `Connection timeout after ${opts.timeoutMs}ms`, { timeoutMs: opts.timeoutMs }, true);
            }
            throw new KyuubiError(ErrorType.CONNECTION_ERROR, `Failed to connect: ${error.message}`, { originalError: error.message }, true);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async parseJson(response) {
        try {
            return await response.json();
        }
        catch (e) {
            throw new KyuubiError(ErrorType.SYSTEM_ERROR, `Invalid JSON response: ${e.message}`, {}, false);
        }
    }
    checkApiResponse(body) {
        const meta = body?.meta ?? {};
        const errCode = meta.errCode ?? 0;
        const errMsg = meta.errMsg ?? '';
        if (errCode !== 0) {
            throw new KyuubiError(ErrorType.QUERY_ERROR, `API Error ${errCode}: ${errMsg}`, { errCode, errMsg }, false);
        }
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
