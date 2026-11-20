import type { VNode } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import NoteContext from "../../components/note_context";
import options from "../../services/options";
import server from "../../services/server";
import { createFilterableTab } from "../../test/outline_filter";
import { getHtmlMatchText } from "../react/RawHtml";
import { type OutlineReport, useOutlineFilter, useOutlineReport } from "./outline_filter";
import RightPanelWidget from "./RightPanelWidget";

vi.mock("../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/i18n")>(),
    t: (key: string) => key
}));
vi.mock("../react/RawHtml", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../react/RawHtml")>();
    return { ...actual, getHtmlMatchText: vi.fn(actual.getHtmlMatchText) };
});

let tab: ReturnType<typeof createFilterableTab>;
let activeContext: NoteContext;

beforeEach(() => {
    options.set("rightPaneCollapsedItems", JSON.stringify([]));
    vi.spyOn(server, "put").mockResolvedValue({});
    activeContext = createContext("split-1", "noteA");
    appContext.tabManager = {
        getActiveContext: () => activeContext
    } as typeof appContext.tabManager;
    tab = createFilterableTab();
});

afterEach(() => {
    tab.destroy();
    vi.restoreAllMocks();
});

describe("the filter field of a tab", () => {
    it("shows only on a filterable tab with items", async () => {
        await renderTab([ <TestSection id="a" items={[ "Budget" ]} /> ], { filterable: false });
        expect(field()).toBeNull();

        await renderTab([], { filterable: true });
        expect(field()).toBeNull();

        await renderTab([ <TestSection id="a" items={[ "Budget" ]} /> ]);
        expect(field()).not.toBeNull();
    });
});

describe("a card while filtering", () => {
    it("hides when its section has no result, and shows once it has one", async () => {
        await renderTab([
            <TestSection id="a" items={[ "Budget" ]} />,
            <TestSection id="b" items={[ "Other" ]} />
        ]);

        await type("budget");
        expect(isShown("a")).toBe(true);
        expect(isShown("b")).toBe(false);
        // The card stays mounted, so its section keeps reporting.
        expect(card("b")).not.toBeNull();

        await renderTab([
            <TestSection id="a" items={[ "Budget" ]} />,
            <TestSection id="b" items={[ "Other", "Budget lines" ]} />
        ]);
        expect(isShown("b")).toBe(true);
        expect(rowsOf("b")).toStrictEqual([ "Budget lines" ]);

        await type("");
        expect(isShown("b")).toBe(true);
        expect(rowsOf("b")).toStrictEqual([ "Other", "Budget lines" ]);
    });

    it("stays on show while its section is loading or failed", async () => {
        await renderTab([
            <TestSection id="a" items={null} />,
            <TestReporter id="b" report={{ status: "failed" }} />
        ]);

        await type("budget");

        expect(isShown("a")).toBe(true);
        expect(isShown("b")).toBe(true);
        expect(emptyState()).toBeNull();
    });
});

describe("the empty state of a filtered tab", () => {
    it("shows once every open section has answered with nothing", async () => {
        await renderTab([
            <TestSection id="a" items={[ "Budget" ]} />,
            <TestSection id="b" items={null} />
        ]);

        await type("zz");
        expect(emptyState()).toBeNull();

        await renderTab([
            <TestSection id="a" items={[ "Budget" ]} />,
            <TestSection id="b" items={[ "Other" ]} />
        ]);
        expect(emptyState()?.textContent).toBe("menu.no_matches");

        await type("");
        expect(emptyState()).toBeNull();
    });

    it("never shows while every card is collapsed", async () => {
        options.set("rightPaneCollapsedItems", JSON.stringify([ "a", "b" ]));
        await renderTab([
            <TestSection id="a" items={[ "Budget" ]} />,
            <TestReporter id="b" report={{ status: "ready", count: 0 }} />
        ]);

        await type("zz");

        expect(emptyState()).toBeNull();
    });
});

