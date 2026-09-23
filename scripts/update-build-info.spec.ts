import { describe, expect, it } from "vitest";

import { formatBuildDate, renderBuildInfo, usesCommitDate } from "./update-build-info.mjs";

describe("formatBuildDate", () => {
    it("formats to whole seconds, whether or not the date carries milliseconds", () => {
        expect(formatBuildDate(new Date("2026-09-21T17:49:03.481Z"))).toBe("2026-09-21T17:49:03Z");
        expect(formatBuildDate(new Date("2026-09-21T17:49:03.000Z"))).toBe("2026-09-21T17:49:03Z");
        // A commit epoch reaches the formatter as whole seconds.
        expect(formatBuildDate(new Date(1758476943 * 1000))).toBe("2025-09-21T17:49:03Z");
    });
});

describe("renderBuildInfo", () => {
    it("renders the module the About dialog reads", () => {
        expect(renderBuildInfo("2026-09-21T17:49:03Z", "a0908a6e1e1741a3c3824d803da07300183dcb0c"))
            .toBe(`export default {
    buildDate: "2026-09-21T17:49:03Z",
    buildRevision: "a0908a6e1e1741a3c3824d803da07300183dcb0c"
};
`);
    });
});

describe("usesCommitDate", () => {
    it("stamps the clock unless --from-commit is passed", () => {
        // Every CI caller of chore:update-build-info relies on this default.
        expect(usesCommitDate([])).toBe(false);
        expect(usesCommitDate([ "--frozen-lockfile" ])).toBe(false);
        expect(usesCommitDate([ "--from-commit" ])).toBe(true);
    });
});
