import { trimIndentation } from "@triliumnext/commons";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import config from "./config.js";
import { getContext } from "./context.js";
import scriptService, { buildJsx, describeScriptFailure, executeBundle, getScriptBundle } from "./script.js";
import ws from "./ws.js";

describe("Script", () => {
    // executeBundle enforces the backendScriptingEnabled security toggle (default false).
    const originalScriptingEnabled = config.Security.backendScriptingEnabled;

    beforeAll(() => {
        config.Security.backendScriptingEnabled = true;
    });

    afterAll(() => {
        config.Security.backendScriptingEnabled = originalScriptingEnabled;
    });

    beforeEach(() => {

        becca.reset();
        vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {}).mockClear();

        buildNote({ id: "root", title: "root" });

        vi.mock("./sql.js", () => {
            return {
                default: {
                    transactional: (cb: Function) => {
                        cb();
                    },
                    execute: () => {},
                    replace: () => {},
                    getMap: () => {}
                }
            };
        });

        vi.mock("./sql_init.js", () => {
            const mock = {
                initializeDb: () => {},
                dbReady: Promise.resolve()
            };
            return { default: mock, ...mock };
        });
    });

    it("returns result from script", () => {
        getContext().init(() => {
            const result = executeBundle({
                script: `return "world";`,
                html: "",
            });
            expect(result).toBe("world");
        });
    });

    it("executes runOnFrontend from a backend script", () => {
        const note = buildNote({
            type: "code",
            mime: "application/javascript;env=backend",
            content: ""
        });

        getContext().init(() => {
            const bundle = getScriptBundle(note, true, "backend", [], `
                api.runOnFrontend(() => {
                    api.showMessage("Hello frontend");
                });
            `);
            expect(bundle).toBeDefined();
            executeBundle(bundle!);

            expect(ws.sendMessageToAllClients).toHaveBeenCalledOnce();
            expect(ws.sendMessageToAllClients).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "execute-script",
                    script: expect.stringContaining("Hello frontend")
                })
            );
        });
    });

    describe("dayjs in backend scripts", () => {
        // buildNote() is called inside beforeAll (not at describe-collection
        // time) so that the test setup's initializeCore() has run first.
        // buildNote generates random IDs via getCrypto(), which crashes with
        // "Crypto not initialized" if invoked during describe collection.
        let scriptNote: ReturnType<typeof buildNote>;

        beforeAll(() => {
            scriptNote = buildNote({
                type: "code",
                mime: "application/javascript;env=backend",
                content: ""
            });
        });

        it("dayjs is available", () => {
            getContext().init(() => {
                const bundle = getScriptBundle(scriptNote, true, "backend", [], `return api.dayjs().format("YYYY-MM-DD");`);
                expect(bundle).toBeDefined();
                const result = executeBundle(bundle!);
                expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            });
        });

        it("dayjs is-same-or-before plugin exists", () => {
            getContext().init(() => {
                const bundle = getScriptBundle(scriptNote, true, "backend", [], `return api.dayjs("2023-10-01").isSameOrBefore(api.dayjs("2023-10-02"));`);
                expect(bundle).toBeDefined();
                const result = executeBundle(bundle!);
                expect(result).toBe(true);
            });
        });
    });
});

describe("getScriptBundle", () => {
    beforeEach(() => {
        becca.reset();
    });

    it("returns a bundle for a backend script", () => {
        const note = buildNote({
            type: "code",
            mime: "application/javascript;env=backend",
            content: "api.log('hello');"
        });

        const bundle = getScriptBundle(note, true, "backend");
        expect(bundle).toBeDefined();
        expect(bundle!.script).toContain("api.log('hello');");
        expect(bundle!.note).toBe(note);
        expect(bundle!.allNotes).toContain(note);
    });

    it("returns a bundle for a frontend script", () => {
        const note = buildNote({
            type: "code",
            mime: "application/javascript;env=frontend",
            content: "api.log('hello');"
        });

        const bundle = getScriptBundle(note, true, "frontend");
        expect(bundle).toBeDefined();
        expect(bundle!.script).toContain("api.log('hello');");
    });

    it("returns undefined for non-script notes", () => {
        const note = buildNote({ type: "text", content: "just text" });

        const bundle = getScriptBundle(note, true, "backend");
        expect(bundle).toBeUndefined();
    });

    it("skips child notes with mismatched script env", () => {
        const parent = buildNote({
            type: "code",
            mime: "application/javascript;env=backend",
            content: "api.log('backend');",
            children: [{
                type: "code",
                mime: "application/javascript;env=frontend",
                content: "api.log('frontend');"
            }]
        });

        const bundle = getScriptBundle(parent, true, "backend");
        expect(bundle).toBeDefined();
        expect(bundle!.script).toContain("api.log('backend');");
        expect(bundle!.script).not.toContain("api.log('frontend');");
    });

    it("builds an HTML bundle for an HTML note", () => {
        const note = buildNote({ type: "render", mime: "text/html", content: "<p>hi</p>" });

        const bundle = getScriptBundle(note, true, "frontend");
        expect(bundle).toBeDefined();
        expect(bundle?.html).toContain("<p>hi</p>");
    });

    it("throws when the note's content is not available (protected)", () => {
        const note = buildNote({ type: "code", mime: "application/javascript;env=backend", content: "" });
        note.isContentAvailable = () => false;

        expect(() => getScriptBundle(note)).toThrow(/protected/);
    });
});

