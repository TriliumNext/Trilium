# RCE Hardening - Defense in Depth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent instant RCE from authenticated access by gating scripting behind a config flag, restricting `require()` to safe modules, adding auth to unauthenticated execution paths, and filtering dangerous attributes from sync.

**Architecture:** Add a `[Scripting]` section to config.ini with `enabled=false` default for server mode. Gate all script execution entry points behind this flag. Restrict `ScriptContext.require()` to a whitelist. Add auth middleware to `/custom/*`. Filter dangerous attributes during sync (same pattern as import's `safeImport`).

**Tech Stack:** TypeScript, Express middleware, Node.js `config.ini` system

---

## Task 1: Add `[Scripting]` config section

**Files:**
- Modify: `apps/server/src/services/config.ts` (add Scripting section to TriliumConfig, configMapping, and config object)
- Modify: `apps/server/src/assets/config-sample.ini` (add [Scripting] section)

**Step 1: Add Scripting section to TriliumConfig interface**

In `config.ts`, add to the `TriliumConfig` interface after `Logging`:

```typescript
/** Scripting and code execution configuration */
Scripting: {
    /** Whether backend/frontend script execution is enabled (default: false for server, true for desktop) */
    enabled: boolean;
    /** Whether the SQL console is accessible (default: false) */
    sqlConsoleEnabled: boolean;
};
```

**Step 2: Add configMapping entries**

Add after `Logging` in `configMapping`:

```typescript
Scripting: {
    enabled: {
        standardEnvVar: 'TRILIUM_SCRIPTING_ENABLED',
        iniGetter: () => getIniSection("Scripting")?.enabled,
        defaultValue: false,
        transformer: transformBoolean
    },
    sqlConsoleEnabled: {
        standardEnvVar: 'TRILIUM_SCRIPTING_SQLCONSOLEENABLED',
        aliasEnvVars: ['TRILIUM_SCRIPTING_SQL_CONSOLE_ENABLED'],
        iniGetter: () => getIniSection("Scripting")?.sqlConsoleEnabled,
        defaultValue: false,
        transformer: transformBoolean
    }
}
```

**Step 3: Add to config object**

```typescript
Scripting: {
    enabled: getConfigValue(configMapping.Scripting.enabled),
    sqlConsoleEnabled: getConfigValue(configMapping.Scripting.sqlConsoleEnabled)
}
```

**Step 4: Update config-sample.ini**

Add at the bottom:

```ini
[Scripting]
# Enable backend/frontend script execution. WARNING: Scripts have full server access including
# filesystem, network, and OS commands via require('child_process'). Only enable if you trust
# all users with admin-level access to the server.
# Desktop builds override this to true automatically.
enabled=false

# Enable the SQL console (allows raw SQL execution against the database)
sqlConsoleEnabled=false
```

**Step 5: Commit**

```
feat(security): add [Scripting] config section with enabled=false default
```

---

## Task 2: Create scripting guard utility

**Files:**
- Create: `apps/server/src/services/scripting_guard.ts`
- Create: `apps/server/src/services/scripting_guard.spec.ts`

**Step 1: Write tests**

```typescript
// scripting_guard.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("ScriptingGuard", () => {
    it("should throw when scripting is disabled", async () => {
        vi.doMock("./config.js", () => ({
            default: { Scripting: { enabled: false, sqlConsoleEnabled: false } }
        }));
        const { assertScriptingEnabled } = await import("./scripting_guard.js");
        expect(() => assertScriptingEnabled()).toThrow("disabled");
    });

    it("should not throw when scripting is enabled", async () => {
        vi.doMock("./config.js", () => ({
            default: { Scripting: { enabled: true, sqlConsoleEnabled: false } }
        }));
        const { assertScriptingEnabled } = await import("./scripting_guard.js");
        expect(() => assertScriptingEnabled()).not.toThrow();
    });

    it("should throw for SQL console when disabled", async () => {
        vi.doMock("./config.js", () => ({
            default: { Scripting: { enabled: true, sqlConsoleEnabled: false } }
        }));
        const { assertSqlConsoleEnabled } = await import("./scripting_guard.js");
        expect(() => assertSqlConsoleEnabled()).toThrow("disabled");
    });
});
```

**Step 2: Implement**

```typescript
// scripting_guard.ts
import config from "./config.js";
import { isElectron } from "./utils.js";

/**
 * Throws if scripting is disabled. Desktop (Electron) always allows scripting.
 */
export function assertScriptingEnabled(): void {
    if (isElectron || config.Scripting.enabled) {
        return;
    }
    throw new Error(
        "Script execution is disabled. Set [Scripting] enabled=true in config.ini or " +
        "TRILIUM_SCRIPTING_ENABLED=true to enable. WARNING: Scripts have full server access."
    );
}

export function assertSqlConsoleEnabled(): void {
    if (isElectron || config.Scripting.sqlConsoleEnabled) {
        return;
    }
    throw new Error(
        "SQL console is disabled. Set [Scripting] sqlConsoleEnabled=true in config.ini to enable."
    );
}

export function isScriptingEnabled(): boolean {
    return isElectron || config.Scripting.enabled;
}
```

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```
feat(security): add scripting guard utility
```

---

## Task 3: Gate script execution endpoints

**Files:**
- Modify: `apps/server/src/routes/api/script.ts` (add guard to exec, run, bundle endpoints)
- Modify: `apps/server/src/routes/api/sql.ts` (add guard to execute endpoint)
- Modify: `apps/server/src/routes/api/bulk_action.ts` (add guard to execute)

**Step 1: Gate `POST /api/script/exec` and `POST /api/script/run/:noteId`**

In `apps/server/src/routes/api/script.ts`, add at the top of `exec()` and `run()`:

```typescript
import { assertScriptingEnabled } from "../../services/scripting_guard.js";

async function exec(req: Request) {
    assertScriptingEnabled();
    // ... existing code
}

function run(req: Request) {
    assertScriptingEnabled();
    // ... existing code
}
```

**Step 2: Gate SQL console**

In `apps/server/src/routes/api/sql.ts`, add at the top of `execute()`:

```typescript
import { assertSqlConsoleEnabled } from "../../services/scripting_guard.js";

function execute(req: Request) {
    assertSqlConsoleEnabled();
    // ... existing code
}
```

**Step 3: Gate bulk action executeScript**

In `apps/server/src/services/bulk_actions.ts`, add guard inside the `executeScript` handler:

```typescript
import { assertScriptingEnabled } from "./scripting_guard.js";

executeScript: (action, note) => {
    assertScriptingEnabled();
    // ... existing code
}
```

**Step 4: Verify TypeScript compiles, run tests**

**Step 5: Commit**

```
feat(security): gate script/SQL execution behind Scripting.enabled config
```

---

## Task 4: Gate scheduler and event handler script execution

**Files:**
- Modify: `apps/server/src/services/scheduler.ts` (check isScriptingEnabled before running)
- Modify: `apps/server/src/services/handlers.ts` (check isScriptingEnabled in runAttachedRelations)
- Modify: `apps/server/src/routes/api/script.ts` (gate startup/widget bundle endpoints)

**Step 1: Gate scheduler**

In `scheduler.ts`, the `TRILIUM_SAFE_MODE` check already exists. Augment it with scripting check:

```typescript
import { isScriptingEnabled } from "./scripting_guard.js";

sqlInit.dbReady.then(() => {
    if (!process.env.TRILIUM_SAFE_MODE && isScriptingEnabled()) {
        setTimeout(cls.wrap(() => runNotesWithLabel("backendStartup")), 10 * 1000);
        setInterval(cls.wrap(() => runNotesWithLabel("hourly")), 3600 * 1000);
        setInterval(cls.wrap(() => runNotesWithLabel("daily")), 24 * 3600 * 1000);
        // ...
    }
});
```

**Step 2: Gate event handlers**

In `handlers.ts`, wrap `runAttachedRelations` with a scripting check:

```typescript
import { isScriptingEnabled } from "./scripting_guard.js";

function runAttachedRelations(note: BNote, relationName: string, originEntity: AbstractBeccaEntity<any>) {
    if (!note || !isScriptingEnabled()) {
        return;
    }
    // ... existing code
}
```

**Step 3: Gate frontend startup/widget bundles**

In `script.ts` (the route file), gate `getStartupBundles` and `getWidgetBundles`:

```typescript
import { isScriptingEnabled } from "../../services/scripting_guard.js";

function getStartupBundles(req: Request) {
    if (!isScriptingEnabled()) {
        return { scripts: [], superScripts: [] };
    }
    // ... existing code
}
```

**Step 4: Verify TypeScript compiles, run tests**

**Step 5: Commit**

```
feat(security): gate scheduler, event handlers, and frontend bundles behind Scripting.enabled
```

---

## Task 5: Add authentication to `/custom/*` routes

**Files:**
- Modify: `apps/server/src/routes/custom.ts` (add optional auth middleware)

**Step 1: Add auth check with opt-out**

The custom handler needs auth by default, but notes with `#customRequestHandlerPublic` label can opt out. Modify `handleRequest`:

```typescript
import auth from "./auth.js";
import { isScriptingEnabled } from "../services/scripting_guard.js";

function handleRequest(req: Request, res: Response) {
    if (!isScriptingEnabled()) {
        res.status(403).send("Script execution is disabled on this server.");
        return;
    }

    // ... existing path parsing code ...

    for (const attr of attrs) {
        // ... existing matching code ...

        if (attr.name === "customRequestHandler") {
            const note = attr.getNote();

            // Require authentication unless note has #customRequestHandlerPublic label
            if (!note.hasLabel("customRequestHandlerPublic")) {
                if (!req.session?.loggedIn) {
                    res.status(401).send("Authentication required for this endpoint.");
                    return;
                }
            }

            // ... existing execution code ...
        }
    }
}
```

**Step 2: Add `customRequestHandlerPublic` to builtin attributes**

In `packages/commons/src/lib/builtin_attributes.ts`, add:

```typescript
{ type: "label", name: "customRequestHandlerPublic", isDangerous: true },
```

**Step 3: Verify TypeScript compiles**

**Step 4: Commit**

```
feat(security): require auth for /custom/* handlers by default, add #customRequestHandlerPublic opt-out
```

---

## Task 6: Restrict `require()` in ScriptContext

**Files:**
- Modify: `apps/server/src/services/script_context.ts` (add module whitelist)

**Step 1: Add module whitelist**

Replace the unrestricted `require()` fallback with a whitelist:

```typescript
// Modules that are safe for user scripts to require.
// These do NOT provide filesystem, network, or OS access.
const ALLOWED_MODULES = new Set([
    // Trilium built-in modules (resolved via note titles, not Node require)
    // -- these are handled before the fallback

    // Safe utility libraries available in node_modules
    "dayjs",
    "marked",
    "turndown",
    "cheerio",
    "axios",        // already exposed via api.axios, but scripts may require it directly
    "xml2js",       // already exposed via api.xml2js
    "escape-html",
    "sanitize-html",
    "lodash",

    // Trilium-specific modules
    "trilium:preact",
    "trilium:api",
]);

// Modules that are BLOCKED even when scripting is enabled.
// These provide OS-level access that makes RCE trivial.
const BLOCKED_MODULES = new Set([
    "child_process",
    "cluster",
    "dgram",
    "dns",
    "fs",
    "fs/promises",
    "net",
    "os",
    "path",
    "process",
    "tls",
    "worker_threads",
    "v8",
    "vm",
]);

class ScriptContext {
    // ... existing fields ...

    require(moduleNoteIds: string[]) {
        return (moduleName: string) => {
            // First: check note-based modules (existing behavior)
            const candidates = this.allNotes.filter((note) => moduleNoteIds.includes(note.noteId));
            const note = candidates.find((c) => c.title === moduleName);

            if (note) {
                return this.modules[note.noteId].exports;
            }

            // Second: check blocked list
            if (BLOCKED_MODULES.has(moduleName)) {
                throw new Error(
                    `Module '${moduleName}' is blocked for security. ` +
                    `Scripts cannot access OS-level modules like child_process, fs, net, os.`
                );
            }

            // Third: allow if in whitelist, otherwise block
            if (ALLOWED_MODULES.has(moduleName)) {
                return require(moduleName);
            }

            throw new Error(
                `Module '${moduleName}' is not in the allowed modules list. ` +
                `Contact your administrator to add it to the whitelist.`
            );
        };
    }
}
```

**Step 2: Verify TypeScript compiles, run tests**

**Step 3: Commit**

```
feat(security): restrict require() in script context to whitelisted modules
```

---

## Task 7: Filter dangerous attributes from sync

**Files:**
- Modify: `apps/server/src/services/sync_update.ts` (add dangerous attribute filtering)

**Step 1: Add attribute filtering in `updateNormalEntity`**

After `preProcessContent(remoteEC, remoteEntityRow)` at line 92, before `sql.replace()` at line 94, add:

```typescript
import attributeService from "./attributes.js";
import { isScriptingEnabled } from "./scripting_guard.js";
import log from "./log.js";

// In updateNormalEntity, after preProcessContent:
if (remoteEC.entityName === "attributes" && !isScriptingEnabled()) {
    const attrRow = remoteEntityRow as { type?: string; name?: string; isDeleted?: number };
    if (attrRow.type && attrRow.name && !attrRow.isDeleted &&
        attributeService.isAttributeDangerous(attrRow.type, attrRow.name)) {
        // Prefix dangerous attributes when scripting is disabled, same as safeImport
        log.info(`Sync: disabling dangerous attribute '${attrRow.name}' (scripting is disabled)`);
        (remoteEntityRow as any).name = `disabled:${attrRow.name}`;
    }
}
```

**Step 2: Verify TypeScript compiles**

**Step 3: Commit**

```
feat(security): filter dangerous attributes from sync when scripting is disabled
```

---

## Task 8: Restrict EJS share templates when scripting is disabled

**Files:**
- Modify: `apps/server/src/share/content_renderer.ts` (skip user EJS templates when scripting disabled)

**Step 1: Add scripting check before EJS rendering**

In `renderNoteContentInternal`, wrap the user template check:

```typescript
import { isScriptingEnabled } from "../services/scripting_guard.js";

// In renderNoteContentInternal, around lines 200-229:
if (note.hasRelation("shareTemplate") && isScriptingEnabled()) {
    // ... existing EJS rendering code ...
}
```

When scripting is disabled, user-provided EJS templates are silently ignored and the default template is used instead. This prevents the unauthenticated RCE via share templates.

**Step 2: Verify TypeScript compiles**

**Step 3: Commit**

```
feat(security): skip user EJS share templates when scripting is disabled
```

---

## Task 9: Desktop auto-enable scripting

**Files:**
- Modify: `apps/server/src/services/config.ts` (override Scripting.enabled for Electron)

**Step 1: Auto-enable for desktop**

After the `config` object is built, add:

```typescript
import { isElectron } from "./utils.js";

// At the bottom, before export:
// Desktop builds always have scripting enabled (single-user trusted environment)
if (isElectron) {
    config.Scripting.enabled = true;
    config.Scripting.sqlConsoleEnabled = true;
}
```

Note: `isElectron` is already imported in utils.ts and is available. Alternatively, the `scripting_guard.ts` already checks `isElectron`, so this step may be redundant but makes the config object truthful.

**Step 2: Check if `isElectron` is available in config.ts scope**

If not available at module load time, the guard in `scripting_guard.ts` already handles this via `isElectron || config.Scripting.enabled`. This step can be skipped if circular import issues arise.

**Step 3: Commit**

```
feat(security): auto-enable scripting for desktop builds
```

---

## Task 10: Add log warnings when scripting is enabled

**Files:**
- Modify: `apps/server/src/services/scheduler.ts` or `apps/server/src/main.ts` (add startup warning)

**Step 1: Add startup log**

In the server startup path, after config is loaded:

```typescript
if (isScriptingEnabled()) {
    log.info("WARNING: Script execution is ENABLED. Scripts have full server access including " +
             "filesystem, network, and OS commands. Only enable in trusted environments.");
}
```

**Step 2: Commit**

```
feat(security): log warning when scripting is enabled at startup
```

---

## Summary of Protection Matrix

| Attack Vector | Before | After (scripting=false) | After (scripting=true) |
|---|---|---|---|
| `POST /api/script/exec` | Full RCE | **Blocked (403)** | RCE with restricted require() |
| `POST /api/bulk-action/execute` (executeScript) | Full RCE | **Blocked (403)** | RCE with restricted require() |
| `POST /api/sql/execute` | SQL execution | **Blocked (403)** | SQL execution |
| `ALL /custom/*` | Unauthenticated RCE | **Auth required + scripting blocked** | Auth required + restricted require() |
| `GET /share/` (EJS template) | Unauthenticated RCE | **Default template only** | RCE (user templates allowed) |
| `#run=backendStartup` notes | Auto-execute on restart | **Not executed** | Executed with restricted require() |
| Event handlers (`~runOnNoteChange` etc.) | Auto-execute | **Not executed** | Executed with restricted require() |
| Frontend startup/widget scripts | Auto-execute on page load | **Not sent to client** | Executed |
| Sync: dangerous attributes | Applied silently | **Prefixed with `disabled:`** | Applied normally |
| `require('child_process')` | Available | N/A (scripts don't run) | **Blocked** |
| `require('fs')` | Available | N/A (scripts don't run) | **Blocked** |
| Desktop (Electron) | Always enabled | Always enabled | Always enabled |
