import type { ComponentProps } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { createAnchorTargets, type LinkTarget, nestTargets } from "../../services/link_targets";
import { renderInto } from "../../test/render";
import LinkTargetList, {
    type LinkDestination, listLinkDestinations, useLinkDestinationKeys
} from "./LinkTargetList";

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

function createHeading(title: string, level: number): LinkTarget {
    return { kind: "heading", title, level, createLinkPath: () => `root/note?block=${title}` };
}

const intro = createHeading("Intro", 2);
const setup = createHeading("Setup", 3);
const linux = createHeading("Linux", 4);
const usage = createHeading("Usage", 2);
const [ top, end ] = createAnchorTargets([ "top", "end" ], "root/note");
const TARGETS = [ intro, setup, linux, usage, top, end ];

/** The text of a destination, as its choice shows it. */
function nameOf(destination: LinkDestination) {
    return destination ? destination.title : "add_link.top_of_note";
}

describe("listLinkDestinations", () => {
    it("lists the whole note, then the targets of each kind under expanded targets", () => {
        const tree = nestTargets(TARGETS);
        const list = (expanded: LinkTarget[]) =>
            listLinkDestinations(tree, new Set(expanded)).map(nameOf);

        expect(list([])).toStrictEqual([ "add_link.top_of_note", "Intro", "Usage", "top", "end" ]);
        expect(list([ intro ]))
            .toStrictEqual([ "add_link.top_of_note", "Intro", "Setup", "Usage", "top", "end" ]);
        // A heading under a collapsed one stays hidden, though it is expanded itself.
        expect(list([ setup ])).toStrictEqual(list([]));
        expect(list([ intro, setup ])).toContain("Linux");
        expect(listLinkDestinations(new Map(), new Set())).toStrictEqual([ null ]);

        // The choices follow the cards, one per kind, whatever the order of the targets.
        const mixed = nestTargets([ top, intro, end, usage ]);
        expect(listLinkDestinations(mixed, new Set()).map(nameOf))
            .toStrictEqual([ "add_link.top_of_note", "top", "end", "Intro", "Usage" ]);
    });
});

describe("LinkTargetList", () => {
    function renderList(props: Partial<ComponentProps<typeof LinkTargetList>> = {}) {
        return renderInto(
            <LinkTargetList
                listRef={{ current: null }}
                targetTree={nestTargets(TARGETS)}
                checkedTarget={null}
                onCheckTarget={vi.fn()}
                expandedTargets={new Set()}
                setExpandedTargets={vi.fn()}
                {...props}
            />
        );
    }

    function rows(container: HTMLElement) {
        return [ ...container.querySelectorAll<HTMLElement>(".tn-card-choice") ];
    }

    it("starts with the whole note for a caller that takes it, with focusable choices", () => {
        const onCheckWholeNote = vi.fn();
        const render = (hasWholeNote: boolean) => renderList({
            targetTree: nestTargets([ intro ]),
            isWholeNoteChecked: true,
            onCheckWholeNote: hasWholeNote ? onCheckWholeNote : undefined
        });

        expect(rows(render(false)).map((row) => row.textContent)).toStrictEqual([ "Intro" ]);

        const [ wholeNote, heading ] = rows(render(true));
        expect(wholeNote?.closest(".link-target-whole-note")).not.toBeNull();
        expect(wholeNote?.getAttribute("aria-checked")).toBe("true");
        expect([ wholeNote, heading ].map((row) => [ row?.id, row?.tabIndex ]))
            .toStrictEqual([ [ "", 0 ], [ "", 0 ] ]);
        wholeNote?.click();
        expect(onCheckWholeNote).toHaveBeenCalledOnce();
    });

    it("shows each kind in a card of its own, with the icon of the kind", () => {
        const onCheckTarget = vi.fn();
        const container = renderList({ checkedTarget: end, onCheckTarget });
        const titles = (list: HTMLElement) =>
            [ ...list.querySelectorAll(".tn-card-heading") ].map((title) => title.textContent);
        // The name of the icon, and whether the row has an expander, which only a target with a
        // level has.
        const describeRow = (row: HTMLElement) => [
            row.textContent,
            [ ...row.querySelector(".tn-card-choice-icon")?.classList ?? [] ]
                .find((name) => name.startsWith("bx-")),
            !!row.querySelector(".tn-card-choice-expander")
        ];

        const rowsOfCard = (kind: string) => [
            ...container.querySelectorAll<HTMLElement>(`.link-target-${kind} .tn-card-choice`)
        ].map(describeRow);

        expect(titles(container))
            .toStrictEqual([ "add_link.link_to_heading", "add_link.link_to_anchor" ]);
        expect(rowsOfCard("heading")).toStrictEqual([
            [ "Intro", "bx-heading", true ], [ "Usage", "bx-heading", true ]
        ]);
        expect(rowsOfCard("anchor")).toStrictEqual([
            [ "top", "bx-bookmark", false ], [ "end", "bx-bookmark", false ]
        ]);
        expect(rows(container).filter((row) => row.getAttribute("aria-checked") === "true")
            .map((row) => row.textContent)).toStrictEqual([ "end" ]);
        rows(container)[2]?.click();
        expect(onCheckTarget).toHaveBeenCalledExactlyOnceWith(top);

        // A caller can name the cards, and show a placeholder in place of no targets.
        expect(titles(renderList({ getKindTitle: (kind) => `Own ${kind}` })))
            .toStrictEqual([ "Own heading", "Own anchor" ]);
        const empty = renderList({ targetTree: new Map(), placeholder: <p className="none" /> });
        expect(empty.querySelector(".none")).not.toBeNull();
        expect(empty.querySelector(".tn-card")).toBeNull();
    });
});

