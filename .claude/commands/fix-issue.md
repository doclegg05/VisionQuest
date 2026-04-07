# /project:fix-issue

Fix a reported issue by number or description.

## Steps
1. Read the issue description (from Linear, GitHub, or user prompt)
2. Identify the affected files and reproduce the bug locally if possible
3. Implement the fix with minimal diff
4. Run `npx eslint .` and `npx prisma validate`
5. Summarize the root cause and the fix applied
