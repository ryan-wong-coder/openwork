# Zeno shared personal-data contracts

One set of Zod schemas defines calendar, fitness, account sync and local task
records for the web app, native service and independent API. The generated
`ZenoClient` is included alongside the ergonomic account-fenced client.

Build before using the default package exports or running the compiled-export
regression tests:

```sh
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @zeno/core build
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @zeno/core test
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @zeno/core contract:check
```

The five public entries resolve to bundled JavaScript and declarations in
`dist/`; development builds may resolve the original TypeScript. Every
independent Zod instance is configured with `jitless: true` before schema
construction, avoiding dynamic parser compilation and its eval capability
probe under the PWA's self-only script policy. The CSP regression imports
each actual compiled entry in a fresh Node process with all dynamic Function
construction intercepted, then validates representative data with zero
attempts. This does not replace the real browser CSP acceptance.

Regenerate both the independent OpenAPI and SDK together with
`pnpm --filter @zeno/core contract:generate`; do not edit generated files.
The Den OpenAPI/SDK remain a separate contract pipeline.
