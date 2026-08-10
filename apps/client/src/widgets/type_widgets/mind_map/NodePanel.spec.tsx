import type { MindElixirInstance, NodeObj } from "mind-elixir";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import appContext from "../../../components/app_context";
import { buildNotes } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import type { AddLinkOpts } from "../../dialogs/add_link";
import { uploadNodeImage } from "./images";
import NodePanel, { applyTagTexts, DEFAULT_FONT_SIZE, gatherTags, getCommonValue, MIXED, NODE_BACKGROUND_COLORS, NODE_COLORS, withIconAt } from "./NodePanel";

// Storing a picture is the one thing the panel does that leaves the browser; the rest of the module
// (the sizes, the proportions) is the real one, being what the panel is checked against here.
vi.mock("./images", async (importOriginal) => ({
    ...await importOriginal<typeof import("./images")>(),
    uploadNodeImage: vi.fn()
}));

// The memo field is a CKEditor, which wants a browser to build itself in; what it is handed and
// what it gives back is checked around it instead (see `toMemoHtml` below). The stand-in reports
// what it was last handed, so that a test can speak for the editor — the real one reports a change
// for a memo handed to it as readily as for one typed.
let memoEditor: MemoEditorProps = { className: "" };
/** What the stand-in is showing, which outlives the props it was last handed. */
let shownMemoText: string | undefined;
vi.mock("../../react/CKEditor", async () => {
    const { useEffect, useImperativeHandle } = await import("preact/hooks");

    return {
        default: (props: MemoEditorProps) => {
            memoEditor = props;
            // What the real one shows: the value it was last told to show, whether it noticed the
            // change itself or was told outright.
            useImperativeHandle(props.apiRef ?? { current: undefined as { setText(text: string): void } | undefined }, () => ({
                setText(text: string) {
                    shownMemoText = text;
                    props.onChange?.(text);
                }
            }), []);
            // As the real one does: it takes a value it is handed only when that differs from the
            // one before it, and reports the change from an effect — where its own `setData` is made.
            useEffect(() => {
                shownMemoText = props.currentValue ?? "";
                props.onChange?.(props.currentValue ?? "");
            }, [ props.currentValue ]);
            return <div className={props.className} data-current-value={props.currentValue} />;
        }
    };
});

interface MemoEditorProps {
    className: string;
    currentValue?: string;
    apiRef?: { current: { setText(text: string): void } | undefined };
    onChange?: (html: string) => void;
}

function buildNode(node: Partial<NodeObj> = {}): NodeObj {
    return { id: "n1", topic: "Node", ...node };
}

/**
 * A stand-in for the Mind Elixir instance exposing only what the panel touches: the live selection
 * and `reshapeNode`.
 */
function buildMind(nodes: NodeObj[]) {
    const reshapeNode = vi.fn();
    const topics = nodes.map((nodeObj) => ({ nodeObj }));
    const mind = {
        currentNodes: topics,
        // Looked up by the memo, which writes to the nodes it was given rather than to the selection.
        findEle: (id: string) => topics.find(({ nodeObj }) => nodeObj.id === id),
        reshapeNode
    } as unknown as MindElixirInstance;
    return { mind, reshapeNode };
}

/** The order the panel lays its sections out in. */
const SIZE = 0;
const TEXT = 1;
const BACKGROUND = 2;
const BRANCH = 3;
const ICON = 4;
const IMAGE = 5;
const LINK = 6;
const TAGS = 7;

function section(container: HTMLElement, index: number) {
    const sections = container.querySelectorAll<HTMLElement>(".tn-overlay-panel-section");
    return sections[index];
}

function tagTexts(container: HTMLElement) {
    return [ ...section(container, TAGS).querySelectorAll(".tn-chip > span") ].map((chip) => chip.textContent);
}

