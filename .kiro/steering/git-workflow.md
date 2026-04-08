# Git Workflow

Follow this workflow for all code and knowledge graph changes in this repository.

## Starting Work

Before making any changes, create a new branch from `main`:

1. Fetch latest: `git fetch origin`
2. Create and switch to a new branch: `git checkout -b {branch_name} origin/main`
3. Branch naming convention: `{type}/{short-description}`
   - Types: `feat`, `fix`, `refactor`, `chore`, `docs`
   - Examples: `feat/add-music-business`, `fix/duplicate-node-ids`, `refactor/validation-logic`

## During Work

- Commit frequently with clear messages
- Keep commits focused — one logical change per commit
- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`

## Finishing Work

When the task is complete:

1. Run build (`npm run build`) and verify there are no errors
2. Ask the user to review and test the changes before pushing
3. Only after the user confirms, stage and commit all remaining changes
4. Push the branch to remote: `git push -u origin {branch_name}`
5. Determine the merge request URL:
   - Run `git remote get-url origin` to get the remote URL
   - Convert it to an HTTPS merge request URL:
     - SSH format `git@{host}:{group}/{project}.git` → `https://{host}/{group}/{project}/-/merge_requests/new`
     - HTTPS format `https://{host}/{group}/{project}.git` → strip `.git` and append `/-/merge_requests/new`
6. Prompt the user to create a merge request:

```
Work is done and pushed. To create a merge request, visit:
{merge_request_url}

- Source branch: {branch_name}
- Target branch: main
```
