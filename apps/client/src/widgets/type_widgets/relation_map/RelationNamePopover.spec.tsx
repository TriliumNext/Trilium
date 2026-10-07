import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

// The suggestions and their rows come from the attribute pane, whose module brings the whole pane.
vi.mock("../../attribute_widgets/attribute_detail", () => ({
    fetchAttributeNames: vi.fn(async (_type: string, query: string) =>
        [ "author", "template" ].filter((name) => name.includes(query))),
    AttributeNameSuggestion: ({ name }: { name: string }) => <span>{name}</span>
}));

vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key
}));

import { renderInto } from "../../../test/render";
import RelationNamePopover, { type AskRelationName, useRelationNamePrompt } from "./RelationNamePopover";

describe("RelationNamePopover", () => {
    it("keeps the name to the characters an attribute name allows, except while composing", async () => {
        const { input } = await mount();

        await type(input, "my relation!");
        expect(input.value).toBe("myrelation");

        await act(async () => { input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); });
        await type(input, "myrelation 关系");
        expect(input.value).toBe("myrelation 关系");

        await act(async () => { input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); });
        expect(input.value).toBe("myrelation关系");
    });

    it("answers the typed name on Enter, and nothing for a blank one", async () => {
        const { input, onAnswer } = await mount();

        await press(input, "Enter");
        expect(onAnswer).not.toHaveBeenCalled();

        await type(input, "author2");
        await press(input, "Enter");
        expect(onAnswer).toHaveBeenCalledWith("author2");
    });

    it("answers a picked suggestion straight away", async () => {
        const { onAnswer } = await mount();

        const rows = await settleDropdown();
        expect(rows.map((row) => row.textContent)).toEqual([ "author", "template" ]);

        await act(async () => (rows[1] as HTMLElement | undefined)?.click());
        expect(onAnswer).toHaveBeenCalledWith("template");
    });

    it("cancels on Escape once the list is closed, and on a press outside", async () => {
        const { input, onAnswer } = await mount();
        await settleDropdown();

        // The first Escape only closes the suggestions.
        await press(input, "Escape");
        expect(onAnswer).not.toHaveBeenCalled();
        await press(input, "Escape");
        expect(onAnswer).toHaveBeenCalledWith(null);

        const outside = await mount();
        await act(async () => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
        expect(outside.onAnswer).toHaveBeenCalledWith(null);
    });

    it("opens on the current name when renaming, with the field focused", async () => {
        const { input } = await mount("author");

        expect(input.value).toBe("author");
        expect(document.activeElement).toBe(input);
        expect(document.querySelector(".relation-name-heading")?.textContent).toBe("relation_map.rename_relation");
    });
});

describe("useRelationNamePrompt", () => {
    it("resolves a request with its answer, and a request replaced by a newer one with nothing", async () => {
        let prompt: ReturnType<typeof useRelationNamePrompt> | undefined;
        function Probe() {
            prompt = useRelationNamePrompt();
            return null;
        }
        await act(async () => { renderInto(<Probe />); });
        const ask = prompt?.ask as AskRelationName;

        const first = ask(fakeAnchor());
        const second = ask(fakeAnchor(), "author");
        await act(async () => undefined);
        expect(await first).toBeNull();
        expect(prompt?.request?.defaultValue).toBe("author");

        await act(async () => prompt?.answer("editor"));
        expect(await second).toBe("editor");
        expect(prompt?.request).toBeUndefined();
    });
});

async function mount(defaultValue = "") {
    const onAnswer = vi.fn();
    await act(async () => {
        renderInto(
            <RelationNamePopover anchor={fakeAnchor()} defaultValue={defaultValue} onAnswer={onAnswer} />);
    });
    // Lets `placeFloating()` resolve, which is when the popover focuses its field.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    const input = document.querySelector<HTMLInputElement>(".relation-name-popover input");
    if (!input) throw new Error("the popover rendered no field");
    return { input, onAnswer };
}

function fakeAnchor() {
    const drawing = document.createElement("div");
    document.body.appendChild(drawing);
    return () => drawing;
}

async function type(input: HTMLInputElement, value: string) {
    await act(async () => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function press(input: HTMLInputElement, key: string) {
    await act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
}

/** Lets the debounced lookup run, then returns the rows of the list portaled to the body. */
async function settleDropdown() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
    });
    return [ ...document.querySelectorAll(".form-autocomplete-dropdown li") ];
}
