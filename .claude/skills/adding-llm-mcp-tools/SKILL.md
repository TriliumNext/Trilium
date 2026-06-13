---
name: adding-llm-mcp-tools
description: Use when adding, changing, or reviewing an LLM/MCP tool in Trilium (the `defineTools` definitions under apps/server/src/services/llm/tools/ — note/attribute/attachment/hierarchy/icon tools) — anything exposed to both the in-app LLM chat and the external MCP server. Covers why `execute` MUST be synchronous (the `NotAPromise<T>` compile guard + better-sqlite3 sync transactions), the `mutates:true`→`sql.transactional` wiring, the single `allToolRegistries` registration point feeding both consumers, the return-`{error}`-don't-throw contract, the protected/system-note guards, and the `getTool()`/`cls.init()` spec harness. Do NOT use for client-side note UI, ETAPI endpoints, or generic Vitest questions (see writing-unit-tests).
---

# Adding an LLM/MCP tool

One tool definition, **two consumers**. Every tool under `apps/server/src/services/llm/tools/` is declared once via `defineTools({...})` and consumed by BOTH the in-app LLM chat AND the external MCP server. The wiring rules below all fall out of that fact — internalize it before touching anything.

## Footgun #1 (the big one): `execute` MUST be synchronous

No `async`, no `await`, no returned Promise. This is not a style preference — better-sqlite3 transactions are synchronous, so an `async execute` lets `sql.transactional()` **commit before the awaited work runs**, silently corrupting entity-change/Becca tracking.

The type system is built to make this a *compile error* (`tool_registry.ts:21,32,40`):

```ts
type NotAPromise<T> = T & { then?: void };          // line 21
// ...
execute: (args: any) => NotAPromise<object>;        // lines 32 (mutating) & 40 (read-only)
```

A Promise has `then: Function`, which violates `then?: void` → typecheck rejects it. It regressed **twice** anyway (`git show 09be2822e0` "fix(llm): some tools were async", `a93029f789` "fix(llm): misuse of transactions in tool use due to async") — the `NotAPromise` guard is the durable fix. **Do not weaken it** (no `as any`, no widening the return type). If you need data, fetch it synchronously through Becca / the sync services; the tools deliberately reuse the same logic as ETAPI without HTTP.

## Footgun #2: `mutates: true` is load-bearing wiring, not a label

Both consumers branch on it to wrap the call in a transaction. Forget it on a write tool and `execute` runs **outside** a transaction — no error, just broken entity-change tracking.

- LLM chat: `tool_registry.ts:65-67` — `def.mutates ? sql.transactional(() => def.execute(args)) : def.execute`
- MCP: `mcp_server.ts:31-33` (note: it lives in `apps/server/src/services/mcp/`, **not** under `llm/`) — the same branch, inside its own `cls.init`

Rule: **any tool that writes** (`setContent`, `save`, `setAttribute`, `createNewNote`, branch/clone/move, `deleteNote`, `markAsDeleted`) gets `mutates: true`. Read-only tools omit it (or `mutates: false`).

## Footgun #3: a new *module* is invisible until registered

`allToolRegistries` (`apps/server/src/services/llm/tools/index.ts:24`) is the **single wiring point** iterated by both `mcp_server.ts:46` and `base_provider.ts:340-341` (`llm/providers/base_provider.ts`, `Object.assign(tools, registry.toToolSet())`). Adding a tool to an **existing** module (e.g. another entry in `note_tools.ts`) needs no wiring. Creating a **new** module means: `export const xTools = defineTools({...})`, add the `export`/`import` lines in `index.ts`, and append `xTools` to the `allToolRegistries` array. Miss the array and chat + MCP both never see it.

## Footgun #4: return `{ error: "..." }` — never throw

The pipeline keys off the literal `error` property; a thrown exception escapes the contract. Every guard does `return { error: "Note not found" }` (`note_tools.ts:67,82,105`). Service calls that *can* throw are wrapped in try/catch that converts to `{ error }` (`note_tools.ts:274-292`, `createNewNote`):

```ts
try {
    const { note } = noteService.createNewNote({ parentNoteId, title, content: htmlContent, type });
    return { success: true, noteId: note.noteId, /* ... */ };
} catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create note" };
}
```

## Footgun #5: protected / system-note guards are mandatory and ordered

Skipping these lets the LLM corrupt protected or system notes. Apply in this order (see `note_tools.ts`):

