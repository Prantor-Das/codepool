# CodePool Handoff

## 1. Project Overview

CodePool is a Next.js web application for connecting GitHub repositories, receiving pull-request webhooks, generating AI code reviews, and showing those reviews in a dashboard. The intended users are developers who want repository-aware PR review and, increasingly, regression-risk detection based on repository history.

The current development objective is the repository-memory graph and regression-analysis sequence from the recent prompts:

1. Neo4j graph foundation.
2. Git/AST ingestion for commits, files, symbols, versions, and relationships.
3. Historical bug-fix mining into antibodies/invariants.
4. **Current uncommitted work:** bounded impact analysis for an open PR and integration into the LLM review path.

Stack and services:

- Next.js 16.3 / React 19 / TypeScript, App Router, Tailwind/shadcn/Base UI.
- Better Auth with PostgreSQL through Kysely and Prisma ORM Postgres contracts/migrations.
- GitHub OAuth and REST API through Octokit; GitHub `pull_request` webhooks.
- Inngest for async review, polling, history, and graph jobs.
- Google AI SDK (`gemini-3.6-flash`) for review/classification/extraction.
- Pinecone for repository and antibody semantic search.
- Neo4j (`neo4j-driver`) for repository-memory graph traversal.
- `ts-morph` for in-memory TS/JS extraction; Bun is the declared package manager.

The repository root is `C:\Users\138487\Desktop\Codepool\codepool`. `README.md` is still the stock Next.js README and does not document the actual architecture.

## 2. Current State

### Completed

- GitHub repository connection, webhook creation, authenticated review queueing, check-run lifecycle, dashboard, and review UI exist in the committed code.
- The Neo4j graph client/writer and uniqueness constraints exist. The writer validates `sourceType` and confidence (`0..1`).
- Commit ingestion, AST extraction, symbol versioning, merged-PR ingestion, and historical bug-fix/antibody/invariant pipelines exist in commits `410d855`, `1b17b7b`, and `284aa3e`.
- The uncommitted impact feature has been implemented in source files listed below.
- This session verified `bun test` (5 passing tests), `bun run lint` (no reported lint failures), and `bunx tsc --noEmit --incremental false` (success).

### In Progress

- The impact layer is implemented but not exercised against a real Neo4j server. Its fixture script exists but has not run because service credentials were not supplied.
- The review Inngest function now calls the new regression judge and passes JSON context to the LLM. This needs end-to-end validation with an actual connected repository, graph data, Pinecone, Inngest, GitHub webhook, and Google model credential.
- `IMPORTS` relationships were added to the graph writer/miner to support impact traversals, but their implementation has important defects listed under Known Bugs/Risks.

### Not Started

- Prompt 5's Sandbox Diff Engine has not been built. `sandbox-diff-engine` is currently only a risk-routing label.
- The optional Neo4j GDS PageRank fragility precomputation (`gds.pageRank.stream`) has not been implemented.
- There is no UI for graph/impact/risk data and no persistence of the judge score/tier on `Review`.
- No unit tests cover `blast-radius.ts`, `historical-impact.ts`, `risk-score.ts`, or diff symbol identification. Only an integration-style Neo4j fixture script exists.
- The stock README has not been updated for setup, architecture, or graph operations.

### Blocked

- Service-backed verification is blocked by the lack of configured service credentials in this environment. Do not expose or commit `.env`; it is gitignored.
- Neo4j, Pinecone, GitHub OAuth/webhook delivery, Inngest, and Google model calls were not exercised here.

### Known Bugs

