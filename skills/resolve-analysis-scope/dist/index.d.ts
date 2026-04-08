/**
 * Skill: Resolve Analysis Scope
 *
 * Determines the scope and boundaries of a data analysis task,
 * identifying relevant data sources, columns, and filters.
 */
import type { AnalysisResult } from "@data-analysis/shared";
export interface AnalysisScope {
    dataSources: string[];
    columns: string[];
    filters: Record<string, unknown>;
}
export declare function resolveScope(query: string): AnalysisResult;