| Check | Guard | Returns |
|---|---|---|
| Note exists | `!becca.getNote(id)` | `{ error: "Note not found" }` |
| Not protected | `!note.isContentAvailable()` | `{ error: "Note is protected..." }` |
| Right content kind | `!note.hasStringContent()` | `{ error: "Cannot ... note type: ${note.type}" }` |
| Stored content is text | `typeof note.getContent() !== "string"` | `{ error: "Note has binary content" }` |
| Rename/delete | `note.isProtected` | `{ error: "...cannot be renamed/deleted" }` |
| Delete/move/clone a system note | `PROTECTED_SYSTEM_NOTES.has(noteId)` | `{ error: "Cannot delete system notes" }` |

`PROTECTED_SYSTEM_NOTES` lives in `helpers.ts:16` = `new Set(["root", "_hidden", "_share", "_lbRoot", "_globalNoteMap"])`. For attribute writes, also guard `attributeService.isAttributeDangerous(type, name)` and (for relations) a missing target note (`attribute_tools.ts:71-79`).

## The recipe (ordered)

1. **Pick or create the module** (`{note,attribute,attachment,hierarchy,icon}_tools.ts`, or a new `*_tools.ts`). Declare the tool inside `defineTools({...})`.
2. Give it `description` (string the LLM reads), `inputSchema` (`z.object({...})` with `.describe()` on each field), and `execute` — **synchronous** (footgun #1).
3. For writes, add `mutates: true` (footgun #2).
4. Guard inputs in order and `return { error }` on every failure branch (footguns #4, #5); wrap throwing service calls in try/catch.
5. New module only: register it in `allToolRegistries` (footgun #3).
6. Add the client-side friendly name in `apps/client/src/translations/en/translation.json` under `llm.tools.<tool_name>`, **imperative tense** ("Create note", not "Creating note"). English only — other locales come via Weblate (see CLAUDE.md / translating-locales).
7. Write the spec with the `getTool()` + `cls.init()` harness — see [spec-harness.md](references/spec-harness.md).

## Decision table — guards & test harness per tool shape

| Tool does… | `mutates` | Required guards (in order) | Spec harness |
|---|---|---|---|
| read-only (search/get) | omit | `!note` → error; `isContentAvailable()` for content reads | plain `getTool(name).execute(args)`; mock `search.findResultsWithQuery` if it searches |
| edit existing note content | `true` | `!note` → not found; `!isContentAvailable()` → protected; `!hasStringContent()` → bad type; binary `getContent()` → binary | Pattern A: `buildNote` + stub `setContent`/`saveRevision` (no CLS) |
| create / move / clone (service writes) | `true` | parent `!isContentAvailable()`; wrap service call in try/catch → `{ error }` | Pattern B: `cls.init(() => createNewNote(...))` to seed, `cls.init(() => getTool(...).execute(...))` to call |
| rename / delete | `true` | `PROTECTED_SYSTEM_NOTES.has(noteId)` first; then `!note`; then `note.isProtected` | Pattern A (mock `deleteNote`/`save`) or Pattern B |

The two harness patterns are spelled out fully in the reference — don't re-derive the boilerplate.

## Quick verification checklist (before you finish)

- [ ] `execute` is not `async` and returns no Promise (typecheck rejects it otherwise — run `pnpm typecheck`).
- [ ] Every write tool has `mutates: true`.
- [ ] A brand-new module is in `allToolRegistries` (`index.ts:24`).
- [ ] All failure branches `return { error }`; the only `throw`s are service calls wrapped in try/catch.
- [ ] Protected/system-note guards present and ordered (table above).
- [ ] Friendly name added under `llm.tools.<name>` in `en/translation.json`, imperative tense.
- [ ] Spec covers happy path **and every guard branch**, asserting the literal `{ error: ... }` object — and that the success path does NOT leak an `error` property (`expect(result).not.toHaveProperty("error")`).

## Reference map

| File | When to open |
|---|---|
| [references/spec-harness.md](references/spec-harness.md) | Writing the `*_tools.spec.ts` — the `getTool()` iterator, Pattern A (mock persistence, no CLS), Pattern B (real becca + `cls.init`), and the error-object assertions. |

Cross-links: **writing-unit-tests** (general Vitest patterns, the `CoreApiTester`, becca/froca fixtures, single-file run commands), **translating-locales** (why en-only and how Weblate picks up the rest), **analyzing-coverage** (chasing the spec to 100%).