- `module/knowledge-graph/history/commit-miner.ts` currently attempts to create `IMPORTS` edges **before** it upserts the current batch's `Symbol` nodes. On the first commit there are no symbols to connect; this needs to run after the symbol upsert.
- That import-resolution Cypher only compares `target.filePath` to strings such as `replace(modulePath, "./", "") + ".ts"`; it ignores the importing file's directory. It only has a chance for root-level relative modules and does not resolve `.js`, `.mts`, aliases, `../`, or extension/index alternatives correctly. It also swallows every query error with `.catch(() => undefined)`.
- `CALLS` resolution is name-only across a repository (`target.name = call`). Same-named functions/classes can be incorrectly connected; qualified methods and imported aliases are not resolved semantically.
- `changedIdentifiersFromDiff()` in `module/regression/judge.ts` only recognizes added `function`, `class`, and simple `const`/`let`/`var =` declarations. It misses methods, many exported/assigned forms, existing-symbol body edits, renamed/deleted symbols, and changes where no declaration line is added. An empty result yields an empty graph context.
- The judge intentionally catches all graph failures and all Pinecone failures and falls back silently to an empty context. This protects standard reviews, but operational graph failures are currently invisible except indirectly in logs/errors from callers.
- `getBlastRadius()`/`getHistoricalImpact()` use bounded Cypher subqueries but have not been executed against the target Neo4j version. Validate syntax and query plans before relying on them in production.
- `repository.graph.build.requested` calls `mineRepositoryHistory()`, so it reparses full history; this conflicts with the intended distinction that later commit handling should be incremental.
- Full history mining performs many GitHub REST calls sequentially and has no explicit rate-limit/backoff/checkpoint handling. Large repositories can be slow or rate-limited.
- The `codepool-suggested` PR-origin detector in `app/api/webhook/github/route.ts` is heuristic (`[codepool-suggested]` text or a `codepool-`/`codepool/` marker). The existing review system creates comments, not authored commits/PRs, so there is no verified native suggestion marker.
- `scripts/verify-ingestion.ts` cleanup matches only `id = $repositoryId`, while most generated graph nodes have prefixed IDs. It may leave fixture graph nodes behind after a successful run.
- Existing source/UI strings contain visibly malformed replacement characters (for example `Review in progress�?�`); this predates the impact work and should be cleaned separately.

## 3. Current Task

Original goal: implement the impact-analysis layer that runs when a PR is opened, merge blast-radius/historical/Pinecone evidence into the existing Regression Judge, compute a risk score, and route high-risk/resurrection candidates to the future Sandbox Diff Engine.

What is implemented:

- `getBlastRadius(repositoryId, changed)` returns changed symbols, callers, reachable symbols, antibodies/invariants, endpoints, scenarios, and database dependencies using bounded paths.
- `getHistoricalImpact(repositoryId, changed)` looks for `Antibody -> DERIVED_FROM -> PullRequest -> FIXED -> Bug` chains reachable by bounded `CALLS`/`IMPORTS` paths.
- `computeImpactScore()` uses the requested relationship weights and `SANDBOX_TRIGGER_SCORE = 0.75`.
- `buildRegressionJudgeContext()` derives best-effort changed identifiers from a unified diff, queries graph/history and Pinecone, calculates risk, and returns a structured object and `standard-review` or `sandbox-diff-engine` tier.
- `app/api/inngest/functions/review.ts` includes that object as JSON in the LLM prompt.
- `scripts/verify-impact.ts` builds a two-CALLS-hop antibody fixture with an endpoint and historical-fix chain, then asserts antibody discovery, endpoint discovery, and a score above the sandbox threshold.

What remains:

- Correct the `IMPORTS` edge creation timing and module-path resolution before treating import traversal as functional.
- Run `bun run verify:impact` on Neo4j and fix any Cypher compatibility/query issues.
- Add focused unit tests for diff parsing and risk scoring; add a test fixture that confirms bounded traversal behavior.
- Decide how to extract changed symbols accurately from the PR's changed files/AST rather than the current regex. GitHub's PR files API or contents at the PR head would be a suitable source.
- Implement the actual Sandbox Diff Engine and consume the tier, or persist/expose the tier so it is not only prompt text.
- Decide whether graph/Pinecone failures should emit observability events/metrics instead of being silently absorbed.

Expected final behavior: an `opened`/`synchronize` PR currently triggers `pr.review.requested`; the review function should resolve changed symbols, form bounded structural/historical/runtimesurface context, do semantic retrieval, score it, provide the structured facts to the LLM, and flag high risk for sandbox execution without claiming a runtime regression as fact.

Acceptance criteria for continuing work:

