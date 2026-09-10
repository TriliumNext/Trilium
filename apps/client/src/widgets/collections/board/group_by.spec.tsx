import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import $ from "jquery";

import Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import type { Attribute } from "../../../services/attribute_parser";
import type { AttributeDetailOpts } from "../../attribute_widgets/attribute_detail";
import { ParentComponent } from "../../react/react_utils";
import BoardGroupBy, { groupingOptions } from "./group_by";

// i18next is never initialised under test, so a translated title would come back undefined. What is
// interpolated is carried along, for the titles these tests are about.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
        opts ? `${key}:${JSON.stringify(opts)}` : key,
    translationsInitializedPromise: Promise.resolve()
}));

const mocks = vi.hoisted(() => ({
    setLabel: vi.fn(async () => {}),
    showError: vi.fn(),
    /** The editor the dropdown opens, which the test drives through the callbacks it was given. */
    detail: { opts: null as AttributeDetailOpts | null, callbacks: {} as Record<string, Function> }
}));

vi.mock("../../../services/attributes", () => ({
    default: { setLabel: mocks.setLabel, isAffecting: () => true }
}));

vi.mock("../../../services/toast", () => ({ default: { showError: mocks.showError } }));

// The editor is tested where it lives; what the dropdown answers for is what it hands over and what
// it writes once the editor reports a definition.
vi.mock("../../attribute_widgets/attribute_detail", () => ({
    AttributeDetail: (props: { opts: AttributeDetailOpts | null }) => {
        mocks.detail.opts = props.opts;
        mocks.detail.callbacks = props as unknown as Record<string, Function>;
        return props.opts ? <div className="attribute-detail-stub" /> : null;
    }
}));

/** A definition as the board note carries it. */
function definition(name: string, { alias, labelType }: {
    alias?: string;
    labelType?: string;
} = {}) {
    return {
        name,
        value: `promoted,single,${labelType ?? "text"}`,
        noteId: "board1",
        isInheritable: true,
        getDefinition: () => ({ isPromoted: true, promotedAlias: alias, labelType })
    };
}

/** A board defining two selects, a text label and a relation, all promoted to its cards. */
const DEFINED = [
    definition("label:status", { alias: "Status", labelType: "select" }),
    definition("label:priority", { alias: "Priority", labelType: "select" }),
    definition("label:notes"),
    definition("relation:assignee")
];

function board(defined = DEFINED) {
    return {
        noteId: "board1",
        getAttributeDefinitions: () => defined,
        // Every definition here is the board's own, which is the case the write has to refuse.
        getOwnedLabels: (name: string) => defined.filter(attribute => attribute.name === name)
    } as unknown as FNote;
}

describe("groupingOptions", () => {
    it("offers the select fields and nothing else", () => {
        expect(groupingOptions(board(), undefined, "status")).toEqual([
            { value: "status", title: "Status" },
            { value: "priority", title: "Priority" }
        ]);
    });

    it("leads with the default grouping, whatever the reader arranged", () => {
        const settings = [ { name: "priority" }, { name: "status" } ];

        expect(groupingOptions(board(), settings, "status").map(option => option.value))
            .toEqual([ "status", "priority" ]);
        expect(groupingOptions(board(), settings, "priority").map(option => option.value))
            .toEqual([ "status", "priority" ]);
    });

    it("names the grouping in force even where no select defines it", () => {
        // A relation cannot be switched to from here, but a board on one still has to say so.
        expect(groupingOptions(board(), undefined, "~assignee")[1]).toEqual({
            value: "~assignee",
            title: 'promoted_attributes.relation_name:{"name":"assignee"}'
        });

        // A label nobody defined, which reads as the name the board groups by.
        expect(groupingOptions(board(), undefined, "severity")[1])
            .toEqual({ value: "severity", title: "severity" });
    });

    it("lists the grouping in force once, whichever way it is written", () => {
        expect(groupingOptions(board(), undefined, "#priority").map(option => option.value))
            .toEqual([ "status", "priority" ]);
    });

    it("falls back to the default grouping for a board naming none", () => {
        expect(groupingOptions(board(), undefined, "").map(option => option.value))
            .toEqual([ "status", "priority" ]);
    });

    /**
     * A board can be switched to something else and have nothing defining `#status`, which would
     * otherwise leave the reader no way back to what the board groups by out of the box.
     */
    it("offers the default grouping on a board that defines nothing at all", () => {
        expect(groupingOptions(board([]), undefined, "status"))
            .toEqual([ { value: "status", title: "board_view.status-alias" } ]);
        expect(groupingOptions(board([]), undefined, "severity")).toEqual([
            { value: "status", title: "board_view.status-alias" },
            { value: "severity", title: "severity" }
        ]);
    });

    it("names the default grouping with the stock word where its definition gives no alias", () => {
        const defined = [ definition("label:status", { labelType: "select" }) ];

        expect(groupingOptions(board(defined), undefined, "status"))
            .toEqual([ { value: "status", title: "board_view.status-alias" } ]);
    });
});

