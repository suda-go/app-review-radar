---
inclusion: always
---

# Data Analysis Toolkit

This is a TypeScript monorepo using npm workspaces.

## Layout
- `skills/` — Kiro skills for data analysis (each skill is its own package)
- `mcps/` — MCP servers for data connections (each connector is its own package)
- `shared/` — Shared types and utilities consumed by skills and MCPs

## Conventions
- All packages use TypeScript with strict mode
- Shared types go in `shared/src/`
- Each skill/MCP has its own `package.json` and `tsconfig.json`
- Use `@data-analysis/` namespace for package names
