/**
 * MCP Server: Example Connector
 *
 * A starter MCP server for connecting to a data source.
 * Replace with your actual data connection logic.
 */

import type { DataSource } from "@data-analysis/shared";

export function createConnection(source: DataSource): void {
  // TODO: implement connection logic
  console.log(`Connecting to ${source.name} (${source.type})`);
}
