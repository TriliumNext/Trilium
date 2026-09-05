import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import type FNote from "../../entities/fnote";
import LoadResults from "../../services/load_results";
import type { AttributeDetailOpts } from "../attribute_widgets/attribute_detail";
import type { PromotedAttribute, PromotedAttributeSetting } from "../collections/promoted_attributes";
import PromotedAttributesCard from "./PromotedAttributesCard";
import { ParentComponent } from "./react_utils";

// i18next is never initialised under test, so every label would read as undefined. The command
// registry, reached through the attribute editor, waits on the translations before it builds.
vi.mock("../../services/i18n", () => ({
    t: (key: string) => key,
    translationsInitializedPromise: Promise.resolve()
}));

const mocks = vi.hoisted(() => ({
    setLabel: vi.fn(),
    removeOwned: vi.fn(async () => {}),
    confirm: vi.fn(async () => true),
    bulk: vi.fn(async () => {}),
    /** The editor the card opens, which the test drives through the callbacks it was given. */
    detail: { opts: null as AttributeDetailOpts | null, callbacks: {} as Record<string, Function> }
}));

vi.mock("../../services/attributes", () => ({
    default: {
        setLabel: mocks.setLabel,
        // Every change in these tests is one the card should answer to.
        isAffecting: () => true
    },
    removeOwnedAttributesByNameOrType: mocks.removeOwned
}));

vi.mock("../../services/bulk_action", () => ({ executeBulkActions: mocks.bulk }));

vi.mock("../../services/dialog", () => ({ default: { confirm: mocks.confirm } }));

// The editor is tested where it lives; what the card answers for is what it hands over and what it
// writes once the editor reports a definition.
vi.mock("../attribute_widgets/attribute_detail", async (importActual) => ({
    // The kinds a definition can hold are read from the module itself, so the card wears the icons
    // the editor picks them by.
    ...(await importActual<typeof import("../attribute_widgets/attribute_detail")>()),
    AttributeDetail: (props: { opts: AttributeDetailOpts | null }) => {
        mocks.detail.opts = props.opts;
        mocks.detail.callbacks = props as unknown as Record<string, Function>;
        return props.opts ? <div className="attribute-detail-stub" /> : null;
    }
}));

/** A definition as the collection note carries it. */
function definition(name: string, { alias, value = "promoted,single,text", labelType }: {
    alias?: string, value?: string, labelType?: string
} = {}) {
    return {
        name,
        value,
        noteId: "board1",
        isInheritable: true,
        getDefinition: () => ({ isPromoted: true, promotedAlias: alias, labelType })
    };
}

let defined = [ definition("label:dueDate", { alias: "Due" }), definition("label:owner") ];

const NOTE = {
    noteId: "board1",
    getAttributeDefinitions: () => defined
} as unknown as FNote;

