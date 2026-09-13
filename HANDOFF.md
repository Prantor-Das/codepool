# CodePool Handoff

## 1. Project Overview

CodePool is a Next.js web application that connects GitHub repositories, receives pull-request webhooks, generates repository-aware AI code reviews, and displays review results in a dashboard. The longer-term product goal is to use repository history and runtime/review evidence to identify regression risk and preserve historical bug fixes as reusable invariants and antibodies.

The intended users are developers and teams who want automated PR review with repository context, historical bug knowledge, and eventually sandbox validation for high-risk changes.

Current development objective: continue the repository-memory and regression-analysis architecture. The current `HEAD` contains the Neo4j graph foundation, Git/AST history ingestion, historical bug-fix mining, and the first regression-judge/impact-analysis integration. The next engineering work is live-service validation and hardening, followed by a Sandbox Diff Engine.

Technology and services:

- Next.js `16.3.4`, React `19.2.8`, TypeScript, App Router, Tailwind/shadcn/Base UI.
- Bun `1.4.2` as the declared package manager.
- Better Auth, Kysely, PostgreSQL, and Prisma ORM Postgres contracts/migrations for users, OAuth accounts, connected repositories, reviews, and webhook-delivery deduplication.
- Octokit for GitHub OAuth-related API access, repository contents, commits, pull requests, check runs, comments, and webhooks.
- Inngest for asynchronous indexing, history mining, review generation, polling, and graph jobs.
- Google AI SDK with `gemini-3.6-flash` for reviews, bug classification, invariant extraction, antibody extraction, and regression-judge context.
- Pinecone integrated records for repository source-code vectors and historical antibody vectors.
- Neo4j via `neo4j-driver` for the Repository Memory Graph.
- `ts-morph` for in-memory TypeScript/JavaScript AST extraction.

The actual workspace is `C:\Users\adrij\Desktop\codepool`. `README.md` now documents the actual setup and architecture, including the Repository Memory and sandbox sections; this file remains the authoritative continuation document for implementation status and risks.

## 2. Current State

### Completed

- GitHub repository connection, OAuth account lookup, webhook installation, webhook HMAC verification, webhook-delivery deduplication, review queue/check-run lifecycle, review generation, and dashboard/review UI are present.
- Neo4j client, session cleanup wrapper, graph writer, provenance validation, and uniqueness constraints exist in `module/knowledge-graph`.
- Canonical graph labels and relationship names are represented in `module/knowledge-graph/lib/graph-writer.ts`. Nodes and relationships written through the shared writer carry `sourceType` and `confidence`.
- Full commit history mining and merged-PR graph ingestion exist. AST extraction produces symbols, calls, reads/writes, route hints, imports/exports, and content hashes. `Symbol` and `SymbolVersion` are separate; a new version is intended only when the AST content hash changes.
- Historical bug-fix mining exists: LLM classification, invariant extraction, antibody extraction, Neo4j relationships, candidate lifecycle fields, and Pinecone `repo-antibodies` indexing.
- Inngest functions exist for `history.mine.requested`, `bug.classify`, `antibody.extract.requested`, and `invariant.extract.requested`.
- Regression impact analysis exists in `module/knowledge-graph/impact`, including bounded blast-radius and historical-impact queries.
- Regression-judge orchestration exists in `module/regression/judge.ts`; the review function includes its structured context and routing tier in the review prompt.
- Risk scoring exists in `module/regression/risk-score.ts`, with a `0.75` sandbox-routing threshold.
- The current branch is `main`, and the latest commit is `f617aaa` (`feat: Implement regression judge context and impact analysis`).

### In Progress

- Impact analysis and historical/antibody paths have not been validated against a live Neo4j/Pinecone deployment in this workspace.
- The regression judge uses best-effort regex diff parsing and may fail to identify edits inside existing symbols or symbols represented by changed files but not newly declared in the diff.
- The `IMPORTS` graph relationship path was added but is not reliable yet; see Known Bugs.
- The current working tree was clean before this README/documentation task. The intended changes from this session are `README.md` and this updated `HANDOFF.md`.

### Not Started

