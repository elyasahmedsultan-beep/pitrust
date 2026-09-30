---
name: Node strip-types tests
description: TypeScript syntax restrictions in Node's strip-only test runner.
---

Modules imported by tests running under `node --experimental-strip-types` must avoid TypeScript constructor parameter properties. Declare fields and assign them in the constructor body instead.

**Why:** The API test runner raised `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` for a parameter property even though the project typecheck passed.

**How to apply:** When adding classes in the import graph of strip-only tests, use syntax Node can erase without compilation or switch the test path to a compiling runner.