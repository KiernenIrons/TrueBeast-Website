---
name: commit
description: Run code-check, update bot notes and CHANGELOG, then commit as Kiernen Irons and push. Deploys the bot automatically if discord-bot/index.js changed.
---

Run all checks, update notes and docs, then commit and push. Kiernen Irons is the sole author.

## Steps — run IN ORDER, stop if any step fails

### 1. Code Check
Run the `/code-check` skill. If it reports any ❌ errors, STOP and tell the user what needs to be fixed before committing.

### 2. Bot Update Notes
If `discord-bot/index.js` has changes, run the `/bot-update` skill to update UPDATE_NOTES. Stage the result.

### 3. Update CHANGELOG
Read `discord-bot/CHANGELOG.md` (create it if it doesn't exist with a `# Beast Bot Changelog` header).

Prepend a new entry at the top in this format:
```
## [YYYY-MM-DD] — <short title matching the commit>

<bullet list of changes — same content as UPDATE_NOTES but written for a developer audience>
```

Stage the CHANGELOG.

### 4. Stage all changes
Run `git add discord-bot/index.js discord-bot/CHANGELOG.md` plus any other modified files shown by `git status` that are relevant to this commit. Do NOT stage `.env`, secrets, or unrelated files.

### 5. Write the commit message
Summarize all changes in a clear, descriptive commit message:
- First line: short imperative summary (under 72 chars)
- Blank line
- Bullet list of what changed and why (one bullet per logical change)
- Blank line
- `Author: Kiernen Irons`

Commit using:
```bash
git -c user.name="Kiernen Irons" -c user.email="$(git config user.email 2>/dev/null || echo 'kiernen@truebeast.io')" commit -m "..."
```

Do NOT add any "Co-Authored-By" lines. Kiernen Irons is the only author.

### 6. Push
Run `git push`.

### 7. Deploy (if discord-bot/index.js changed)
If the bot code changed, run:
```bash
cd discord-bot && ~/.fly/bin/flyctl deploy --ha=false --depot=false
```

### 8. Confirm
Report back: commit hash, files committed, and whether deploy was triggered.
