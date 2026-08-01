import type { ModelPosition } from "@triliumnext/ckeditor5";
import { describe, expect, it, vi } from "vitest";

import server from "../../../services/server";
import { fetchAttributeNames, getClickIndex, renderAttributeName } from "./AttributeEditor";

describe("fetchAttributeNames", () => {
    it("prefixes each name with the marker that inserts it, and asks for the names by an escaped query", async () => {
        const get = vi.fn(async () => [ "author", "priority" ]);
        server.get = get as unknown as typeof server.get;

        expect(await fetchAttributeNames("relation", "a b")).toEqual([
            { id: "~author", name: "author" },
            { id: "~priority", name: "priority" }
        ]);
        expect(get).toHaveBeenCalledExactlyOnceWith("attribute-names/?type=relation&query=a%20b");

        expect((await fetchAttributeNames("label", "")).map((item) => item.id)).toEqual([ "#author", "#priority" ]);
    });
});

describe("renderAttributeName", () => {
    it("marks a name Trilium reads for itself, and leaves an invented one as bare text", () => {
        const builtin = renderAttributeName("label", "archived");

        // `ck-button_with-text` keeps the label visible, and the reset opt-out keeps the badge styled.
        expect(builtin.classList.contains("ck-button_with-text")).toBe(true);
        expect(builtin.querySelector(".attr-name-suggestion")?.classList.contains("ck-reset_all-excluded")).toBe(true);
        expect(builtin.querySelector(".attr-name-suggestion-name")?.textContent).toBe("archived");
        expect(builtin.querySelector(".ext-badge.outline")).not.toBeNull();

        const invented = renderAttributeName("label", "myOwnLabel");
        expect(invented.querySelector(".attr-name-suggestion-name")?.textContent).toBe("myOwnLabel");
        expect(invented.querySelector(".ext-badge")).toBeNull();

        // A name that is a built-in of the other type is not one here.
        expect(renderAttributeName("relation", "archived").querySelector(".ext-badge")).toBeNull();
    });
});

describe("getClickIndex", () => {
    it("measures every sibling before the pressed one as the text it stands for", () => {
        const reference = { name: "reference", getAttribute: () => "#root/abc123" };
        const text = { data: "#author=Elian ", previousSibling: null };
        // …#author=Elian ~parent=#root/abc123 |~other
        const pressed = {
            data: "~other",
            startOffset: 3,
            previousSibling: { data: "~parent=", previousSibling: { ...reference, previousSibling: text } }
        };

        // The offset the editor reports counts the reference as a single node; the index does not.
        const index = getClickIndex({ offset: 5, textNode: pressed } as unknown as ModelPosition);
        expect(index).toBe(2 + "#author=Elian ".length + "~parent=".length + "#root/abc123".length + 1);

        // A press in the first node of all is its own offset.
        expect(getClickIndex({ offset: 4, textNode: text } as unknown as ModelPosition)).toBe(4);
        // A press where there is no text node at all still resolves to a position.
        expect(getClickIndex({ offset: 7, textNode: null } as unknown as ModelPosition)).toBe(7);
    });
});