1. Real Neo4j fixture run prints all three impact PASS assertions and cleans up.
2. A changed helper two or three call hops from an antibody discovers that antibody/invariant and its served endpoint.
3. Import-derived reachability works for nested relative imports and no errors are silently discarded.
4. No traversal exceeds CALLS 4, IMPORTS 3, or data dependency 2.
5. An ordinary PR still receives a review if Neo4j/Pinecone are unavailable, while the degradation is observable.
6. A high score or historical resurrection feeds a real downstream Sandbox Diff Engine once that feature exists.

## 4. Work Completed In This Session

### Impact-analysis implementation

- `module/knowledge-graph/impact/blast-radius.ts` (new, untracked)
  - Added `ImpactSubgraph` and `getBlastRadius()`.
  - It uses separate bounded Cypher patterns: callers `[:CALLS*1..4]`, structural reachability `[:CALLS*0..4]` and `[:IMPORTS*1..3]`, and data `[:READS|WRITES*1..2]`.
  - It collects `Antibody-[:WATCHES]->Symbol`, optional `PROTECTS` invariant, `SERVES` endpoints, and reverse `TOUCHES` scenarios.
  - Not service-tested; type checked and linted only.

- `module/knowledge-graph/impact/historical-impact.ts` (new, untracked)
  - Added bounded traversal to a watched symbol and historical `Antibody -> PullRequest -> Bug`, plus optional issue/invariant metadata.
  - Not service-tested; type checked and linted only.

- `module/regression/risk-score.ts` (new, untracked)
  - Added the requested weight table, `computeImpactScore()`, and trigger threshold `.75`.
  - Current formula is `relationship*.25 + inverseDistance*.15 + historical*.25 + runtime*.20 + changeMagnitude*.15`, clamped to `1`.
  - `unrelatedImport: .1` is exposed in the table but is not currently used by the formula; this is a gap to resolve deliberately.

- `module/regression/judge.ts` (new, untracked)
  - Added regex-based `changedIdentifiersFromDiff()` and `buildRegressionJudgeContext()`.
  - Runs Pinecone retrieval in parallel with graph/historical lookups. Graph and Pinecone failures degrade to empty data to avoid blocking reviews.
  - Calculates change magnitude from added/removed diff lines divided by 100. A historical match always routes to `sandbox-diff-engine`, even if the numeric score is below threshold.
  - Not unit-tested.

- `app/api/inngest/functions/review.ts` (modified, uncommitted)
  - Replaced direct `retrieveContext()` call with `buildRegressionJudgeContext()` in an Inngest step named `build-regression-judge-context`.
  - The AI prompt now contains JSON structured context and routing tier before the raw diff.
  - Existing review persistence/comment/check-run behavior was not otherwise changed.

- `scripts/verify-impact.ts` (new, untracked)
  - Creates three Symbol nodes with a two-hop CALLS chain, a `SERVES` endpoint, a Scenario, an Antibody/Invariant, and a historical PR/Bug/Issue chain.
  - Asserts the two-hop antibody, endpoint, and numeric score. It cleans nodes prefixed by its generated repository ID.
  - Not run because Neo4j was not configured.

### Follow-on graph changes required by impact work

- `module/knowledge-graph/lib/graph-writer.ts` (modified, uncommitted)
  - Added `IMPORTS` to the allowed typed relationship list so graph writes can use it.

- `module/knowledge-graph/history/commit-miner.ts` (modified, uncommitted)
  - Added an attempted relative-import-to-symbol `IMPORTS` materialization query.
  - This is not ready as described in Known Bugs; do not assume it works simply because the type list permits `IMPORTS`.

- `module/knowledge-graph/extraction/ast.ts` (modified, uncommitted)
  - Removed an unused `SourceFile` parameter/import during lint cleanup. Behavior is otherwise unchanged.

- `package.json` (modified, uncommitted)
  - Added `verify:impact`: `bun scripts/verify-impact.ts`.

No database migration was added: Neo4j is external and this work did not change PostgreSQL contract models.

## 5. Files That Matter

