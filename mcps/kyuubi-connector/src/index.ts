#!/usr/bin/env node
/**
 * Kyuubi MCP Server — Multi-region data query service
 *
 * Supports SQL queries via Kyuubi REST API and metadata/lineage via Data Factory OpenAPI.
 * Workspace-centric: each token = one workspace, auto-detected region at startup.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
import { KyuubiRestClient } from './kyuubi-rest-client.js';
import { OpenApiClient } from './openapi-client.js';
import {
  WorkspaceInfo,
  BuiltinRegion,
  ResolvedConfig,
  KyuubiError,
  ErrorType,
} from './kyuubi-types.js';

// ---------------------------------------------------------------------------
// Built-in region definitions
// ---------------------------------------------------------------------------

const BUILTIN_REGIONS: Record<string, BuiltinRegion> = {
  singapore: { baseUrl: 'http://proxy-service-http-alisgp0-dp.api.xiaomi.net', catalogPrefix: 'alsgprc' },
  russia:    { baseUrl: 'http://proxy-service-http-ksyru0-dp.api.xiaomi.net', catalogPrefix: 'ksmosprc' },
  netherlands: { baseUrl: 'http://proxy-service-http-azamsprc0-dp.api.xiaomi.net', catalogPrefix: 'azamsprc' },
  india:     { baseUrl: 'http://proxy-service-http-azpnprc-dp.api.xiaomi.net', catalogPrefix: 'azpnprc' },
  beijing:   { baseUrl: 'http://proxy-service-http-cnbj1-dp.api.xiaomi.net', catalogPrefix: 'zjyprc' },
};

const OPENAPI_BASE_URL = 'https://api-gateway.dp.pt.xiaomi.com/openapi';

/** Map catalogPrefix → regionName */
const PREFIX_TO_REGION = new Map<string, string>();
for (const [name, r] of Object.entries(BUILTIN_REGIONS)) {
  PREFIX_TO_REGION.set(r.catalogPrefix, name);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

/**
 * Parse a fully-qualified table name: catalog.schema.table
 * Returns { catalog, schema, table } or throws.
 */
function parseTableName(fullName: string): { catalog: string; schema: string; table: string } {
  const parts = fullName.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid table name "${fullName}". Expected format: catalog.schema.table`);
  }
  return { catalog: parts[0], schema: parts[1], table: parts[2] };
}

/**
 * Detect region from catalog name by matching known prefixes.
 */
function detectRegion(catalog: string): string | undefined {
  for (const [prefix, region] of PREFIX_TO_REGION) {
    if (catalog.includes(prefix)) return region;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

interface RawConfig {
  tokens?: string[] | Record<string, string | string[]>;
  regions?: Record<string, { baseUrl: string; token: string | string[]; catalogPrefix: string }>;
  defaultRegion?: string;
  timeoutSeconds?: number;
  pollIntervalSeconds?: number;
}

/**
 * Resolve a single token: call /workspace/info to get id/name/description,
 * then /metadata/catalog/list to detect region from catalog prefixes.
 */
async function resolveToken(
  openapi: OpenApiClient,
  token: string,
): Promise<{ id: number; name: string; description: string; owner: string; tokenUser: string; regionName: string }> {
  openapi.setToken(token);

  let id = 0, name = 'unknown', description = '', owner = '', tokenUser = '';
  try {
    const info = await openapi.getWorkspaceInfo();
    id = info.id;
    name = info.workspaceName || `workspace-${id}`;
    description = info.description || '';
    owner = info.owner || '';
  } catch { /* fallback */ }

  // Get the actual user behind this token
  try {
    const tokenDetail = await openapi.getTokenDetail();
    tokenUser = tokenDetail.user || '';
  } catch { /* fallback to owner */ }
  if (!tokenUser) tokenUser = owner;

  // Detect region from catalogs
  let regionName = 'unknown';
  // First try description
  const desc = description.toLowerCase();
  if (desc.includes('新加坡') || desc.includes('singapore')) regionName = 'singapore';
  else if (desc.includes('俄罗斯') || desc.includes('russia') || desc.includes('moscow')) regionName = 'russia';
  else if (desc.includes('荷兰') || desc.includes('netherlands') || desc.includes('amsterdam')) regionName = 'netherlands';
  else if (desc.includes('印度') || desc.includes('india') || desc.includes('pune')) regionName = 'india';
  else if (desc.includes('北京') || desc.includes('beijing') || desc.includes('zjy')) regionName = 'beijing';

  // If still unknown, check catalog list
  if (regionName === 'unknown') {
    try {
      const catalogs = await openapi.listCatalogs();
      if (Array.isArray(catalogs)) {
        for (const cat of catalogs) {
          // API may return strings or objects with catalogName/name
          const catName = typeof cat === 'string' ? cat : ((cat as any).catalogName || (cat as any).name || '');
          const detected = detectRegion(catName);
          if (detected) { regionName = detected; break; }
        }
      }
    } catch { /* fallback */ }
  }

  return { id, name, description, owner, tokenUser, regionName };
}

async function loadAndResolveConfig(configPath: string): Promise<ResolvedConfig> {
  const raw: RawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const timeoutSeconds = raw.timeoutSeconds ?? 600;
  const pollIntervalSeconds = raw.pollIntervalSeconds ?? 2;

  const workspaces = new Map<string, WorkspaceInfo>();
  const regionWorkspaces = new Map<string, string[]>();

  const openapi = new OpenApiClient({ baseUrl: OPENAPI_BASE_URL });

  // Collect all tokens to resolve
  const allTokens: Array<{ token: string; hintRegion?: string; hintBaseUrl?: string; hintPrefix?: string }> = [];

  if (raw.tokens) {
    if (Array.isArray(raw.tokens)) {
      for (const t of raw.tokens) allTokens.push({ token: t });
    } else {
      for (const [prefix, tokenOrArr] of Object.entries(raw.tokens)) {
        const tokens = Array.isArray(tokenOrArr) ? tokenOrArr : [tokenOrArr];
        const regionName = PREFIX_TO_REGION.get(prefix);
        const region = regionName ? BUILTIN_REGIONS[regionName] : undefined;
        for (const t of tokens) {
          allTokens.push({
            token: t,
            hintRegion: regionName,
            hintBaseUrl: region?.baseUrl,
            hintPrefix: region?.catalogPrefix,
          });
        }
      }
    }
  }

  if (raw.regions) {
    for (const [regionName, regionDef] of Object.entries(raw.regions)) {
      const tokens = Array.isArray(regionDef.token) ? regionDef.token : [regionDef.token];
      for (const t of tokens) {
        allTokens.push({
          token: t,
          hintRegion: regionName,
          hintBaseUrl: regionDef.baseUrl,
          hintPrefix: regionDef.catalogPrefix,
        });
      }
    }
  }

  // Resolve all tokens sequentially (shared OpenApiClient, token must not overlap)
  const resolved: Array<{
    id: number; name: string; description: string; owner: string; tokenUser: string; regionName: string;
    token: string; baseUrl: string; catalogPrefix: string;
  }> = [];
  for (const { token, hintRegion, hintBaseUrl, hintPrefix } of allTokens) {
    const r = await resolveToken(openapi, token);
    const regionName = hintRegion || r.regionName;
    const region = BUILTIN_REGIONS[regionName];
    resolved.push({
      ...r,
      regionName,
      token,
      baseUrl: hintBaseUrl || region?.baseUrl || BUILTIN_REGIONS.singapore.baseUrl,
      catalogPrefix: hintPrefix || region?.catalogPrefix || 'alsgprc',
    });
  }

  for (const r of resolved) {
    // Use "id" as map key to avoid same-name collisions
    const wsKey = String(r.id || r.token.slice(0, 8));
    const info: WorkspaceInfo = {
      id: r.id,
      name: r.name,
      description: r.description,
      owner: r.owner,
      tokenUser: r.tokenUser,
      regionName: r.regionName,
      token: r.token,
      baseUrl: r.baseUrl,
      catalogPrefix: r.catalogPrefix,
    };
    workspaces.set(wsKey, info);
    const list = regionWorkspaces.get(r.regionName) || [];
    list.push(wsKey);
    regionWorkspaces.set(r.regionName, list);
    console.error(`[kyuubi-mcp]   #${resolved.indexOf(r)} id=${r.id} region=${r.regionName} user=${r.tokenUser} "${r.name}" ${r.description ? '(' + r.description + ')' : ''}`);
  }

  // Determine default workspace
  let currentWorkspace = '';
  if (raw.defaultRegion && regionWorkspaces.has(raw.defaultRegion)) {
    currentWorkspace = regionWorkspaces.get(raw.defaultRegion)![0];
  } else {
    currentWorkspace = workspaces.keys().next().value || '';
  }

  return {
    workspaces,
    regionWorkspaces,
    currentWorkspace,
    openapiBaseUrl: OPENAPI_BASE_URL,
    timeoutSeconds,
    pollIntervalSeconds,
  };
}