- Production-grade Sandbox Diff Engine/provider rollout and operational hardening.
- Optional Neo4j GDS PageRank/fragility precomputation.
- UI or persistence for impact score, risk tier, historical matches, graph context, or sandbox results.
- Automatic discovery of all historical merged PRs from GitHub and automatic dispatch of `history.mine.requested` from repository connection. The current history pipeline expects an event containing `HistoricalPullRequest[]`.
- Focused unit tests for blast radius, historical impact, judge diff parsing, risk score, and fallback behavior.
- Production-grade graph/Pinecone observability, retry/checkpoint strategy, and cross-store consistency handling.
- Accurate AST-based changed-symbol identification for arbitrary PR diffs.
- Ongoing README refinement as architecture and provider configuration evolve.

### Blocked

- Live graph/vector verification is blocked in this environment because `.env` does not contain verified Neo4j credentials, and no live service configuration was supplied for this session. Do not add real credentials to git or to `HANDOFF.md`.
- Any end-to-end GitHub/Inngest/Google/Pinecone/Neo4j verification also requires valid service credentials and running/configured services.

### Known Bugs

- `module/knowledge-graph/history/commit-miner.ts` attempts `IMPORTS` edges before the current batch's `Symbol` nodes are upserted. First-pass imports can therefore have no targets. Move import-edge creation after symbol creation.
- Import resolution is incomplete: it does not correctly account for the importing file's directory and does not robustly support `.js`, `.mts`, `../`, aliases, extension variants, or index files. One path currently swallows query failures; errors should be scoped and observable.
- `CALLS` resolution is repository-wide name matching. Same-named functions/classes can be connected incorrectly, and aliases/qualified methods are not resolved semantically.
- `changedIdentifiersFromDiff()` in `module/regression/judge.ts` is regex-based and mainly catches added function/class/simple variable declarations. It misses body-only edits, methods, many export/assignment forms, deleted/renamed symbols, and changes with no added declaration.
- Graph and Pinecone failures in regression-judge context are intentionally degraded to empty context so ordinary reviews can continue, but the failures are not yet surfaced through a durable metric/event.
- Neo4j Cypher in the impact modules has not been run against the target Neo4j version. Validate syntax, bounded traversal, and query plans.
- `repository.graph.build.requested` invokes full `mineRepositoryHistory()`, so it reparses full history instead of being an incremental graph refresh.
- Full history mining performs many sequential GitHub API calls and has no explicit checkpoint, rate-limit, or backoff strategy.
- Graph write and Pinecone antibody upsert are not one transaction. A Pinecone failure after Neo4j writes can leave the two stores temporarily divergent; a Neo4j failure after a vector write has the inverse risk.
- `scripts/verify-ingestion.ts` cleanup only matches the repository root ID while generated child nodes use prefixed IDs, so successful fixture runs may leave data.
- `scripts/verify-antibodies.ts` uses deterministic fixture/stub extractor dependencies but still requires live Neo4j and Pinecone for persistence; it is not a pure unit test.
- Current UI/source strings contain malformed replacement characters in places such as review queue text. This predates the regression work.
- README now documents the current architecture, but should be kept synchronized as sandbox/provider behavior evolves.

## 3. Current Task

The last implementation objective was to build a regression-judge context for an opened/synchronized PR. It should combine bounded Neo4j graph reachability, historical antibody/invariant evidence, Pinecone semantic context, and a weighted risk score, then route high-risk or historical-resurrection candidates toward a future Sandbox Diff Engine.

Implemented behavior:

1. The existing webhook queues `pr.review.requested` for opened/synchronize/reopened/ready-for-review PR actions.
2. `generateReview` fetches the PR diff/title/body.
3. `buildRegressionJudgeContext()` extracts best-effort changed identifiers, queries graph impact and historical impact, retrieves Pinecone context, calculates a score, and returns a structured context plus either `standard-review` or `sandbox-diff-engine` tier.
4. The review prompt includes that structured JSON and the tier before the raw diff. The tier is advisory context only; it is not proof of a runtime regression.

The historical knowledge path is also present:

