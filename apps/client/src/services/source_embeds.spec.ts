import { describe, expect, it } from "vitest";

import { InlineCodeEmbed } from "../widgets/type_widgets/code/CodeEmbed";
import { getInlineEmbedType, getSourceEmbedTypeByLanguage } from "./source_embeds";

describe("getInlineEmbedType", () => {
    it("is the source embed type of a diagram language, else an extended code block", async () => {
        expect(getInlineEmbedType("mermaid")).toBe(getSourceEmbedTypeByLanguage("mermaid"));

        const codeBlock = getInlineEmbedType("text-x-python");
        expect(codeBlock.contentType).toBe("extendedCodeBlock");
        expect(await codeBlock.load()).toBe(InlineCodeEmbed);
    });
});
