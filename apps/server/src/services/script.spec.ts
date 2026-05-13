import { trimIndentation } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import cls from "./cls.js";
import scriptService, { buildJsx, executeBundle, getScriptBundle } from "./script.js";
import ws from "./ws.js";

vi.mock("./ws.js", () => ({
    default: {
        sendMessageToAllClients: vi.fn()
    }
}));

describe("Script", () => {
    beforeEach(() => {

        becca.reset();

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
            return {
                dbReady: () => {
                    console.log("Hello world");
                }
            };
        });
    });

    it("returns result from script", () => {
        cls.init(() => {
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

        cls.init(() => {
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
        const scriptNote = buildNote({
            type: "code",
            mime: "application/javascript;env=backend",
            content: ""
        });

        it("dayjs is available", () => {
            cls.init(() => {
                const bundle = getScriptBundle(scriptNote, true, "backend", [], `return api.dayjs().format("YYYY-MM-DD");`);
                expect(bundle).toBeDefined();
                const result = executeBundle(bundle!);
                expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            });
        });

        it("dayjs is-same-or-before plugin exists", () => {
            cls.init(() => {
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
});

describe("executeNote", () => {
    beforeEach(() => {
        becca.reset();
        vi.mocked(ws.sendMessageToAllClients).mockClear();
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
});

describe("getScriptBundleForFrontend", () => {
    beforeEach(() => {
        becca.reset();
        vi.mocked(ws.sendMessageToAllClients).mockClear();
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
