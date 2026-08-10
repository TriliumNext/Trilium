import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// This spec sits next to the worker entry, so resolve it relative to __dirname
// rather than depending on the test runner's cwd.
const WORKER_ENTRY = join(__dirname, "local-server-worker.ts");

// Static value imports intentionally permitted. Adding an entry here means you
// have verified — ideally against the built worker bundle — that it pulls in no
// heavy transitive graph and cannot throw before the error handlers are
// installed. Prefer a dynamic import() instead; keep this list empty if you can.
const ALLOWED_STATIC_VALUE_IMPORTS: readonly string[] = [];

/**
 * `local-server-worker.ts` is the standalone SQLite worker's entry module. Its
 * design (see the file's own header) requires that nothing runs before the
 * module body installs `self.onerror` / `self.onunhandledrejection` and waits
 * for the INIT message — every heavy dependency is pulled in with a dynamic
 * `import()` from inside `initialize()`, in a controlled order.
 *
 * Static *value* imports break that: they hoist above the module body and
 * evaluate at worker startup. In 73a61ba1cc a static
 *   `import { … } from './lightweight/database_restore'`
 * dragged `@triliumnext/core` (~2 MB of i18n + sql + image code) into that
 * hoisted startup, which reordered SQLite's wasm init and broke iOS standalone
 * with "Unexpected response MIME type. Expected 'application/wasm'" — days of
 * debugging. This test makes that class of regression impossible: the worker
 * entry may only use type-only static imports (erased at runtime).
 */
describe("local-server-worker.ts static imports", () => {
    it("has no static value imports — everything runtime must be dynamically imported", () => {
        const offenders = staticValueImportsOf(WORKER_ENTRY).filter(
            (specifier) => !ALLOWED_STATIC_VALUE_IMPORTS.includes(specifier)
        );

        expect(offenders, forbiddenImportMessage(offenders)).toEqual([]);
    });
});

/** Module specifiers of every top-level static import that survives to runtime. */
function staticValueImportsOf(entryPath: string): string[] {
    const source = readFileSync(entryPath, "utf8");
    const sourceFile = ts.createSourceFile(entryPath, source, ts.ScriptTarget.Latest, true);

    const specifiers: string[] = [];
    for (const statement of sourceFile.statements) {
        // A dynamic `import(...)` is a CallExpression, not an ImportDeclaration,
        // so the whole loadModules() block is correctly ignored here.
        if (!ts.isImportDeclaration(statement)) {
            continue;
        }
        // `import type … from "x"` is fully erased at runtime; detect it from
        // the source text to avoid the TS API churn around the type-only flags.
        // Everything else — a default or namespace binding, named value
        // bindings, or a bare side-effect `import "x"` — reaches runtime and
        // counts. (Write type imports in this file as `import type { … }`, not
        // the inline `import { type … }` form, so this stays a simple check.)
        if (/^import\s+type\b/.test(statement.getText(sourceFile))) {
            continue;
        }
        if (ts.isStringLiteral(statement.moduleSpecifier)) {
            specifiers.push(statement.moduleSpecifier.text);
        }
    }
    return specifiers;
}

function forbiddenImportMessage(offenders: string[]): string {
    return [
        `local-server-worker.ts must not statically import runtime values: ${offenders.join(", ")}.`,
        "",
        "This file is the standalone SQLite worker's entry. Static value imports hoist and",
        "evaluate at worker startup, before the error handlers are installed and before the",
        "controlled load order in initialize() — which has broken SQLite's wasm init.",
        "Load every dependency with a dynamic import() at its use site instead."
    ].join("\n");
}