describe("executeNote", () => {
    beforeEach(() => {
        becca.reset();
        vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {}).mockClear();
    });

    it("sends a toast when trying to execute a frontend script in the backend", () => {
        const note = buildNote({
            type: "code",
            mime: "application/javascript;env=frontend",
            content: "api.log('hello');"
        });

        scriptService.executeNote(note, {});
        expect(ws.sendMessageToAllClients).toHaveBeenCalledOnce();
        expect(ws.sendMessageToAllClients).toHaveBeenCalledWith(
            expect.objectContaining({ type: "toast" })
        );
    });

    it("throws when the note is protected and unavailable", () => {
        const note = buildNote({ type: "code", mime: "application/javascript;env=backend", content: "" });
        note.isContentAvailable = () => false;

        expect(() => scriptService.executeNote(note, {})).toThrow(/protected/);
    });
});

describe("getScriptBundleForFrontend", () => {
    beforeEach(() => {
        becca.reset();
        vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {}).mockClear();
    });

    it("returns a bundle with noteIds instead of note objects", () => {
        const note = buildNote({
            type: "code",
            mime: "application/javascript;env=frontend",
            content: "api.log('hello');"
        });

        const bundle = scriptService.getScriptBundleForFrontend(note);
        expect(bundle).toBeDefined();
        expect(bundle!.noteId).toBe(note.noteId);
        expect(bundle!.note).toBeUndefined();
        expect(bundle!.allNoteIds).toContain(note.noteId);
        expect(bundle!.allNotes).toBeUndefined();
    });

    it("returns undefined and sends a toast for backend scripts", () => {
        const note = buildNote({
            type: "code",
            mime: "application/javascript;env=backend",
            content: "api.log('hello');"
        });

        const bundle = scriptService.getScriptBundleForFrontend(note);
        expect(bundle).toBeUndefined();
        expect(ws.sendMessageToAllClients).toHaveBeenCalledOnce();
        expect(ws.sendMessageToAllClients).toHaveBeenCalledWith(
            expect.objectContaining({ type: "toast" })
        );
    });

    it("returns a bundle when a backend note uses runOnFrontend with an override script", () => {
        const note = buildNote({
            type: "code",
            mime: "application/javascript;env=backend",
            content: `
                api.runOnFrontend(() => {
                    api.showMessage("Hello frontend");
                });
            `
        });

        const frontendScript = `() => { api.showMessage("Hello frontend"); }`;
        const bundle = scriptService.getScriptBundleForFrontend(note, frontendScript);
        expect(bundle).toBeDefined();
        expect(bundle!.script).toContain("Hello frontend");
    });
});

describe("JSX building", () => {
    it("processes basic JSX", () => {
        const script = trimIndentation`\
            function MyComponent() {
                return <p>Hello world.</p>;
            }
        `;
        const expected = trimIndentation`\
            "use strict";function MyComponent() {
                return api.preact.h('p', null, "Hello world." );
            }
        `;
        expect(buildJsx(script).code).toStrictEqual(expected);
    });

    it("processes fragments", () => {
        const script = trimIndentation`\
            function MyComponent() {
                return <>
                    <p>Hi</p>
                    <p>there</p>
                </>;
            }
        `;
        const expected = trimIndentation`\
            "use strict";function MyComponent() {
                return api.preact.h(api.preact.Fragment, null
                    , api.preact.h('p', null, "Hi")
                    , api.preact.h('p', null, "there")
                );
            }
        `;
        expect(buildJsx(script).code).toStrictEqual(expected);
    });

    it("rewrites export", () => {
        const script = trimIndentation`\
            const { defineWidget } = api.preact;

            export default defineWidget({
                parent: "right-pane",
                render() {
                    return <></>;
                }
            });
        `;
        const expected = trimIndentation`\
            "use strict";Object.defineProperty(exports, "__esModule", {value: true});const { defineWidget } = api.preact;

            module.exports = defineWidget({
                parent: "right-pane",
                render() {
                    return api.preact.h(api.preact.Fragment, null);
                }
            });
        `;
        expect(buildJsx(script).code).toStrictEqual(expected);
    });

    it("rewrites React API imports", () => {
        const script = trimIndentation`\
            import { defineWidget, RightPanelWidget} from "trilium:preact";
            defineWidget({
                render() {
                    return <RightPanelWidget />;
                }
            });
        `;
        const expected = trimIndentation`\
            "use strict";const _triliumpreact = api.preact;
            _triliumpreact.defineWidget.call(void 0, {
                render() {
                    return api.preact.h(_triliumpreact.RightPanelWidget, null );
                }
            });
        `;
        expect(buildJsx(script).code).toStrictEqual(expected);
    });

    it("rewrites internal API imports", () => {
        const script = trimIndentation`\
            import { log } from "trilium:api";
            log("Hi");
        `;
        const expected = trimIndentation`\
            "use strict";const _triliumapi = api;
            _triliumapi.log.call(void 0, "Hi");
        `;
        expect(buildJsx(script).code).toStrictEqual(expected);
    });
});

