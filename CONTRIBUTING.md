# Contributing

## Change classes

- Execution bug fix: may change scripts, schemas, reporter, tests, or workflows without weakening a gate.
- Adapter/mapping addition: may add systems, contracts, segments, or caller examples.
- Methodology change: prohibited in v1.1.x; requires a separately approved version.

## Required verification

Run `npm ci` and `npm run verify`. Every behavior change needs a test that fails before the change
and passes after it. Governance changes require CODEOWNER review. Do not push directly to `main`.

## Trust boundary

Playwright attachments are supporting evidence. A core backend assertion may pass only when a
protected trusted probe independently observes the expected value. AI-written prose and booleans
are never Gate inputs.