describe("Enter in the filter field", () => {
    it("runs the first result that navigates, in the order of the cards", async () => {
        const activateA = vi.fn();
        const activateB = vi.fn();
        await renderTab([
            <TestSection id="a" items={[ "Other", "Budget" ]} activate={activateA} />,
            <TestSection id="b" items={[ "Budget" ]} activate={activateB} />,
            <TestSection id="c" items={[ "Budget" ]} />
        ]);

        await type("budget");
        const event = await press("Enter");

        expect(event.defaultPrevented).toBe(true);
        expect(activateA).toHaveBeenCalledExactlyOnceWith("Budget");
        expect(activateB).not.toHaveBeenCalled();
    });

    it("passes over a section without an action", async () => {
        const activate = vi.fn();
        await renderTab([
            <TestSection id="a" items={[ "Budget" ]} />,
            <TestSection id="b" items={[ "Budget" ]} activate={activate} />
        ]);

        await type("budget");
        await press("Enter");

        expect(activate).toHaveBeenCalledExactlyOnceWith("Budget");
    });

    it("waits at a section still loading before it, then runs its result", async () => {
        const activateA = vi.fn();
        const activateB = vi.fn();
        await renderTab([
            <TestSection id="a" items={null} activate={activateA} />,
            <TestSection id="b" items={[ "Budget" ]} activate={activateB} />
        ]);

        await type("budget");
        await press("Enter");
        expect(activateA).not.toHaveBeenCalled();
        expect(activateB).not.toHaveBeenCalled();

        await renderTab([
            <TestSection id="a" items={[ "Budget" ]} activate={activateA} />,
            <TestSection id="b" items={[ "Budget" ]} activate={activateB} />
        ]);
        expect(activateA).toHaveBeenCalledExactlyOnceWith("Budget");
        expect(activateB).not.toHaveBeenCalled();
    });

    it("drops the wait on a new key, Escape, blur and another note", async () => {
        const activate = vi.fn();
        const sections = (items: string[] | null) => [
            <TestSection id="a" items={items} activate={activate} />,
            <TestSection id="b" items={[ "Other" ]} />
        ];
        const waitThenLoad = async (drop: () => Promise<void>) => {
            await renderTab(sections(null));
            await type("budget");
            await press("Enter");
            await drop();
            await renderTab(sections([ "Budget" ]));
        };

        await waitThenLoad(() => type("budge"));
        await type("");
        await waitThenLoad(async () => { await press("Escape"); });
        await waitThenLoad(async () => {
            await act(async () => {
                field()?.dispatchEvent(new FocusEvent("blur"));
                field()?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
            });
        });
        await type("");
        await waitThenLoad(() => switchContext(createContext("split-1", "noteB")));

        expect(activate).not.toHaveBeenCalled();
    });

    it("does nothing while composing or held, or with nothing typed", async () => {
        const activate = vi.fn();
        await renderTab([
            <TestSection id="a" items={[ "Budget" ]} activate={activate} />,
            <TestSection id="b" items={[ "Other" ]} />
        ]);

        await press("Enter");
        await type("  ");
        await press("Enter");
        await type("budget");
        await press("Enter", { isComposing: true });
        await press("Enter", { repeat: true });
        expect(activate).not.toHaveBeenCalled();

        await press("Enter");
        expect(activate).toHaveBeenCalledOnce();
    });

    it("runs a ready result at once behind sections loading that cannot answer", async () => {
        const activate = vi.fn();
        await renderTab([
            <TestReporter id="attachments" report={{ status: "loading", navigates: false }} />,
            <TestReporter id="layers" report={{ status: "loading", navigates: false }} />,
            <TestSection id="annotations" items={[ "Budget" ]} activate={activate} />
        ]);

        await type("zz");
        expect(emptyState()).toBeNull();

        await type("budget");
        await press("Enter");
        expect(activate).toHaveBeenCalledExactlyOnceWith("Budget");
    });

    it("waits through a handoff between two reporters of one section", async () => {
        const activateHeading = vi.fn();
        const activatePage = vi.fn();
        let handOver: () => void = () => {};
        function Handoff() {
            const [ isHandedOver, setIsHandedOver ] = useState(false);
            handOver = () => setIsHandedOver(true);
            return (
                <RightPanelWidget id="toc" title="toc">
                    {isHandedOver
                        ? <TestRows id="toc" items={[ "12 Budget" ]} activate={activateHeading} />
                        : <WaitingReporter id="toc" />}
                </RightPanelWidget>
            );
        }
        await renderTab([
            <Handoff />,
            <TestSection id="pages" items={[ "12" ]} activate={activatePage} />
        ]);

        await type("12");
        await press("Enter");
        expect(activateHeading).not.toHaveBeenCalled();

        // The waiting reporter is removed during the diff, before the list reports.
        await act(async () => handOver());

        expect(activateHeading).toHaveBeenCalledExactlyOnceWith("12 Budget");
        expect(activatePage).not.toHaveBeenCalled();
    });
});

