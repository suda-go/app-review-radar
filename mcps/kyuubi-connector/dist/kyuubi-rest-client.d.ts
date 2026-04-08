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
import { KyuubiRestClientOptions, KyuubiQueryResponse } from './kyuubi-types.js';
export declare class KyuubiRestClient {
    private readonly baseUrl;
    private readonly token;
    private engine;
    private readonly defaultTimeoutMs;
    private readonly pollIntervalMs;
    private catalog;
    private schema;
    constructor(options: KyuubiRestClientOptions);
    setCatalog(catalog: string): void;
    setEngine(engine: string): void;
    setSchema(schema: string): void;
    executeQuery(sql: string, catalog?: string, schema?: string, timeoutMs?: number, engine?: string): Promise<KyuubiQueryResponse>;
    testConnection(): Promise<boolean>;
    /**
     * Submit SQL without waiting — returns queryId immediately.
     * Use getQueryStatus() to poll, then fetchAllResults() when done.
     */
    submitQueryAsync(sql: string, catalog?: string, schema?: string, engine?: string): Promise<string>;
    /**
     * Check query status by queryId. Returns state + resultId when finished.
     */
    getQueryStatus(queryId: string): Promise<Record<string, unknown>>;
    /**
     * Fetch results for a completed query. Public wrapper.
     */
    fetchResults(queryId: string, timeoutMs?: number): Promise<KyuubiQueryResponse>;
    private submitQuery;
    private waitForCompletion;
    private fetchAllResults;
    private buildHeaders;
    private doFetch;
    private parseJson;
    private checkApiResponse;
    private sleep;
}