| File | Importance | Purpose | Current relevance |
| ---- | ---------- | ------- | ----------------- |
| `HANDOFF.md` | Critical | Continuation record | Read first; it documents uncommitted work and risks. |
| `app/api/inngest/functions/review.ts` | Critical | Existing LLM review job | Now consumes the regression judge context. |
| `module/regression/judge.ts` | Critical | New orchestration layer | Diff identifier extraction, graph/Pinecone merge, risk tier. |
| `module/regression/risk-score.ts` | High | Risk score contract | Weight table, threshold, current formula. |
| `module/knowledge-graph/impact/blast-radius.ts` | Critical | Bounded graph impact query | Core current task; needs live Neo4j validation. |
| `module/knowledge-graph/impact/historical-impact.ts` | Critical | Historical resurrection query | Core current task; needs live Neo4j validation. |
| `module/knowledge-graph/history/commit-miner.ts` | Critical | Git/AST graph writer | Provides CALLS/SERVES/data edges; current IMPORTS insertion is defective. |
| `module/knowledge-graph/extraction/ast.ts` | High | TS/JS AST extraction | Defines calls, imports, reads/writes, route detection, symbol hashes. |
| `module/knowledge-graph/lib/graph-client.ts` | High | Neo4j driver/session access | Reads `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`. |
| `module/knowledge-graph/lib/graph-writer.ts` | High | Typed graph write/provenance API | All label/relationship/provenance validation; now contains `IMPORTS`. |
| `module/knowledge-graph/schema/constraints.ts` | High | Neo4j uniqueness constraints | Apply before service-backed graph tests. |
| `module/knowledge-graph/history/bug-fix-pipeline.ts` | High | Antibody/invariant graph model | Defines the relationship directions historical impact relies on. |
| `app/api/webhook/github/route.ts` | High | GitHub webhook ingress | Queues reviews on open/sync and graph ingestion on merged PRs. |
| `app/api/inngest/functions/index.ts` | High | Graph/Inngest job registrations | History sync, graph build, merged PR ingestion, index/poll jobs. |
| `app/api/inngest/route.ts` | High | Inngest serve endpoint | Must register any future Inngest function. |
| `module/ai/lib/rag.ts` | High | Pinecone codebase indexing/search | Judge uses `retrieveContext()`; vectors use repo slug `${owner}/${repo}`. |
| `scripts/verify-impact.ts` | High | New Neo4j integration fixture | First live validation target for the current task. |
| `scripts/verify-ingestion.ts` | Medium | Ingestion fixture | Confirms symbol/version/CALLS basics but cleanup needs correction. |
| `scripts/verify-antibodies.ts` | Medium | Antibody pipeline fixture | Confirms historical graph relationship directions. |
| `src/prisma/contract.prisma` | High | PostgreSQL schema | User/account/repository/review/webhook tables. |
| `.env.example` | High | Required configuration list | Use to create local `.env`; never commit secrets. |
| `package.json` | High | Commands/dependencies | Bun scripts include all verification commands. |

## 6. Architecture

### Application and authentication

```text
Browser (React/TanStack Query)
  -> Next.js App Router pages/components
  -> server actions
  -> Better Auth + Kysely/PostgreSQL
  -> Octokit GitHub API
```

- Better Auth is configured in `lib/auth.ts`; GitHub OAuth requests `repo` and `user:email` scope.
- PostgreSQL models live in `src/prisma/contract.prisma`. Repositories belong to users; reviews belong to repositories; webhook deliveries are deduplicated in PostgreSQL.
- UI pages include dashboard, repository connection, and review history. They do not currently display graph impact data.

### Repository connection and indexing

```text
Connect repository server action
  -> create/update GitHub webhook
  -> PostgreSQL Repository
  -> Inngest repository.connected (Pinecone source-code indexing)
  -> Inngest repository.sync.requested (Neo4j history mining)
```

- `module/repository/action/index.ts` queues `repository.connected` and `repository.sync.requested` for a newly connected repository.
- `indexRepo` uses GitHub contents walking and Pinecone integrated embeddings via `module/ai/lib/rag.ts`.
- `syncRepositoryHistory` calls `mineRepositoryHistory()`, which lists Git commits oldest-first, fetches changed file contents at each commit SHA, parses TS/JS, and writes graph data.

### GitHub webhook and review flow

