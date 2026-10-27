import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import { createEnv, SCRIPT_MIME_BACKEND, scriptPath } from "../index.js";
import { getHover, hoverSource } from "./hover.js";

// Loading TypeScript and the bundled lib.*.d.ts the first time is not instant.
const TIMEOUT = 30_000;

/** A backend script's language service holding `code`. */
async function scriptHolding(code: string) {
    const env = await createEnv(SCRIPT_MIME_BACKEND);
    const path = scriptPath(SCRIPT_MIME_BACKEND);
    env.updateFile(path, code);
    return { env, path };
}

describe("getHover", () => {
    it("returns the quick info under the position, with no definition lookups", async () => {
        const { env, path } = await scriptHolding("api.log(\"x\");");
        const typeDefinition = vi.spyOn(env.languageService, "getTypeDefinitionAtPosition");
        const definition = vi.spyOn(env.languageService, "getDefinitionAtPosition");

        const hover = getHover({ env, path, pos: 5 });
        expect(hover).toMatchObject({ start: 4, end: 7 });
        expect(hover?.quickInfo?.displayParts?.map((part) => part.text).join("")).toContain("log");
        expect(typeDefinition).not.toHaveBeenCalled();
        expect(definition).not.toHaveBeenCalled();
    }, TIMEOUT);
});

describe("hoverSource", () => {
    it("shows what the renderer builds over the symbol, and nothing where there is none", async () => {
        const { env, path } = await scriptHolding("api.log(\"x\");\n\n");
        const dom = document.createElement("div");
        const renderTooltip = vi.fn(() => ({ dom }));
        const view = new EditorView({ state: EditorState.create({ doc: "api.log(\"x\");\n\n" }) });
        const source = hoverSource({ env, path, renderTooltip });

        const tooltip = source(view, 5);
        expect(tooltip).toMatchObject({ pos: 4, end: 7 });
        expect(tooltip?.create(view)).toEqual({ dom });
        expect(renderTooltip).toHaveBeenCalledWith(expect.objectContaining({ start: 4, end: 7 }), view);

        expect(source(view, 14)).toBe(null);
        view.destroy();
    }, TIMEOUT);
});
