import { Octokit } from "octokit";
import { extractSymbols, type ExtractedSymbol } from "../extraction/ast";
import { runQuery } from "../lib/graph-client";

const GIT = { sourceType: "git" as const, confidence: 1 };
const AST = { sourceType: "ast" as const, confidence: 1 };

export type RepositoryTarget = { repositoryId: string; owner: string; repo: string; token: string };
export type CommitInput = {
  sha: string;
  committedAt: string;
  message?: string;
  files: Array<{ path: string; content: string }>;
  pullRequest?: { number: number; url?: string; origin?: "codepool-suggested" | "github" };
};

const symbolId = (repositoryId: string, symbol: ExtractedSymbol) =>
  `${repositoryId}:symbol:${symbol.filePath}:${symbol.kind}:${symbol.name}`;
const fileId = (repositoryId: string, path: string) => `${repositoryId}:file:${path}`;
const commitId = (repositoryId: string, sha: string) => `${repositoryId}:commit:${sha}`;

function cleanCallName(call: string) {
  return call.replace(/\?\./g, ".").split(".").at(-1) ?? call;
}

/**
 * Writes one commit atomically enough for retry safety. Symbol versions are only
 * added when their AST content hash differs from the latest version.
 */
export async function ingestExtractedCommit(repositoryId: string, input: CommitInput) {
  const extracted = input.files.flatMap(({ path, content }) => extractSymbols(path, content));
  const historyOrder = new Date(input.committedAt).getTime();
  const commit = commitId(repositoryId, input.sha);
  const rows = extracted.map((symbol, index) => ({
    ...symbol,
    calls: symbol.calls.map(cleanCallName),
    id: symbolId(repositoryId, symbol),
    fileId: fileId(repositoryId, symbol.filePath),
    versionId: `${symbolId(repositoryId, symbol)}:version:${input.sha}:${symbol.contentHash}`,
    // Preserve deterministic ordering for multiple symbols written at the same commit instant.
    historyOrder: historyOrder * 10_000 + index,
  }));

  await runQuery(
    `MERGE (repository:Repository {id: $repositoryId})
     SET repository.sourceType = $gitSource, repository.confidence = $confidence
     MERGE (commit:Commit {id: $commitId})
     SET commit.sha = $sha, commit.committedAt = $committedAt, commit.message = $message,
         commit.sourceType = $gitSource, commit.confidence = $confidence
     MERGE (repository)-[hasCommit:HAS_COMMIT]->(commit)
     SET hasCommit.sourceType = $gitSource, hasCommit.confidence = $confidence
     WITH repository, commit
     UNWIND $files AS inputFile
     MERGE (file:File {id: inputFile.id})
     SET file.path = inputFile.path, file.repositoryId = $repositoryId,
         file.sourceType = $gitSource, file.confidence = $confidence
     MERGE (repository)-[hasFile:HAS_FILE]->(file)
     SET hasFile.sourceType = $gitSource, hasFile.confidence = $confidence
     MERGE (commit)-[touched:TOUCHED]->(file)
     SET touched.sourceType = $gitSource, touched.confidence = $confidence`,
    {
      repositoryId, commitId: commit, sha: input.sha, committedAt: input.committedAt, message: input.message ?? "",
      files: [...new Map(input.files.map((file) => [file.path, { id: fileId(repositoryId, file.path), path: file.path }])).values()],
      gitSource: GIT.sourceType, confidence: GIT.confidence,
    },
  );

  // Resolve relative module imports after every batch. This is intentionally
  // bounded to repository-local files; package imports have no Symbol target.
  await runQuery(
    `MATCH (source:Symbol {repositoryId: $repositoryId})
     UNWIND source.imports AS modulePath
     MATCH (target:Symbol {repositoryId: $repositoryId})
     WHERE modulePath STARTS WITH "." AND target.filePath IN [
       replace(modulePath, "./", "") + ".ts",
       replace(modulePath, "./", "") + ".tsx",
       replace(modulePath, "./", "") + "/index.ts"
     ]
     MERGE (source)-[imports:IMPORTS]->(target)
     SET imports.sourceType = $astSource, imports.confidence = $confidence`,
    { repositoryId, astSource: AST.sourceType, confidence: AST.confidence },
  ).catch(() => undefined);

  if (input.pullRequest) {
    const prId = `${repositoryId}:pr:${input.pullRequest.number}`;
    await runQuery(
      `MERGE (pr:PullRequest {id: $prId})
       SET pr.number = $number, pr.url = $url, pr.origin = $origin, pr.sourceType = $gitSource, pr.confidence = $confidence
       MATCH (commit:Commit {id: $commitId})
       MERGE (commit)-[part:PART_OF_PR]->(pr)
       SET part.sourceType = $gitSource, part.confidence = $confidence`,
      { prId, number: input.pullRequest.number, url: input.pullRequest.url ?? "", origin: input.pullRequest.origin ?? "github", commitId: commit, gitSource: GIT.sourceType, confidence: GIT.confidence },
    );
  }

  if (rows.length === 0) return { symbols: 0, versionsCreated: 0 };
  const versionResult = await runQuery(
    `UNWIND $symbols AS row
     MATCH (repository:Repository {id: $repositoryId})
     MATCH (commit:Commit {id: $commitId})
     MATCH (file:File {id: row.fileId})
     MERGE (symbol:Symbol {id: row.id})
     SET symbol.name = row.name, symbol.kind = row.kind, symbol.filePath = row.filePath,
         symbol.signature = row.signature, symbol.calls = row.calls, symbol.reads = row.reads, symbol.writes = row.writes, symbol.repositoryId = $repositoryId,
         symbol.sourceType = $astSource, symbol.confidence = $confidence
     MERGE (repository)-[hasSymbol:HAS_SYMBOL]->(symbol)
     SET hasSymbol.sourceType = $astSource, hasSymbol.confidence = $confidence
     MERGE (file)-[fileSymbol:HAS_SYMBOL]->(symbol)
     SET fileSymbol.sourceType = $astSource, fileSymbol.confidence = $confidence
     CALL {
       WITH symbol
       OPTIONAL MATCH (prior:SymbolVersion)-[:VERSION_OF]->(symbol)
       WITH prior ORDER BY prior.historyOrder DESC
       RETURN head(collect(prior)) AS latest
     }
     WITH row, symbol, commit, latest WHERE latest IS NULL OR latest.contentHash <> row.contentHash
     MERGE (version:SymbolVersion {id: row.versionId})
     SET version.contentHash = row.contentHash, version.signature = row.signature,
         version.startLine = row.startLine, version.endLine = row.endLine, version.historyOrder = row.historyOrder,
         version.sourceType = $astSource, version.confidence = $confidence
     MERGE (version)-[versionOf:VERSION_OF]->(symbol)
     SET versionOf.sourceType = $astSource, versionOf.confidence = $confidence
     FOREACH (previous IN CASE WHEN latest IS NULL THEN [] ELSE [latest] END |
       MERGE (version)-[previousVersion:PREVIOUS_VERSION]->(previous)
       SET previousVersion.sourceType = $astSource, previousVersion.confidence = $confidence)
     MERGE (commit)-[modified:MODIFIED]->(version)
     SET modified.sourceType = $gitSource, modified.confidence = $confidence
     RETURN count(version) AS created`,
    { repositoryId, commitId: commit, symbols: rows, astSource: AST.sourceType, gitSource: GIT.sourceType, confidence: 1 },
  );

  await runQuery(
    `MATCH (source:Symbol {repositoryId: $repositoryId})
     UNWIND source.calls AS call
     MATCH (target:Symbol {repositoryId: $repositoryId})
     WHERE target.id <> source.id AND target.name = call
     MERGE (source)-[calls:CALLS]->(target)
     SET calls.sourceType = $astSource, calls.confidence = $confidence`,
    { repositoryId, astSource: AST.sourceType, confidence: AST.confidence },
  );

  await runQuery(
    `UNWIND $symbols AS row MATCH (symbol:Symbol {id: row.id})
     UNWIND row.reads AS entityName
     MERGE (entity:DatabaseEntity {id: $repositoryId + ":database:" + entityName})
     SET entity.name = entityName, entity.sourceType = $astSource, entity.confidence = $confidence
     MERGE (symbol)-[reads:READS]->(entity) SET reads.sourceType = $astSource, reads.confidence = $confidence`,
    { repositoryId, symbols: rows, astSource: AST.sourceType, confidence: AST.confidence },
  );
  await runQuery(
    `UNWIND $symbols AS row MATCH (symbol:Symbol {id: row.id})
     UNWIND row.writes AS entityName
     MERGE (entity:DatabaseEntity {id: $repositoryId + ":database:" + entityName})
     SET entity.name = entityName, entity.sourceType = $astSource, entity.confidence = $confidence
     MERGE (symbol)-[writes:WRITES]->(entity) SET writes.sourceType = $astSource, writes.confidence = $confidence`,
    { repositoryId, symbols: rows, astSource: AST.sourceType, confidence: AST.confidence },
  );
  await runQuery(
    `UNWIND $symbols AS row WITH row WHERE row.route IS NOT NULL
     MATCH (symbol:Symbol {id: row.id})
     MERGE (endpoint:Endpoint {id: $repositoryId + ":endpoint:" + row.route.method + ":" + coalesce(row.route.path, row.filePath)})
     SET endpoint.method = row.route.method, endpoint.path = row.route.path, endpoint.sourceType = $astSource, endpoint.confidence = $confidence
     MERGE (symbol)-[serves:SERVES]->(endpoint) SET serves.sourceType = $astSource, serves.confidence = $confidence`,
    { repositoryId, symbols: rows, astSource: AST.sourceType, confidence: AST.confidence },
  );
  return { symbols: rows.length, versionsCreated: Number(versionResult.records[0]?.get("created") ?? 0) };
}