describe("useLinkDestinationKeys", () => {
    type Keys = ReturnType<typeof useLinkDestinationKeys>;

    function show(targets: LinkTarget[] = TARGETS) {
        const onPick = vi.fn<(destination: LinkDestination) => void>();
        const keys: { current: Keys | null } = { current: null };
        function Host() {
            const listRef = useRef<HTMLDivElement>(null);
            keys.current = useLinkDestinationKeys(targets, onPick);
            return <LinkTargetList listRef={listRef} {...keys.current.listProps} />;
        }
        const container = renderInto(<Host />);

        const rows = () => [ ...container.querySelectorAll<HTMLElement>(".tn-card-choice") ];
        const checked = () => rows().filter((row) => row.getAttribute("aria-checked") === "true");
        return {
            onPick,
            keys,
            rows,
            /** The text of the one checked choice, which the host points at. */
            checked() {
                expect(checked()).toHaveLength(1);
                expect(checked()[0]?.id).toBe(keys.current?.activeId);
                return checked()[0]?.textContent;
            },
            /** Forwards a key as the host does, and returns whether the list took it. */
            async press(key: string, init: KeyboardEventInit = {}) {
                const event = new KeyboardEvent("keydown", { key, cancelable: true, ...init });
                let isTaken = false;
                await act(async () => {
                    isTaken = keys.current?.handleKeyDown(event) ?? false;
                });
                expect(event.defaultPrevented).toBe(isTaken);
                return isTaken;
            },
            async click(text: string, selector = "") {
                const row = rows().find((choice) => choice.textContent === text);
                const target = selector ? row?.querySelector<HTMLElement>(selector) : row;
                if (!target) throw new Error(`The list shows no '${text}${selector}'.`);
                await act(async () => target.click());
            }
        };
    }

    it("opens on the whole note, with choices that the host names and that take no focus", () => {
        const { rows, checked, keys } = show();

        expect(checked()).toBe("add_link.top_of_note");
        expect(rows().map((row) => row.textContent))
            .toStrictEqual([ "add_link.top_of_note", "Intro", "Usage", "top", "end" ]);
        const ids = rows().map((row) => row.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.every((id) => id.startsWith("link-destination-"))).toBe(true);
        expect(rows().some((row) => row.hasAttribute("tabindex"))).toBe(false);
        expect(keys.current?.listProps.isWholeNoteChecked).toBe(true);
    });

    it("moves the checked choice with Up and Down, wrapping at either end", async () => {
        const { checked, press } = show();

        const visited: (string | null | undefined)[] = [];
        for (const key of [ "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown" ]) {
            expect(await press(key)).toBe(true);
            visited.push(checked());
        }
        expect(visited).toStrictEqual([ "Intro", "Usage", "top", "end", "add_link.top_of_note" ]);

        expect(await press("ArrowUp")).toBe(true);
        expect(checked()).toBe("end");
        expect(await press("ArrowUp")).toBe(true);
        expect(checked()).toBe("top");
    });

    it("expands and collapses a heading with Right and Left, stepping in and out", async () => {
        const { rows, checked, press } = show();
        const shown = () => rows().map((row) => row.textContent);

        // Neither arrow does anything on the whole note, but the list keeps them from the host.
        expect([ await press("ArrowRight"), await press("ArrowLeft") ])
            .toStrictEqual([ true, true ]);
        expect(checked()).toBe("add_link.top_of_note");

        await press("ArrowDown");
        await press("ArrowRight");
        expect([ checked(), shown() ]).toStrictEqual([
            "Intro", [ "add_link.top_of_note", "Intro", "Setup", "Usage", "top", "end" ]
        ]);
        await press("ArrowRight");
        expect(checked()).toBe("Setup");
        await press("ArrowRight");
        await press("ArrowRight");
        expect([ checked(), shown() ]).toStrictEqual([
            "Linux", [ "add_link.top_of_note", "Intro", "Setup", "Linux", "Usage", "top", "end" ]
        ]);
        // A heading without sub-headings has nothing to expand.
        await press("ArrowRight");
        expect(checked()).toBe("Linux");

        await press("ArrowLeft");
        expect(checked()).toBe("Setup");
        await press("ArrowLeft");
        expect([ checked(), shown() ]).toStrictEqual([
            "Setup", [ "add_link.top_of_note", "Intro", "Setup", "Usage", "top", "end" ]
        ]);
        await press("ArrowLeft");
        expect(checked()).toBe("Intro");
        await press("ArrowLeft");
        expect(shown()).toStrictEqual([ "add_link.top_of_note", "Intro", "Usage", "top", "end" ]);
        // A collapsed heading at the top level stays checked.
        await press("ArrowLeft");
        expect(checked()).toBe("Intro");

        // An anchor takes the arrows without moving.
        await press("ArrowUp");
        await press("ArrowUp");
        expect([ await press("ArrowRight"), await press("ArrowLeft"), checked() ])
            .toStrictEqual([ true, true, "end" ]);
    });

    it("expands with the arrow the expander points to in a right-to-left interface", async () => {
        glob.isRtl = true;
        try {
            const { rows, checked, press } = show();
            await press("ArrowDown");
            await press("ArrowRight");
            expect(rows()).toHaveLength(5);
            await press("ArrowLeft");
            expect(rows()).toHaveLength(6);
            await press("ArrowLeft");
            expect(checked()).toBe("Setup");
            await press("ArrowRight");
            expect(checked()).toBe("Intro");
        } finally {
            glob.isRtl = false;
        }
    });

    it("picks the checked choice on Enter and Tab, and the one clicked", async () => {
        const { onPick, press, click } = show();

        // A key held down since it picked the note is taken, and picks nothing.
        expect(await press("Enter", { repeat: true })).toBe(true);
        expect(onPick).not.toHaveBeenCalled();
        expect(await press("Enter")).toBe(true);
        expect(onPick).toHaveBeenLastCalledWith(null);
        await press("ArrowDown");
        expect(await press("Tab")).toBe(true);
        expect(onPick).toHaveBeenLastCalledWith(intro);
        await press("ArrowUp");
        await press("ArrowUp");
        await press("Enter");
        expect(onPick).toHaveBeenLastCalledWith(end);

        await click("Usage");
        expect(onPick).toHaveBeenLastCalledWith(usage);
        await click("top");
        expect(onPick).toHaveBeenLastCalledWith(top);
        await click("add_link.top_of_note");
        expect(onPick).toHaveBeenLastCalledWith(null);
        expect(onPick).toHaveBeenCalledTimes(6);
    });

    it("leaves the other keys, and those of an input method, to the host", async () => {
        const { onPick, checked, press } = show();

        expect(await press("a")).toBe(false);
        expect(await press("Backspace")).toBe(false);
        expect(await press("Escape")).toBe(false);
        expect(await press("Enter", { isComposing: true })).toBe(false);
        expect(await press("ArrowDown", { isComposing: true })).toBe(false);
        expect(checked()).toBe("add_link.top_of_note");
        expect(onPick).not.toHaveBeenCalled();
    });

    it("checks the heading that a click collapses over the checked choice", async () => {
        const { checked, press, click, onPick } = show();

        await press("ArrowDown");
        await press("ArrowRight");
        await press("ArrowRight");
        await press("ArrowRight");
        await press("ArrowRight");
        expect(checked()).toBe("Linux");

        await click("Intro", ".tn-card-choice-expander");
        expect(checked()).toBe("Intro");
        await press("Enter");
        expect(onPick).toHaveBeenLastCalledWith(intro);
        // The expander does not pick.
        expect(onPick).toHaveBeenCalledOnce();

        // Once the heading is expanded again, the choice that it hid is checked.
        await click("Intro", ".tn-card-choice-expander");
        expect(checked()).toBe("Linux");
    });

    it("scrolls the choice a key checks into view, and resets to the whole note", async () => {
        const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView")
            .mockImplementation(() => {});
        try {
            const { checked, press, rows, keys } = show();
            expect(scrollIntoView).not.toHaveBeenCalled();

            await press("ArrowDown");
            await press("ArrowRight");
            await press("ArrowRight");
            expect(checked()).toBe("Setup");
            expect(scrollIntoView.mock.contexts.map((row) => (row as Element).textContent))
                .toStrictEqual([ "Intro", "Setup" ]);
            expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });

            await act(async () => keys.current?.reset());
            expect(checked()).toBe("add_link.top_of_note");
            expect(rows()).toHaveLength(5);
            expect(scrollIntoView).toHaveBeenCalledTimes(2);
        } finally {
            scrollIntoView.mockRestore();
        }
    });
});
