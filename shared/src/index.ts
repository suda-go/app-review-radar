/**
 * Shared utilities and types for data analysis toolkit.
 */

export interface DataSource {
  type: string;
  name: string;
  connectionString: string;
}

export interface AnalysisResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
