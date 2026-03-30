# Bot Update Notes

Update the `UPDATE_NOTES` constant in `discord-bot/index.js` to accurately reflect all changes in the current commit.

## Steps

1. **Get the diff** — Run `git diff HEAD discord-bot/index.js` (and `git diff --cached discord-bot/index.js` for staged changes) to see exactly what changed.

2. **Read the current UPDATE_NOTES** — Find the `UPDATE_NOTES` constant near the top of `discord-bot/index.js` (around line 530). Read its current value.

3. **Analyze the changes** and produce a new `UPDATE_NOTES` array that accurately describes ONLY what changed in this specific update. Each entry is `{ name, value }`:
   - Use clear, non-technical language that server members will understand
   - Use relevant emoji in the `name` field (🐛 for bugs, ✨ for features, ⚙️ for config changes, 🔒 for security, etc.)
   - Be specific — don't say "fixed a bug", say what the bug was and what it does now
   - Keep each `value` under 200 characters
   - Do NOT include changes from previous deploys — only THIS update
   - If nothing in `discord-bot/index.js` changed, leave UPDATE_NOTES as a single entry: `{ name: '🔧 Maintenance', value: 'Internal improvements and stability fixes.' }`

4. **Update the file** — Replace the `UPDATE_NOTES` array in `discord-bot/index.js` with the new one.

5. **Confirm** — Show the user the new UPDATE_NOTES before proceeding.