/** Types a tag into the field and settles it, the way Enter does for someone using the panel. */
function typeTag(container: HTMLElement, text: string) {
    const input = section(container, TAGS).querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("the tag field has no box to type in");
    input.value = text;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

function iconButtons(container: HTMLElement) {
    return [ ...section(container, ICON).querySelectorAll<HTMLButtonElement>(".mind-map-node-icon button") ];
}

/** The icon each button in the row wears, the adding button included. */
function iconFaces(container: HTMLElement) {
    return iconButtons(container).map((button) =>
        [ ...button.classList ].filter((name) => name.startsWith("bx")).join(" "));
}

function imageWidthButtons(container: HTMLElement) {
    return Array.from(section(container, IMAGE).querySelectorAll<HTMLElement>(".mind-map-node-image-actions .btn"));
}

function activeImageWidth(container: HTMLElement) {
    return imageWidthButtons(container).findIndex((button) => button.classList.contains("active"));
}

function imageShapeButtons(container: HTMLElement) {
    return Array.from(section(container, IMAGE).querySelectorAll<HTMLElement>(".mind-map-node-image-shapes .btn"));
}

function activeImageShape(container: HTMLElement) {
    return imageShapeButtons(container).findIndex((button) => button.classList.contains("active"));
}

/** The button of the picture row wearing the given icon, if it is offered at all. */
function imageAction(container: HTMLElement, icon: string) {
    return section(container, IMAGE).querySelector<HTMLButtonElement>(`.mind-map-node-image .${icon}`);
}

/** Hands a picture to the field behind the button, the way picking one from disk does. */
function chooseImage(container: HTMLElement, file: File) {
    const input = section(container, IMAGE).querySelector<HTMLInputElement>("input[type=file]");
    if (!input) throw new Error("the picture row has no field to pick through");
    Object.defineProperty(input, "files", { value: [ file ], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The field saying what the selection is linked to, which is what opens the dialog. */
function linkField(container: HTMLElement) {
    return section(container, LINK).querySelector<HTMLButtonElement>("button.mind-map-node-link");
}

/** What the field says the selection points at, read off the label rather than the whole button. */
function linkLabel(field: HTMLElement | null) {
    return field?.querySelector(".mind-map-node-link-label")?.textContent;
}

/** The button beside the link field dropping what the selection points at, if it is offered at all. */
function unlinkButton(container: HTMLElement) {
    return section(container, LINK).querySelector<HTMLButtonElement>(".bx-unlink");
}

function sizeButtons(container: HTMLElement) {
    return Array.from(section(container, SIZE).querySelectorAll<HTMLElement>(".btn"));
}

function activeSize(container: HTMLElement) {
    return sizeButtons(container).findIndex((button) => button.classList.contains("active"));
}

function presetCells(root: HTMLElement) {
    return Array.from(root.querySelectorAll<HTMLElement>(".color-cell")).filter((cell) =>
        !cell.classList.contains("color-cell-reset") && !cell.classList.contains("custom-color-cell"));
}

describe("getCommonValue", () => {
    it("reports the shared value, the absence of one, and disagreement", () => {
        const read = (node: NodeObj) => node.style?.color;

        expect(getCommonValue([], read)).toBeNull();
        expect(getCommonValue([buildNode()], read)).toBeNull();
        expect(getCommonValue([buildNode({ style: { color: "#ff0000" } })], read)).toBe("#ff0000");
        expect(getCommonValue([
            buildNode({ style: { color: "#ff0000" } }),
            buildNode({ style: { color: "#ff0000" } })
        ], read)).toBe("#ff0000");
        expect(getCommonValue([
            buildNode({ style: { color: "#ff0000" } }),
            buildNode({ style: { color: "#00ff00" } })
        ], read)).toBe(MIXED);
        expect(getCommonValue([
            buildNode({ style: { color: "#ff0000" } }),
            buildNode()
        ], read)).toBe(MIXED);
    });

    it("treats a blanked-out value the same as an unset one", () => {
        // Clearing a color writes an empty string rather than removing the property, so the two
        // spellings of "no color" have to agree.
        const read = (node: NodeObj) => node.style?.color;

        expect(getCommonValue([buildNode({ style: { color: "" } })], read)).toBeNull();
        expect(getCommonValue([
            buildNode({ style: { color: "" } }),
            buildNode()
        ], read)).toBeNull();
    });
});

describe("gatherTags", () => {
    it("hands over the tags a selection agrees on, whatever order each holds them in", () => {
        expect(gatherTags([buildNode()])).toEqual({ texts: [], readOnly: false });
        expect(gatherTags([buildNode({ tags: ["one", { text: "two" }] })]))
            .toEqual({ texts: ["one", "two"], readOnly: false });
        expect(gatherTags([
            buildNode({ id: "a", tags: ["one", "two"] }),
            buildNode({ id: "b", tags: ["two", "one"] })
        ])).toEqual({ texts: ["one", "two"], readOnly: false });
    });

    it("gathers everything the selection carries, for reading only, once they disagree", () => {
        expect(gatherTags([
            buildNode({ id: "a", tags: ["one", "shared"] }),
            buildNode({ id: "b", tags: ["shared", "two"] })
        ])).toEqual({ texts: ["one", "shared", "two"], readOnly: true });

        // One node holding none of them is a disagreement like any other.
        expect(gatherTags([buildNode({ id: "a", tags: ["one"] }), buildNode({ id: "b" })]))
            .toEqual({ texts: ["one"], readOnly: true });
    });
});

describe("withIconAt", () => {
    it("takes an icon in at a place, and drops the one that was there", () => {
        const icons = [ "bx bx-star", "bx bx-cube" ];

        // The button at the end of the row stands one past it, which is where a pick is appended.
        expect(withIconAt(icons, icons.length, "bx bx-bulb")).toEqual([ "bx bx-star", "bx bx-cube", "bx bx-bulb" ]);
        expect(withIconAt([], 0, "bx bx-bulb")).toEqual([ "bx bx-bulb" ]);
        // Picking on an icon takes its place, wherever in the row it stands.
        expect(withIconAt(icons, 0, "bx bx-bulb")).toEqual([ "bx bx-bulb", "bx bx-cube" ]);
        expect(withIconAt(icons, 1, "bx bx-bulb")).toEqual([ "bx bx-star", "bx bx-bulb" ]);
        // Removing takes out that one alone, the same icon worn twice included.
        expect(withIconAt(icons, 0, null)).toEqual([ "bx bx-cube" ]);
        expect(withIconAt([ "bx bx-star", "bx bx-star" ], 1, null)).toEqual([ "bx bx-star" ]);
        // Nothing of the original is touched along the way.
        expect(icons).toEqual([ "bx bx-star", "bx bx-cube" ]);
    });
});

describe("the memo field of the panel", () => {
    /** What the field is currently showing, the editor itself standing in for the real one. */
    function shownMemo(container: HTMLElement) {
        return container.querySelector(".mind-map-node-memo")?.getAttribute("data-current-value");
    }

    /**
     * Brings a tab to the front, named by the icon it wears rather than by its title, so that the
     * tests speak of the panel and not of the wording it happens to carry.
     */
    async function openTab(container: HTMLElement, icon: string) {
        const tab = container.querySelector(`[role="tab"] .${icon}`)?.closest("button");
        if (!tab) throw new Error(`the panel has no ${icon} tab`);

        await act(async () => tab.click());
    }

    /**
     * The panel opens on the formatting tab, and the editor is built only when the memo's own is
     * first opened — so there is nothing to read or write into before this.
     *
     * Found by either face it wears: the tab says on itself whether anything is written about the
     * node, so naming one icon would be naming only the nodes that carry a memo.
     */
    async function openMemoTab(container: HTMLElement) {
        const tab = memoTabIcon(container)?.closest("button");
        if (!tab) throw new Error("the panel has no memo tab");

        await act(async () => tab.click());
    }

    const openFormatTab = (container: HTMLElement) => openTab(container, "bx-palette");

    /** The face the memo's tab wears, which is what it says about the node without being opened. */
    function memoTabIcon(container: HTMLElement) {
        return container.querySelector('[role="tab"] .bx-notepad, [role="tab"] .bx-calendar-alt');
    }

    /** The tabs' bodies, in the order they are laid into the panel — all of them, shown or not. */
    function tabBodies(container: HTMLElement) {
        return [ ...container.querySelectorAll('[role="tabpanel"]') ];
    }

    /** The icon of the tab on show, which is what the panel says it is showing. */
    function activeTabIcon(container: HTMLElement) {
        const active = container.querySelector('[role="tab"][aria-selected="true"] .tn-icon');
        return [ ...active?.classList ?? [] ].find((name) => name.startsWith("bx-"));
    }

    /** Writes into the field, as someone typing does: what it shows is what it then reports. */
    async function typeMemo(html: string) {
        await act(async () => {
            shownMemoText = html;
            memoEditor.onChange?.(html);
        });
    }

    it("keeps the memo in a tab of its own, raised only once it is asked for", async () => {
        const node = buildNode({ id: "a", memo: "<p>About A</p>" } as Partial<NodeObj>);
        let container: HTMLElement | undefined;

        await act(async () => {
            container = renderInto(<NodePanel mind={buildMind([node]).mind} noteId="map" nodes={[node]} />);
        });
        if (!container) throw new Error("render produced no container");
        const panel = container;

        // The panel opens on the fields, the editor not yet built — which is what keeps a map whose
        // memos are never touched from paying for one on every selection.
        expect(activeTabIcon(panel)).toBe("bx-palette");
        expect(panel.querySelector(".mind-map-node-memo")).toBeNull();

        await openMemoTab(panel);
        expect(activeTabIcon(panel)).toBe("bx-notepad");
        expect(shownMemo(panel)).toBe("<p>About A</p>");
        // Every tab keeps its place in the panel, the one not on show merely hidden within it: that
        // is what holds the panel's height still as tabs are switched, and it is also what makes
        // returning to the fields instant, with nothing half-typed in them lost on the way.
        expect(section(panel, SIZE)).toBeTruthy();
        expect(tabBodies(panel).map((body) => body.getAttribute("aria-hidden"))).toEqual([ "true", "false" ]);
    });

    it("writes a memo back from behind the other tab, the editor staying up once raised", async () => {
        // Switching away must not take the editor down: it is what writes a memo back as the
        // selection moves on, and someone who types one and returns to the fields would lose it.
        const first = buildNode({ id: "a" });
        const second = buildNode({ id: "b" });
        const firstMind = buildMind([first]);
        let container: HTMLElement | undefined;

        await act(async () => {
            container = renderInto(<NodePanel mind={firstMind.mind} noteId="map" nodes={[first]} />);
        });
        if (!container) throw new Error("render produced no container");
        const panel = container;

        await openMemoTab(panel);
        await typeMemo("<p>About A</p>");
        await openFormatTab(panel);
        expect(activeTabIcon(panel)).toBe("bx-palette");

        await act(async () => {
            render(<NodePanel mind={buildMind([second]).mind} noteId="map" nodes={[second]} />, panel);
        });
        expect(firstMind.reshapeNode).toHaveBeenCalledWith(firstMind.mind.currentNodes[0], { memo: "<p>About A</p>" });
    });

    it("shows the memo of whatever is selected now, not of what was selected before", async () => {
        // One field serves every selection it outlives, so the memo it shows has to follow the
        // selection — otherwise the memo of the node left behind is what is read, and written over.
        const withMemo = buildNode({ id: "a", memo: "<p>About A</p>" } as Partial<NodeObj>);
        const without = buildNode({ id: "b" });
        let container: HTMLElement | undefined;

        await act(async () => {
            container = renderInto(<NodePanel mind={buildMind([withMemo]).mind} noteId="map" nodes={[withMemo]} />);
        });
        if (!container) throw new Error("render produced no container");
        const panel = container;
        await openMemoTab(panel);
        expect(shownMemo(panel)).toBe("<p>About A</p>");

        // Rendered into the same container, so the panel is updated rather than built anew.
        await act(async () => {
            render(<NodePanel mind={buildMind([without]).mind} noteId="map" nodes={[without]} />, panel);
        });
        expect(shownMemo(panel)).toBe("");

        await act(async () => {
            render(<NodePanel mind={buildMind([withMemo]).mind} noteId="map" nodes={[withMemo]} />, panel);
        });
        expect(shownMemo(panel)).toBe("<p>About A</p>");
    });

    it("clears what was typed when the node selected next carries the same memo — none, usually", async () => {
        // The field takes a value it is handed only when it differs from the one before it, and two
        // nodes with no memo hand it the same nothing. Left to that, what was typed for the node
        // just left stays on the page as the memo of the one just selected.
        const first = buildNode({ id: "a" });
        const second = buildNode({ id: "b" });
        let container: HTMLElement | undefined;

        await act(async () => {
            container = renderInto(<NodePanel mind={buildMind([first]).mind} noteId="map" nodes={[first]} />);
        });
        if (!container) throw new Error("render produced no container");
        const panel = container;
        await openMemoTab(panel);

        await typeMemo("<p>Typed for A</p>");
        expect(shownMemoText).toBe("<p>Typed for A</p>");

        await act(async () => {
            render(<NodePanel mind={buildMind([second]).mind} noteId="map" nodes={[second]} />, panel);
        });
        expect(shownMemoText).toBe("");
    });

    it("writes what was typed to the node it was typed for, and the memo it is handed to none", async () => {
        const first = buildNode({ id: "a", memo: "<p>About A</p>" } as Partial<NodeObj>);
        const second = buildNode({ id: "b", memo: "<p>About B</p>" } as Partial<NodeObj>);
        const firstMind = buildMind([first]);
        let container: HTMLElement | undefined;

        await act(async () => {
            container = renderInto(<NodePanel mind={firstMind.mind} noteId="map" nodes={[first]} />);
        });
        if (!container) throw new Error("render produced no container");
        const panel = container;
        await openMemoTab(panel);

        await typeMemo("<p>About A, at length</p>");

        // Selecting another node writes what was typed for the first back to the first...
        const secondMind = buildMind([second]);
        await act(async () => {
            render(<NodePanel mind={secondMind.mind} noteId="map" nodes={[second]} />, panel);
        });
        expect(firstMind.reshapeNode).toHaveBeenCalledWith(firstMind.mind.currentNodes[0], { memo: "<p>About A, at length</p>" });

        // ...and the memo the field is then handed is the second node's own, which it is not asked
        // to write anywhere — least of all over the node just left.
        await act(async () => memoEditor.onChange?.("<p>About B</p>"));
        expect(secondMind.reshapeNode).not.toHaveBeenCalled();
        expect(firstMind.reshapeNode).toHaveBeenCalledTimes(1);
    });

    /** The panel as a map that can only be read raises it, which is the memo or nothing at all. */
    async function renderReadOnly(nodes: NodeObj[], mind = buildMind(nodes).mind) {
        let container: HTMLElement | undefined;

        await act(async () => {
            container = renderInto(<NodePanel mind={mind} noteId="map" nodes={nodes} readOnly />);
        });
        if (!container) throw new Error("render produced no container");
        return container;
    }

    it("says on the tab whether there is anything written about the node", async () => {
        // The map draws everything else a node holds and draws nothing of a memo, so the tab is the
        // only place one is ever announced — worth saying before it is opened.
        const faceOf = (nodes: NodeObj[]) => {
            const panel = renderInto(<NodePanel mind={buildMind(nodes).mind} noteId="map" nodes={nodes} />);
            return [ ...memoTabIcon(panel)?.classList ?? [] ].find((name) => name.startsWith("bx-"));
        };
        const written = (id: string, memo: string) => buildNode({ id, memo } as Partial<NodeObj>);

        expect(faceOf([ buildNode() ])).toBe("bx-calendar-alt");
        expect(faceOf([ written("a", "<p>About A</p>") ])).toBe("bx-notepad");
        // A selection whose memos differ carries one all the same: there is something to go and read.
        expect(faceOf([ written("a", "<p>About A</p>"), buildNode({ id: "b" }) ])).toBe("bx-notepad");
    });

    it("holds the memo alone, and nothing to edit with, on a map that can only be read", async () => {
        const node = buildNode({ id: "a", memo: "<p>About A</p>" } as Partial<NodeObj>);

        const panel = await renderReadOnly([node]);

        // What is written about the node is there to be read at once, with no tab to reach it
        // through: with the fields gone there is nothing left to choose between.
        expect(shownMemo(panel)).toBe("<p>About A</p>");
        expect(panel.querySelectorAll('[role="tab"]')).toHaveLength(0);
        expect(panel.querySelector(".tn-overlay-panel-title")).toBeTruthy();
        // None of the fields, every one of which edits — and what they stand for is on the node.
        expect(panel.querySelectorAll(".tn-overlay-panel-section")).toHaveLength(0);
    });

    it("stands aside where there is no one memo to read", async () => {
        // Nothing written about the node, and nothing to show for a selection whose memos differ:
        // either way the panel could only put an empty pane between the reader and the map.
        expect((await renderReadOnly([buildNode()])).querySelector(".mind-map-node-panel")).toBeNull();
        expect((await renderReadOnly([
            buildNode({ id: "a", memo: "<p>About A</p>" } as Partial<NodeObj>),
            buildNode({ id: "b", memo: "<p>About B</p>" } as Partial<NodeObj>)
        ])).querySelector(".mind-map-node-panel")).toBeNull();

        // A map that can be edited raises the panel for the very same node, memo or no memo.
        const editable = renderInto(<NodePanel mind={buildMind([buildNode()]).mind} noteId="map" nodes={[buildNode()]} />);
        expect(editable.querySelector(".mind-map-node-panel")).toBeTruthy();
    });

    it("writes nothing back from a map that can only be read", async () => {
        const first = buildNode({ id: "a", memo: "<p>About A</p>" } as Partial<NodeObj>);
        const second = buildNode({ id: "b", memo: "<p>About B</p>" } as Partial<NodeObj>);
        const firstMind = buildMind([first]);

        const panel = await renderReadOnly([first], firstMind.mind);

        // Nothing can be typed into it in the first place, the field being held read-only; what it
        // is holding is written back all the same as the selection moves on, and that is the way a
        // map being read would come to be written to.
        await typeMemo("<p>About A, meddled with</p>");
        await act(async () => {
            render(<NodePanel mind={buildMind([second]).mind} noteId="map" nodes={[second]} readOnly />, panel);
        });

        expect(firstMind.reshapeNode).not.toHaveBeenCalled();
    });
});

describe("applyTagTexts", () => {
    it("keeps a styled tag while its text stands, and plain text for the rest", () => {
        const styled = { text: "urgent", style: { color: "red" } };

        expect(applyTagTexts([styled, "later"], ["urgent", "done"])).toEqual([styled, "done"]);
        // Dropped from the texts, the styling goes with it rather than following the tag back.
        expect(applyTagTexts([styled], ["done"])).toEqual(["done"]);
        expect(applyTagTexts(undefined, ["done"])).toEqual(["done"]);
        expect(applyTagTexts([styled], [])).toEqual([]);
    });
});

describe("NodePanel", () => {
    it("offers every row on a single line, backgrounds as translucent variants of the same hues", () => {
        const nodes = [buildNode()];
        const { mind } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);

        for (const index of [TEXT, BACKGROUND, BRANCH]) {
            // A row is the presets plus the clear and custom cells; more would wrap in the panel.
            expect(presetCells(section(container, index))).toHaveLength(NODE_COLORS.length);
            expect(section(container, index).querySelectorAll(".color-cell")).toHaveLength(NODE_COLORS.length + 2);
        }
        expect(NODE_BACKGROUND_COLORS).toEqual(NODE_COLORS.map((color) => `${color}40`));
    });

    it("shows a node with no size of its own as medium, and applies the sizes it is asked for", () => {
        const nodes = [buildNode({ id: "a" }), buildNode({ id: "b" })];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);

        expect(sizeButtons(container)).toHaveLength(4);
        expect(activeSize(container)).toBe(1);

        sizeButtons(container)[2].click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { fontSize: "24px" } });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { style: { fontSize: "24px" } });

        // Back to medium means back to having no size of its own, rather than the size of an
        // ordinary node — the root is larger than that.
        reshapeNode.mockClear();
        sizeButtons(container)[1].click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { fontSize: DEFAULT_FONT_SIZE } });
        expect(DEFAULT_FONT_SIZE).toBe("");
    });

    it("shows the size the selection already carries, and none when the nodes disagree", () => {
        const large = { style: { fontSize: "24px" } };
        const { mind } = buildMind([buildNode(large)]);
        expect(activeSize(renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={[buildNode(large)]} />))).toBe(2);

        const mixed = [buildNode({ id: "a", ...large }), buildNode({ id: "b", style: { fontSize: "32px" } })];
        const mixedMind = buildMind(mixed);
        expect(activeSize(renderInto(<NodePanel mind={mixedMind.mind} noteId="mapNote" nodes={mixed} />))).toBe(-1);
    });

    it("shows the colors the selection already carries", () => {
        const nodes = [buildNode({
            style: { color: NODE_COLORS[1], background: NODE_BACKGROUND_COLORS[2] },
            branchColor: NODE_COLORS[0]
        })];
        const { mind } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);

        const selectedIn = (index: number) => presetCells(section(container, index))
            .findIndex((cell) => cell.classList.contains("selected"));
        expect(selectedIn(TEXT)).toBe(1);
        // The translucent background has to survive being matched against its swatch.
        expect(selectedIn(BACKGROUND)).toBe(2);
        expect(selectedIn(BRANCH)).toBe(0);
    });

    it("selects nothing for a property the selected nodes disagree on", () => {
        const nodes = [
            buildNode({ id: "a", style: { color: NODE_COLORS[0] } }),
            buildNode({ id: "b", style: { color: NODE_COLORS[1] } })
        ];
        const { mind } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);

        const textCells = Array.from(section(container, TEXT).querySelectorAll(".color-cell"));
        expect(textCells.some((cell) => cell.classList.contains("selected"))).toBe(false);
        // The properties they do agree on are still shown as unset.
        const backgroundReset = section(container, BACKGROUND).querySelector(".color-cell-reset");
        expect(backgroundReset?.classList.contains("selected")).toBe(true);
    });

    it("patches every selected node, and blanks the property when a color is cleared", () => {
        const nodes = [buildNode({ id: "a" }), buildNode({ id: "b" })];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);

        presetCells(section(container, TEXT))[3].click();
        expect(reshapeNode).toHaveBeenCalledTimes(2);
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { color: NODE_COLORS[3] } });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { style: { color: NODE_COLORS[3] } });

        reshapeNode.mockClear();
        presetCells(section(container, BACKGROUND))[3].click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { background: NODE_BACKGROUND_COLORS[3] } });

        reshapeNode.mockClear();
        section(container, BACKGROUND).querySelector<HTMLElement>(".color-cell-reset")?.click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { background: "" } });

        reshapeNode.mockClear();
        presetCells(section(container, BRANCH))[1].click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { branchColor: NODE_COLORS[1] });
    });

    it("shows every icon the selection wears, and a button for one more", () => {
        const nodes = [buildNode({ icons: ["bx bx-star", "bx bx-cube"] })];

        const container = renderInto(<NodePanel mind={buildMind(nodes).mind} noteId="mapNote" nodes={nodes} />);

        // The icons themselves, then the button adding another.
        expect(iconFaces(container)).toEqual(["bx bx-star", "bx bx-cube", "bx bx-plus"]);
        // A node wearing none is the adding button alone, which is invitation enough.
        expect(iconFaces(renderInto(<NodePanel mind={buildMind([buildNode()]).mind} noteId="mapNote" nodes={[buildNode()]} />)))
            .toEqual(["bx bx-plus"]);
    });

    it("shows what a disagreeing selection carries between them, for reading only", () => {
        const nodes = [
            buildNode({ id: "a", icons: ["bx bx-star"] }),
            buildNode({ id: "b", icons: ["bx bx-cube"] })
        ];

        const container = renderInto(<NodePanel mind={buildMind(nodes).mind} noteId="mapNote" nodes={nodes} />);

        // Everything they carry, and no way to add: a pick could only overwrite what each has.
        expect(iconFaces(container)).toEqual(["bx bx-star", "bx bx-cube"]);
        expect(iconButtons(container).every((button) => button.disabled)).toBe(true);
    });

    it("offers what can be done with the picture a node carries, and only takes one in without", () => {
        const nodes = [buildNode({ image: { url: "api/attachments/att1/image/a.png", width: 240, height: 180 } })];

        const container = renderInto(<NodePanel mind={buildMind(nodes).mind} noteId="mapNote" nodes={nodes} />);

        // The picture is on the node itself; the row says how large it is drawn and offers the way
        // to another one or to none.
        expect(activeImageWidth(container)).toBe(1);
        expect(imageAction(container, "bx-repost")?.disabled).toBe(false);
        expect(imageAction(container, "bx-trash")).toBeTruthy();

        // A node carrying none offers to take one in, and nothing else: there is no size to set and
        // nothing to remove.
        const empty = renderInto(<NodePanel mind={buildMind([buildNode()]).mind} noteId="mapNote" nodes={[buildNode()]} />);
        expect(imageWidthButtons(empty)).toHaveLength(0);
        expect(imageAction(empty, "bx-trash")).toBeNull();
        expect(imageAction(empty, "bx-image-add")).toBeTruthy();
    });

    it("draws every selected node at the width it is asked for, each keeping its own proportions", () => {
        const nodes = [
            buildNode({ id: "a", image: { url: "a.png", width: 240, height: 180 } }),
            buildNode({ id: "b", image: { url: "b.png", width: 240, height: 480 } })
        ];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);

        imageWidthButtons(container)[2].click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { image: { url: "a.png", width: 400, height: 300 } });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { image: { url: "b.png", width: 400, height: 800 } });

        // Removing takes the picture off every selected node.
        reshapeNode.mockClear();
        imageAction(container, "bx-trash")?.click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { image: undefined });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { image: undefined });
    });

    it("cuts every selected picture to the shape it is asked for, each at the width it is drawn at", async () => {
        const nodes = [
            buildNode({ id: "a", image: { url: "a.png", width: 240, height: 180 } }),
            buildNode({ id: "b", image: { url: "b.png", width: 120, height: 90 } })
        ];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);

        // Both carry their own shape, which is the one shown; the widths they disagree on are not.
        expect(imageShapeButtons(container)).toHaveLength(3);
        expect(activeImageShape(container)).toBe(0);
        expect(activeImageWidth(container)).toBe(-1);

        imageShapeButtons(container)[1].click();

        await vi.waitFor(() => expect(reshapeNode).toHaveBeenCalledTimes(2));
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { image: { url: "a.png", width: 240, height: 240, fit: "cover" } });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { image: { url: "b.png", width: 120, height: 120, fit: "cover" } });
    });

    it("takes no picture in where the selection carries different ones", () => {
        const nodes = [
            buildNode({ id: "a", image: { url: "a.png", width: 240, height: 180 } }),
            buildNode({ id: "b", image: { url: "b.png", width: 120, height: 90 } })
        ];

        const container = renderInto(<NodePanel mind={buildMind(nodes).mind} noteId="mapNote" nodes={nodes} />);

        // One picture cannot take the place of them all — that is a removal in all but name. What
        // it would take, removing them and taking one in, is what the row still offers. (The
        // section carries the reason as its title, which no test can read: the panel's own strings
        // resolve to nothing until i18next is initialized, which it is not here.)
        expect(imageAction(container, "bx-repost")?.disabled).toBe(true);
        expect(imageAction(container, "bx-trash")).toBeTruthy();
        // No width can be shown either, but one can still be set for all of them.
        expect(activeImageWidth(container)).toBe(-1);
        expect(imageWidthButtons(container)).toHaveLength(3);
    });

    it("stores a chosen picture on the note and gives it to every selected node", async () => {
        const image = { url: "api/attachments/att9/image/photo.png", width: 240, height: 160 };
        vi.mocked(uploadNodeImage).mockResolvedValue(image);
        const nodes = [buildNode({ id: "a" }), buildNode({ id: "b" })];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);
        chooseImage(container, new File([""], "photo.png", { type: "image/png" }));

        await vi.waitFor(() => expect(reshapeNode).toHaveBeenCalledTimes(2));
        expect(uploadNodeImage).toHaveBeenCalledWith("mapNote", expect.objectContaining({ name: "photo.png" }));
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { image });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { image });
    });

    it("leaves the selection as it was when a picture cannot be stored", async () => {
        vi.mocked(uploadNodeImage).mockResolvedValue(null);
        const nodes = [buildNode()];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);
        chooseImage(container, new File([""], "photo.png", { type: "image/png" }));

        await vi.waitFor(() => expect(uploadNodeImage).toHaveBeenCalled());
        expect(reshapeNode).not.toHaveBeenCalled();
    });

    it("says what the selection is linked to, and what it would take to link it", async () => {
        const [ noteId ] = buildNotes([ { title: "Linked note", "#iconClass": "bx bx-cube" } ]);
        const linkFace = (nodes: NodeObj[]) =>
            linkField(renderInto(<NodePanel mind={buildMind(nodes).mind} noteId="mapNote" nodes={nodes} />));

        // Nothing yet, and a selection that disagrees, each say so in their own words.
        expect(linkFace([buildNode()])?.querySelector(".mind-map-node-link-empty")).toBeTruthy();
        expect(linkFace([
            buildNode({ id: "a", hyperLink: "https://example.com" }),
            buildNode({ id: "b" })
        ])?.querySelector(".mind-map-node-link-mixed")).toBeTruthy();

        // An address reads as the host it points at, its whole self being far too long for the panel.
        expect(linkLabel(linkFace([buildNode({ hyperLink: "https://example.com/a/long/page?q=1" })])))
            .toBe("example.com");

        // A note reads as it is named and dressed now, rather than as the address it is stored as.
        const note = linkFace([buildNode({ hyperLink: `#root/${noteId}` })]);
        expect(note?.querySelector(".bx-cube")).toBeTruthy();
        await vi.waitFor(() => expect(linkLabel(note)).toBe("Linked note"));
    });

    it("picks a link through the add-link dialog, asked for the target alone", async () => {
        const nodes = [buildNode({ id: "a" }), buildNode({ id: "b" })];
        const { mind, reshapeNode } = buildMind(nodes);
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
        onTestFinished(() => triggerCommand.mockRestore());

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);
        linkField(container)?.click();

        // A node reads as its own topic, so the dialog is asked for what is pointed at and nothing
        // else — no title to write beside it.
        expect(triggerCommand).toHaveBeenCalledWith("showAddLinkDialog",
            expect.objectContaining({ targetOnly: true, hasSelection: false }));

        // What comes back is stored the way the map stores it: a note as an in-app address, an
        // address as one we could follow. Every node the panel was handed takes it.
        const opts = triggerCommand.mock.calls[0][1] as AddLinkOpts;
        await opts.addLink("root/abc123", "Linked note");
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { hyperLink: "#root/abc123" });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { hyperLink: "#root/abc123" });

        reshapeNode.mockClear();
        await opts.addLink("example.com", "example.com", true);
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { hyperLink: "https://example.com" });

        // Nothing we could store, nothing written: the selection keeps the link it had.
        reshapeNode.mockClear();
        await opts.addLink("javascript:alert(1)", "", true);
        expect(reshapeNode).not.toHaveBeenCalled();
    });

    it("opens the dialog on the link the selection already carries", () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
        onTestFinished(() => triggerCommand.mockRestore());

        const openOn = (...nodes: NodeObj[]) => {
            linkField(renderInto(<NodePanel mind={buildMind(nodes).mind} noteId="mapNote" nodes={nodes} />))?.click();
            return (triggerCommand.mock.lastCall?.[1] as AddLinkOpts).currentLink;
        };

        // Handed over as the pick it was, so that the dialog opens on it and offers to change it.
        expect(openOn(buildNode({ hyperLink: "#root/abc123" }))).toEqual({ notePath: "root/abc123" });
        expect(openOn(buildNode({ hyperLink: "https://example.com/page" })))
            .toEqual({ externalLink: "https://example.com/page" });

        // Nothing to open on: a node linked to nothing, and a selection pointing several ways at
        // once — there is no one link there to be changed.
        expect(openOn(buildNode())).toBeUndefined();
        expect(openOn(
            buildNode({ id: "a", hyperLink: "https://example.com" }),
            buildNode({ id: "b" })
        )).toBeUndefined();
    });

    it("unlinks the selection from the button beside the field, which is only there to be unlinked", () => {
        const linked = [
            buildNode({ id: "a", hyperLink: "https://example.com" }),
            buildNode({ id: "b", hyperLink: "https://example.com" })
        ];
        const { mind, reshapeNode } = buildMind(linked);

        // Nothing to drop, nothing offering to: the field alone stands there.
        expect(unlinkButton(renderInto(<NodePanel mind={buildMind([buildNode()]).mind} noteId="mapNote" nodes={[buildNode()]} />))).toBeNull();

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={linked} />);
        unlinkButton(container)?.click();

        // Blanked out rather than removed, Mind Elixir only ever assigning the properties it is given.
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { hyperLink: "" });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { hyperLink: "" });
    });

    it("edits the tags of a single node, keeping the styling of the ones that stay", () => {
        const styled = { text: "urgent", style: { color: "red" } };
        const nodes = [buildNode({ tags: [styled, "later"] })];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);

        expect(tagTexts(container)).toEqual(["urgent", "later"]);

        typeTag(container, "done");

        expect(reshapeNode).toHaveBeenCalledWith(mind.currentNodes[0], { tags: [styled, "later", "done"] });
    });

    it("edits the tags of several nodes that carry the same ones, each keeping its own styling", () => {
        // The same tag, dressed differently on each node: what is written back has to be read from
        // the node it is written to, rather than from whichever node the field happened to show.
        const nodes = [
            buildNode({ id: "a", tags: [{ text: "urgent", style: { color: "red" } }] }),
            buildNode({ id: "b", tags: [{ text: "urgent", style: { color: "blue" } }] })
        ];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);

        expect(tagTexts(container)).toEqual(["urgent"]);
        expect(container.querySelector<HTMLInputElement>(".tn-field input")?.disabled).toBe(false);

        typeTag(container, "done");

        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { tags: [nodes[0].tags?.[0], "done"] });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { tags: [nodes[1].tags?.[0], "done"] });
    });

    it("gathers the tags of a selection that disagrees, for reading only", () => {
        const nodes = [
            buildNode({ id: "a", tags: ["one", "shared"] }),
            buildNode({ id: "b", tags: ["shared", "two"] })
        ];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);

        expect(tagTexts(container)).toEqual(["one", "shared", "two"]);
        expect(container.querySelector<HTMLInputElement>(".tn-field input")?.disabled).toBe(true);
        // Nothing to press: a removal would take a tag off a node that never had it.
        expect([...container.querySelectorAll<HTMLButtonElement>(".tn-chip-remove")].every((button) => button.disabled)).toBe(true);

        typeTag(container, "done");
        expect(reshapeNode).not.toHaveBeenCalled();
    });

    it("goes away when sent away, and comes back with the next selection", async () => {
        const first = buildNode({ id: "a" });
        const second = buildNode({ id: "b" });
        let container: HTMLElement | undefined;
        await act(async () => {
            container = renderInto(<NodePanel mind={buildMind([first]).mind} noteId="mapNote" nodes={[first]} />);
        });
        if (!container) throw new Error("render produced no container");
        const panel = container;

        /** Renders the panel for the given selection, as the map does when the selection changes. */
        const select = async (nodes: NodeObj[]) => act(async () => {
            render(<NodePanel mind={buildMind(nodes).mind} noteId="mapNote" nodes={nodes} />, panel);
        });
        const shown = () => !!panel.querySelector(".mind-map-node-panel");
        /** Presses the button that sends the panel away, the way it is pressed on the map. */
        const dismiss = async () => act(async () => {
            panel.querySelector<HTMLButtonElement>(".tn-overlay-panel-close")?.click();
        });

        await dismiss();
        expect(shown()).toBe(false);

        // The node is still the selected one — what was sent away is the panel, not the selection —
        // so it stays away for as long as that selection stands, edits to the node included.
        await select([first]);
        expect(shown()).toBe(false);

        // Anything selected after it raises the panel again, the node just left among them.
        await select([second]);
        expect(shown()).toBe(true);
        await dismiss();
        expect(shown()).toBe(false);
        await select([first]);
        expect(shown()).toBe(true);
    });

    it("keeps clicks and key presses from reaching the map underneath", () => {
        const nodes = [buildNode()];
        const { mind } = buildMind(nodes);

        const container = renderInto(<NodePanel mind={mind} noteId="mapNote" nodes={nodes} />);
        const panel = container.querySelector(".mind-map-node-panel");

        for (const event of [
            new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
            new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Delete" })
        ]) {
            const stopPropagation = vi.spyOn(event, "stopPropagation");
            panel?.dispatchEvent(event);
            expect(stopPropagation).toHaveBeenCalled();
        }
    });
});