```text
GitHub pull_request webhook
  -> /api/webhook/github verifies HMAC + deduplicates delivery in PostgreSQL
  -> opened/synchronize/reopened/ready_for_review:
       create GitHub check run + queue pr.review.requested
  -> closed + merged:
       queue pull_request.merged
  -> Inngest generateReview
       fetch PR diff/title/body
       build Regression Judge context
       Google AI review
       GitHub review comment/check result + PostgreSQL Review record
```

- `pull_request.merged` invokes incremental merged-commit graph ingestion; it should only parse files changed in that merge commit.
- A two-minute polling function is a backup for missed review webhook deliveries.

### Knowledge graph and historical knowledge

```text
GitHub commits/files
  -> ts-morph extraction
  -> Neo4j: Repository -> Commit -> File/SymbolVersion -> Symbol
  -> Symbol CALLS / READS / WRITES / SERVES (IMPORTS intended)

Historical merged bug-fix PR
  -> LLM classifier + antibody + invariant extraction
  -> Neo4j: Antibody -WATCHES-> Symbol
           Antibody -PROTECTS-> Invariant
           Antibody -DERIVED_FROM-> PullRequest -FIXED-> Bug -REPORTED_IN-> Issue
  -> Pinecone repo-antibodies namespace
```

- Graph writes are tagged with provenance. Commit/File/MODIFIED/TOUCHED writes use `git` at confidence `1`; AST graph data uses `ast` at confidence `1`; historical LLM-derived data uses `llm` with extractor/classifier confidence.
- Symbol version write logic only creates a new `SymbolVersion` when the new AST content hash differs from the latest version for that symbol.

### Current Regression Judge flow

```text
PR diff
  -> changedIdentifiersFromDiff() (best-effort regex)
  -> Neo4j getBlastRadius() + getHistoricalImpact() [bounded]
  -> Pinecone retrieveContext()
  -> computeImpactScore()
  -> structured JSON context + risk tier
  -> Google review prompt
```

The structured payload has changed symbols, callers, reachable symbols, endpoints, scenarios, DB dependencies, antibody/invariant matches, historical bugs/fixes, semantic context, score, and tier. The tier currently does not enqueue any sandbox work.

## 7. Important Technical Decisions

1. **Bound graph traversal explicitly.**
   - `CALLS` is capped at 4, `IMPORTS` at 3, and `READS|WRITES` at 2 in current impact Cypher.
   - This avoids unbounded variable-length graph scans in a multi-repository graph.
   - Do not replace these with `*` without bounds. If product requirements need a different depth, make it a controlled, tested input/configuration.

2. **Keep standard review available when graph services fail.**
   - `buildRegressionJudgeContext()` catches graph and Pinecone failures separately and yields empty context.
   - This deliberately avoids making GitHub review generation dependent on Neo4j/Pinecone uptime.
   - Do not casually remove the fallback; improve it with logging/metrics and a visible degraded-state field instead.

3. **Use provenance at every Neo4j write.**
   - `writeNode`/`writeRelationship` set `sourceType` and `confidence` and enforce a valid confidence range.
   - Git/AST ingestion must retain `git`/`ast` source with confidence `1.0`; historical LLM inference must retain its confidence.
   - Avoid direct ad-hoc graph writes that skip these fields.

4. **Use versioned symbols based on AST content hash, not commit count.**
   - A commit touching a file does not automatically create a new `SymbolVersion`; unchanged symbols should not gain versions.
   - `PREVIOUS_VERSION` points from the newer version to the earlier version.
   - Do not simplify this to one version per commit, or the ingestion assertion loses meaning.

5. **Separate PostgreSQL operational records from Neo4j knowledge.**
   - Postgres owns users, OAuth accounts, repositories, review UI state, and webhook dedupe.
   - Neo4j owns repository-memory graph entities; no Prisma migration is needed for graph changes.
   - Pinecone stores semantic source/antibody records, not authoritative graph relations.

6. **The current score is a routing heuristic, not an observed regression.**
   - A `sandbox-diff-engine` tier means likely high impact/historical resemblance; it must not be described by the model as proof of a bug.
   - The prompt explicitly says this, and future sandbox results should be a separate evidence channel.

## 8. Commands

Run these from the project root (`codepool`):

