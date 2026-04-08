/**
 * Workspace-centric model:
 * - Each token represents one workspace
 * - Each workspace belongs to a region (auto-detected at startup)
 * - SQL queries route by region (catalog prefix)
 * - Job management uses the current active workspace's token
 */
/** Resolved workspace info (populated at startup via API) */
export interface WorkspaceInfo {
    /** Workspace ID (from API) */
    id: number;
    /** Workspace display name (from API) */
    name: string;
    /** Workspace description (from API), e.g. "互联网国际数据业务-新加坡" */
    description: string;
    /** Workspace owner username (from API) */
    owner: string;
    /** Current token's user (from /workspace/token/detail) */
    tokenUser: string;
    /** Region name: singapore / russia / netherlands / india */
    regionName: string;
    /** The workspace token */
    token: string;
    /** Region's SQL proxy base URL */
    baseUrl: string;
    /** Catalog prefix for auto-routing, e.g. "alsgprc" */
    catalogPrefix: string;
}
/** Built-in region definition */
export interface BuiltinRegion {
    baseUrl: string;
    catalogPrefix: string;
}
/** Runtime config after loading + resolving */
export interface ResolvedConfig {
    /** All workspaces (key = workspace name) */
    workspaces: Map<string, WorkspaceInfo>;
    /** Region → list of workspace names (first is used for SQL) */
    regionWorkspaces: Map<string, string[]>;
    /** Current active workspace name */
    currentWorkspace: string;
    /** OpenAPI base URL */
    openapiBaseUrl: string;
    timeoutSeconds: number;
    pollIntervalSeconds: number;
}
export interface KyuubiRestClientOptions {
    baseUrl: string;
    token: string;
    engine?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
}
export interface KyuubiColumnInfo {
    name: string;
    type: string;
    comment?: string;
}
export interface KyuubiQueryResponse {
    columns: KyuubiColumnInfo[];
    rows: unknown[][];
    state: string;
    queryId: string;
    waitMessages?: string[];
}
export declare enum QueryState {
    QUEUED = "QUEUED",
    RUNNING = "RUNNING",
    FINISHED = "FINISHED",
    FAILED = "FAILED",
    CANCELLED = "CANCELLED"
}
export declare enum ErrorType {
    AUTH_ERROR = "AUTH_ERROR",
    CONNECTION_ERROR = "CONNECTION_ERROR",
    QUERY_ERROR = "QUERY_ERROR",
    SYSTEM_ERROR = "SYSTEM_ERROR"
}
export declare class KyuubiError extends Error {
    readonly type: ErrorType;
    readonly details: Record<string, unknown>;
    readonly retryable: boolean;
    constructor(type: ErrorType, message: string, details?: Record<string, unknown>, retryable?: boolean);
}
