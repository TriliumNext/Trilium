import { describe, expect, it } from "vitest";

import { renderInto } from "../../test/render";
import { AttributeSnippetBadges, parseAttributeSnippetLine } from "./Badge";

describe("parseAttributeSnippetLine", () => {
    it("splits a label or a relation into its kind's icon, its name and its value, highlights kept", () => {
        expect(parseAttributeSnippetLine("#<b>tag</b>")).toEqual({ icon: "bx bx-hash", name: "<b>tag</b>" });
        expect(parseAttributeSnippetLine("#status=&quot;<b class=\"search-fuzzy-match\">open</b>&quot;"))
            .toEqual({ icon: "bx bx-hash", name: "status", value: "<b class=\"search-fuzzy-match\">open</b>" });
        expect(parseAttributeSnippetLine("~author=&quot;J. R. R. &quot;Tolkien&quot;&quot;"))
            .toEqual({ icon: "bx bx-transfer", name: "author", value: "J. R. R. &quot;Tolkien&quot;" });
    });

    it("gives a definition its field's icon and its bare name, its options only where matched", () => {
        expect(parseAttributeSnippetLine("#label:<b>due</b>=&quot;promoted,single,date&quot;"))
            .toEqual({ icon: "bx bx-calendar", name: "<b>due</b>" });
        expect(parseAttributeSnippetLine("#relation:author=&quot;promoted&quot;"))
            .toEqual({ icon: "bx bx-transfer", name: "author" });
        // Options the search matched stay, as the reason the note is listed.
        expect(parseAttributeSnippetLine("#label:due=&quot;promoted,single,<b>date</b>&quot;"))
            .toEqual({ icon: "bx bx-calendar", name: "due", value: "promoted,single,<b>date</b>" });
        // A highlight across the prefix leaves the name as text.
        expect(parseAttributeSnippetLine("#<b>label:due</b>=&quot;promoted&quot;"))
            .toEqual({ icon: "bx bx-text", name: "due" });
    });

    it("gives up on a line it cannot read, such as one the server cut short", () => {
        expect(parseAttributeSnippetLine("#status=&quot;a long val...")).toBeNull();
        expect(parseAttributeSnippetLine("status")).toBeNull();
    });
});

describe("AttributeSnippetBadges", () => {
    it("draws each attribute as its kind's icon, its name and its value, or the line as it came", () => {
        const container = renderInto(<AttributeSnippetBadges
            className="attrs"
            snippet={"#<b>tag</b><br>~template=&quot;Book&quot;<br>#status=&quot;cut sho..."}
        />);
        const [ tag, template, cut ] = container.querySelectorAll<HTMLElement>(".attrs > .ext-badge.outline");

        expect(tag.classList.contains("attribute-badge")).toBe(true);
        expect(tag.querySelector(".attribute-badge-key > .tn-icon")?.className).toBe("bx bx-hash tn-icon");
        expect(tag.querySelector(".attribute-badge-key > .attribute-badge-name")?.innerHTML).toBe("<b>tag</b>");
        expect(tag.querySelector(".attribute-badge-value")).toBeNull();

        expect(template.querySelector(".attribute-badge-key > .tn-icon")?.className)
            .toBe("bx bx-transfer tn-icon");
        expect(template.querySelector(".attribute-badge-name")?.textContent).toBe("template");
        expect(template.querySelector(".attribute-badge-value")?.textContent).toBe("Book");
        expect(template.classList.contains("has-value")).toBe(true);

        expect(cut.classList.contains("attribute-badge")).toBe(false);
        expect(cut.textContent).toBe("#status=\"cut sho...");
    });

    it("draws a definition as the attributes panel does: its field's icon and its bare name", () => {
        const container = renderInto(<AttributeSnippetBadges
            className="attrs"
            snippet={"#label:<b>due</b>=&quot;promoted,single,date&quot;<br>#relation:author=&quot;promoted&quot;"}
        />);
        const [ due, author ] = container.querySelectorAll<HTMLElement>(".attrs > .ext-badge");

        expect(due.querySelector(".tn-icon")?.className).toBe("bx bx-calendar tn-icon");
        expect(due.querySelector(".attribute-badge-name")?.innerHTML).toBe("<b>due</b>");
        // What the definition sets up is the icon; its options are no value of the note's.
        expect(due.querySelector(".attribute-badge-value")).toBeNull();

        expect(author.querySelector(".tn-icon")?.className).toBe("bx bx-transfer tn-icon");
        expect(author.querySelector(".attribute-badge-name")?.textContent).toBe("author");
    });
});