```bash
# Install dependencies using the declared package manager
bun install

# Development server
bun run dev

# Inngest local development server (downloads/runs inngest-cli through npx)
bun run inngest:dev

# Optional public tunnel for GitHub webhooks; writes ignored tunnel.txt
bun run dev:tunnel

# Static checks and unit tests
bun run lint
bun test
bunx tsc --noEmit --incremental false

# Production build/start
bun run build
bun run start

# Prisma ORM contract/migration operations
bun run db:generate
bun run db:init
bun run db:migrate
bun run db:status
bun run db:setup

# Neo4j fixture checks (require Neo4j env vars)
bun run verify:graph
bun run verify:ingestion
bun run verify:antibodies
bun run verify:impact
```

`bunx tsc --noEmit` without `--incremental false` attempted to write `tsconfig.tsbuildinfo` and failed with `EPERM` in this managed workspace. Use the documented non-incremental form here; `*.tsbuildinfo` is ignored.

## 9. Environment Variables

Configure these in local `.env` (copy `.env.example`; do not commit it):

```text
DATABASE_URL=<required PostgreSQL connection string>
BETTER_AUTH_SECRET=<required>
BETTER_AUTH_URL=<required application URL>
NEXT_PUBLIC_BETTER_AUTH_URL=<optional browser override>
NEXT_PUBLIC_BASE_URL=<required public URL for production GitHub webhooks>

GITHUB_CLIENT_ID=<required for GitHub OAuth>
GITHUB_CLIENT_SECRET=<required for GitHub OAuth>
GITHUB_WEBHOOK_SECRET=<required to verify/create webhooks>

GOOGLE_GENERATIVE_AI_API_KEY=<required for Google AI review/classification/extraction>
PINECONE_DB_API_KEY=<required for Pinecone; PINECONE_API_KEY is also accepted by code>
PINECONE_INDEX=<required for Pinecone>
PINECONE_TEXT_FIELD=<optional; defaults to text>

NEO4J_URI=<required for graph operations>
NEO4J_USER=<required for graph operations>
NEO4J_PASSWORD=<required for graph operations>
```

Notes:

- `.env.example` also lists `MODELSCOPE_API_KEY`, but current `lib/modelscope.ts` actually uses the Google AI SDK/model and `GOOGLE_GENERATIVE_AI_API_KEY`; the ModelScope naming is stale.
- `NEXT_PUBLIC_BASE_URL` must be public/non-local for `createWebhook()` to install a GitHub webhook. Local development can use `bun run dev:tunnel` and update the base URL.

## 10. Testing Status

### Run in this session

| Command | Result |
| --- | --- |
| `bun test` | Passed: 5 tests in 2 files, 0 failures. Covers review check lifecycle and review content rendering. |
| `bun run lint` | Passed with no reported errors/warnings after the final cleanup. |
| `bunx tsc --noEmit --incremental false` | Passed. |
| `git diff --check` | Passed; only Git line-ending warnings were printed. |

### Not run

- `bun run build` was not run.
- `bun run verify:graph`, `verify:ingestion`, `verify:antibodies`, and `verify:impact` were not run because no verified Neo4j configuration was available in this environment.
- No live GitHub OAuth/webhook, Inngest, Google AI, Pinecone, PostgreSQL migration, or Neo4j query execution was performed.
- No automated test currently exercises the new impact modules or the changed review prompt integration.

### Errors encountered

- `bunx tsc --noEmit` initially failed because TypeScript attempted to write `tsconfig.tsbuildinfo` and received `EPERM`. Retrying with `--incremental false` succeeded.
- During inspection, PowerShell `Get-Content` did not resolve the literal `[...all]` auth route because brackets are wildcard syntax. This did not affect application execution and no auth route was modified.

## 11. Git / Change Status

- Branch: `main`.
- Most recent commits at inspection:

```text
284aa3e feat: implement historical bug fix mining and classification functions, add antibody and invariant extraction, and create verification script
1b17b7b feat: implement repository history synchronization and graph ingestion functions, enhance GitHub webhook handling, and add ingestion verification script
410d855 feat: integrate Neo4j support with graph client and writer, add schema constraints, and implement verification script
```

- `HANDOFF.md` is newly created by this handoff task and is also uncommitted.
- Existing uncommitted modified files:

