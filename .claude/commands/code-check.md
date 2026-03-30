# Code Check

Review all recently changed code for errors before committing.

## Steps

1. **Syntax check** — Run `node --check discord-bot/index.js` and report result. If it fails, show the error and STOP — do not proceed further.

2. **Identify changed files** — Run `git diff --name-only HEAD` and `git diff --name-only --cached` to get all modified files.

3. **Review each changed file** for:
   - Logic errors or bugs introduced by the change
   - Missing `await` on async calls
   - Unhandled promise rejections or missing `.catch()`
   - Variables used before being defined
   - Any `console.log` debug statements left in
   - Firestore save/load pairs — if data is written, confirm it's also loaded at startup
   - Any hardcoded test values or temporary hacks that shouldn't be committed
   - Security issues: SQL injection, command injection, leaking tokens/secrets

4. **Discord-bot specific checks**:
   - If a new event handler was added, confirm the required Intent and/or Partial is registered
   - If a new slash command was added, confirm it's both in the `commands` array AND has a handler in `interactionCreate`
   - If a new Map/state variable was added, confirm it's populated from Firestore at startup and saved periodically

5. **Report** — Output a clear summary:
   - ✅ if everything looks clean
   - ❌ with specific line numbers and descriptions for any issues found

Do NOT fix issues automatically — only report them. The user will decide what to fix before committing.
