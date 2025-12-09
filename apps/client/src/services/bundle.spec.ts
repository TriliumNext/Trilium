import { describe, expect, it } from "vitest";
import { Bundle, executeBundle } from "./bundle";
import { buildNote } from "../test/easy-froca";

describe("Script bundle", () => {
    it("dayjs is available", async () => {
        const script = /* js */`return api.dayjs().format("YYYY-MM-DD");`;
        const bundle = getBundle(script);
        const result = await executeBundle(bundle, null, $());
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("dayjs is-same-or-before plugin exists", async () => {
        const script = /* js */`return api.dayjs("2023-10-01").isSameOrBefore(api.dayjs("2023-10-02"));`;
        const bundle = getBundle(script);
        const result = await executeBundle(bundle, null, $());
        expect(result).toBe(true);
    });
});

function getBundle(script: string) {
    const id = buildNote({
        title: "Script note"
    }).noteId;
    const bundle: Bundle = {
        script: [
            '',
            `apiContext.modules['${id}'] = { exports: {} };`,
            `return await ((async function(exports, module, require, api) {`,
            `try {`,
            `${script}`,
            `;`,
            `} catch (e) { throw new Error(\"Load of script note \\\"Client\\\" (${id}) failed with: \" + e.message); }`,
            `for (const exportKey in exports) module.exports[exportKey] = exports[exportKey];`,
            `return module.exports;`,
            `}).call({}, {}, apiContext.modules['${id}'], apiContext.require([]), apiContext.apis['${id}']));`,
            ''
        ].join('\n'),
        html: "",
        noteId: id,
        allNoteIds: [ id ]
    };
    return bundle;
}