```text
app/api/inngest/functions/review.ts
module/knowledge-graph/extraction/ast.ts
module/knowledge-graph/history/commit-miner.ts
module/knowledge-graph/lib/graph-writer.ts
package.json
```

- Existing untracked files/directories:

```text
module/knowledge-graph/impact/blast-radius.ts
module/knowledge-graph/impact/historical-impact.ts
module/regression/judge.ts
module/regression/risk-score.ts
scripts/verify-impact.ts
HANDOFF.md
```

These changes are intentional and are the current impact-analysis feature. Do not discard/reset them. No commits were created in this session.

`git diff --stat` does not include untracked files; it reported 36 insertions and 20 deletions in the five tracked modified files. The new untracked files contain the majority of the feature.

## 12. Problems / Risks

- **Primary functional risk:** `IMPORTS` graph relationships are currently unreliable for the reasons in Known Bugs. The new impact code does safely bound them, but likely gets no useful import paths until ingestion is fixed and existing repositories are reindexed.
- **Graph data freshness:** an open/synchronized PR is analyzed against the repository's already-ingested graph. The PR head itself is not AST-ingested before review; changed IDs are guessed from text diff. This can make graph matching stale or empty.
- **Historical data availability:** historical antibodies only exist if `history.mine.requested` has been supplied with `HistoricalPullRequest[]` and the asynchronous classifier/extractors succeeded. Nothing automatically mines all historical PRs on repository connection.
- **Operational cost:** full commit history mining has no repository-size/rate-limit strategy. Inngest retries could repeat expensive GitHub and Neo4j work.
- **Endpoint/scenario limitations:** endpoints are only inferred for exported HTTP-method-named functions in conventional Next routes. Scenarios are not populated by current normal ingestion; the impact script creates them only as a fixture.
- **Security/authorization:** OAuth tokens are stored in Postgres account rows and used by async jobs. Preserve user/repository ownership checks when adding APIs or jobs.
- **Prompt size:** the full `RegressionJudgeContext` JSON plus raw diff is sent to the model. Large graph/semantic result sets can raise cost/token risk; add caps/summaries if production data grows.
- **Documentation gap:** README is generic and not reliable for setup. This handoff is currently the most complete operational documentation.

## 13. Next Steps

1. Read this file and inspect the uncommitted impact files before changing anything.
2. Fix `IMPORTS` ingestion in `module/knowledge-graph/history/commit-miner.ts`:
   - Move import edge creation after Symbol nodes are written.
   - Resolve paths relative to each importing file, normalize `.`/`..`, and support configured TS/JS extensions/index files.
   - Remove the broad swallowed error; log/return a scoped failure or test it explicitly.
3. Rebuild/reingest a small fixture repository after that fix, then run `bun run verify:ingestion` and `bun run verify:impact` with Neo4j configured. Correct fixture cleanup in `verify-ingestion.ts` while there.
4. Validate the exact Neo4j Cypher syntax and query plans in `blast-radius.ts` and `historical-impact.ts`; add indexes/constraints where query profiling shows need.
5. Replace or augment regex diff symbol discovery with AST extraction of changed PR-head files and stable symbol IDs. Ensure edits inside an existing function are mapped, not just newly declared functions.
6. Add unit tests for risk scoring, changed-symbol extraction, bounded traversal construction, and regression judge fallback behavior. Keep `bun test`, lint, and non-incremental typecheck green.
7. Add explicit degraded-context observability and decide how to persist/expose `impactScore`/tier in the review record/UI.
8. Implement Prompt 5 Sandbox Diff Engine, using `sandbox-diff-engine` tier as its input; do not equate the tier with a confirmed regression.
9. Update README with actual local setup, service dependencies, Inngest/webhook workflow, and verification commands.
10. Once validated, review the diff carefully and commit the intended impact work and this handoff in a focused commit.

## NEXT ACTION

Start with `module/knowledge-graph/history/commit-miner.ts`: move and rewrite the `IMPORTS` relationship query so it runs after symbol upserts and resolves nested relative imports correctly. Then configure Neo4j and run `bun run verify:ingestion` followed by `bun run verify:impact`; use those results to validate or repair the bounded impact Cypher before extending the judge further.
