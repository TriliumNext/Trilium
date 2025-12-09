import becca from "../becca/becca.js";
import { note, NoteBuilder } from "../test/becca_mocking.js";
import cls from "./cls.js";
import { executeBundle, getScriptBundle } from "./script.js";
import BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";


describe("Script", () => {
    let rootNote!: NoteBuilder;

    beforeEach(() => {

        becca.reset();

        rootNote = new NoteBuilder(
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
        const scriptNote = note("dayjs", {
            type: "code",
            mime: "application/javascript;env=backend",
        });

        it("dayjs is available", () => {
            cls.init(() => {
                const bundle = getScriptBundle(scriptNote.note, true, "backend", [], `return api.dayjs().format("YYYY-MM-DD");`);
                expect(bundle).toBeDefined();
                const result = executeBundle(bundle!);
                expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            });
        });

        it("dayjs is-same-or-before plugin exists", () => {
            cls.init(() => {
                const bundle = getScriptBundle(scriptNote.note, true, "backend", [], `return api.dayjs("2023-10-01").isSameOrBefore(api.dayjs("2023-10-02"));`);
                expect(bundle).toBeDefined();
                const result = executeBundle(bundle!);
                expect(result).toBe(true);
            });
        });
    });
});