- A `HistoricalPullRequest` contains repository/PR identity, title/body/diff, optional linked issue, stable touched-symbol IDs, and optional regression-test IDs.
- Bug-fix classification returns `{ isBugFix, confidence }` from Gemini.
- Invariant extraction returns statement/category/severity/confidence. Invariants are independent Neo4j nodes with `status: "candidate"`, `validFrom`, `validUntil`, and `supersededBy` fields.
- Antibody extraction returns problem/root cause/confidence. Antibodies are independent candidate nodes and link to the invariant, PR, touched symbols, and regression tests.
- Antibody text is upserted to Pinecone namespace `repo-antibodies` with `neo4jId` metadata.

Expected final behavior for the regression work: normal review generation remains available when graph/vector services are unavailable, while degradation is observable; known historical fixes and bounded structural impact are included when services are available; high-risk routing eventually launches a real Sandbox Diff Engine without presenting a heuristic tier as a confirmed regression.

Acceptance criteria for the next implementation phase:

1. `bun run verify:ingestion` and `bun run verify:impact` pass against a configured Neo4j instance and clean their fixtures.
2. A helper two or three `CALLS` hops from an antibody discovers that antibody/invariant and any served endpoint, without exceeding the configured bounds.
3. Nested relative import traversal works and no import-query errors are silently discarded.
4. `bun run verify:antibodies` passes against configured Neo4j and Pinecone and confirms the expected Antibody/Invariant/Symbol/PullRequest links.
5. Ordinary review generation still works with unavailable graph/vector services, with an explicit degraded signal or observability path.
6. A high score or historical resurrection can invoke a real Sandbox Diff Engine once that component is implemented.

## 4. Work Completed In This Session

This session was a documentation session. No application code, dependency, database, or environment value was intentionally changed.

- `HANDOFF.md`
  - Inspected the actual repository, current branch/log/status, package/configuration, README, tests, graph/history/impact/review code, webhook/auth flow, and environment template.
  - Replaced stale status text that described impact work as uncommitted even though it is in `HEAD`.
  - Corrected the workspace path, documented current commit state, separated completed/in-progress/not-started/blocked work, recorded known implementation risks, and documented exact commands/environment names without secrets.
  - This file is one of the two intentional modified documentation files after this session and should not be reverted or discarded.

- `README.md`
  - Replaced the stock Next.js README with project-specific setup, architecture, environment, workflow, command, limitation, and development documentation.
  - Added a dedicated Repository Memory and Sandbox section describing Neo4j/Pinecone/PostgreSQL ownership, graph relationships, historical antibody flow, regression judging, and the configured differential execution path.
  - No application behavior was changed; README content was based on the inspected source/configuration and `HANDOFF.md`.

Previously completed work relevant to continuation is in the recent commits, not newly authored in this session:

- `410d855`: Neo4j client/writer, constraints, and graph verification script.
- `1b17b7b`: history synchronization, AST extraction, commit/merged-PR graph ingestion, webhook/function wiring, and ingestion fixture.
- `284aa3e`: bug classifier, invariant/antibody extractors, pipeline, Pinecone antibody namespace, Inngest chain, and antibody fixture.
- `f617aaa`: regression judge context, impact queries, risk scoring, review integration, and impact fixture.

## 5. Files That Matter

