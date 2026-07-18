import { KATEX_MACROS } from "@triliumnext/commons";
import katex from "katex";
import { describe, expect, it } from "vitest";

// Guards against the MathLive→KaTeX mismatch from issue #9523: the visual math editor
// emits commands KaTeX doesn't define, so they must be mapped to valid KaTeX. These tests
// render against the real KaTeX engine so a typo in a macro value would surface as a throw.
describe("KaTeX MathLive compatibility macros", () => {
    it("renders every mapped MathLive command without erroring", () => {
        for (const [command, replacement] of Object.entries(KATEX_MACROS)) {
            // throwOnError makes KaTeX throw on an unknown command rather than emitting red
            // error text, so a successful render proves both the macro key is needed (the
            // bare command is unknown) and its replacement is valid KaTeX.
            expect(() => katex.renderToString(command, { throwOnError: true }), `${command} should be unknown to KaTeX`).toThrow();
            expect(() => katex.renderToString(command, { throwOnError: true, macros: { ...KATEX_MACROS } }), `${command} → ${replacement}`).not.toThrow();
        }
    });

    it("renders a differential integral expression that previously failed (issue #9523)", () => {
        const html = katex.renderToString("\\int f(x) \\differentialD x", {
            throwOnError: true,
            macros: { ...KATEX_MACROS }
        });
        // \mathrm{d} produces an upright "d", wrapped by KaTeX in a `mathrm` span.
        expect(html).toContain("mathrm");
    });
});
