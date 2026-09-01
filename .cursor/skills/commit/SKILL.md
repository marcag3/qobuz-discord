---
name: commit
description: >-
  Commit current changes using the gitmoji convention. Use when the user invokes
  /commit or asks to commit with gitmoji.
disable-model-invocation: true
---

# /commit — gitmoji commits

Commit your changes using the gitmoji convention.

## Workflow

1. **Inspect changes** — run these in parallel:
   ```bash
   git status
   git diff
   git diff --staged
   git log --oneline -5
   ```

2. **Pick one gitmoji** that best matches the primary intent of the change. Use only one emoji per commit.

3. **Draft the message** using this format:
   ```
   <emoji> <short description>

   [optional body — explain why, not what]
   ```

   Rules:
   - Imperative mood, under 60 characters for the subject
   - One atomic purpose per commit; split unrelated changes
   - Add a body when the why is not obvious
   - Reference issue numbers when relevant (`#123`)

4. **Stage and commit** — follow the Git Safety Protocol below.

5. **Verify** with `git status` after the commit succeeds.

## Gitmoji reference

| Emoji | When to use |
|-------|-------------|
| ✨ | New feature |
| 🐛 | Bug fix |
| ♻️ | Refactor (no behavior change) |
| 🎨 | Code structure / formatting |
| ⚡️ | Performance improvement |
| 🔥 | Remove code or files |
| 📝 | Documentation |
| ✅ | Add or update tests |
| 🔧 | Configuration files |
| ⬆️ | Upgrade dependencies |
| ⬇️ | Downgrade dependencies |
| 📦 | Build system or dependencies |
| 🔒 | Security fix |
| 🚑 | Critical hotfix |
| 💥 | Breaking change |
| 🚀 | Deploy / release |
| 👷 | CI build changes |
| 🏗️ | Architectural changes |
| 🚧 | Work in progress |
| 🎉 | Initial commit |

Full list: https://gitmoji.dev

## Examples

```
✨ Add channel-aware Now Playing messages

Store the invoker's text channel so embeds post where the user ran /play.
```

```
🐛 Fix playback cleanup on stop
```

```
♻️ Extract queue formatting into shared helper
```

## Git Safety Protocol

- NEVER update the git config
- NEVER run destructive commands (`push --force`, `reset --hard`, etc.) unless explicitly requested
- NEVER skip hooks (`--no-verify`, `--no-gpg-sign`, etc.) unless explicitly requested
- NEVER force-push to `main`/`master`; warn the user if they request it
- Avoid `git commit --amend` unless ALL of these are true:
  1. User explicitly requested amend, OR the commit succeeded but a hook auto-modified files
  2. HEAD was created by you in this conversation
  3. Commit has NOT been pushed to remote
- If a commit FAILED or was REJECTED by a hook, fix the issue and create a NEW commit — never amend
- Do not commit files that likely contain secrets (`.env`, credentials). Warn the user if they ask to commit them
- Do not create an empty commit when there are no changes

## Commit command

Stage relevant files, then commit with a HEREDOC:

```bash
git add <files>
git commit -m "$(cat <<'EOF'
✨ Short description here

Optional body explaining why.
EOF
)"
```

Do NOT push unless the user explicitly asks.
