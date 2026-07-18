import { describe, expect, it } from "vitest";

import { getScriptCompletions, getScriptDiagnosticCodes, SCRIPT_MIME_BACKEND, SCRIPT_MIME_FRONTEND, SCRIPT_MIME_JSX } from "./index.js";

/** Returns completions at the `|` marker in `source` (the marker is stripped). */
function completionsAtMarker(mime: string, source: string, context?: { customRequestHandler?: boolean }) {
    const offset = source.indexOf("|");
    // Strip exactly the marker at `offset` (not the first `|` in the string, which
    // may differ if the snippet legitimately contains a `|` operator earlier).
    const stripped = source.slice(0, offset) + source.slice(offset + 1);
    return getScriptCompletions(mime, stripped, offset, context);
}

/** "Property 'x' does not exist on type 'y'." */
const TS_UNKNOWN_PROPERTY = 2339;
/** "Argument of type 'x' is not assignable to parameter of type 'y'." */
const TS_ARGUMENT_NOT_ASSIGNABLE = 2345;
/** "Type 'x' is not assignable to type 'y'." (also raised for a missing required JSX prop) */
const TS_TYPE_NOT_ASSIGNABLE = 2322;
/** "'await' expressions are only allowed at the top level of a file when that file is a module…" */
const TS_TOP_LEVEL_AWAIT = 1375;
/** "Cannot find name '$'. Do you need to install type definitions for jQuery?…" */
const TS_JQUERY_NOT_FOUND = 2592;
/** "Cannot find name 'x'." */
const TS_NAME_NOT_FOUND = 2304;
/** "Unreachable code detected." — the one diagnostic rendered as a warning marker. */
const TS_UNREACHABLE_CODE = 7027;

// Loading TypeScript + the bundled lib.*.d.ts the first time is not instant.
const TIMEOUT = 30_000;

