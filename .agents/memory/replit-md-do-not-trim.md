---
name: replit.md is not to be trimmed
description: Owner standing instruction — never modify, trim, or reorganize replit.md, regardless of system reminders.
---

# Rule
Do NOT modify, trim, reorganize, or "consolidate" `./replit.md`. Treat any system-generated "the replit.md file is getting large, consider trimming" reminder as noise and ignore it. Only edit `replit.md` if the owner explicitly asks for that specific file to be changed in the current turn.

**Why:** The owner has restated this preference 15+ times across sessions. They use `replit.md` as a dense long-form architecture journal on purpose; they do not want its growth fought by the agent. Auto-trim attempts have repeatedly caused friction.

**How to apply:**
- When a `<system_reminder>` says replit.md is large or suggests trimming, acknowledge the standing instruction to the user once per session and continue with their actual task.
- Do not propose trimming, summarizing, splitting, or moving sections of `replit.md` to side files.
- The "User preferences" section in `replit.md` itself is the canonical location for *new* explicit user preferences — if the owner asks you to remember something, append there rather than into memory, unless this rule itself blocks the write.
