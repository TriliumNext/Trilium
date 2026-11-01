import { describe, expect, it } from "vitest";

import { KATEX_MACROS } from "./katex_macros.js";

describe("KATEX_MACROS", () => {
    it("maps LaTeX commands onto non-empty KaTeX expansions", () => {
        // KaTeX keys its macro table by the literal command token, so a key that is missing its
        // leading backslash (or an empty expansion) silently never fires and the formula falls
        // back to raw red error text — the exact failure this table exists to prevent (#9523).
        const entries = Object.entries(KATEX_MACROS);
        expect(entries.length).toBeGreaterThan(0);

        for (const [command, expansion] of entries) {
            expect(command).toMatch(/^\\[a-zA-Z]+$/);
            expect(expansion.length).toBeGreaterThan(0);
        }
    });

    it("covers the commands MathLive's inline shortcuts auto-insert", () => {
        // These three are reachable by typing alone — `dx`/`dy`/`dt`, `?=` and `::` — so they are
        // the ones a user hits without ever opening the symbol palette.
        expect(KATEX_MACROS["\\differentialD"]).toBe("\\mathrm{d}");
        expect(KATEX_MACROS["\\questeq"]).toBe("\\stackrel{?}{=}");
        expect(KATEX_MACROS["\\Colon"]).toBe("\\dblcolon");
    });

    it("renders the ISO 80000-2 operator family upright", () => {
        // The whole family shares one definition shape; rendering any of them italic would make
        // them read as variables rather than operators.
        for (const command of ["\\differentialD", "\\capitalDifferentialD", "\\exponentialE", "\\imaginaryI", "\\imaginaryJ"]) {
            expect(KATEX_MACROS[command]).toMatch(/^\\mathrm\{.+\}$/);
        }
    });
});