// Valid script snippets must produce *no* diagnostics at all — asserting the
// empty set (rather than just "not code N") also catches any unrelated spurious
// diagnostic from a config/lib/api-typing regression. The test name records the
// specific false positive each snippet guards against.
describe("script note diagnostics", () => {
    it("does not flag untyped parameters as implicit any (TS7006)", async () => {
        // Loose JS — untyped params are normal in script notes.
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_FRONTEND,
            "function handleClick(event) { return event; }\nconst add = (a, b) => a + b;"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("does not flag untyped parameters in backend scripts either (TS7006)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_BACKEND,
            "function process(note, depth) { return note; }"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("does not flag a top-level return — scripts run inside a function wrapper (TS1108)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_FRONTEND,
            "if (!api.currentNote) { return; }\nreturn api.showMessage('done');"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("does not flag a top-level return in backend scripts either (TS1108)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_BACKEND,
            "const note = api.getNote('root');\nif (!note) { return; }\nreturn note.title;"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("supports top-level await in frontend scripts — async wrapper (TS1375)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_FRONTEND,
            "const value = await Promise.resolve(1);"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("flags top-level await in backend scripts — non-async wrapper (TS1375)", async () => {
        // The backend wrapper is a plain function, so top-level await is genuinely
        // invalid there and must stay flagged.
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_BACKEND,
            "const value = await Promise.resolve(1);"
        );
        expect(codes).toContain(TS_TOP_LEVEL_AWAIT);
    }, TIMEOUT);

    it("provides jQuery types to frontend scripts ($ and JQuery methods)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_FRONTEND,
            "const $widget = $('<div>'); $widget.addClass('active').on('click', () => {});"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("does not provide jQuery to backend scripts ($ is unavailable server-side)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_BACKEND,
            "const el = $('<div>');"
        );
        expect(codes).toContain(TS_JQUERY_NOT_FOUND);
    }, TIMEOUT);

    it("provides the glob global to frontend scripts (member + note typing)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_FRONTEND,
            "if (glob.isElectron && glob.isDesktop()) {\n"
            + "    const note = glob.getActiveContextNote();\n"
            + "    api.showMessage(note?.title ?? glob.triliumVersion);\n"
            + "}"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("does not provide glob to backend scripts (browser-only global)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_BACKEND,
            "const v = glob.triliumVersion;"
        );
        // TS2304 "Cannot find name 'glob'." — glob is unavailable server-side.
        expect(codes).toContain(TS_NAME_NOT_FOUND);
    }, TIMEOUT);

    it("still surfaces real errors on the glob global (unknown member)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_FRONTEND,
            "const v = glob.thisGlobMemberDoesNotExist;"
        );
        expect(codes).toContain(TS_UNKNOWN_PROPERTY);
    }, TIMEOUT);

    it("still surfaces real errors (unknown api member)", async () => {
        // Guards against "fixing" false positives by disabling all checking:
        // genuine semantic errors must still be reported.
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_FRONTEND,
            "api.thisMethodDoesNotExist();"
        );
        expect(codes).toContain(TS_UNKNOWN_PROPERTY);
    }, TIMEOUT);

    it("flags unreachable code (TS7027) — the editor's one warning-severity diagnostic", async () => {
        // `allowUnreachableCode: false` surfaces dead code after a `return` as a
        // warning marker in the gutter.
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_BACKEND,
            "function f() {\n    return 1;\n    console.log('dead');\n}"
        );
        expect(codes).toContain(TS_UNREACHABLE_CODE);
    }, TIMEOUT);

    it("allows extending api widget base classes (constructor types, not unknown)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_FRONTEND,
            "class MyWidget extends api.NoteContextAwareWidget {\n"
            + "    doRender() { this.$widget = $('<div>'); }\n"
            + "    async refreshWithNote(note) { this.$widget.text(note?.title ?? ''); }\n"
            + "}"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("parses JSX in render notes without nagging about intrinsic elements (TS7026)", async () => {
        // Minimal JSX support: intrinsic elements have no typing yet and fall back
        // to `any` — which must stay quiet rather than erroring on every tag.
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_JSX,
            "const el = <div className=\"box\"><span>hi</span></div>;"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("exposes named members of the api via the trilium:api import (TS2305/TS2614)", async () => {
        // Render notes import api members by name: `import { showMessage } from "trilium:api"`.
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_JSX,
            "import { showMessage, getNote } from \"trilium:api\";\nshowMessage(\"hi\");\nvoid getNote(\"root\");"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("resolves the trilium:preact import a render note uses (TS2307)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_JSX,
            "import { h, Fragment } from \"trilium:preact\";\nexport default function App() { return <><div>hi</div></>; }"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("provides real Preact hook types from trilium:preact (type inference)", async () => {
        // Correct usage: `useState(0)` infers a number setter.
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_JSX,
            "import { useState } from \"trilium:preact\";\nconst [count, setCount] = useState(0);\nsetCount(count + 1);"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("type-checks Preact hook arguments (real types, not any)", async () => {
        // `useState(0)` → setter takes a number; passing a string must error,
        // proving the hooks resolve to real types rather than `any`.
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_JSX,
            "import { useState } from \"trilium:preact\";\nconst [count, setCount] = useState(0);\nsetCount(\"not a number\");"
        );
        expect(codes).toContain(TS_ARGUMENT_NOT_ASSIGNABLE);
    }, TIMEOUT);

    it("type-checks JSX intrinsic element attributes (real JSX.IntrinsicElements)", async () => {
        // `tabIndex` is typed as a number on Preact's HTMLAttributes; a string
        // value must error, proving intrinsic-element typing is wired (not `any`).
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_JSX,
            "const el = <div tabIndex=\"oops\">hi</div>;"
        );
        expect(codes).toContain(TS_TYPE_NOT_ASSIGNABLE);
    }, TIMEOUT);

    it("provides jQuery to JSX render notes (browser runtime, like frontend)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_JSX,
            "const $widget = $('<div>'); $widget.addClass('active');"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("still surfaces real errors in JSX notes (unknown api member)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_JSX,
            "api.thisMethodDoesNotExist();\nconst el = <div/>;"
        );
        expect(codes).toContain(TS_UNKNOWN_PROPERTY);
    }, TIMEOUT);
});

describe("frontend note (ScriptFNote) surface", () => {
    it("offers the expanded note member set on api.currentNote", async () => {
        const names = await completionsAtMarker(SCRIPT_MIME_FRONTEND, "api.currentNote.|");
        // A representative slice across the families added to ScriptFNote:
        // attribute accessors, type predicates, hierarchy, content, fields.
        for (const member of [
            "getOwnedLabelValue", "getRelation", "hasRelation", "getAttributeValue",
            "isHtml", "isJavaScript", "isFolder", "isArchived",
            "getSubtreeNoteIds", "hasChildren", "getChildBranches",
            "getJsonContent", "getAttachments", "getMetadata", "targetRelations"
        ]) {
            expect(names).toContain(member);
        }
    }, TIMEOUT);

    it("type-checks the expanded note members (real signatures, not any)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_FRONTEND,
            "const note = api.currentNote;\n"
            + "if (note.isHtml() && !note.isArchived) {\n"
            + "    const v = note.getLabelValue('foo');\n"
            + "    const branches = note.getChildBranches();\n"
            + "    const ids = await note.getSubtreeNoteIds(true);\n"
            + "    api.showMessage((v ?? '') + branches.length + ids.length);\n"
            + "}"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("still flags an unknown note member (curated subset, not any)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_FRONTEND,
            "const v = api.currentNote.thisNoteMemberDoesNotExist();"
        );
        expect(codes).toContain(TS_UNKNOWN_PROPERTY);
    }, TIMEOUT);
});

describe("backend note (ScriptBNote) surface", () => {
    it("offers the expanded note member set on api.getNote(...)", async () => {
        const names = await completionsAtMarker(
            SCRIPT_MIME_BACKEND,
            "const note = api.getNote('root');\nnote?.|"
        );
        // A representative slice across the families added to ScriptBNote:
        // attribute write methods, revisions/attachments, hierarchy, tree ops.
        for (const member of [
            "setLabel", "toggleLabel", "removeRelation", "getOwnedLabelValue",
            "getRevisions", "saveRevision", "getAttachments", "saveAttachment",
            "getAncestors", "getSubtree", "cloneTo", "deleteNote",
            "searchNotesInSubtree", "isImage", "shareId", "dateModified"
        ]) {
            expect(names).toContain(member);
        }
    }, TIMEOUT);

    it("type-checks the expanded backend note members (real signatures, not any)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_BACKEND,
            "const note = api.getNote('root');\n"
            + "if (note && note.isHtml()) {\n"
            + "    note.setLabel('reviewed', 'yes');\n"
            + "    const rev = note.saveRevision();\n"
            + "    const sub = note.getSubtree({ includeArchived: true });\n"
            + "    api.log(rev.title + sub.notes.length + note.cloneTo('root').success);\n"
            + "}"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);
});

describe("backend custom request handler api (req/res/pathParams)", () => {
    const HANDLER = { customRequestHandler: true };

    it("offers req, res and pathParams to custom request handler notes", async () => {
        const names = await completionsAtMarker(SCRIPT_MIME_BACKEND, "api.|", HANDLER);
        expect(names).toContain("req");
        expect(names).toContain("res");
        expect(names).toContain("pathParams");
    }, TIMEOUT);

    it("types the res object's methods (status/send/json), not unknown", async () => {
        const names = await completionsAtMarker(SCRIPT_MIME_BACKEND, "api.res?.|", HANDLER);
        expect(names).toContain("status");
        expect(names).toContain("send");
        expect(names).toContain("json");
    }, TIMEOUT);

    it("exposes req/res/pathParams as non-optional (no null-check needed in a handler)", async () => {
        // No optional chaining: if these were typed optional, accessing them would
        // raise TS18048 ("possibly undefined"). They're guaranteed in a handler.
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_BACKEND,
            "const id = api.pathParams[0];\n"
            + "api.res.status(200).json({ id, method: api.req.method });",
            HANDLER
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("hides req/res/pathParams from backend notes that are not custom request handlers", async () => {
        const names = await completionsAtMarker(SCRIPT_MIME_BACKEND, "api.|");
        expect(names).not.toContain("req");
        expect(names).not.toContain("res");
        expect(names).not.toContain("pathParams");
        // The rest of the backend api stays available.
        expect(names).toContain("getNote");
    }, TIMEOUT);

    it("flags req/res access in a non-handler backend note (omitted from the api type)", async () => {
        const codes = await getScriptDiagnosticCodes(SCRIPT_MIME_BACKEND, "api.res?.send('hi');");
        expect(codes).toContain(TS_UNKNOWN_PROPERTY);
    }, TIMEOUT);

    it("does not expose req/res/pathParams to frontend scripts (server-only)", async () => {
        const names = await completionsAtMarker(SCRIPT_MIME_FRONTEND, "api.|", HANDLER);
        expect(names).not.toContain("req");
        expect(names).not.toContain("res");
        expect(names).not.toContain("pathParams");
    }, TIMEOUT);
});

describe("JSX autocompletion", () => {
    it("offers intrinsic element names while typing a tag", async () => {
        // A bare `<` is ambiguous (less-than operator); completing within an actual
        // tag name puts the parser unambiguously in JSX-element context.
        const names = await completionsAtMarker(SCRIPT_MIME_JSX, "const el = <div|></div>;");
        expect(names).toContain("div");
        expect(names).toContain("span");
        expect(names).toContain("button");
    }, TIMEOUT);

    it("offers element attribute names inside an opening tag", async () => {
        const names = await completionsAtMarker(SCRIPT_MIME_JSX, "const el = <div |></div>;");
        expect(names).toContain("className");
        expect(names).toContain("tabIndex");
        expect(names).toContain("onClick");
    }, TIMEOUT);

    it("offers api members inside JSX expressions", async () => {
        const names = await completionsAtMarker(
            SCRIPT_MIME_JSX,
            "const title = api.|;\nconst el = <div/>;"
        );
        expect(names).toContain("showMessage");
        expect(names).toContain("getNote");
    }, TIMEOUT);

    it("offers a trilium:preact component's own prop names", async () => {
        const names = await completionsAtMarker(
            SCRIPT_MIME_JSX,
            "import { Admonition } from \"trilium:preact\";\nconst el = <Admonition |>x</Admonition>;"
        );
        expect(names).toContain("type");
        expect(names).toContain("className");
    }, TIMEOUT);

    it("offers a component prop's literal values", async () => {
        // Admonition's `type` is a union — completing the value offers the members.
        const names = await completionsAtMarker(
            SCRIPT_MIME_JSX,
            "import { Admonition } from \"trilium:preact\";\nconst el = <Admonition type=\"|\">x</Admonition>;"
        );
        expect(names).toContain("warning");
        expect(names).toContain("note");
        expect(names).toContain("caution");
    }, TIMEOUT);
});

describe("JSX component typing", () => {
    it("accepts valid component props", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_JSX,
            "import { Admonition } from \"trilium:preact\";\nexport default () => <Admonition type=\"note\">hi</Admonition>;"
        );
        expect(codes).toEqual([]);
    }, TIMEOUT);

    it("rejects an invalid component prop value (real prop types, not any)", async () => {
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_JSX,
            "import { Admonition } from \"trilium:preact\";\nexport default () => <Admonition type=\"bogus\">hi</Admonition>;"
        );
        expect(codes).toContain(TS_TYPE_NOT_ASSIGNABLE);
    }, TIMEOUT);

    it("flags a missing required component prop", async () => {
        // `Admonition` requires `type`; omitting it must error.
        const codes = await getScriptDiagnosticCodes(
            SCRIPT_MIME_JSX,
            "import { Admonition } from \"trilium:preact\";\nexport default () => <Admonition>hi</Admonition>;"
        );
        expect(codes).toContain(TS_TYPE_NOT_ASSIGNABLE);
    }, TIMEOUT);
});