describe("collapsed cards while filtering", () => {
    it("stay collapsed and out of the filter, and Enter runs the open card's result", async () => {
        options.set("rightPaneCollapsedItems", JSON.stringify([ "toc", "pages" ]));
        const activateHeading = vi.fn();
        const activateHighlight = vi.fn();
        await renderTab([
            <TestSection id="toc" items={[ "Budget" ]} activate={activateHeading} />,
            <TestReporter
                id="pages" report={{ status: "ready", count: 1, activateFirst: vi.fn() }}
            />,
            <TestSection id="highlights" items={[ "Budget" ]} activate={activateHighlight} />
        ]);

        await type("budget");
        await press("Enter");

        expect(card("toc")?.classList.contains("collapsed")).toBe(true);
        expect(card("toc")?.querySelector(".card-body")).toBeNull();
        expect(isShown("toc")).toBe(true);
        expect(isShown("pages")).toBe(true);
        expect(activateHighlight).toHaveBeenCalledOnce();
        expect(activateHeading).not.toHaveBeenCalled();
    });

    it("leave a section reporting from above its body out of the empty state", async () => {
        options.set("rightPaneCollapsedItems", JSON.stringify([ "pages" ]));
        await renderTab([
            <TestReporter
                id="pages" report={{ status: "ready", count: 1, activateFirst: vi.fn() }}
            />,
            <TestSection id="highlights" items={[ "Other" ]} />
        ]);

        await type("budget");

        expect(emptyState()).not.toBeNull();
    });

    it("search their section with the query once opened", async () => {
        options.set("rightPaneCollapsedItems", JSON.stringify([ "toc" ]));
        await renderTab([
            <TestSection id="toc" items={[ "Budget", "Other" ]} />,
            <TestSection id="highlights" items={[ "Budget" ]} />
        ]);
        await type("budget");

        await clickHeader("toc");

        expect(rowsOf("toc")).toStrictEqual([ "Budget" ]);
    });
});

describe("a card opened during a filter", () => {
    it("stays with 'No matches' until the query changes", async () => {
        options.set("rightPaneCollapsedItems", JSON.stringify([ "highlights" ]));
        await renderTab([
            <TestSection id="toc" items={[ "Budget" ]} />,
            <TestSection id="highlights" items={[ "Other", "Budget plan" ]} grow />
        ]);
        await type("zz");
        expect(emptyState()).not.toBeNull();

        await clickHeader("highlights");
        expect(isShown("highlights")).toBe(true);
        expect(card("highlights")?.querySelector(".card-body .no-items")?.textContent)
            .toBe("menu.no_matches");
        expect(card("highlights")?.classList.contains("grow")).toBe(false);
        expect(emptyState()).toBeNull();

        await type("zzz");
        expect(isShown("highlights")).toBe(false);

        await clickHeader("highlights");
        await clickHeader("highlights");
        expect(isShown("highlights")).toBe(true);
        await type("zz");
        await type("zzz");
        expect(isShown("highlights")).toBe(false);

        await type("plan");
        expect(isShown("highlights")).toBe(true);
        expect(rowsOf("highlights")).toStrictEqual([ "Budget plan" ]);

        await type("");
        expect(card("highlights")?.classList.contains("collapsed")).toBe(false);
    });
});

describe("clearing the filter", () => {
    it("clears on Escape and on the clear button, then leaves Escape alone", async () => {
        await renderTab([
            <TestSection id="a" items={[ "Budget" ]} />,
            <TestSection id="b" items={[ "Other" ]} />
        ]);

        await type("budget");
        const first = await press("Escape");
        expect(first.defaultPrevented).toBe(true);
        expect(field()?.value).toBe("");
        expect(isShown("b")).toBe(true);

        const second = await press("Escape");
        expect(second.defaultPrevented).toBe(false);

        await type("budget");
        await act(async () => {
            tab.container.querySelector<HTMLElement>(".tn-menu-filter-clear")?.click();
        });
        expect(field()?.value).toBe("");
        expect(isShown("b")).toBe(true);
    });

    it("starts another note unfiltered, and never brings the query back", async () => {
        const sections = [
            <TestSection id="a" items={[ "Budget" ]} />,
            <TestSection id="b" items={[ "Other" ]} />
        ];
        await renderTab(sections);
        await type("budget");

        await switchContext(createContext("split-1", "noteB"));
        expect(field()?.value).toBe("");
        expect(isShown("b")).toBe(true);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
        expect(field()?.value).toBe("");

        await switchContext(createContext("split-1", "noteA"));
        expect(field()?.value).toBe("");
    });

    it("keeps one query per attachment of a note", async () => {
        const attachment = (attachmentId: string) => {
            const noteContext = createContext("split-1", "noteA");
            noteContext.viewScope = { viewMode: "attachments", attachmentId };
            return noteContext;
        };
        await switchContext(attachment("first"));
        await renderTab([
            <TestSection id="a" items={[ "Budget" ]} />,
            <TestSection id="b" items={[ "Other" ]} />
        ]);
        await type("budget");

        await switchContext(attachment("second"));
        expect(field()?.value).toBe("");
        await switchContext(attachment("first"));
        expect(field()?.value).toBe("");
    });
});