// ---------------------------------------------------------------------------
// Get client for a region (auto-route by catalog)
// ---------------------------------------------------------------------------

function getClientForCatalog(
  config: ResolvedConfig,
  catalog: string,
): { client: KyuubiRestClient; workspace: WorkspaceInfo } {
  const regionName = detectRegion(catalog);
  if (!regionName) {
    throw new Error(`Cannot detect region for catalog "${catalog}". Known prefixes: ${[...PREFIX_TO_REGION.keys()].join(', ')}`);
  }
  const wsNames = config.regionWorkspaces.get(regionName);
  if (!wsNames || wsNames.length === 0) {
    throw new Error(`No workspace configured for region "${regionName}"`);
  }
  // Prefer the current workspace if it belongs to this region
  let wsKey = wsNames[0];
  if (wsNames.includes(config.currentWorkspace)) {
    wsKey = config.currentWorkspace;
  }
  const ws = config.workspaces.get(wsKey)!;
  const client = new KyuubiRestClient({
    baseUrl: ws.baseUrl,
    token: ws.token,
    timeoutMs: config.timeoutSeconds * 1000,
    pollIntervalMs: config.pollIntervalSeconds * 1000,
  });
  return { client, workspace: ws };
}

function getCurrentWorkspace(config: ResolvedConfig): WorkspaceInfo {
  const ws = config.workspaces.get(config.currentWorkspace);
  if (!ws) throw new Error('No active workspace');
  return ws;
}

function getOpenApiClient(config: ResolvedConfig, token?: string): OpenApiClient {
  const client = new OpenApiClient({ baseUrl: config.openapiBaseUrl });
  client.setToken(token || getCurrentWorkspace(config).token);
  return client;
}

/**
 * Get OpenAPI client for a specific workspace_id, or current workspace if not specified.
 */