describe("BoardGroupBy", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        mocks.setLabel.mockClear();
        mocks.showError.mockClear();
        mocks.detail.opts = null;
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /** Renders the dropdown with its menu open, which is where its items are drawn. */
    async function setup(current = "status") {
        const onSelect = vi.fn();
        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <BoardGroupBy
                        note={board()}
                        options={groupingOptions(board(), undefined, current)}
                        current={current}
                        onSelect={onSelect}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });

        // Bootstrap does not open a menu under happy-dom, and the items are drawn only once it is.
        await act(async () => {
            $(mountPoint.querySelector(".dropdown") as HTMLElement).trigger("show.bs.dropdown");
        });

        return { mountPoint, onSelect };
    }

    const items = (mountPoint: HTMLElement) =>
        [ ...mountPoint.querySelectorAll(".dropdown-menu .dropdown-item") ];

    it("offers making a grouping after the ones the board has, behind a divider", async () => {
        const { mountPoint } = await setup();

        expect(items(mountPoint).map(item => item.textContent?.trim())).toEqual([
            "Status", "Priority", "promoted_attributes.create_attribute"
        ]);
        // Set apart from the groupings above it: the entry makes one rather than picking one.
        const menu = [ ...(mountPoint.querySelector(".dropdown-menu")?.children ?? []) ];
        const divider = menu.findIndex(child => child.classList.contains("dropdown-divider"));
        const create = menu.findIndex(child => child.classList.contains("board-group-by-create"));
        expect(divider).toBeGreaterThan(0);
        expect(create).toBe(divider + 1);
    });

    it("opens the editor on a promoted, inheritable select that cannot be changed", async () => {
        const { mountPoint } = await setup();

        await act(async () => {
            mountPoint.querySelector<HTMLElement>(".board-group-by-create")?.click();
        });

        expect(mocks.detail.opts).toMatchObject({
            isOwned: true,
            focus: "name",
            // A grouping is a select whose options are the columns the board makes, and a card
            // stands in one of them: none of the four is the reader's to change here.
            hideType: true,
            hideTypeOptions: true,
            hideMultiplicity: true,
            hideInheritance: true,
            attribute: {
                type: "label",
                value: "promoted,single,select",
                isInheritable: true
            }
        });
    });

    it("writes what the editor was left holding, and groups by it", async () => {
        const { mountPoint, onSelect } = await setup();

        await act(async () => {
            mountPoint.querySelector<HTMLElement>(".board-group-by-create")?.click();
        });

        const made: Attribute = {
            type: "label",
            name: "label:severity",
            value: "promoted,single,select,options=Minor;Major",
            isInheritable: true
        };
        await act(async () => {
            mocks.detail.callbacks.onAttributesChanged([ made ]);
            await mocks.detail.callbacks.onSaveAndClose();
        });

        expect(mocks.setLabel).toHaveBeenCalledWith(
            "board1", "label:severity", "promoted,single,select,options=Minor;Major", true);
        // Made to be grouped by, so the board moves to it rather than leaving a second step.
        expect(onSelect).toHaveBeenCalledWith("severity");
        expect(mocks.detail.opts).toBeNull();
    });

    /**
     * `set-attribute` replaces the value of a definition the board already owns, so a name already
     * taken would cost that grouping its alias and every column it offers.
     */
    it("refuses a name the board already defines, keeping the editor open", async () => {
        const { mountPoint, onSelect } = await setup();

        await act(async () => {
            mountPoint.querySelector<HTMLElement>(".board-group-by-create")?.click();
        });

        await act(async () => {
            mocks.detail.callbacks.onAttributesChanged([ {
                type: "label",
                name: "label:status",
                value: "promoted,single,select,options=Something else",
                isInheritable: true
            } ]);
            await mocks.detail.callbacks.onSaveAndClose();
        });

        expect(mocks.setLabel).not.toHaveBeenCalled();
        expect(onSelect).not.toHaveBeenCalled();
        expect(mocks.showError).toHaveBeenCalledWith(
            'board_view.grouping-already-defined:{"name":"status"}');
        // Left standing on the name, so what was typed is not lost to a rename.
        expect(mocks.detail.opts).not.toBeNull();
    });

    it("writes nothing for an editor closed without a name", async () => {
        const { mountPoint, onSelect } = await setup();

        await act(async () => {
            mountPoint.querySelector<HTMLElement>(".board-group-by-create")?.click();
        });

        await act(async () => {
            mocks.detail.callbacks.onAttributesChanged([
                { type: "label", name: "label:", value: "promoted,single,select" }
            ]);
            await mocks.detail.callbacks.onSaveAndClose();
        });

        expect(mocks.setLabel).not.toHaveBeenCalled();
        expect(onSelect).not.toHaveBeenCalled();
    });
});