| File | Importance | Purpose | Current relevance |
| ---- | ---- | ---- | ---- |
| `HANDOFF.md` | Critical | Continuation record | Read first; this file is the source of current project status. |
| `package.json` | Critical | Dependencies and verified scripts | Defines Bun commands, Neo4j/Pinecone/AI dependencies, and fixture commands. |
| `.env.example` | Critical | Configuration template | Lists required PostgreSQL, GitHub, Google, Pinecone, and Neo4j variable names. |
| `app/api/webhook/github/route.ts` | Critical | GitHub webhook ingress | Verifies/deduplicates webhooks and queues review/merged-PR events. |
| `app/api/inngest/route.ts` | Critical | Inngest endpoint registration | Registers review, graph, history, and impact-related functions. |
| `app/api/inngest/functions/review.ts` | Critical | Review worker | Fetches PR data, builds regression context, invokes the model, and updates GitHub/Postgres. |
| `app/api/inngest/functions/index.ts` | High | Existing async jobs | Repository indexing, full history sync, merged-PR ingestion, polling, and stale-review cleanup. |
| `app/api/inngest/functions/history.ts` | High | Historical bug-fix event chain | Wires `history.mine.requested` through classification and extraction to graph write. |
| `module/knowledge-graph/lib/graph-client.ts` | High | Neo4j driver/session access | Lazy singleton driver; validates `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`; always closes sessions. |
| `module/knowledge-graph/lib/graph-writer.ts` | High | Canonical graph write API | Validates labels, relationship types, and provenance; sets `sourceType`/`confidence`. |
| `module/knowledge-graph/schema/constraints.ts` | High | Graph schema initialization | Applies idempotent uniqueness constraints on requested node IDs. |
| `module/knowledge-graph/extraction/ast.ts` | High | AST extraction | Produces symbols, content hashes, calls, reads/writes, routes, imports, and exports. |
| `module/knowledge-graph/history/commit-miner.ts` | Critical | Git/AST graph ingestion | Creates repository/commit/file/symbol/version graph; inspect before fixing `IMPORTS` or version behavior. |
| `module/knowledge-graph/history/bug-classifier.ts` | High | LLM bug-fix classifier | Defines `HistoricalPullRequest` and classification contract. |
| `module/knowledge-graph/history/invariant-extractor.ts` | High | Invariant LLM extraction | Extracts plain-English statement/category/severity/confidence. |
| `module/knowledge-graph/history/antibody-extractor.ts` | High | Antibody LLM extraction | Extracts problem/root cause/confidence. |
| `module/knowledge-graph/history/bug-fix-pipeline.ts` | Critical | Historical knowledge persistence | Writes candidate Bug/Invariant/Antibody graph and `repo-antibodies` Pinecone records. |
| `module/knowledge-graph/impact/blast-radius.ts` | Critical | Bounded graph impact query | Finds callers/reachable symbols, antibody/invariant links, endpoints, scenarios, and data dependencies. |
| `module/knowledge-graph/impact/historical-impact.ts` | Critical | Historical resurrection query | Finds historical fixes reachable from changed symbols. |
| `module/regression/judge.ts` | Critical | Regression context orchestration | Merges diff, graph, history, Pinecone, score, and routing tier. |
| `module/regression/risk-score.ts` | High | Score contract | Contains relationship/distance/history/runtime/change weights and `0.75` threshold. |
| `module/ai/lib/rag.ts` | High | Existing source-code Pinecone path | Indexes repository files and retrieves semantic context in the default namespace. |
| `module/ai/lib/generate-json.ts` | High | Shared structured AI call | Uses the existing Gemini provider for history extraction. |
| `lib/modelscope.ts` | High | Existing review model wrapper | Despite its name, currently uses Google Gemini; the ModelScope env naming is stale. |
| `module/github/lib/github.ts` | High | Octokit service layer | GitHub repository, PR, diff, contents, check-run, and webhook helpers. |
| `src/prisma/contract.prisma` | High | PostgreSQL contract | Defines User, Session, Account, Repository, Review, and WebhookDelivery models. |
| `lib/auth.ts` | High | Better Auth setup | Configures Kysely/Postgres and GitHub OAuth. |
| `scripts/verify-graph-setup.ts` | Medium | Basic Neo4j fixture | Applies constraints and verifies repository/commit/symbol/version chain. |
| `scripts/verify-ingestion.ts` | Medium | AST/history fixture | Verifies ingestion basics; cleanup has a known prefix issue. |
| `scripts/verify-antibodies.ts` | High | Historical knowledge fixture | Uses three fixtures/stub extraction and verifies antibody/invariant/symbol/PR links plus Pinecone persistence. |
| `scripts/verify-impact.ts` | High | Impact fixture | Verifies bounded multi-hop graph impact and historical match. |
| `README.md` | High | User documentation | Documents current setup, complete application flow, memory architecture, historical PR handling, sandbox differential execution, and limitations. |

## 6. Architecture

### Application, authentication, and operational data

```text
Browser (React/TanStack Query)
  -> Next.js App Router pages/components
  -> server actions / API routes
  -> Better Auth + Kysely/PostgreSQL
  -> Octokit GitHub API
```

