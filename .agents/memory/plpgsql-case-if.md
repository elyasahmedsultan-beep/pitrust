---
name: PL/pgSQL CASE conditions
description: Avoid ambiguous CASE parsing inside PL/pgSQL IF conditions.
---

When a `CASE` expression appears inside a PL/pgSQL `IF` boolean comparison, parenthesize the complete `CASE ... END` expression.

**Why:** An unparenthesized CASE nested in an IF condition can produce `syntax error at end of input`; PL/pgSQL may treat the CASE's `THEN` as the IF condition terminator.

**How to apply:** Write comparisons as `value <> (CASE WHEN ... THEN ... ELSE ... END)` and validate the function definition with PostgreSQL before asking a user to apply a migration.