describe("useOutlineFilter", () => {
    it("reads each text once across queries, and only the edited one afterwards", async () => {
        const headings = [ "<b>Budget</b>", "Plan", "Micro<i>scope</i>" ];
        const sections = (items: string[]) => [
            <TestSection id="a" items={items} isHtml />,
            <TestSection id="b" items={[ "Other" ]} />
        ];
        await renderTab(sections(headings));
        vi.mocked(getHtmlMatchText).mockClear();

        for (const query of [ "b", "bu", "microscope", "plan" ]) {
            await type(query);
        }
        expect(vi.mocked(getHtmlMatchText)).toHaveBeenCalledTimes(3);
        expect(rowsOf("a")).toStrictEqual([ "Plan" ]);

        await renderTab(sections([ "<b>Budget</b>", "Plans", "Micro<i>scope</i>" ]));
        expect(vi.mocked(getHtmlMatchText)).toHaveBeenCalledTimes(4);
        expect(rowsOf("a")).toStrictEqual([ "Plans" ]);
    });
});

interface TestRowsProps {
    id: string;
    /** `null` while the section reads its items. */
    items: string[] | null;
    activate?(item: string): void;
    /** Read the items as markup. */
    isHtml?: boolean;
}

function TestRows({ id, items, activate, isHtml }: TestRowsProps) {
    const matches = useOutlineFilter(items, {
        section: id,
        getText: isHtml ? undefined : (item) => item,
        getHtml: isHtml ? (item) => item : undefined,
        activate
    });
    const shown = matches ? matches.map(({ item }) => item) : items ?? [];
    return (
        <ul>
            {shown.map((item) => (
                <li key={item} dangerouslySetInnerHTML={{ __html: item }} />
            ))}
        </ul>
    );
}

function TestSection(props: TestRowsProps & { grow?: boolean }) {
    return (
        <RightPanelWidget id={props.id} title={props.id} grow={props.grow}>
            <TestRows {...props} />
        </RightPanelWidget>
    );
}

/** A section that reports from above its card's body, as the PDF pages do. */
function TestReporter({ id, report }: { id: string; report: OutlineReport }) {
    useOutlineReport(id, report);
    return <RightPanelWidget id={id} title={id}>{id}</RightPanelWidget>;
}

function WaitingReporter({ id }: { id: string }) {
    useOutlineReport(id, { status: "loading", navigates: true });
    return null;
}

function createContext(ntxId: string, noteId: string) {
    const noteContext = new NoteContext(ntxId);
    noteContext.noteId = noteId;
    noteContext.notePath = noteId;
    noteContext.viewScope = { viewMode: "default" };
    return noteContext;
}

async function switchContext(noteContext: NoteContext) {
    activeContext = noteContext;
    await act(async () => {
        await appContext.triggerEvent("activeContextChanged", { noteContext });
    });
}

function renderTab(items: VNode[], renderOptions?: { filterable?: boolean }) {
    return tab.render(items, renderOptions);
}

const field = () => tab.field();
const type = (text: string) => tab.type(text);
const press = (key: string, init?: KeyboardEventInit) => tab.press(key, init);
const card = (id: string) => tab.card(id);
const isShown = (id: string) => tab.isShown(id);
const emptyState = () => tab.emptyState();

async function clickHeader(id: string) {
    await act(async () => card(id)?.querySelector<HTMLElement>(".card-header")?.click());
}

function rowsOf(id: string) {
    return [ ...card(id)?.querySelectorAll("li") ?? [] ].map((row) => row.textContent);
}