- Better Auth is configured in `lib/auth.ts`; GitHub OAuth uses `repo` and `user:email` scopes.
- PostgreSQL owns users, sessions, accounts/tokens, connected repositories, review records, and webhook-delivery deduplication.
- `module/repository/action/index.ts` validates the authenticated user, creates/reconciles a GitHub webhook, persists the repository, and queues connection/sync events.
- The UI has dashboard, repository, settings, authentication, review list, and review-detail flows. It does not currently display graph impact data.

### Repository indexing and graph ingestion

```text
Connected repository
  -> repository.connected
      -> GitHub contents -> Pinecone source-code records
  -> repository.sync.requested
      -> GitHub commits oldest-first
      -> ts-morph AST extraction
      -> Neo4j Repository/Commit/File/Symbol/SymbolVersion graph
```

- `module/ai/lib/rag.ts` indexes source files using the existing Pinecone integrated-record API and retrieves source context with repository filtering.
- `module/knowledge-graph/history/commit-miner.ts` writes Git/AST provenance and uses symbol content hashes for version creation.
- `pull_request.merged` performs merged-commit file ingestion. It does not itself automatically run the historical bug-fix LLM pipeline.

### Historical bug-fix knowledge

```text
history.mine.requested { pullRequests }
  -> bug.classify
      -> antibody.extract.requested
          -> invariant.extract.requested
              -> Neo4j graph write + Pinecone repo-antibodies upsert
```

The graph model is intentionally normalized:

```text
Antibody -[:PROTECTS]-> Invariant
Antibody -[:DERIVED_FROM]-> PullRequest -[:FIXED]-> Bug
Bug -[:VIOLATED]-> Invariant
Bug -[:REPORTED_IN]-> Issue
Antibody -[:WATCHES]-> Symbol
Antibody -[:VERIFIED_BY]-> Test
PullRequest -[:RESTORED]-> Invariant
```

Invariant and Antibody are separate nodes. LLM-derived nodes default to `status: candidate`; Invariant also has `validFrom`, `validUntil`, and `supersededBy` for future deprecation/supersession.

### GitHub review and regression judge

```text
GitHub pull_request webhook
  -> HMAC verification + Postgres delivery claim
  -> opened/synchronize/reopened/ready_for_review
      -> pr.review.requested
          -> fetch PR diff/title/body
          -> bounded Neo4j impact + historical lookup
          -> Pinecone semantic retrieval
          -> weighted risk score and routing tier
          -> Gemini review prompt
          -> GitHub comment/check-run + Postgres Review
```

Impact traversal bounds are currently `CALLS*1..4`, `IMPORTS*1..3`, and `READS|WRITES*1..2`. The judge catches graph/vector lookup failures to preserve standard reviews, but this fallback needs observability.

### External data ownership

```text
PostgreSQL: identity, OAuth, connected repos, review state, webhook dedupe
Neo4j: repository memory, symbols/versions, graph relationships, invariants/antibodies
Pinecone: source-code semantic records + repo-antibodies semantic records
GitHub: source of truth for repository/PR/commit/issue/check-run data
```

No PostgreSQL migration is required for Neo4j graph schema changes. Do not migrate or overwrite existing source-code Pinecone records when adding antibody records; use the dedicated `repo-antibodies` namespace.

## 7. Important Technical Decisions

1. Keep PostgreSQL/Pinecone existing data paths intact. Neo4j is an additional repository-memory layer; do not replace operational Postgres records or the existing source-code Pinecone namespace.
2. Use bounded graph traversal. Never change the impact queries to unbounded variable-length paths. Current limits are calls 4, imports 3, and data dependencies 2.
3. Preserve provenance on every graph write. Use `writeNode`/`writeRelationship` and valid `sourceType` values (`ast`, `git`, `github`, `llm`, `runtime`) with confidence `0..1`. Existing direct Cypher in the miner must also set these properties until it is refactored.
4. Keep `Symbol` separate from `SymbolVersion`. Only content changes create versions; `PREVIOUS_VERSION` points from newer to older.
5. Keep Invariant separate from Antibody. Multiple bugs/antibodies may reference one invariant; do not embed invariant JSON inside an antibody.
6. Treat the risk score and `sandbox-diff-engine` tier as routing heuristics, not evidence that a runtime regression exists. The model prompt should not claim more than the graph/diff evidence supports.
7. Keep standard reviews resilient to optional service failure, but add logs/metrics/degraded-state data rather than silently hiding all failures.
8. Use `.env.example` for documenting new variables. Never edit or commit real `.env` secrets.
9. Inngest functions must be registered in `app/api/inngest/route.ts`; adding a function file alone does not make it active.