describe("PromotedAttributesCard", () => {
    let container: HTMLElement;
    let host: Component;
    let stored: PromotedAttribute[][];
    let settings: PromotedAttributeSetting[] | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        stored = [];
        settings = undefined;
        defined = [ definition("label:dueDate", { alias: "Due" }), definition("label:owner") ];
        mocks.detail.opts = null;
        mocks.confirm.mockResolvedValue(true);
        host = new Component();
        container = document.body.appendChild(document.createElement("div"));
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("lists what the note defines, named as the definitions name them", () => {
        draw();

        expect(names()).toEqual([ "Due", "owner" ]);
        expect(shown()).toEqual([ true, true ]);
    });

    /** The same icons the editor picks a kind by, so a row reads as what it holds. */
    it("wears the icon of what each attribute holds", () => {
        defined = [
            definition("label:dueDate", { labelType: "date" }),
            definition("label:done", { labelType: "boolean" }),
            definition("label:notes"),
            definition("relation:owner")
        ];
        draw();

        expect(icons()).toEqual([
            "bx bx-calendar", "bx bx-toggle-left", "bx bx-text", "bx bx-transfer"
        ]);
        // And says which kind it is, in the words the editor lists them under.
        expect(types()).toEqual([
            "attribute_detail.date", "attribute_detail.boolean", "attribute_detail.text",
            "attribute_detail.relation_type"
        ]);
    });

    it("follows the order the settings give, and turns off what they hide", () => {
        settings = [ { name: "owner", hidden: true }, { name: "dueDate" } ];
        draw();

        expect(names()).toEqual([ "owner", "Due" ]);
        expect(shown()).toEqual([ false, true ]);
    });

    it("reports the whole list in its new order", () => {
        draw();

        press(segments()[0], "ArrowDown", { ctrlKey: true });

        expect(stored.at(-1)?.map((attribute) => attribute.name)).toEqual([ "owner", "dueDate" ]);
        expect(names()).toEqual([ "owner", "Due" ]);
    });

    it("hides an attribute without taking it off the list, and shows it again", () => {
        draw();

        toggle(0);
        expect(stored.at(-1)).toEqual([
            expect.objectContaining({ name: "dueDate", hidden: true }),
            expect.objectContaining({ name: "owner", hidden: false })
        ]);
        expect(shown()).toEqual([ false, true ]);

        toggle(0);
        expect(stored.at(-1)?.[0].hidden).toBe(false);
    });

    describe("the attribute editor", () => {
        it("opens on the definition the entry stands for", () => {
            draw();

            edit(0);

            expect(mocks.detail.opts?.attribute).toEqual({
                type: "label",
                name: "label:dueDate",
                value: "promoted,single,text",
                isInheritable: true
            });
            // Everything arranged here is inheritable and promoted, so neither is asked about.
            expect(mocks.detail.opts?.hideInheritance).toBe(true);
            expect(mocks.detail.opts?.hideMultiplicity).toBe(true);
            // Portalled to the page, so it stands over the dialog the card is in.
            expect(document.body.querySelector(".attribute-detail-stub")).toBeTruthy();
        });

        it("writes what the editor reports back to the note", async () => {
            draw();
            edit(0);

            await save({
                type: "label", name: "label:dueDate", value: "promoted,single,date",
                isInheritable: true
            });

            expect(mocks.setLabel)
                .toHaveBeenCalledWith("board1", "label:dueDate", "promoted,single,date", true);
            expect(mocks.bulk).not.toHaveBeenCalled();
            // Nothing is removed: the definition keeps its name and its inheritance.
            expect(mocks.removeOwned).not.toHaveBeenCalled();
            expect(mocks.detail.opts).toBeNull();
        });

        /** The values were written against the old name, so they are renamed with it. */
        it("takes the values with it when the definition is renamed", async () => {
            draw();
            edit(0);

            await save({
                type: "label", name: "label:deadline", value: "promoted,single,text",
                isInheritable: true
            });

            expect(mocks.bulk).toHaveBeenCalledWith(
                [ "board1" ],
                [ { name: "renameLabel", oldLabelName: "dueDate", newLabelName: "deadline" } ],
                { includeDescendants: true });
            // The definition it was renamed from goes, and the new one is written.
            expect(mocks.removeOwned).toHaveBeenCalledWith(NOTE, "label", "label:dueDate");
            expect(mocks.setLabel)
                .toHaveBeenCalledWith("board1", "label:deadline", "promoted,single,text", true);
        });

        it("takes the definition and its values away when the editor deletes it", async () => {
            draw();
            edit(1);

            await act(async () => {
                mocks.detail.callbacks.onDelete();
                await flush();
            });

            expect(mocks.bulk).toHaveBeenCalledWith(
                [ "board1" ],
                [ { name: "deleteLabel", labelName: "owner" } ],
                { includeDescendants: true, silent: true });
            expect(mocks.removeOwned).toHaveBeenCalledWith(NOTE, "label", "label:owner");
        });

        /**
         * `set-attribute` writes the value of a definition that already exists and nothing else,
         * so an inheritance the reader changed would be dropped by a plain write.
         */
        it("writes the definition afresh when its inheritance changed", async () => {
            draw();
            edit(0);

            await save({
                type: "label", name: "label:dueDate", value: "promoted,single,text",
                isInheritable: false
            });

            expect(mocks.removeOwned).toHaveBeenCalledWith(NOTE, "label", "label:dueDate");
            expect(mocks.setLabel)
                .toHaveBeenCalledWith("board1", "label:dueDate", "promoted,single,text", false);
            // Only the definition is rewritten; the values on the items are untouched.
            expect(mocks.bulk).not.toHaveBeenCalled();
        });

        it("writes nothing where the editor was dismissed or reported nothing", async () => {
            draw();
            edit(0);

            act(() => mocks.detail.callbacks.onDismiss());
            expect(mocks.detail.opts).toBeNull();

            edit(0);
            await act(async () => {
                mocks.detail.callbacks.onSaveAndClose();
                await flush();
            });

            expect(mocks.setLabel).not.toHaveBeenCalled();
            expect(mocks.bulk).not.toHaveBeenCalled();
            expect(mocks.removeOwned).not.toHaveBeenCalled();
        });
    });

    describe("deleting one", () => {
        /** The values go with the definition, which the attributes panel does not do. */
        it("asks, then takes the definition and its values away", async () => {
            draw();

            await act(async () => {
                segments()[0].querySelector<HTMLElement>(".promoted-attribute-delete")?.click();
                await flush();
            });

            expect(mocks.confirm).toHaveBeenCalledWith(
                expect.stringContaining("promoted_attributes.delete_confirmation"));
            expect(mocks.bulk).toHaveBeenCalledWith(
                [ "board1" ],
                [ { name: "deleteLabel", labelName: "dueDate" } ],
                { includeDescendants: true, silent: true });
            expect(mocks.removeOwned).toHaveBeenCalledWith(NOTE, "label", "label:dueDate");
        });

        it("leaves everything alone where the reader said no", async () => {
            mocks.confirm.mockResolvedValue(false);
            draw();

            await act(async () => {
                segments()[0].querySelector<HTMLElement>(".promoted-attribute-delete")?.click();
                await flush();
            });

            expect(mocks.bulk).not.toHaveBeenCalled();
            expect(mocks.removeOwned).not.toHaveBeenCalled();
        });
    });

    describe("creating one", () => {
        it("opens the editor on a new definition, named for the reader to change", () => {
            draw();

            act(() => { adder()?.click(); });

            expect(mocks.detail.opts?.attribute)
                .toEqual({ type: "label", name: "label:myLabel", value: "promoted,single,text", isInheritable: true });
            expect(mocks.detail.opts?.focus).toBe("name");
            expect(mocks.detail.opts?.hideInheritance).toBe(true);
            // Nothing is listed until the note reports what was made.
            expect(names()).toEqual([ "Due", "owner" ]);
            expect(stored).toEqual([]);
        });

        it("lists what was made once the note reports it, at the end", async () => {
            draw();
            act(() => { adder()?.click(); });

            await save({
                type: "label", name: "label:priority", value: "promoted,single,text",
                isInheritable: true
            });
            defined = [ ...defined, definition("label:priority") ];
            await reported();

            expect(names()).toEqual([ "Due", "owner", "priority" ]);
        });

        /** A definition the reader left unpromoted is not one the items can show. */
        it("leaves out a definition that is not promoted", async () => {
            draw();
            act(() => { adder()?.click(); });

            await save({
                type: "label", name: "label:internal", value: "single,text", isInheritable: true
            });
            await reported();

            expect(names()).toEqual([ "Due", "owner" ]);
        });

        it("drops an attribute the note no longer defines, keeping the order of the rest", async () => {
            settings = [ { name: "owner" }, { name: "dueDate" } ];
            draw();

            defined = [ definition("label:dueDate", { alias: "Due" }) ];
            await reported();

            expect(names()).toEqual([ "Due" ]);
        });
    });

    // #region The card, and what the test does to it

    function draw() {
        act(() => {
            render(
                <ParentComponent.Provider value={host}>
                    <PromotedAttributesCard
                        heading="Promoted attributes"
                        instruction="Pick what the items show."
                        note={NOTE}
                        settings={settings}
                        onChange={(attributes) => stored.push(attributes)}
                    />
                </ParentComponent.Provider>,
                container);
        });
    }

    function segments() {
        return [ ...container.querySelectorAll<HTMLElement>(".tn-sortable-segment") ];
    }

    function types() {
        return segments().map((segment) =>
            segment.querySelector(".promoted-attribute-type .text")?.textContent);
    }

    function icons() {
        return segments().map((segment) =>
            segment.querySelector(".tn-icon")?.className.replace(" tn-icon", ""));
    }

    function names() {
        return segments().map((segment) =>
            segment.querySelector(".promoted-attribute-name")?.textContent);
    }

    /** Which entries are drawn as shown on the items, read from their toggles. */
    function shown() {
        return segments().map((segment) =>
            !!segment.querySelector(".switch-button")?.classList.contains("on"));
    }

    function toggle(index: number) {
        act(() => { segments()[index].querySelector<HTMLElement>(".switch-button")?.click(); });
    }

    function edit(index: number) {
        act(() => {
            segments()[index].querySelector<HTMLElement>(".promoted-attribute-edit")?.click();
        });
    }

    function adder() {
        return container.querySelector<HTMLElement>(".tn-sortable-adder");
    }

    /** The editor reporting a definition and being told to save it. */
    async function save(definition: unknown) {
        await act(async () => {
            mocks.detail.callbacks.onAttributesChanged([ definition ]);
            mocks.detail.callbacks.onSaveAndClose();
            await flush();
        });
    }

    /** The app reporting an attribute change, which is how the card hears of a definition. */
    async function reported() {
        const results = new LoadResults([ {
            entityName: "attributes",
            entityId: "attr1",
            entity: { attributeId: "attr1", noteId: "board1", type: "label", name: "label:x" }
        } as never ]);
        results.addAttribute("attr1", "other");

        await act(async () => {
            host.handleEvent("entitiesReloaded", { loadResults: results });
            await flush();
        });
    }

    async function flush() {
        for (let step = 0; step < 4; step++) {
            await Promise.resolve();
        }
    }

    function press(target: Element, key: string, options: KeyboardEventInit = {}) {
        act(() => {
            target.dispatchEvent(
                new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
        });
    }

    // #endregion
});
