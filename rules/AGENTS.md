# Windows Auto Permission Guardrail

This environment uses the `win-auto-perm` lifecycle hook to simulate Antigravity's Auto mode on Windows platforms without native 24H2 sandbox support.

- Routine development, build, test, query, and navigation commands are automatically approved by the lifecycle hook.
- Destructive commands (e.g., recursive deletion, disk formatting, registry edits, hard git resets) will be intercepted and escalated to the user for manual confirmation.
- Prefer executing commands cleanly and without unnecessary destructive flags.