## 8. Commands

Run commands from `C:\Users\adrij\Desktop\codepool`.

```bash
# Install dependencies with the declared package manager
bun install

# Start the Next.js development server
bun run dev

# Start the local Inngest development process
bun run inngest:dev

# Start the optional localtunnel helper for public GitHub webhooks
bun run dev:tunnel

# Tests and static checks
bun test
bun run lint
bunx tsc --noEmit --incremental false

# Production build/start
bun run build
bun run start

# PostgreSQL/Prisma contract and migration commands
bun run db:generate
bun run db:init
bun run db:migrate
bun run db:status
bun run db:setup

# Service-backed fixtures; require configured Neo4j and, for antibodies, Pinecone
bun run verify:graph
bun run verify:ingestion
bun run verify:antibodies
bun run verify:impact
```

There is no project-specific deployment command in `package.json`; deployment is not documented or verified in this repository. `bunx tsc --noEmit` with incremental mode attempted to write `tsconfig.tsbuildinfo` and previously hit managed-workspace `EPERM`; use `--incremental false` for a clean validation command here.

## 9. Environment Variables

Configure these in local `.env`, usually by copying `.env.example`. Real values are intentionally omitted here and must never be committed.

```text
DATABASE_URL=<required PostgreSQL connection string>
BETTER_AUTH_SECRET=<required>
BETTER_AUTH_URL=<required application URL>
NEXT_PUBLIC_BETTER_AUTH_URL=<optional browser URL override>
NEXT_PUBLIC_BASE_URL=<required public URL for production GitHub webhooks>

GITHUB_CLIENT_ID=<required for GitHub OAuth>
GITHUB_CLIENT_SECRET=<required for GitHub OAuth>
GITHUB_WEBHOOK_SECRET=<required for webhook verification/creation>

GOOGLE_GENERATIVE_AI_API_KEY=<required for Gemini review/classification/extraction>
PINECONE_DB_API_KEY=<required; PINECONE_API_KEY is also accepted by code>
PINECONE_INDEX=<required Pinecone index name>
PINECONE_TEXT_FIELD=<optional; defaults to text>

NEO4J_URI=<required for Neo4j operations>
NEO4J_USER=<required for Neo4j operations>
NEO4J_PASSWORD=<required for Neo4j operations>
```

`.env.example` also contains `MODELSCOPE_API_KEY` because of older project naming, but current review/extraction code uses the Google AI SDK and `GOOGLE_GENERATIVE_AI_API_KEY`. `NEXT_PUBLIC_BASE_URL` must be public/non-local for production webhook installation; local development can use the tunnel helper.

## 10. Testing Status

Verified during this handoff audit:

| Command | Result |
| --- | --- |
| `bun test` | Passed: 5 tests in 2 files, 0 failures. |
| `bun run lint` | Completed with no errors; an existing unused `sourceFile` warning in `module/knowledge-graph/extraction/ast.ts` may appear depending on the checked revision. |
| `bunx tsc --noEmit --incremental false` | Passed. |

Not verified in this environment:

- `bun run build` was not run in this audit.
- `bun run verify:graph`, `verify:ingestion`, `verify:antibodies`, and `verify:impact` were not run successfully against live services because verified Neo4j/Pinecone configuration was unavailable.
- No live Neo4j Cypher, Pinecone upsert/search, Gemini call, GitHub OAuth/webhook, Inngest delivery, or PostgreSQL migration was exercised in this audit.
- No focused unit tests cover impact queries, judge diff parsing, risk scoring, historical pipeline orchestration, or graph/Pinecone failure fallback.

Previously observed implementation errors:

- `bun add neo4j-driver` initially hit sandbox temp-directory `EPERM`; the dependency was subsequently installed with approved escalation and is present in `package.json`/`bun.lock`.
- Running `bun run verify:graph`/`bun run verify:antibodies` without Neo4j variables fails with the expected `Neo4j is not configured. Set NEO4J_URI.` error. This is configuration failure, not proof that live Cypher passes.

