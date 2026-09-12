import { createHash } from "node:crypto";
import { Node, Project, ScriptKind, type SourceFile } from "ts-morph";

export type ExtractedSymbolKind = "function" | "class" | "method" | "import" | "export";

export type ExtractedSymbol = {
  name: string;
  kind: ExtractedSymbolKind;
  filePath: string;
  signature: string;
  startLine: number;
  endLine: number;
  calls: string[];
  reads: string[];
  writes: string[];
  imports: string[];
  exports: string[];
  /** A best-effort HTTP method/path inferred from framework conventions. */
  route?: { method: string; path?: string };
  contentHash: string;
};

const TS_JS_EXTENSIONS: Record<string, ScriptKind> = {
  ".ts": ScriptKind.TS, ".tsx": ScriptKind.TSX, ".js": ScriptKind.JS,
  ".jsx": ScriptKind.JSX, ".mts": ScriptKind.TS, ".cts": ScriptKind.TS,
  ".mjs": ScriptKind.JS, ".cjs": ScriptKind.JS,
};
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const READ_METHODS = new Set(["find", "findOne", "findMany", "findFirst", "count", "aggregate", "select", "get", "query"]);
const WRITE_METHODS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany", "insert", "save"]);

function scriptKindFor(filePath: string): ScriptKind | undefined {
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return TS_JS_EXTENSIONS[extension];
}

function lineRange(node: Node) {
  return { startLine: node.getStartLineNumber(), endLine: node.getEndLineNumber() };
}

function callableDetails(node: Node, sourceFile: SourceFile) {
  const calls = new Set<string>();
  const reads = new Set<string>();
  const writes = new Set<string>();
  node.forEachDescendant((descendant) => {
    if (!Node.isCallExpression(descendant)) return;
    const expression = descendant.getExpression();
    const callName = expression.getText();
    calls.add(callName);
    if (!Node.isPropertyAccessExpression(expression)) return;
    const method = expression.getName();
    const entity = expression.getExpression().getText();
    if (READ_METHODS.has(method)) reads.add(entity);
    if (WRITE_METHODS.has(method)) writes.add(entity);
  });
  return { calls: [...calls], reads: [...reads], writes: [...writes] };
}

function hashNode(node: Node) {
  return createHash("sha256").update(node.getText()).digest("hex");
}

function inferredRoute(name: string, filePath: string): ExtractedSymbol["route"] {
  if (!HTTP_METHODS.has(name)) return undefined;
  const normalized = filePath.replace(/\\/g, "/");
  const appRoute = normalized.match(/(?:^|\/)app\/(.+)\/route\.[^.]+$/);
  const pagesRoute = normalized.match(/(?:^|\/)pages\/api\/(.+)\.[^.]+$/);
  const segment = appRoute?.[1] ?? pagesRoute?.[1];
  return { method: name, path: segment ? `/${segment.replace(/\/route$/, "")}`.replace(/\/index$/, "") : undefined };
}

function toSymbol(
  node: Node,
  name: string,
  kind: ExtractedSymbolKind,
  filePath: string,
  sourceFile: SourceFile,
  imports: string[],
  exports: string[],
): ExtractedSymbol {
  const range = lineRange(node);
  return {
    name, kind, filePath, signature: node.getText().split("{")[0].trim(), ...range,
    ...callableDetails(node, sourceFile), imports, exports, route: inferredRoute(name, filePath), contentHash: hashNode(node),
  };
}

/** Parses one in-memory TS/JS file. Unsupported formats intentionally return no symbols. */
export function extractSymbols(filePath: string, content: string): ExtractedSymbol[] {
  const kind = scriptKindFor(filePath);
  if (!kind) return [];
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
  const sourceFile = project.createSourceFile(filePath, content, { scriptKind: kind, overwrite: true });
  const imports = sourceFile.getImportDeclarations().map((declaration) => declaration.getModuleSpecifierValue());
  const exports = sourceFile.getExportDeclarations().flatMap((declaration) => declaration.getNamedExports().map((entry) => entry.getName()));
  const result: ExtractedSymbol[] = [];

  for (const declaration of sourceFile.getImportDeclarations()) {
    const names = [declaration.getDefaultImport()?.getText(), ...declaration.getNamedImports().map((entry) => entry.getName())].filter(Boolean).join(", ");
    result.push(toSymbol(declaration, names || declaration.getModuleSpecifierValue(), "import", filePath, sourceFile, imports, exports));
  }
  for (const declaration of sourceFile.getExportDeclarations()) {
    result.push(toSymbol(declaration, declaration.getModuleSpecifierValue() ?? "export", "export", filePath, sourceFile, imports, exports));
  }
  for (const declaration of sourceFile.getFunctions()) {
    const name = declaration.getName();
    if (name) result.push(toSymbol(declaration, name, "function", filePath, sourceFile, imports, exports));
  }
  for (const declaration of sourceFile.getClasses()) {
    const className = declaration.getName();
    if (!className) continue;
    result.push(toSymbol(declaration, className, "class", filePath, sourceFile, imports, exports));
    for (const method of declaration.getMethods()) {
      result.push(toSymbol(method, `${className}.${method.getName()}`, "method", filePath, sourceFile, imports, exports));
    }
  }
  for (const statement of sourceFile.getVariableStatements()) {
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer || (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))) continue;
      result.push(toSymbol(declaration, declaration.getName(), "function", filePath, sourceFile, imports, exports));
    }
  }
  return result;
}
