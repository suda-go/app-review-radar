/**
 * Workspace-centric model:
 * - Each token represents one workspace
 * - Each workspace belongs to a region (auto-detected at startup)
 * - SQL queries route by region (catalog prefix)
 * - Job management uses the current active workspace's token
 */
export var QueryState;
(function (QueryState) {
    QueryState["QUEUED"] = "QUEUED";
    QueryState["RUNNING"] = "RUNNING";
    QueryState["FINISHED"] = "FINISHED";
    QueryState["FAILED"] = "FAILED";
    QueryState["CANCELLED"] = "CANCELLED";
})(QueryState || (QueryState = {}));
export var ErrorType;
(function (ErrorType) {
    ErrorType["AUTH_ERROR"] = "AUTH_ERROR";
    ErrorType["CONNECTION_ERROR"] = "CONNECTION_ERROR";
    ErrorType["QUERY_ERROR"] = "QUERY_ERROR";
    ErrorType["SYSTEM_ERROR"] = "SYSTEM_ERROR";
})(ErrorType || (ErrorType = {}));
export class KyuubiError extends Error {
    type;
    details;
    retryable;
    constructor(type, message, details = {}, retryable = false) {
        super(message);
        this.type = type;
        this.details = details;
        this.retryable = retryable;
        this.name = 'KyuubiError';
    }
}