## 11. Git / Change Status

- Branch: `main`.
- `HEAD`: `f617aaa feat: Implement regression judge context and impact analysis`.
- `origin/main` and `origin/HEAD` pointed to the same commit during inspection.
- Before this documentation update, `git status --short` was clean and there were no uncommitted application changes.
- This documentation task intentionally modifies `README.md` and `HANDOFF.md`; do not discard either file. No commit was created.
- Recent relevant commits:

```text
f617aaa feat: Implement regression judge context and impact analysis
284aa3e feat: implement historical bug fix mining and classification functions, add antibody and invariant extraction, and create verification script
1b17b7b feat: implement repository history synchronization and graph ingestion functions, enhance GitHub webhook handling, and add ingestion verification script
410d855 feat: integrate Neo4j support with graph client and writer, add schema constraints, and implement verification script
```

After this file is written, run `git status --short` and verify that only the intended `README.md` and `HANDOFF.md` changes are present. Do not use destructive reset/checkout commands to clean the tree.

## 12. Problems / Risks

- The most important functional risk is broken/incomplete `IMPORTS` materialization, which can make import-based impact reachability empty or incorrect until fixed and reindexed.
- Open-PR analysis uses an already-ingested graph and a regex-derived changed-symbol list. The PR head is not AST-ingested before review, so stale or empty graph context is possible.
- Historical antibody data is not automatically mined for every repository connection; it requires the history event payload and successful asynchronous LLM/Pinecone/Neo4j work.
- Full history mining is API-expensive and retrying Inngest jobs can repeat GitHub/Neo4j work without checkpoints.
- Endpoint inference is limited to current AST route heuristics, and normal ingestion does not yet populate runtime Scenarios; fixtures create scenarios only for validation.
- Prompt size can grow because structured judge context and raw diffs are both sent to Gemini; add caps/summarization before production scale.
- Cross-store graph/vector writes lack atomicity and reconciliation.
- GitHub OAuth access tokens are read from Postgres account rows by async jobs. Preserve repository ownership checks and do not expose token values in logs or docs.
- Existing `.env` contains private credentials in the local workspace and is gitignored. Never print, copy, or commit them.

## 13. Next Steps

1. Read this file and inspect `git status --short`; preserve the intentional README and handoff changes.
2. Fix `IMPORTS` in `module/knowledge-graph/history/commit-miner.ts`: run after symbol upserts, resolve nested relative paths from the importer directory, support relevant TS/JS extension/index variants, and stop swallowing all errors.
3. Add or update a small fixture proving import reachability, then run `bun run verify:ingestion` with Neo4j.
4. Configure isolated Neo4j/Pinecone test services and run `bun run verify:graph`, `bun run verify:antibodies`, and `bun run verify:impact`; repair Cypher/type/cleanup issues revealed by real runs.
5. Add unit tests for `changedIdentifiersFromDiff()`, `computeImpactScore()`, bounded traversal assumptions, and judge service-failure fallback.
6. Replace/augment regex changed-symbol detection with AST extraction of PR-head changed files, including body-only edits, methods, renames, and deletions.
7. Add explicit degraded-context logging/metrics and decide whether score/tier should be persisted in the PostgreSQL `Review` record or exposed in the UI.
8. Add reconciliation or retry strategy for Neo4j/Pinecone antibody writes.
9. Harden and complete the Sandbox Diff Engine/provider rollout, then connect the `sandbox-diff-engine` tier without treating the tier as confirmed runtime evidence.
10. Keep `README.md` synchronized with setup, service dependencies, graph model, event flow, and verification commands.
11. Re-run `bun test`, `bun run lint`, `bunx tsc --noEmit --incremental false`, and relevant service fixtures; then update this handoff and review the diff before committing.

## NEXT ACTION

Open `module/knowledge-graph/history/commit-miner.ts` and fix the `IMPORTS` write ordering and nested relative-module resolution first. Then configure a disposable Neo4j instance and run `bun run verify:ingestion` and `bun run verify:impact` before changing the regression judge further.
