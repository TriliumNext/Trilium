import mermaid from "mermaid";
import { describe, expect, it } from "vitest";

import SAMPLE_DIAGRAMS from "./sample_diagrams";

/** Detector ids that are not a diagram type of their own, so they need no sample. */
const NOT_SAMPLED = new Set([
    "error",
    "---",
    "info",
    "flowchart-elk",
    "railroadEbnf",
    "railroadAbnf",
    "railroadPeg"
]);

describe("Mermaid sample diagrams", () => {
    it("cover every diagram type Mermaid registers, each with code that parses", async () => {
        // `mermaid.parse()` registers the built-in diagrams on first use.
        await mermaid.parse("info");
        const registered = mermaid.getRegisteredDiagramsMetadata()
            .map(({ id }) => id)
            .filter((id) => !NOT_SAMPLED.has(id));
        expect(registered.length).toBeGreaterThan(0);

        const sampled = new Set<string>();
        for (const { content } of SAMPLE_DIAGRAMS) {
            sampled.add(mermaid.detectType(content));
            await expect(mermaid.parse(content)).resolves.toBeTruthy();
        }

        expect(registered.filter((id) => !sampled.has(id))).toEqual([]);
    });
});
