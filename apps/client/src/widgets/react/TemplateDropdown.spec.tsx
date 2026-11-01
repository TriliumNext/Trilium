import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { type NoteTypeOption } from "../../services/note_types";
import { renderInto } from "../../test/render";
import { offeredTemplateIds, type TemplateChoice, useTemplateChoice } from "./TemplateDropdown";

function option(id: string, title: string): NoteTypeOption {
    return { id, title, icon: "bx bx-note", group: "type", options: { type: "text" } };
}

describe("TemplateDropdown", () => {
    it("offers the stored templates, or the defaults while none are stored", () => {
        const defaults = [ "type:text:text/html" ];

        expect(offeredTemplateIds(undefined, defaults)).toBe(defaults);
        expect(offeredTemplateIds({ templates: [] }, defaults)).toBe(defaults);
        expect(offeredTemplateIds({ templates: [ "note:mine" ] }, defaults))
            .toEqual([ "note:mine" ]);
    });

    it("resolves the offered ids and the last used one against what exists", () => {
        const available = [ option("type:text:text/html", "Text"), option("note:mine", "Mine") ];
        const onSelect = vi.fn();
        const onMore = vi.fn();
        const choices: TemplateChoice[] = [];

        function Probe({ ids, lastUsedId }: { ids: string[], lastUsedId?: string }) {
            choices.push(useTemplateChoice({ ids, lastUsedId, available, onSelect, onMore }));
            return null;
        }

        const ids = [ "note:gone", "note:mine", "type:text:text/html" ];
        const container = renderInto(<Probe ids={ids} lastUsedId="type:text:text/html" />);
        const first = choices.at(-1);
        expect(first?.offered.map((template) => template.title)).toEqual([ "Mine", "Text" ]);
        expect(first?.current?.title).toBe("Text");
        expect(first?.onSelect).toBe(onSelect);
        expect(first?.onMore).toBe(onMore);

        // The same inputs give the same choice, so a host passing it down redraws nothing.
        act(() => render(<Probe ids={ids} lastUsedId="type:text:text/html" />, container));
        expect(choices).toHaveLength(2);
        expect(choices.at(-1)).toBe(first);

        // A last used template that is no longer offered falls back to the first one offered.
        act(() => render(<Probe ids={ids} lastUsedId="note:gone" />, container));
        expect(choices.at(-1)?.current?.title).toBe("Mine");
    });
});
