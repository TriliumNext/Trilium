import { trimIndentation } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import { NoteBuilder } from "../test/becca_mocking.js";
import cls from "./cls.js";
import { buildJsx, executeBundle, getScriptBundle } from "./script.js";

describe("Script", () => {
    beforeEach(() => {

        becca.reset();

        new NoteBuilder(
            new BNote({
                noteId: "root",
                title: "root",
                type: "text"
            })
        );
        new BBranch({
            branchId: "none_root",
            noteId: "root",
            parentNoteId: "none",
            notePosition: 10
        });

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
