import { TEMPLATE_ALLOWED_METHODS, TEMPLATE_ALLOWED_PROPERTIES } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

import { NOTE_TEMPLATE_MEMBERS, templateCompletionAt } from "./template_completions";

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

const VARIABLES = { note: "note" } as const;

function titlesAt(before: string) {
    const completion = templateCompletionAt(before, VARIABLES);
    return completion && {
        from: completion.from,
        query: completion.query,
        titles: completion.entries().map((entry) => entry.title)
    };
}

describe("templateCompletionAt", () => {
    it("offers nothing outside an expression", () => {
        expect(templateCompletionAt("NEW: ", VARIABLES)).toBeNull();
        expect(templateCompletionAt("${note.title} and more", VARIABLES)).toBeNull();
    });

    it("offers the variables right after ${", () => {
        expect(titlesAt("NEW: ${")).toStrictEqual({ from: 7, query: "", titles: [ "note" ] });
        expect(titlesAt("NEW: ${no")).toStrictEqual({ from: 7, query: "no", titles: [ "note" ] });
    });

    it("offers the members of what the path before the dot is", () => {
        const onNote = titlesAt("${note.ti");
        expect(onNote?.from).toBe(7);
        expect(onNote?.query).toBe("ti");
        expect(onNote?.titles).toContain("title");
        expect(onNote?.titles).toContain("getLabelValue('…')");

        expect(titlesAt("${note.dateCreatedObj.")?.titles).toStrictEqual([ "format('…')" ]);
        expect(titlesAt("${note.title.")).toBeNull();
        expect(titlesAt("${other.")).toBeNull();
    });

    it("offers nothing after a name inherited from Object.prototype", () => {
        expect(titlesAt("${constructor.")).toBeNull();
        expect(titlesAt("${constructor.title.")).toBeNull();
        expect(titlesAt("${__proto__.")).toBeNull();
    });

    it("offers only what the template engine allows", () => {
        for (const member of NOTE_TEMPLATE_MEMBERS) {
            const allowed = member.kind === "method" ? TEMPLATE_ALLOWED_METHODS : TEMPLATE_ALLOWED_PROPERTIES;
            expect(allowed.has(member.name), member.name).toBe(true);
        }
    });
});
