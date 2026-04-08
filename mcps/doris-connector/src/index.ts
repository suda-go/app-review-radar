#!/usr/bin/env ts-node
/**
 * Doris MCP Server — MySQL protocol direct connection
 *
 * Tools: execute_query, list_databases, list_tables, describe_table, switch_connection
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
import mysql from 'mysql2/promise';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DorisConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
}

interface DorisConfig {
  connections: Record<string, DorisConnection>;
  defaultConnection?: string;
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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadConfig(configPath: string = 'doris-config.json'): DorisConfig {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw);

  if (!parsed.connections || Object.keys(parsed.connections).length === 0) {
    throw new Error('Config must define at least one connection');
  }
  if (!parsed.defaultConnection) {
    parsed.defaultConnection = Object.keys(parsed.connections)[0];
  }
  return parsed as DorisConfig;
}

async function getPool(conn: DorisConnection): Promise<mysql.Pool> {
  return mysql.createPool({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: conn.database,
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const configArg = process.argv.indexOf('--config');
  const configPath = configArg !== -1 ? process.argv[configArg + 1] : undefined;
  const config = loadConfig(configPath);

  const connNames = Object.keys(config.connections);
  const connList = connNames.join(', ');
  let currentConnName = config.defaultConnection!;

  // Connection pools
  const pools = new Map<string, mysql.Pool>();
  for (const [name, conn] of Object.entries(config.connections)) {
    pools.set(name, await getPool(conn));
  }

  const server = new McpServer({ name: 'doris', version: '1.0.0' });

  // =========================================================================
  // Connection management
  // =========================================================================

  server.tool('list_connections', 'List all configured Doris connections', {}, async () => {
    const info = Object.entries(config.connections).map(([name, c]) => ({
      name, host: c.host, port: c.port, database: c.database,
      isCurrent: name === currentConnName,
    }));
    return ok({ connections: info, current: currentConnName });
  });

  if (connNames.length > 1) {
    server.tool(
      'switch_connection',
      `Switch active Doris connection. Available: ${connList}`,
      { connection: z.string().describe(`Connection name: ${connList}`) },
      async ({ connection }) => {
        if (!config.connections[connection]) {
          return fail(`Unknown connection "${connection}". Available: ${connList}`);
        }
        currentConnName = connection;
        return ok({ message: `Switched to: ${connection}` });
      },
    );
  }

  // =========================================================================
  // Query Tools
  // =========================================================================

  server.tool(
    'execute_query',
    'Execute a read-only SQL query on Doris (SELECT/SHOW/DESCRIBE).',
    {
      sql: z.string().describe('SQL query'),
      connection: z.string().optional().describe('Connection name (uses current if omitted)'),
      max_rows: z.number().optional().describe('Max rows (default: 100)'),
    },
    async ({ sql, connection, max_rows }) => {
      if (/\b(DROP|DELETE|TRUNCATE|ALTER|INSERT|UPDATE|CREATE)\b/i.test(sql)) {
        return fail('Only read-only queries are allowed.');
      }
      try {
        const name = connection || currentConnName;
        const pool = pools.get(name);
        if (!pool) return fail(`Unknown connection "${name}"`);
        const limit = max_rows ?? 100;
        // Add LIMIT if not present
        let finalSql = sql;
        if (/^\s*SELECT/i.test(sql) && !/\bLIMIT\b/i.test(sql)) {
          finalSql = `${sql} LIMIT ${limit}`;
        }
        const [rows, fields] = await pool.query(finalSql);
        const columns = (fields as mysql.FieldPacket[]).map(f => ({
          name: f.name, type: f.type,
        }));
        const data = Array.isArray(rows) ? rows.slice(0, limit) : rows;
        return ok({ connection: name, columns, rowCount: Array.isArray(rows) ? rows.length : 1, rows: data });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'list_databases',
    'List databases on the Doris cluster.',
    { connection: z.string().optional().describe('Connection name') },
    async ({ connection }) => {
      try {
        const name = connection || currentConnName;
        const pool = pools.get(name);
        if (!pool) return fail(`Unknown connection "${name}"`);
        const [rows] = await pool.query('SHOW DATABASES');
        const dbs = (rows as any[]).map(r => Object.values(r)[0]);
        return ok({ connection: name, databases: dbs });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'list_tables',
    'List tables in a database.',
    {
      database: z.string().optional().describe('Database name (uses current if omitted)'),
      connection: z.string().optional().describe('Connection name'),
    },
    async ({ database, connection }) => {
      try {
        const name = connection || currentConnName;
        const pool = pools.get(name);
        if (!pool) return fail(`Unknown connection "${name}"`);
        const db = database || config.connections[name].database;
        const sql = db ? `SHOW TABLES FROM \`${db}\`` : 'SHOW TABLES';
        const [rows] = await pool.query(sql);
        const tables = (rows as any[]).map(r => Object.values(r)[0]);
        return ok({ connection: name, database: db, tables });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.tool(
    'describe_table',
    'Show column definitions for a table.',
    {
      table: z.string().describe('Table name (can include database prefix like db.table)'),
      connection: z.string().optional().describe('Connection name'),
    },
    async ({ table, connection }) => {
      try {
        const name = connection || currentConnName;
        const pool = pools.get(name);
        if (!pool) return fail(`Unknown connection "${name}"`);
        const [rows] = await pool.query(`DESCRIBE \`${table.replace('.', '`.`')}\``);
        return ok({ connection: name, table, columns: rows });
      } catch (err) {
        return fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // ---- Start ----
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Failed to start Doris MCP server:', err);
  process.exit(1);
});