function getClientForWorkspace(config: ResolvedConfig, workspaceId?: number): OpenApiClient {
  if (workspaceId !== undefined) {
    const key = String(workspaceId);
    const ws = config.workspaces.get(key);
    if (!ws) {
      const available = [...config.workspaces.values()].map(w => `${w.id} (${w.name} - ${w.description || w.regionName})`);
      throw new Error(`Unknown workspace_id ${workspaceId}. Available:\n${available.join('\n')}`);
    }
    return getOpenApiClient(config, ws.token);
  }
  return getOpenApiClient(config);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const configArg = process.argv.indexOf('--config');
  const configPath = configArg !== -1 ? process.argv[configArg + 1] : 'kyuubi-config.json';

  console.error('[kyuubi-mcp] Loading config from', configPath);
  const config = await loadAndResolveConfig(configPath);
  console.error(`[kyuubi-mcp] Loaded ${config.workspaces.size} workspace(s), active: ${config.currentWorkspace}`);

  const server = new McpServer({ name: 'kyuubi', version: '1.0.0' });

  // =========================================================================
  // Region management
  // =========================================================================

  server.tool(
    'list_regions',
    '列出所有已配置的区域及工作空间（含 ID、描述，方便区分同区域多空间）',
    {},
    async () => {
      const regions: Record<string, unknown[]> = {};
      for (const [regionName, wsKeys] of config.regionWorkspaces) {
        regions[regionName] = wsKeys.map((key, i) => {
          const ws = config.workspaces.get(key)!;
          return {
            workspaceId: ws.id,
            workspaceName: ws.name,
            description: ws.description,
            tokenUser: ws.tokenUser,
            catalogPrefix: ws.catalogPrefix,
            isCurrent: key === config.currentWorkspace,
            tokenIndex: i,
          };
        });
      }
      const cur = config.workspaces.get(config.currentWorkspace);
      return ok({
        regions,
        currentWorkspace: cur ? { id: cur.id, name: cur.name, description: cur.description, region: cur.regionName } : config.currentWorkspace,
      });
    },
  );

  server.tool(
    'switch_region',
    '切换当前活跃工作空间。可按 region + token_index，或直接按 workspace_id 切换',
    {
      region: z.string().optional().describe('Region name: singapore / russia / netherlands / india'),
      token_index: z.number().optional().describe('Token index within the region (default: 0)'),
      workspace_id: z.number().optional().describe('Directly switch by workspace ID (overrides region/token_index)'),
    },
    async ({ region, token_index, workspace_id }) => {
      // Switch by workspace_id
      if (workspace_id !== undefined) {
        const key = String(workspace_id);
        const ws = config.workspaces.get(key);
        if (!ws) {
          const available = [...config.workspaces.values()].map(w => `${w.id} (${w.name} - ${w.description || w.regionName})`);
          return fail(`Unknown workspace_id ${workspace_id}. Available:\n${available.join('\n')}`);
        }
        config.currentWorkspace = key;
        return ok({ message: `Switched to workspace ${ws.id}: ${ws.name}`, workspace: { id: ws.id, name: ws.name, description: ws.description, region: ws.regionName } });
      }

      // Switch by region + token_index
      if (!region) {
        return fail('Please provide either region or workspace_id');
      }
      const wsKeys = config.regionWorkspaces.get(region);
      if (!wsKeys || wsKeys.length === 0) {
        return fail(`Unknown region "${region}". Available: ${[...config.regionWorkspaces.keys()].join(', ')}`);
      }
      const idx = token_index ?? 0;
      if (idx < 0 || idx >= wsKeys.length) {
        return fail(`Invalid token_index ${idx}. Region "${region}" has ${wsKeys.length} workspace(s).`);
      }
      config.currentWorkspace = wsKeys[idx];
      const ws = config.workspaces.get(config.currentWorkspace)!;
      return ok({ message: `Switched to ${ws.name} (${region}, index ${idx})`, workspace: { id: ws.id, name: ws.name, description: ws.description, region: ws.regionName } });
    },
  );

  // =========================================================================
  // SQL — Synchronous (Kyuubi REST API)
  // =========================================================================

  server.tool(
    'list_tables',
    '列出指定 catalog.schema 下的表',
    {
      catalog: z.string().describe('Catalog name, e.g. iceberg_alsgprc_hadoop'),
      schema: z.string().describe('Schema/database name'),
    },
    async ({ catalog, schema }) => {
      try {
        const { client } = getClientForCatalog(config, catalog);
        const result = await client.executeQuery(`SHOW TABLES FROM ${catalog}.${schema}`, catalog, schema);
        const tables = result.rows.map(r => r[0]);
        return ok({ catalog, schema, tables, count: tables.length });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'describe_table',
    '查看表的列名和类型。支持全名 catalog.schema.table',
    {
      table: z.string().describe('Full table name: catalog.schema.table'),
    },
    async ({ table }) => {
      try {
        const { catalog, schema, table: tableName } = parseTableName(table);
        const { client } = getClientForCatalog(config, catalog);
        const result = await client.executeQuery(
          `DESCRIBE ${catalog}.${schema}.${tableName}`,
          catalog, schema,
        );
        const columns = result.rows.map(r => ({
          name: r[0], type: r[1], comment: r[2] || '',
        }));
        return ok({ table, columns, count: columns.length });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'execute_query',
    '执行只读 SQL（SELECT/SHOW），同步等待结果返回，10 分钟超时',
    {
      sql: z.string().describe('SQL query (SELECT/SHOW only)'),
      catalog: z.string().optional().describe('Catalog (auto-detected from SQL if omitted)'),
      schema: z.string().optional().describe('Schema/database'),
      max_rows: z.number().optional().describe('Max rows to return (default: 100)'),
      engine: z.enum(['auto', 'trino', 'spark']).optional().describe('查询引擎: auto(默认) / trino / spark'),
    },
    async ({ sql, catalog, schema, max_rows, engine }) => {
      // Block write operations
      if (/\b(DROP|DELETE|TRUNCATE|ALTER|INSERT|UPDATE|CREATE)\b/i.test(sql)) {
        return fail('Only read-only queries (SELECT/SHOW/DESCRIBE) are allowed.');
      }
      try {
        // Auto-detect catalog from SQL if not provided
        let effectiveCatalog = catalog || '';
        if (!effectiveCatalog) {
          const match = sql.match(/(?:FROM|JOIN|TABLE)\s+(\w+)\.\w+\.\w+/i);
          if (match) effectiveCatalog = match[1];
        }
        if (!effectiveCatalog) {
          // Use current workspace's catalog
          effectiveCatalog = getCurrentWorkspace(config).catalogPrefix;
        }

        const { client, workspace } = getClientForCatalog(config, effectiveCatalog);

        const result = await client.executeQuery(sql, effectiveCatalog, schema, undefined, engine);
        return ok({
          region: workspace.regionName,
          workspace: workspace.name,
          columns: result.columns,
          rowCount: result.rows.length,
          rows: result.rows,
          queryId: result.queryId,
          ...(result.waitMessages?.length ? { waitMessages: result.waitMessages } : {}),
        });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // =========================================================================
  // DDL — CREATE TABLE etc.
  // =========================================================================

  server.tool(
    'execute_ddl',
    '执行 DDL 语句（CREATE TABLE / ALTER TABLE / DROP TABLE / CREATE TABLE AS SELECT）。CTAS 自动走异步提交',
    {
      sql: z.string().describe('DDL statement (CREATE TABLE, ALTER TABLE, DROP TABLE, CTAS)'),
      catalog: z.string().optional().describe('Catalog (auto-detected from SQL if omitted)'),
      schema: z.string().optional().describe('Schema/database'),
    },
    async ({ sql, catalog, schema }) => {
      const normalized = sql.trim().toUpperCase();
      // Only allow DDL statements and INSERT INTO
      if (!/^(CREATE|ALTER|DROP|INSERT)\b/.test(normalized)) {
        return fail('execute_ddl only supports CREATE, ALTER, DROP, and INSERT statements. Use execute_query for SELECT/SHOW.');
      }
      // Block standalone DML except INSERT (but allow SELECT inside CTAS)
      const isCTAS = /^CREATE\s+TABLE\b.*\bAS\s+SELECT\b/is.test(sql.trim());
      const isInsert = /^INSERT\b/i.test(sql.trim());
      if (!isCTAS && !isInsert && /\b(UPDATE|DELETE|TRUNCATE)\b/i.test(sql)) {
        return fail('UPDATE/DELETE/TRUNCATE statements are not allowed in execute_ddl.');
      }
      try {
        let effectiveCatalog = catalog || '';
        if (!effectiveCatalog) {
          // Match catalog from table name in DDL, INSERT INTO, or CTAS source
          const match = sql.match(/(?:TABLE|DATABASE|SCHEMA|INTO)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(\w+)\.\w+\.\w+/i);
          if (match) effectiveCatalog = match[1];
        }
        if (!effectiveCatalog) {
          effectiveCatalog = getCurrentWorkspace(config).catalogPrefix;
        }

        const { client, workspace } = getClientForCatalog(config, effectiveCatalog);

        // CTAS and INSERT can be long-running, use async submission
        if (isCTAS || isInsert) {
          const queryId = await client.submitQueryAsync(sql, effectiveCatalog, schema);
          return ok({
            region: workspace.regionName,
            workspace: workspace.name,
            queryId,
            message: `${isInsert ? 'INSERT' : 'CTAS'} 已异步提交，使用 check_query 查看进度`,
          });
        }

        const result = await client.executeQuery(sql, effectiveCatalog, schema);
        return ok({
          region: workspace.regionName,
          workspace: workspace.name,
          message: 'DDL executed successfully',
          columns: result.columns,
          rows: result.rows,
          queryId: result.queryId,
        });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // =========================================================================
  // SQL — Async (for long-running queries)
  // =========================================================================

  server.tool(
    'submit_query',
    '异步提交 SQL 查询，立刻返回 queryId。适合长查询',
    {
      sql: z.string().describe('SQL query'),
      catalog: z.string().optional().describe('Catalog (auto-detected if omitted)'),
      schema: z.string().optional().describe('Schema/database'),
      engine: z.enum(['auto', 'trino', 'spark']).optional().describe('查询引擎: auto / trino / spark（默认 spark，异步查询推荐用 spark）'),
    },
    async ({ sql, catalog, schema, engine }) => {
      if (/\b(DROP|DELETE|TRUNCATE|ALTER|INSERT|UPDATE|CREATE)\b/i.test(sql)) {
        return fail('Only read-only queries are allowed.');
      }
      try {
        let effectiveCatalog = catalog || '';
        if (!effectiveCatalog) {
          const match = sql.match(/(?:FROM|JOIN|TABLE)\s+(\w+)\.\w+\.\w+/i);
          if (match) effectiveCatalog = match[1];
        }
        if (!effectiveCatalog) {
          effectiveCatalog = getCurrentWorkspace(config).catalogPrefix;
        }
        const { client, workspace } = getClientForCatalog(config, effectiveCatalog);
        const effectiveEngine = engine || 'spark';
        const queryId = await client.submitQueryAsync(sql, effectiveCatalog, schema, effectiveEngine);
        return ok({
          queryId,
          region: workspace.regionName,
          workspace: workspace.name,
          message: '查询已提交，使用 check_query 查看进度，完成后用 fetch_query_result 获取结果',
        });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'check_query',
    '查看异步查询的状态和执行进度',
    {
      query_id: z.string().describe('Query ID from submit_query'),
      catalog: z.string().optional().describe('Catalog for routing (auto-detected if omitted)'),
    },
    async ({ query_id, catalog }) => {
      try {
        const effectiveCatalog = catalog || getCurrentWorkspace(config).catalogPrefix;
        const { client } = getClientForCatalog(config, effectiveCatalog);
        const status = await client.getQueryStatus(query_id);
        return ok(status);
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'fetch_query_result',
    '获取已完成的异步查询结果',
    {
      query_id: z.string().describe('Query ID or result ID from check_query'),
      catalog: z.string().optional().describe('Catalog for routing'),
      max_rows: z.number().optional().describe('Max rows (default: 100)'),
    },
    async ({ query_id, catalog, max_rows }) => {
      try {
        const effectiveCatalog = catalog || getCurrentWorkspace(config).catalogPrefix;
        const { client, workspace } = getClientForCatalog(config, effectiveCatalog);
        const result = await client.fetchResults(query_id);
        const limit = max_rows ?? 100;
        const rows = result.rows.slice(0, limit);
        return ok({
          region: workspace.regionName,
          columns: result.columns,
          rowCount: rows.length,
          totalRows: result.rows.length,
          rows,
        });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // =========================================================================
  // Metadata (Data Factory OpenAPI)
  // =========================================================================

  server.tool(
    'get_table_detail',
    '获取表详情（owner、描述、字段、分区等）。支持全名 catalog.schema.table',
    {
      table: z.string().describe('Full table name: catalog.schema.table'),
    },
    async ({ table }) => {
      try {
        const { catalog, schema, table: tableName } = parseTableName(table);
        const regionName = detectRegion(catalog);
        let token = getCurrentWorkspace(config).token;
        if (regionName) {
          const wsNames = config.regionWorkspaces.get(regionName);
          if (wsNames?.length) token = config.workspaces.get(wsNames[0])!.token;
        }
        const client = getOpenApiClient(config, token);
        const detail = await client.getTableDetail(catalog, schema, tableName);
        return ok(detail);
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'get_table_fields',
    '获取表字段定义（名称、类型、注释）',
    {
      table: z.string().describe('Full table name: catalog.schema.table'),
    },
    async ({ table }) => {
      try {
        const { catalog, schema, table: tableName } = parseTableName(table);
        const regionName = detectRegion(catalog);
        let token = getCurrentWorkspace(config).token;
        if (regionName) {
          const wsNames = config.regionWorkspaces.get(regionName);
          if (wsNames?.length) token = config.workspaces.get(wsNames[0])!.token;
        }
        const client = getOpenApiClient(config, token);
        const fields = await client.getTableFields(catalog, schema, tableName);
        return ok(fields);
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'get_table_ddl',
    '获取建表 DDL 语句',
    {
      table: z.string().describe('Full table name: catalog.schema.table'),
    },
    async ({ table }) => {
      try {
        const { catalog, schema, table: tableName } = parseTableName(table);
        const regionName = detectRegion(catalog);
        let token = getCurrentWorkspace(config).token;
        if (regionName) {
          const wsNames = config.regionWorkspaces.get(regionName);
          if (wsNames?.length) token = config.workspaces.get(wsNames[0])!.token;
        }
        const client = getOpenApiClient(config, token);
        const ddl = await client.getTableDDL(catalog, schema, tableName);
        return ok(ddl);
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'get_table_partitions',
    '获取分区信息（记录数、文件大小）',
    {
      table: z.string().describe('Full table name: catalog.schema.table'),
    },
    async ({ table }) => {
      try {
        const { catalog, schema, table: tableName } = parseTableName(table);
        const regionName = detectRegion(catalog);
        let token = getCurrentWorkspace(config).token;
        if (regionName) {
          const wsNames = config.regionWorkspaces.get(regionName);
          if (wsNames?.length) token = config.workspaces.get(wsNames[0])!.token;
        }
        const client = getOpenApiClient(config, token);
        const partitions = await client.getTablePartitions(catalog, schema, tableName);
        return ok(partitions);
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'search_tables',
    '按关键词、catalog、库名搜索表',
    {
      keyword: z.string().optional().describe('Search keyword'),
      catalog: z.string().optional().describe('Filter by catalog'),
      db_name: z.string().optional().describe('Filter by database name'),
    },
    async ({ keyword, catalog, db_name }) => {
      try {
        const client = getOpenApiClient(config);
        const tables = await client.listAuthorizedTables({
          keyword, catalog, dbName: db_name,
        });
        return ok(tables);
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'list_databases',
    '列出 catalog 下的数据库',
    {
      catalog: z.string().describe('Catalog name'),
      keyword: z.string().optional().describe('Filter keyword'),
    },
    async ({ catalog, keyword }) => {
      try {
        const regionName = detectRegion(catalog);
        let token = getCurrentWorkspace(config).token;
        if (regionName) {
          const wsNames = config.regionWorkspaces.get(regionName);
          if (wsNames?.length) token = config.workspaces.get(wsNames[0])!.token;
        }
        const client = getOpenApiClient(config, token);
        const dbs = await client.listDatabases(catalog, keyword);
        return ok(dbs);
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'list_catalogs',
    '列出可用的 catalog',
    {
      engine: z.string().optional().describe('Filter by engine type'),
    },
    async ({ engine }) => {
      try {
        const client = getOpenApiClient(config);
        const catalogs = await client.listCatalogs(engine);
        return ok(catalogs);
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // =========================================================================
  // Permission
  // =========================================================================

  server.tool(
    'check_table_permission',
    '检查当前用户是否有指定表的查询权限',
    {
      table: z.string().describe('Full table name: catalog.schema.table'),
    },
    async ({ table }) => {
      try {
        const { catalog, schema, table: tableName } = parseTableName(table);
        const ws = getCurrentWorkspace(config);
        const client = getOpenApiClient(config);
        const result = await client.checkTablePermission(catalog, schema, tableName, ws.tokenUser, ws.id);
        return ok({ table, hasPermission: result, user: ws.tokenUser, workspace: ws.name });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // =========================================================================
  // Table Management
  // =========================================================================

  server.tool(
    'create_iceberg_table',
    '通过 OpenAPI 创建 Iceberg 表（支持审批流）。会自动校验字段名、类型、分区字段，自动填充 TBLPROPERTIES 默认值',
    {
      catalog: z.string().describe('Catalog 名称，必须以 iceberg_ 开头，如 iceberg_alsgprc_hadoop'),
      database: z.string().describe('库名'),
      table_name: z.string().describe('表名（小写+数字+下划线）'),
      description: z.string().optional().describe('表描述'),
      columns: z.array(z.object({
        name: z.string().describe('字段名'),
        type: z.string().describe('字段类型：STRING/INT/BIGINT/DOUBLE/FLOAT/BOOLEAN/BINARY/DATE/TIMESTAMP/DECIMAL/STRUCT<...>/ARRAY<...>/MAP<...>'),
        comment: z.string().optional().describe('字段描述'),
      })).describe('字段列表'),
      partition_columns: z.array(z.string()).optional().describe('分区字段名列表，如 ["date", "hour"]'),
      ttl_days: z.number().optional().describe('生命周期（天），默认 550'),
      storage_location: z.enum(['HDFS', 'JUICEFS']).optional().describe('存储位置，默认 JUICEFS'),
      require_approval: z.boolean().optional().describe('是否需要审批'),
      apply_reason: z.string().optional().describe('审批申请理由'),
      reviewer: z.string().optional().describe('审核人'),
    },
    async ({ catalog, database, table_name, description, columns, partition_columns, ttl_days, storage_location, require_approval, apply_reason, reviewer }) => {
      // ---- Validation ----
      const errors: string[] = [];
      const SQL_RESERVED = new Set(['select','from','table','order','group','where','having','join','on','as','and','or','not','in','is','null','like','between','case','when','then','else','end','create','drop','alter','insert','update','delete','into','values','set','limit','offset','union','all','distinct','exists']);
      const VALID_NAME = /^[a-z][a-z0-9_]*$/;
      const BASE_TYPES = new Set(['STRING','INT','BIGINT','DOUBLE','FLOAT','BOOLEAN','BINARY','DATE','TIMESTAMP','DECIMAL']);
      const PARTITION_TYPES = new Set(['INT','BIGINT','STRING','DATE']);

      // Table name
      if (!VALID_NAME.test(table_name)) errors.push(`表名 "${table_name}" 不合法，只允许小写字母、数字、下划线，不能以数字开头`);
      if (!catalog.startsWith('iceberg_')) errors.push(`Catalog "${catalog}" 必须以 iceberg_ 开头`);
      if (!VALID_NAME.test(database)) errors.push(`库名 "${database}" 不合法`);

      // Columns
      const colNames = new Set<string>();
      for (const col of columns) {
        if (!VALID_NAME.test(col.name)) errors.push(`字段名 "${col.name}" 不合法，只允许小写字母、数字、下划线`);
        if (SQL_RESERVED.has(col.name.toLowerCase())) errors.push(`字段名 "${col.name}" 是 SQL 保留字，请换一个`);
        if (colNames.has(col.name)) errors.push(`字段名 "${col.name}" 重复`);
        colNames.add(col.name);
        const upperType = col.type.toUpperCase();
        const isComplex = /^(STRUCT|ARRAY|MAP)</.test(upperType);
        if (!BASE_TYPES.has(upperType) && !isComplex) errors.push(`字段 "${col.name}" 的类型 "${col.type}" 不支持。支持：STRING/INT/BIGINT/DOUBLE/FLOAT/BOOLEAN/BINARY/DATE/TIMESTAMP/DECIMAL/STRUCT<>/ARRAY<>/MAP<>`);
      }

      // Partition columns
      if (partition_columns) {
        for (const pc of partition_columns) {
          if (!colNames.has(pc)) errors.push(`分区字段 "${pc}" 不在字段列表中`);
          const col = columns.find(c => c.name === pc);
          if (col) {
            const upperType = col.type.toUpperCase();
            if (!PARTITION_TYPES.has(upperType)) errors.push(`分区字段 "${pc}" 的类型 "${col.type}" 不支持做分区，只允许 INT/BIGINT/STRING/DATE`);
          }
        }
        if (partition_columns.length > 3) errors.push(`分区字段 ${partition_columns.length} 个，超过 3 个可能导致小文件问题，建议减少`);
      }

      if (errors.length > 0) {
        return fail(`建表校验失败：\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}`);
      }

      // ---- Verify database exists ----
      try {
        const regionName = detectRegion(catalog);
        let token = getCurrentWorkspace(config).token;
        if (regionName) {
          const wsNames = config.regionWorkspaces.get(regionName);
          if (wsNames?.length) token = config.workspaces.get(wsNames[0])!.token;
        }
        const client = getOpenApiClient(config, token);
        const dbs = await client.listDatabases(catalog) as any[];
        const dbExists = Array.isArray(dbs) && dbs.some((d: any) => (d.dbName || d.databaseName || d.name || d) === database);
        if (!dbExists) {
          return fail(`库 "${database}" 在 catalog "${catalog}" 中不存在。请确认库名是否正确。`);
        }
      } catch {
        // Skip db check if API fails
      }

      // ---- Build request ----
      // Map types: DDL uses STRING/INT etc, API may need different format
      const TYPE_MAP: Record<string, string> = {
        'STRING': 'string', 'INT': 'int', 'BIGINT': 'long', 'DOUBLE': 'double',
        'FLOAT': 'float', 'BOOLEAN': 'boolean', 'BINARY': 'binary',
        'DATE': 'date', 'TIMESTAMP': 'timestamp', 'DECIMAL': 'decimal',
      };
      const allColNames = columns.map(c => c.name).join(',');
      const apiColumns = columns.map(c => {
        const upperType = c.type.toUpperCase();
        const apiType = TYPE_MAP[upperType] || c.type.toLowerCase();
        return {
          name: c.name,
          type: apiType,
          comment: c.comment || '暂无描述',
          securityLevel: 'L2',
          partition: partition_columns?.includes(c.name) ? { enable: true, type: 'OTHER_PARTITION', order: partition_columns.indexOf(c.name), transform: 'identity' } : undefined,
        };
      });

      const body: Record<string, unknown> = {
        tableParams: {
          baseParams: {
            catalogName: catalog,
            databaseName: database,
            tableName: table_name,
            description: description || '',
            columns: apiColumns,
            ttl: ttl_days ?? 550,
          },
          specificParams: {
            icebergParams: {
              formatVersion: 'V2',
              optimizePriority: 'BALANCED',
              storageLocation: storage_location || 'JUICEFS',
            },
          },
        },
      };

      if (require_approval) {
        (body as any).extraParams = {
          applyingParams: {
            requireApproval: true,
            applyReason: apply_reason || '通过 AI 助手创建表',
            reviewer: reviewer || '',
          },
        };
      }

      // ---- Generate DDL preview ----
      const colDefs = columns.map(c => `  ${c.name} ${c.type.toUpperCase()} COMMENT '${c.comment || '暂无描述'}'`).join(',\n');
      const partitionClause = partition_columns?.length ? `\nPARTITIONED BY (${partition_columns.join(', ')})` : '';
      const ddlPreview = `CREATE TABLE ${catalog}.${database}.${table_name} (\n${colDefs}\n) USING iceberg${partitionClause}`;

      try {
        const regionName = detectRegion(catalog);
        let token = getCurrentWorkspace(config).token;
        if (regionName) {
          const wsNames = config.regionWorkspaces.get(regionName);
          if (wsNames?.length) token = config.workspaces.get(wsNames[0])!.token;
        }
        const client = getOpenApiClient(config, token);
        const result = await client.createTable(body);
        return ok({
          table: `${catalog}.${database}.${table_name}`,
          ddlPreview,
          result,
          message: require_approval
            ? '建表请求已提交，等待审批'
            : '建表成功',
        });
      } catch (err) {
        return fail(`建表失败: ${err instanceof Error ? err.message : String(err)}\n\nDDL 预览:\n${ddlPreview}`);
      }
    },
  );

  // =========================================================================
  // Lineage
  // =========================================================================

  server.tool(
    'query_table_lineage',
    '查询表的上下游作业血缘',
    {
      tables: z.array(z.string()).describe('Table full names, e.g. ["catalog.schema.table"]'),
      depth: z.number().optional().describe('Lineage depth (default: 1)'),
      directions: z.enum(['INPUT', 'OUTPUT']).optional().describe('INPUT=上游写入作业, OUTPUT=下游读取作业, 不填=全部'),
    },
    async ({ tables, depth, directions }) => {
      try {
        // Detect region from first table's catalog
        const firstCatalog = tables[0]?.split('.')[0] || '';
        const regionName = detectRegion(firstCatalog);
        let token = getCurrentWorkspace(config).token;
        if (regionName) {
          const wsNames = config.regionWorkspaces.get(regionName);
          if (wsNames?.length) token = config.workspaces.get(wsNames[0])!.token;
        }
        const client = getOpenApiClient(config, token);
        const body: Record<string, unknown> = { catalogTableNames: tables };
        if (directions) body.directions = directions;
        const lineage = await client.queryTableLineage(body);
        return ok(lineage);
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // =========================================================================
  // Job management — Create
  // =========================================================================

  server.tool(
    'create_sparksql_job',
    `创建 SparkSQL 作业并自动上线调度+执行。自动填充 noticeList、资源配置等默认值`,
    {
      workspace_id: z.number().describe('在哪个工作空间创建'),
      sql: z.string().describe('要执行的 SQL'),
      job_name: z.string().optional().describe('作业名（不传则自动生成）'),
      description: z.string().optional().describe('作业描述'),
      spark_sql_version: z.string().optional().describe('SparkSQL 版本（默认 SPARK_3_1）'),
      driver_memory: z.string().optional().describe('Driver 内存（默认 2g）'),
      executor_memory: z.string().optional().describe('Executor 内存（默认 4g）'),
      dynamic_allocation: z.boolean().optional().describe('是否动态分配（默认 true）'),
      num_executors: z.number().optional().describe('Executor 数量（默认 100）'),
      cron: z.string().optional().describe('定时调度 cron 表达式（不传则手动触发）'),
    },
    async ({ workspace_id, sql, job_name, description, spark_sql_version, driver_memory, executor_memory, dynamic_allocation, num_executors, cron }) => {
      try {
        const wsKey = String(workspace_id);
        const ws = config.workspaces.get(wsKey);
        if (!ws) {
          const available = [...config.workspaces.values()].map(w => `${w.id} (${w.name} - ${w.description || w.regionName})`);
          return fail(`Unknown workspace_id ${workspace_id}. Available:\n${available.join('\n')}`);
        }
        const defaultUser = ws.tokenUser || ws.owner || 'unknown';

        const body: Record<string, unknown> = {
          jobName: job_name || `sparksql_${Date.now()}`,
          jobType: 'SPARK_SQL',
          description: description || job_name || 'SparkSQL 作业',
          sql,
          schedulerType: cron ? 'scheduler' : 'user',
          sparkSQLVersion: spark_sql_version || '3.3',
          driverMemory: driver_memory || '2g',
          executorMemory: executor_memory || '4g',
          dynamicAllocationEnabled: dynamic_allocation ?? true,
          numExecutors: num_executors ?? 1,
          dynamicAllocationMinExecutors: 1,
          dynamicAllocationMaxExecutors: num_executors ?? 100,
          retryTimes: 0,
          noticeList: [{
            notifyIf: ['FAILED'],
            retryTriggerCondition: 'every',
            timeout: 120,
            notifyProvider: 'Falcon',
            notifyLevel: 'P2',
            notifyingReceiver: [{ notifyObjectType: 'user', receivers: [{ id: defaultUser }] }],
          }],
        };
        if (cron) {
          body.quartzCron = cron;
        } else {
          body.quartzCron = '0 0 4 * * ?';
        }

        const client = getClientForWorkspace(config, workspace_id);
        const jobId = await client.createSparkSQLJob(body);

        // Move job to user's directory
        let dirMessage = '';
        try {
          const dirTree = await client.viewDirs() as any;
          function findDir(node: any): number | null {
            if (!node) return null;
            if (node.name === defaultUser) return node.id;
            if (Array.isArray(node.children)) {
              for (const child of node.children) {
                const found = findDir(child);
                if (found) return found;
              }
            }
            return null;
          }
          let targetDirId: number | null = null;
          if (Array.isArray(dirTree)) {
            for (const node of dirTree) {
              targetDirId = findDir(node);
              if (targetDirId) break;
            }
          } else {
            targetDirId = findDir(dirTree);
          }
          if (!targetDirId) {
            const newDir = await client.createDir(defaultUser) as any;
            targetDirId = typeof newDir === 'number' ? newDir : (newDir?.id ?? null);
          }
          if (targetDirId) {
            await client.moveJobsToDir(targetDirId, [String(jobId)]);
            dirMessage = `，已移至目录 "${defaultUser}"`;
          }
        } catch (e) {
          dirMessage = `，移动目录失败: ${e instanceof Error ? e.message : String(e)}`;
        }

        // Enable schedule then run once
        let scheduleError = '';
        let scheduleIsAuthError = false;
        try {
          await client.enableJobSchedule(String(jobId));
        } catch (e: any) {
          scheduleError = e instanceof Error ? e.message : String(e);
          scheduleIsAuthError = e?.type === ErrorType.AUTH_ERROR || /\b(401|403|auth|Unauthorized|Forbidden)\b/i.test(scheduleError);
        }
        let taskId: unknown = null;
        let startError = '';
        let startIsAuthError = false;
        if (!scheduleError) {
          try {
            taskId = await client.startJob(String(jobId));
          } catch (e: any) {
            startError = e instanceof Error ? e.message : String(e);
            startIsAuthError = e?.type === ErrorType.AUTH_ERROR || /\b(401|403|auth|Unauthorized|Forbidden)\b/i.test(startError);
          }
        }

        const statusParts: string[] = [];
        if (!scheduleError) statusParts.push('上线调度成功');
        else statusParts.push(`上线调度失败: ${scheduleError}`);
        if (taskId) statusParts.push(`已触发执行（taskId=${taskId}）`);
        else if (startError) statusParts.push(`触发执行失败: ${startError}`);

        // 权限不足时给出友好提示
        let permissionHint = '';
        if (scheduleIsAuthError || startIsAuthError) {
          permissionHint = '\n⚠️ 检测到权限不足：当前 token 没有发布/执行作业的权限。作业已创建为草稿，请联系工作空间管理员授权，或到数据工场页面手动发布。';
        }

        return ok({
          jobId,
          taskId,
          workspace: { id: ws.id, name: ws.name, region: ws.regionName },
          message: `作业创建成功（jobId=${jobId}），${statusParts.join('，')}${dirMessage}${permissionHint}`,
        });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'create_data_push_job',
    `创建数据推送作业并自动发布。默认推送给自己的飞书，自动填充 noticeList 等配置`,
    {
      workspace_id: z.number().describe('在哪个工作空间创建'),
      sql: z.string().describe('要执行的查询 SQL'),
      title: z.string().describe('推送标题'),
      subtitle: z.string().optional().describe('推送子标题'),
      exec_engine: z.string().optional().describe('执行引擎: TRINO / SPARK（默认 TRINO）'),
      receivers: z.array(z.string()).optional().describe('推送给谁（用户名列表，默认推送给自己）'),
      receiver_type: z.string().optional().describe('推送方式: LARK/EMAIL/SMS（默认 LARK）'),
      data_put_type: z.enum(['CSV', 'LARK']).optional().describe('数据输出格式: CSV=生成CSV附件推送, LARK=写入飞书多维表格（默认 CSV）'),
      data_put_url: z.string().optional().describe('飞书多维表格 URL（data_put_type=LARK 时必填）'),
      job_name: z.string().optional().describe('作业名（不传则自动生成）'),
      description: z.string().optional().describe('作业描述'),
      catalog: z.string().optional().describe('catalog（不传则自动从 SQL 提取）'),
      cron: z.string().optional().describe('定时调度 cron 表达式（不传则一次性执行）'),
    },
    async ({ workspace_id, sql, title, subtitle, exec_engine, receivers, receiver_type, data_put_type, data_put_url, job_name, description, catalog, cron }) => {
      try {
        // Resolve workspace and owner
        const wsKey = String(workspace_id);
        const ws = config.workspaces.get(wsKey);
        if (!ws) {
          const available = [...config.workspaces.values()].map(w => `${w.id} (${w.name} - ${w.description || w.regionName})`);
          return fail(`Unknown workspace_id ${workspace_id}. Available:\n${available.join('\n')}`);
        }
        const defaultUser = ws.tokenUser || ws.owner || 'unknown';
        const recvList = receivers ?? [defaultUser];
        const recvType = receiver_type ?? 'LARK';

        // Auto-detect catalog from SQL
        let effectiveCatalog = catalog || '';
        if (!effectiveCatalog) {
          const match = sql.match(/(?:FROM|JOIN|TABLE)\s+(\w+)\.\w+\.\w+/i);
          if (match) effectiveCatalog = match[1];
        }

        const body: Record<string, unknown> = {
          jobName: job_name || `data_push_${Date.now()}`,
          jobType: 'DATA_PUSH',
          description: description || title,
          title,
          mode: 'SAVE_AND_SCHEDULE',
          schedulerType: cron ? 'scheduler' : 'user',
          cron: cron ? undefined : { repeat: 'DAY', hour: 10, minute: 0 },
          retryTimes: 0,
          noticeList: [{
            notifyIf: ['FAILED'],
            retryTriggerCondition: 'every',
            timeout: 120,
            notifyProvider: 'Falcon',
            notifyLevel: 'P2',
            notifyingReceiver: [{ notifyObjectType: 'user', receivers: recvList.map(r => ({ id: r })) }],
          }],
          bodys: [{
            sql,
            description: subtitle || '',
            catalog: effectiveCatalog,
            execEngine: (exec_engine || 'TRINO').toUpperCase(),
            isFullData: true,
            pushWhenEmptyData: false,
            ...(data_put_type ? { dataPutType: data_put_type } : {}),
            ...(data_put_url ? { dataPutUrl: data_put_url } : {}),
          }],
          dataPushReceivers: [{ type: recvType, receivers: recvList }],
        };
        if (cron) {
          body.quartzCron = cron;
          body.cron = undefined; // Use quartzCron instead
        }

        const client = getClientForWorkspace(config, workspace_id);
        const jobId = await client.createDataPushJob(body);

        // Move job to receiver's directory
        let dirMessage = '';
        try {
          const dirTree = await client.viewDirs() as any;
          const targetDirName = recvList[0]; // Use first receiver as directory name

          // Recursively search for directory by name
          function findDir(node: any): number | null {
            if (!node) return null;
            if (node.name === targetDirName) return node.id;
            if (Array.isArray(node.children)) {
              for (const child of node.children) {
                const found = findDir(child);
                if (found) return found;
              }
            }
            return null;
          }

          let targetDirId: number | null = null;
          // dirTree could be a single root Dir or an array
          if (Array.isArray(dirTree)) {
            for (const node of dirTree) {
              targetDirId = findDir(node);
              if (targetDirId) break;
            }
          } else {
            targetDirId = findDir(dirTree);
          }

          if (!targetDirId) {
            // Create directory under root (parentDirId=0 or omitted)
            const newDir = await client.createDir(targetDirName) as any;
            targetDirId = typeof newDir === 'number' ? newDir : (newDir?.id ?? null);
          }
          if (targetDirId) {
            await client.moveJobsToDir(targetDirId, [String(jobId)]);
            dirMessage = `，已移至目录 "${targetDirName}"`;
          } else {
            dirMessage = `，目录创建返回异常，未能移动`;
          }
        } catch (e) {
          dirMessage = `，移动目录失败: ${e instanceof Error ? e.message : String(e)}`;
        }

        // Auto-enable schedule (上线调度) then run once (执行一次)
        let scheduleError = '';
        let scheduleIsAuthError = false;
        try {
          await client.enableJobSchedule(String(jobId));
        } catch (e: any) {
          scheduleError = e instanceof Error ? e.message : String(e);
          scheduleIsAuthError = e?.type === ErrorType.AUTH_ERROR || /\b(401|403|auth|Unauthorized|Forbidden)\b/i.test(scheduleError);
        }

        let taskId: unknown = null;
        let startError = '';
        let startIsAuthError = false;
        if (!scheduleError) {
          try {
            taskId = await client.startJob(String(jobId));
          } catch (e: any) {
            startError = e instanceof Error ? e.message : String(e);
            startIsAuthError = e?.type === ErrorType.AUTH_ERROR || /\b(401|403|auth|Unauthorized|Forbidden)\b/i.test(startError);
          }
        }

        const statusParts: string[] = [];
        if (!scheduleError) statusParts.push('上线调度成功');
        else statusParts.push(`上线调度失败: ${scheduleError}`);
        if (taskId) statusParts.push(`已触发执行（taskId=${taskId}）`);
        else if (startError) statusParts.push(`触发执行失败: ${startError}`);

        // 权限不足时给出友好提示
        let permissionHint = '';
        if (scheduleIsAuthError || startIsAuthError) {
          permissionHint = '\n⚠️ 检测到权限不足：当前 token 没有发布/执行作业的权限。作业已创建为草稿，请联系工作空间管理员授权，或到数据工场页面手动发布。';
        }

        return ok({
          jobId,
          taskId,
          workspace: { id: ws.id, name: ws.name, region: ws.regionName },
          receivers: recvList,
          message: `作业创建成功（jobId=${jobId}），${statusParts.join('，')}${dirMessage}${permissionHint}`,
        });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // =========================================================================
  // Notebook
  // =========================================================================

  server.tool(
    'create_notebook',
    '在工作空间中创建一个 Notebook 文件',
    {
      workspace_id: z.number().describe('工作空间 ID'),
      name: z.string().describe('Notebook 名称'),
      content: z.unknown().optional().describe('Notebook 内容（JSON 格式，可选）'),
    },
    async ({ workspace_id, name, content }) => {
      try {
        const wsKey = String(workspace_id);
        const ws = config.workspaces.get(wsKey);
        if (!ws) {
          const available = [...config.workspaces.values()].map(w => `${w.id} (${w.name})`);
          return fail(`Unknown workspace_id ${workspace_id}. Available:\n${available.join('\n')}`);
        }
        const client = getClientForWorkspace(config, workspace_id);
        const body: Record<string, unknown> = { name };
        if (content !== undefined) body.content = content;
        const result = await client.createNotebook(body, ws.tokenUser, ws.id);
        return ok({ workspace: { id: ws.id, name: ws.name }, result });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'create_notebook_job',
    '创建 Notebook 调度作业并自动上线+执行',
    {
      workspace_id: z.number().describe('工作空间 ID'),
      job_name: z.string().describe('作业名称'),
      description: z.string().optional().describe('作业描述'),
      notebook_path: z.string().describe('Notebook 文件路径（inputNotebookPath）'),
      output_notebook_path: z.string().optional().describe('输出 Notebook 路径'),
      git_url: z.string().optional().describe('Git 仓库 URL'),
      git_ref: z.string().optional().describe('Git 分支/tag'),
      runtime_name: z.string().optional().describe('运行时名称'),
      queue: z.string().optional().describe('队列名称'),
      base_env_name: z.string().optional().describe('基础环境名称'),
      python_packages: z.string().optional().describe('Python 依赖包'),
      spark_driver_memory: z.string().optional().describe('Driver 内存（默认 2g）'),
      spark_executor_memory: z.string().optional().describe('Executor 内存（默认 4g）'),
      spark_num_executors: z.number().optional().describe('Executor 数量（默认 2）'),
      cron: z.string().optional().describe('定时调度 cron 表达式'),
      parameters: z.array(z.string()).optional().describe('Notebook 参数列表'),
    },
    async ({ workspace_id, job_name, description, notebook_path, output_notebook_path, git_url, git_ref, runtime_name, queue, base_env_name, python_packages, spark_driver_memory, spark_executor_memory, spark_num_executors, cron, parameters }) => {
      try {
        const wsKey = String(workspace_id);
        const ws = config.workspaces.get(wsKey);
        if (!ws) {
          const available = [...config.workspaces.values()].map(w => `${w.id} (${w.name})`);
          return fail(`Unknown workspace_id ${workspace_id}. Available:\n${available.join('\n')}`);
        }
        const defaultUser = ws.tokenUser || ws.owner || 'unknown';

        const notebook: Record<string, unknown> = {
          inputNotebookPath: notebook_path,
        };
        if (output_notebook_path) notebook.outputNotebookPath = output_notebook_path;
        if (git_url) notebook.gitUrl = git_url;
        if (git_ref) notebook.gitRef = git_ref;
        if (parameters) notebook.parameters = parameters;

        const body: Record<string, unknown> = {
          jobName: job_name,
          jobType: 'NOTEBOOK',
          description: description || job_name,
          mode: 'SAVE_AND_SCHEDULE',
          schedulerType: cron ? 'scheduler' : 'user',
          retryTimes: 0,
          notebook,
          noticeList: [{
            notifyIf: ['FAILED'],
            retryTriggerCondition: 'every',
            timeout: 120,
            notifyProvider: 'Falcon',
            notifyLevel: 'P2',
            notifyingReceiver: [{ notifyObjectType: 'user', receivers: [{ id: defaultUser }] }],
          }],
        };

        if (runtime_name || queue) {
          const runtimeConfig: Record<string, unknown> = {
            baseEnvName: base_env_name || '',
            pythonPackages: python_packages || '',
            sparkParams: {
              driverMemory: spark_driver_memory || '2g',
              executorMemory: spark_executor_memory || '4g',
              numExecutors: spark_num_executors ?? 2,
            },
          };
          body.runtime = {
            name: runtime_name || 'default',
            queue: queue || 'default',
            workspaceId: ws.id,
            config: runtimeConfig,
          };
        }

        if (cron) {
          body.quartzCron = cron;
        } else {
          body.quartzCron = '0 0 4 * * ?';
        }

        const client = getClientForWorkspace(config, workspace_id);
        const jobId = await client.createNotebookJob(body);

        // Move to user directory
        let dirMessage = '';
        try {
          const dirTree = await client.viewDirs() as any;
          function findDir(node: any): number | null {
            if (!node) return null;
            if (node.name === defaultUser) return node.id;
            if (Array.isArray(node.children)) {
              for (const child of node.children) {
                const found = findDir(child);
                if (found) return found;
              }
            }
            return null;
          }
          let targetDirId: number | null = null;
          if (Array.isArray(dirTree)) {
            for (const node of dirTree) { targetDirId = findDir(node); if (targetDirId) break; }
          } else {
            targetDirId = findDir(dirTree);
          }
          if (!targetDirId) {
            const newDir = await client.createDir(defaultUser) as any;
            targetDirId = typeof newDir === 'number' ? newDir : (newDir?.id ?? null);
          }
          if (targetDirId) {
            await client.moveJobsToDir(targetDirId, [String(jobId)]);
            dirMessage = `，已移至目录 "${defaultUser}"`;
          }
        } catch (e) {
          dirMessage = `，移动目录失败: ${e instanceof Error ? e.message : String(e)}`;
        }

        // Enable schedule then run once
        let scheduleError = '';
        let scheduleIsAuthError = false;
        try {
          await client.enableJobSchedule(String(jobId));
        } catch (e: any) {
          scheduleError = e instanceof Error ? e.message : String(e);
          scheduleIsAuthError = e?.type === ErrorType.AUTH_ERROR || /\b(401|403|auth|Unauthorized|Forbidden)\b/i.test(scheduleError);
        }
        let taskId: unknown = null;
        let startError = '';
        let startIsAuthError = false;
        if (!scheduleError) {
          try {
            taskId = await client.startJob(String(jobId));
          } catch (e: any) {
            startError = e instanceof Error ? e.message : String(e);
            startIsAuthError = e?.type === ErrorType.AUTH_ERROR || /\b(401|403|auth|Unauthorized|Forbidden)\b/i.test(startError);
          }
        }

        const statusParts: string[] = [];
        if (!scheduleError) statusParts.push('上线调度成功');
        else statusParts.push(`上线调度失败: ${scheduleError}`);
        if (taskId) statusParts.push(`已触发执行（taskId=${taskId}）`);
        else if (startError) statusParts.push(`触发执行失败: ${startError}`);

        let permissionHint = '';
        if (scheduleIsAuthError || startIsAuthError) {
          permissionHint = '\n⚠️ 检测到权限不足：当前 token 没有发布/执行作业的权限。作业已创建为草稿，请联系工作空间管理员授权，或到数据工场页面手动发布。';
        }

        return ok({
          jobId,
          taskId,
          workspace: { id: ws.id, name: ws.name, region: ws.regionName },
          message: `Notebook 作业创建成功（jobId=${jobId}），${statusParts.join('，')}${dirMessage}${permissionHint}`,
        });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'update_notebook_job',
    '修改 Notebook 作业',
    {
      workspace_id: z.number().optional().describe('工作空间 ID'),
      job_id: z.string().describe('作业 ID'),
      job_name: z.string().optional().describe('作业名称'),
      description: z.string().optional().describe('作业描述'),
      notebook_path: z.string().optional().describe('Notebook 文件路径'),
      output_notebook_path: z.string().optional().describe('输出 Notebook 路径'),
      git_url: z.string().optional().describe('Git 仓库 URL'),
      git_ref: z.string().optional().describe('Git 分支/tag'),
      cron: z.string().optional().describe('定时调度 cron 表达式'),
      update_mode: z.enum(['UPDATE_ALL', 'UPDATE_BASE', 'UPDATE_VERSION']).optional().describe('更新模式（默认 UPDATE_ALL）'),
    },
    async ({ workspace_id, job_id, job_name, description, notebook_path, output_notebook_path, git_url, git_ref, cron, update_mode }) => {
      try {
        const client = getClientForWorkspace(config, workspace_id);
        const body: Record<string, unknown> = {
          updateMode: update_mode || 'UPDATE_ALL',
          jobType: 'NOTEBOOK',
        };
        if (job_name) body.jobName = job_name;
        if (description) body.description = description;
        if (cron) body.quartzCron = cron;

        if (notebook_path || output_notebook_path || git_url || git_ref) {
          const notebook: Record<string, unknown> = {};
          if (notebook_path) notebook.inputNotebookPath = notebook_path;
          if (output_notebook_path) notebook.outputNotebookPath = output_notebook_path;
          if (git_url) notebook.gitUrl = git_url;
          if (git_ref) notebook.gitRef = git_ref;
          body.notebook = notebook;
        }

        const result = await client.updateNotebookJob(job_id, body);
        return ok({ jobId: job_id, result, message: 'Notebook 作业更新成功' });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // =========================================================================
  // Job management — Update
  // =========================================================================

  server.tool(
    'update_sparksql_job',
    '修改 SparkSQL 作业',
    {
      workspace_id: z.number().optional().describe('工作空间 ID'),
      job_id: z.string().describe('作业 ID'),
      body: z.record(z.unknown()).describe('更新的作业配置'),
    },
    async ({ workspace_id, job_id, body }) => {
      try {
        const client = getClientForWorkspace(config, workspace_id);
        const result = await client.updateSparkSQLJob(job_id, body);
        return ok({ result, message: '作业更新成功' });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'update_data_push_job',
    '修改数据推送作业',
    {
      workspace_id: z.number().optional().describe('工作空间 ID'),
      job_id: z.string().describe('作业 ID'),
      body: z.record(z.unknown()).describe('更新的作业配置'),
    },
    async ({ workspace_id, job_id, body }) => {
      try {
        const client = getClientForWorkspace(config, workspace_id);
        const result = await client.updateDataPushJob(job_id, body);
        return ok({ result, message: '作业更新成功' });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // =========================================================================
  // Job management — Lifecycle
  // =========================================================================

  server.tool(
    'list_jobs',
    '查询作业列表',
    {
      workspace_id: z.number().optional().describe('工作空间 ID'),
      search_key: z.string().optional().describe('搜索关键词'),
      job_id: z.string().optional().describe('作业 ID'),
      job_types: z.string().optional().describe('作业类型过滤'),
      owner: z.boolean().optional().describe('是否只看自己的'),
      page: z.number().optional().describe('页码（默认 1）'),
      page_size: z.number().optional().describe('每页条数（默认 20）'),
    },
    async ({ workspace_id, search_key, job_id, job_types, owner, page, page_size }) => {
      try {
        const client = getClientForWorkspace(config, workspace_id);
        const result = await client.listJobs({
          searchKey: search_key, jobId: job_id, jobTypes: job_types,
          owner, page: page ?? 1, pageSize: page_size ?? 20,
        });
        return ok(result);
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'get_job_detail',
    '获取作业详情',
    {
      workspace_id: z.number().optional().describe('工作空间 ID'),
      job_id: z.string().describe('作业 ID'),
      version: z.number().optional().describe('作业版本'),
    },
    async ({ workspace_id, job_id, version }) => {
      try {
        const client = getClientForWorkspace(config, workspace_id);
        const result = await client.getJobDetail(job_id, version);
        return ok(result);
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'start_job',
    '启动作业',
    {
      workspace_id: z.number().optional().describe('工作空间 ID'),
      job_id: z.string().describe('作业 ID'),
      version: z.number().optional().describe('作业版本'),
    },
    async ({ workspace_id, job_id, version }) => {
      try {
        const client = getClientForWorkspace(config, workspace_id);
        const result = await client.startJob(job_id, version);
        return ok({ result, message: '作业已启动' });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'stop_job',
    '停止作业',
    {
      workspace_id: z.number().optional().describe('工作空间 ID'),
      job_id: z.string().describe('作业 ID'),
      task_id: z.string().optional().describe('任务实例 ID'),
    },
    async ({ workspace_id, job_id, task_id }) => {
      try {
        const client = getClientForWorkspace(config, workspace_id);
        const result = await client.stopJob(job_id, task_id);
        return ok({ result, message: '作业已停止' });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'delete_job',
    '删除作业',
    {
      workspace_id: z.number().optional().describe('工作空间 ID'),
      job_id: z.string().describe('作业 ID'),
      version: z.number().optional().describe('作业版本'),
    },
    async ({ workspace_id, job_id, version }) => {
      try {
        const client = getClientForWorkspace(config, workspace_id);
        const result = await client.deleteJob(job_id, version);
        return ok({ result, message: '作业已删除' });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // =========================================================================
  // Job management — Scheduler
  // =========================================================================

  server.tool(
    'enable_job_schedule',
    '启用作业调度',
    {
      workspace_id: z.number().optional().describe('工作空间 ID'),
      job_id: z.string().describe('作业 ID'),
    },
    async ({ workspace_id, job_id }) => {
      try {
        const client = getClientForWorkspace(config, workspace_id);
        const result = await client.enableJobSchedule(job_id);
        return ok({ result, message: '调度已启用' });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'disable_job_schedule',
    '停用作业调度',
    {
      workspace_id: z.number().optional().describe('工作空间 ID'),
      job_id: z.string().describe('作业 ID'),
    },
    async ({ workspace_id, job_id }) => {
      try {
        const client = getClientForWorkspace(config, workspace_id);
        const result = await client.disableJobSchedule(job_id);
        return ok({ result, message: '调度已停用' });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // =========================================================================
  // Task instances
  // =========================================================================

  /**
   * Helper: resolve a dagNodeId to the latest real taskId.
   * startJob() returns a dagNodeId, not a taskId.
   * We call /develop/dagNodes/{dagNodeId}/tasks to get the actual task list.
   */
  async function resolveTaskId(client: OpenApiClient, dagNodeId: string): Promise<{ taskId: string; tasks: unknown }> {
    const result = await client.listDagNodeTasks(dagNodeId, 1, 10) as any;
    const tasks = result?.data ?? result;
    if (Array.isArray(tasks) && tasks.length > 0) {
      return { taskId: String(tasks[0].id), tasks };
    }
    throw new Error(`dagNode ${dagNodeId} 下未找到任务实例`);
  }

  server.tool(
    'get_task_detail',
    '获取任务实例详情。如果不指定 workspace_id，会自动遍历所有工作空间查找',
    {
      workspace_id: z.number().optional().describe('工作空间 ID（不传则自动遍历所有空间查找）'),
      task_id: z.string().describe('任务实例 ID'),
    },
    async ({ workspace_id, task_id }) => {
      /**
       * task_id may actually be a dagNodeId (returned by startJob).
       * Strategy: try getTaskDetail first; if it fails with 500 (kolibre-adapter B-0),
       * treat task_id as dagNodeId → resolve to real taskId → retry.
       */
      async function tryGetDetail(client: OpenApiClient, id: string, wsInfo?: { id: number; name: string; regionName: string }) {
        try {
          const result = await client.getTaskDetail(id);
          return ok(wsInfo ? { workspace: wsInfo, ...(result as object) } : result);
        } catch (err: any) {
          // If 500 from kolibre-adapter, likely a dagNodeId — resolve and retry
          const msg = err instanceof Error ? err.message : String(err);
          if (/kolibre-adapter|B-0|HTTP 500/i.test(msg)) {
            const { taskId, tasks } = await resolveTaskId(client, id);
            const detail = await client.getTaskDetail(taskId);
            return ok(wsInfo
              ? { workspace: wsInfo, dagNodeId: id, resolvedTaskId: taskId, ...(detail as object) }
              : { dagNodeId: id, resolvedTaskId: taskId, ...(detail as object) });
          }
          throw err;
        }
      }

      if (workspace_id !== undefined) {
        try {
          const client = getClientForWorkspace(config, workspace_id);
          return await tryGetDetail(client, task_id);
        } catch (err) {
          return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const errors: string[] = [];
      for (const [key, ws] of config.workspaces) {
        try {
          const client = getOpenApiClient(config, ws.token);
          return await tryGetDetail(client, task_id, { id: ws.id, name: ws.name, regionName: ws.regionName });
        } catch {
          errors.push(`${ws.id}(${ws.name})`);
        }
      }
      return fail(`任务 ${task_id} 在所有工作空间中均未找到。已查询: ${errors.join(', ')}`);
    },
  );

  server.tool(
    'get_task_log',
    '获取任务实例日志。如果不指定 workspace_id，会自动遍历所有工作空间查找',
    {
      workspace_id: z.number().optional().describe('工作空间 ID（不传则自动遍历所有空间查找）'),
      task_id: z.string().describe('任务实例 ID'),
    },
    async ({ workspace_id, task_id }) => {
      async function tryGetLog(client: OpenApiClient, id: string, wsInfo?: { id: number; name: string; regionName: string }) {
        try {
          const result = await client.getTaskLog(id);
          return ok(wsInfo ? { workspace: wsInfo, ...(result as object) } : result);
        } catch (err: any) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/kolibre-adapter|B-0|HTTP 500/i.test(msg)) {
            const { taskId } = await resolveTaskId(client, id);
            const log = await client.getTaskLog(taskId);
            return ok(wsInfo
              ? { workspace: wsInfo, dagNodeId: id, resolvedTaskId: taskId, ...(log as object) }
              : { dagNodeId: id, resolvedTaskId: taskId, ...(log as object) });
          }
          throw err;
        }
      }

      if (workspace_id !== undefined) {
        try {
          const client = getClientForWorkspace(config, workspace_id);
          return await tryGetLog(client, task_id);
        } catch (err) {
          return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const errors: string[] = [];
      for (const [key, ws] of config.workspaces) {
        try {
          const client = getOpenApiClient(config, ws.token);
          return await tryGetLog(client, task_id, { id: ws.id, name: ws.name, regionName: ws.regionName });
        } catch {
          errors.push(`${ws.id}(${ws.name})`);
        }
      }
      return fail(`任务 ${task_id} 的日志在所有工作空间中均未找到。已查询: ${errors.join(', ')}`);
    },
  );

  // =========================================================================
  // Start server
  // =========================================================================

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[kyuubi-mcp] Server started');
}

main().catch((err) => {
  console.error('[kyuubi-mcp] Failed to start:', err);
  process.exit(1);
});