describe("executeScript", () => {
    // executeScript funnels through executeBundle, which enforces backendScriptingEnabled.
    const originalScriptingEnabled = config.Security.backendScriptingEnabled;

    beforeAll(() => {
        config.Security.backendScriptingEnabled = true;
    });

    afterAll(() => {
        config.Security.backendScriptingEnabled = originalScriptingEnabled;
    });

    beforeEach(() => {
        becca.reset();
    });

    it("executes a frontend script excerpt in the backend context", () => {
        const note = buildNote({ type: "code", mime: "application/javascript;env=backend", content: "" });

        getContext().init(() => {
            const result = scriptService.executeScript(`() => "hello from excerpt"`, [], note.noteId, note.noteId, "notes", note.noteId, becca);
            expect(result).toBe("hello from excerpt");
        });
    });

    it("serializes params and passes them to the excerpt", () => {
        const note = buildNote({ type: "code", mime: "application/javascript;env=backend", content: "" });

        getContext().init(() => {
            const result = scriptService.executeScript(`(count, label) => label + ":" + (count + 1)`, [4, "n"], note.noteId, note.noteId, "notes", note.noteId, becca);
            expect(result).toBe("n:5");
        });
    });

    it("throws when the current note cannot be found", () => {
        getContext().init(() => {
            expect(() => scriptService.executeScript(`() => 1`, [], "missing", "missing", "notes", "missing", becca)).toThrow(/Cannot find note/);
        });
    });
});

describe("executeNoteNoException", () => {
    const originalScriptingEnabled = config.Security.backendScriptingEnabled;

    beforeAll(() => {
        config.Security.backendScriptingEnabled = true;
    });

    afterAll(() => {
        config.Security.backendScriptingEnabled = originalScriptingEnabled;
    });

    beforeEach(() => {
        becca.reset();
    });

    it("swallows runtime errors thrown by the script", () => {
        const note = buildNote({
            type: "code",
            mime: "application/javascript;env=backend",
            content: `throw new Error("boom");`
        });

        getContext().init(() => {
            expect(() => scriptService.executeNoteNoException(note, {})).not.toThrow();
        });
    });
});

describe("describeScriptFailure", () => {
    /** A failure as the bundle wraps one: the note it stands for, and what it wrapped. */
    const wrapped = (noteId: string, message: string, cause: unknown) =>
        Object.assign(new Error(message, { cause }), { scriptNoteId: noteId });

    it("answers the failure itself and the note nearest it", () => {
        const failure = new Error("Module 'axioss' could not be loaded.", { cause: new Error("Cannot find module") });
        const outer = wrapped("parent", "Load of script note \"Parent\" (parent) failed with: ...",
            wrapped("child", "Load of script note \"Child\" (child) failed with: ...", failure));

        expect(describeScriptFailure(outer)).toEqual({
            message: "Module 'axioss' could not be loaded.",
            noteId: "child"
        });
    });

    it("stops at the failure rather than at what the failure wrapped", () => {
        // Node answers a missing module with a require stack of Trilium's own files; the message
        // above it was written to keep that out of the way, so the walk must not go past it.
        const nodeError = new Error("Cannot find module 'x'\nRequire stack:\n- becca.ts");
        const failure = new Error("Module 'x' could not be loaded.", { cause: nodeError });

        expect(describeScriptFailure(wrapped("n1", "wrapped", failure)).message)
            .toBe("Module 'x' could not be loaded.");
    });

    it("answers a failure that was never wrapped, without a note", () => {
        expect(describeScriptFailure(new Error("scripting is disabled")))
            .toEqual({ message: "scripting is disabled" });
        expect(describeScriptFailure("just a string")).toEqual({ message: "just a string" });
    });

    it("survives a cycle in the chain", () => {
        const looped = wrapped("n1", "outer", undefined);
        looped.cause = looped;

        expect(describeScriptFailure(looped)).toEqual({ message: "outer", noteId: "n1" });
    });
});