async function contentsAtRef(octokit: Octokit, target: RepositoryTarget, path: string, ref: string) {
  const response = await octokit.rest.repos.getContent({ owner: target.owner, repo: target.repo, path, ref });
  const data = response.data;
  if (Array.isArray(data) || data.type !== "file" || !data.content) return undefined;
  return Buffer.from(data.content, "base64").toString("utf8");
}

/** Initial connection only: GitHub commits are processed oldest-first. */
export async function mineRepositoryHistory(target: RepositoryTarget) {
  const octokit = new Octokit({ auth: target.token });
  const commits = await octokit.paginate(octokit.rest.repos.listCommits, { owner: target.owner, repo: target.repo, per_page: 100 });
  let symbols = 0;
  let versionsCreated = 0;
  for (const listed of commits.reverse()) {
    const { data: detail } = await octokit.rest.repos.getCommit({ owner: target.owner, repo: target.repo, ref: listed.sha });
    const files = await Promise.all((detail.files ?? []).filter((file) => file.status !== "removed").map(async (file) => {
      const content = await contentsAtRef(octokit, target, file.filename, detail.sha);
      return content === undefined ? undefined : { path: file.filename, content };
    }));
    const result = await ingestExtractedCommit(target.repositoryId, { sha: detail.sha, committedAt: detail.commit.committer?.date ?? detail.commit.author?.date ?? new Date().toISOString(), message: detail.commit.message, files: files.filter((file): file is { path: string; content: string } => Boolean(file)) });
    symbols += result.symbols;
    versionsCreated += result.versionsCreated;
  }
  return { commits: commits.length, symbols, versionsCreated };
}

/** Merged PR path: only files present in its merge commit are parsed. */
export async function ingestMergedPullRequest(target: RepositoryTarget, input: { sha: string; prNumber: number; url?: string; codepoolSuggested?: boolean }) {
  const octokit = new Octokit({ auth: target.token });
  const { data: detail } = await octokit.rest.repos.getCommit({ owner: target.owner, repo: target.repo, ref: input.sha });
  const files = await Promise.all((detail.files ?? []).filter((file) => file.status !== "removed").map(async (file) => {
    const content = await contentsAtRef(octokit, target, file.filename, detail.sha);
    return content === undefined ? undefined : { path: file.filename, content };
  }));
  return ingestExtractedCommit(target.repositoryId, { sha: detail.sha, committedAt: detail.commit.committer?.date ?? new Date().toISOString(), message: detail.commit.message, files: files.filter((file): file is { path: string; content: string } => Boolean(file)), pullRequest: { number: input.prNumber, url: input.url, origin: input.codepoolSuggested ? "codepool-suggested" : "github" } });
}
