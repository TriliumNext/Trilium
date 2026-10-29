/**
 * Regression tests for https://github.com/TriliumNext/Trilium/issues/10575
 * ("on bigger notes. The content of the note tends to 'refresh'").
 *
 * When a big text note opens in auto-read-only mode and the user temporarily enables
 * editing, the `ReadOnlyText` widget stays mounted (hidden) behind the editor. It reads
 * the note content via `useNoteBlob(note, undefined, { reportLoadStateTo: noteContext })`:
 * because no componentId is passed, the WS echo of the user's *own* spaced-update save
 * (which carries the saving component's id) is misclassified as a foreign change. The
 * hidden widget then refetches the whole blob after every save and publishes
 * `contentLoad: "loading"` to the shared note context, which makes the note-detail
 * loading overlay cover the visible editor, so the content "disappears and reappears"
 * while typing.
 *
 * These tests assert the *correct* behavior, so they are red while the bug exists and
 * become the regression suite once it is fixed:
 *  - an entity change originating from the widget's own component must trigger neither
 *    a blob refetch nor a `contentLoad` publish;
 *  - a foreign change may refetch, but a hidden widget must never publish `contentLoad`
 *    (the overlay would cover the editor the user is typing into).
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import NoteContext from "../../../components/note_context";
import LoadResults from "../../../services/load_results";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import ReadOnlyText, { ReadOnlyTextContent } from "./ReadOnlyText";

// Imported by ReadOnlyText only for its content styles; irrelevant (and heavy) in happy-dom.
vi.mock("@triliumnext/ckeditor5", () => ({}));

const { watchContentEmbeds, stopWatchingEmbeds, loadEmbeddedNote, loadInlineEmbed } = vi.hoisted(() => {
    const stop = vi.fn();
    return {
        watchContentEmbeds: vi.fn(() => stop),
        stopWatchingEmbeds: stop,
        loadEmbeddedNote: vi.fn(async () => {}),
        loadInlineEmbed: vi.fn(async () => {})
    };
});
vi.mock("./utils", async (importOriginal) => ({
    ...await importOriginal<typeof import("./utils")>(),
    watchContentEmbeds,
    loadEmbeddedNote,
    loadInlineEmbed
}));

const disposeStickyTableHeaders = vi.hoisted(() => vi.fn());
const applyStickyTableHeaders = vi.hoisted(() => vi.fn(() => disposeStickyTableHeaders));
vi.mock("@triliumnext/ckeditor5/src/plugins/table_sticky_header_read_only.js", () => ({
    applyStickyTableHeaders
}));

vi.stubGlobal("logError", vi.fn());
vi.stubGlobal("logInfo", vi.fn());

function setupHarness({ isVisible: initialIsVisible, language }: { isVisible: boolean; language?: string }) {
    const note = buildNote({
        title: "Big note",
        type: "text",
        content: "<p>hello</p>",
        ...(language ? { "#language": language } : {})
    });

    // Count blob fetches without changing what they resolve to.
    const originalGetBlob = note.getBlob.bind(note);
    const getBlobSpy = vi.fn(originalGetBlob);
    note.getBlob = getBlobSpy;

    const parent = new Component();
    const noteContext = new NoteContext("ro-ntx");

    // Record every contentLoad state published to the shared note context.
    const contentLoadStates: string[] = [];
    const originalSetContextData = noteContext.setContextData.bind(noteContext);
    noteContext.setContextData = ((key, value) => {
        if (key === "contentLoad" && value && typeof value === "object" && "state" in value) {
            contentLoadStates.push(String(value.state));
        }
        return originalSetContextData(key, value);
    }) as typeof noteContext.setContextData;

    const container = document.createElement("div");
    document.body.appendChild(container);

    async function mount(isVisible = initialIsVisible) {
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <ReadOnlyText
                        note={note}
                        noteContext={noteContext}
                        ntxId={noteContext.ntxId}
                        parentComponent={parent}
                        viewScope={undefined}
                        isVisible={isVisible}
                    />
                </ParentComponent.Provider>,
                container
            );
        });
        // The blob resolves on a microtask after the first effect flush; a second act
        // cycle lets useNoteBlob's state update land and deliver the content.
        await act(async () => {});
    }

    async function fireContentChange(componentId: string) {
        const loadResults = new LoadResults([]);
        loadResults.addNoteContent(note.noteId, componentId);
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults });
        });
        await act(async () => {});
    }

    return { note, parent, noteContext, contentLoadStates, getBlobSpy, container, mount, fireContentChange };
}

describe("ReadOnlyText reacting to content changes (#10575)", () => {
    let cleanupContainer: HTMLElement | undefined;

    afterEach(() => {
        const mounted = cleanupContainer;
        if (mounted) {
            act(() => render(null, mounted));
            mounted.remove();
            cleanupContainer = undefined;
        }
    });

    it("loads and renders the content on mount, reporting the load state", async () => {
        const harness = setupHarness({ isVisible: true });
        cleanupContainer = harness.container;

        await harness.mount();

        expect(harness.container.textContent).toContain("hello");
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(1);
        // The initial fetch is exactly what the loading overlay exists for.
        expect(harness.contentLoadStates).toEqual([ "loading", "loaded" ]);
    });

    it("ignores the echo of a save made by its own component (no refetch, no overlay)", async () => {
        const harness = setupHarness({ isVisible: false });
        cleanupContainer = harness.container;

        await harness.mount();
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(1); // sanity: initial load only

        harness.contentLoadStates.length = 0;

        // The user types into EditableText in the same split; the WS echo of the spaced-update
        // save carries the shared parent component's id.
        await harness.fireContentChange(harness.parent.componentId);

        // The change originated here, so refetching the whole blob is pure waste...
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(1);
        // ...and publishing "loading" makes the note-detail overlay cover the editor mid-typing.
        expect(harness.contentLoadStates).toEqual([]);
    });

    it("does not publish a load state while hidden, even for foreign changes", async () => {
        const harness = setupHarness({ isVisible: false });
        cleanupContainer = harness.container;

        await harness.mount();
        harness.contentLoadStates.length = 0;

        // A change from elsewhere (another split, another device via sync). A hidden widget
        // may refresh its content, but it must not drive the shared loading overlay.
        await harness.fireContentChange("ReactWrappedWidget-remote");

        expect(harness.contentLoadStates).not.toContain("loading");
    });

    it("shows a change saved elsewhere once its tab shows, having loaded it at once", async () => {
        const resizeCallbacks: (() => void)[] = [];
        const { ResizeObserver } = globalThis;
        globalThis.ResizeObserver = class {
            constructor(callback: () => void) {
                resizeCallbacks.push(callback);
            }
            observe() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;
        try {
            const harness = setupHarness({ isVisible: true });
            cleanupContainer = harness.container;
            await harness.mount();
            harness.contentLoadStates.length = 0;

            // A tab in the background, hidden as `SplitNoteContainer` hides one.
            harness.container.style.display = "none";
            harness.getBlobSpy.mockResolvedValue({ content: "<p>changed</p>" } as never);
            await harness.fireContentChange("ReactWrappedWidget-remote");
            expect(harness.getBlobSpy).toHaveBeenCalledTimes(2);
            expect(harness.container.textContent).toContain("hello");

            harness.container.style.display = "";
            await act(async () => {
                for (const callback of resizeCallbacks) callback();
            });
            expect(harness.container.textContent).toContain("changed");
            expect(harness.contentLoadStates).toEqual([ "loaded" ]);
        } finally {
            globalThis.ResizeObserver = ResizeObserver;
        }
    });

    it("catches up on skipped own-component changes when displayed again, but only then", async () => {
        const harness = setupHarness({ isVisible: false });
        cleanupContainer = harness.container;

        await harness.mount();
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(1);

        // Becoming visible without having missed anything must not refetch (the user just
        // toggles between read-only and editable without editing).
        await harness.mount(true);
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(1);

        // The user edits in the editable view (own-component echo while hidden)...
        await harness.mount(false);
        await harness.fireContentChange(harness.parent.componentId);
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(1); // still skipped

        // ...and re-locks the note: the read-only view must not show stale content.
        await harness.mount(true);
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(2);
    });
});

describe("ReadOnlyText ?bookmark= handling", () => {
    let cleanupContainer: HTMLElement | undefined;

    afterEach(() => {
        const mounted = cleanupContainer;
        if (mounted) {
            act(() => render(null, mounted));
            mounted.remove();
            cleanupContainer = undefined;
        }
    });

    it("keeps the bookmark until the content renders, then expands the collapsible and consumes it", async () => {
        Element.prototype.scrollIntoView = vi.fn();
        const note = buildNote({
            title: "Collapsible note",
            type: "text",
            content:
                `<details class="trilium-collapsible"><summary>Hidden</summary>` +
                `<p><a id="deep-anchor"></a>target</p></details>`
        });
        const parent = new Component();
        const noteContext = new NoteContext("bm-ntx");
        noteContext.viewScope = { bookmark: "deep-anchor" };

        const container = document.createElement("div");
        document.body.appendChild(container);
        cleanupContainer = container;

        // First act cycle only: the blob resolves on a microtask after the first effect flush
        // (see setupHarness.mount), so this mounts with the content still loading.
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <ReadOnlyText
                        note={note}
                        noteContext={noteContext}
                        ntxId={noteContext.ntxId}
                        parentComponent={parent}
                        viewScope={noteContext.viewScope}
                        isVisible={true}
                    />
                </ParentComponent.Provider>,
                container
            );
        });

        // The mount effect ran against an empty container, so it must not consume the bookmark
        // yet, or the post-load pass has nothing left to reveal.
        expect(noteContext.viewScope?.bookmark).toBe("deep-anchor");

        // Second act cycle: the blob lands, the content commits, and the [blob] effect fires.
        await act(async () => {});

        const details = container.querySelector("details");
        expect(details?.open).toBe(true);
        expect(noteContext.viewScope?.bookmark).toBeUndefined();
    });
});

describe("ReadOnlyText ?block= handling", () => {
    let cleanupContainer: HTMLElement | undefined;

    afterEach(() => {
        const mounted = cleanupContainer;
        if (mounted) {
            act(() => render(null, mounted));
            mounted.remove();
            cleanupContainer = undefined;
        }
    });

    async function mountWithBlock(block: string | undefined, isVisible = true) {
        const scrollBy = vi.fn();
        Element.prototype.scrollBy = scrollBy;
        const note = buildNote({
            title: "Blocks",
            type: "text",
            content: "<p data-trilium-block-id=\"b1\">One</p>"
                + "<p data-trilium-block-id=\"b2\">Two</p>"
        });
        const parent = new Component();
        const noteContext = new NoteContext("block-ntx");
        noteContext.noteId = note.noteId;
        noteContext.viewScope = { block };

        const container = document.createElement("div");
        document.body.appendChild(container);
        cleanupContainer = container;
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <ReadOnlyText
                        note={note}
                        noteContext={noteContext}
                        ntxId={noteContext.ntxId}
                        parentComponent={parent}
                        viewScope={noteContext.viewScope}
                        isVisible={isVisible}
                    />
                </ParentComponent.Provider>,
                container
            );
        });
        const isBlockKept = noteContext.viewScope?.block === block;
        await act(async () => {});

        return { parent, noteContext, container, scrollBy, isBlockKept };
    }

    function isFlashed(container: HTMLElement, block: string) {
        const element = container.querySelector(`[data-trilium-block-id='${block}']`);
        return element?.classList.contains("block-reference-flash");
    }

    it("reveals the referenced block once the content renders", async () => {
        const { noteContext, container, scrollBy, isBlockKept } = await mountWithBlock("b2");

        expect(isBlockKept).toBe(true);
        expect(noteContext.viewScope?.block).toBeUndefined();
        expect(scrollBy).toHaveBeenCalledOnce();
        expect([ isFlashed(container, "b1"), isFlashed(container, "b2") ]).toEqual([ false, true ]);
    });

    it("reveals a block of the open note when a link to it is followed", async () => {
        const { parent, noteContext, container, scrollBy } = await mountWithBlock("b2");
        const otherContext = new NoteContext("other-ntx");
        otherContext.noteId = noteContext.noteId;

        noteContext.viewScope = { block: "b1" };
        await act(async () => {
            await parent.handleEvent("noteSwitched", { noteContext: otherContext, notePath: "" });
        });
        expect(noteContext.viewScope?.block).toBe("b1");

        await act(async () => {
            await parent.handleEvent("noteSwitched", { noteContext, notePath: "" });
        });
        expect(noteContext.viewScope?.block).toBeUndefined();
        expect(scrollBy).toHaveBeenCalledTimes(2);
        expect(isFlashed(container, "b1")).toBe(true);
    });

    it("labels a link to a block of its note by the text of the block", async () => {
        const harness = setupHarness({ isVisible: true });
        cleanupContainer = harness.container;
        const content = "<p data-trilium-block-id=\"b1\">Opening words</p>"
            + `<p><a class="reference-link" href="#root/${harness.note.noteId}?block=b1">x</a></p>`;
        harness.note.getBlob = async () => ({ content }) as never;

        await harness.mount();

        const link = harness.container.querySelector("a.reference-link");
        expect(link).not.toBeNull();
        await vi.waitFor(() => expect(link?.textContent).toBe("Opening words"));
    });

    it("leaves a link to a block of its note to the editor while hidden", async () => {
        const { parent, noteContext, container, scrollBy } = await mountWithBlock(
            undefined,
            false
        );
        expect(container.querySelector("[data-trilium-block-id='b1']")).not.toBeNull();

        noteContext.viewScope = { block: "b1" };
        await act(async () => {
            await parent.handleEvent("noteSwitched", { noteContext, notePath: "" });
        });
        expect(noteContext.viewScope?.block).toBe("b1");
        expect(scrollBy).not.toHaveBeenCalled();
    });
});

/**
 * The direction is resolved from the note's `#language` label and handed to the content
 * element as `dir`, which is what the RTL rules in the content stylesheets key off (they
 * match on the `.ck-content` ancestor carrying it). The editor sets it via CKEditor's own
 * `language.content` config, so a read-only note that drops it flips back to LTR the moment
 * editing is disabled.
 */
describe("ReadOnlyText text direction", () => {
    let cleanupContainer: HTMLElement | undefined;

    afterEach(() => {
        const mounted = cleanupContainer;
        if (mounted) {
            act(() => render(null, mounted));
            mounted.remove();
            cleanupContainer = undefined;
        }
    });

    async function mountWithLanguage(language?: string) {
        const harness = setupHarness({ isVisible: true, language });
        cleanupContainer = harness.container;
        await harness.mount();
        return harness.container.querySelector(".note-detail-readonly-text-content");
    }

    it("marks the content right-to-left for a note in an RTL language", async () => {
        expect((await mountWithLanguage("he"))?.getAttribute("dir")).toBe("rtl");
    });

    it("marks the content left-to-right otherwise", async () => {
        expect((await mountWithLanguage("en"))?.getAttribute("dir")).toBe("ltr");
        expect((await mountWithLanguage(undefined))?.getAttribute("dir")).toBe("ltr");
    });
});

describe("ReadOnlyText embedded notes", () => {
    it("watches its content for embed boxes until it unmounts", async () => {
        watchContentEmbeds.mockClear();
        stopWatchingEmbeds.mockClear();
        const harness = setupHarness({ isVisible: true });

        await harness.mount();

        const content = harness.container.querySelector(".note-detail-readonly-text-content");
        expect(content).not.toBeNull();
        expect(watchContentEmbeds.mock.calls).toEqual([ [ content ] ]);
        expect(stopWatchingEmbeds).not.toHaveBeenCalled();

        await act(async () => render(null, harness.container));
        harness.container.remove();
        expect(stopWatchingEmbeds).toHaveBeenCalledOnce();
    });

    it("loads an embed with the blocks it shows", async () => {
        loadEmbeddedNote.mockClear();
        const harness = setupHarness({ isVisible: true });
        harness.note.getBlob = async () => ({
            content: "<figure class=\"include-note\" data-note-id=\"src1\""
                + " data-block=\"b1:b2\"></figure>"
        }) as never;

        await harness.mount();

        expect(loadEmbeddedNote)
            .toHaveBeenCalledWith("src1", expect.anything(), undefined, { block: "b1:b2" });
        await act(async () => render(null, harness.container));
        harness.container.remove();
    });
});

describe("ReadOnlyText Mermaid diagrams", () => {
    const html = `<pre data-box-size="small" data-display-mode="source" data-hide-title="true"`
        + ` data-trilium-block-id="b1" data-code-wrap-lines="true" data-code-line-numbers="false"`
        + ` style="--include-note-height:12em;">`
        + `<code class="language-mermaid">graph TD;</code></pre>`
        + `<pre><code class="language-mermaid" data-trilium-display-mode="split"`
        + ` data-trilium-block-id="b2">graph LR;</code></pre>`
        + `<pre><code class="language-javascript">let a;</code></pre>`;

    afterEach(() => {
        vi.stubGlobal("glob", { ...glob, device: "desktop" });
    });

    async function mountContent(isChanging?: boolean) {
        const container = document.createElement("div");
        document.body.append(container);
        await act(async () => render(<ReadOnlyTextContent html={html} isChanging={isChanging} />, container));
        return {
            container,
            async unmount() {
                await act(async () => render(null, container));
                container.remove();
            }
        };
    }

    it("shows each diagram in the embed box of the editor, read-only", async () => {
        loadInlineEmbed.mockClear();
        const { container, unmount } = await mountContent();

        expect(loadInlineEmbed).toHaveBeenCalledTimes(2);
        const embeds = loadInlineEmbed.mock.calls.map((call: unknown[]) => {
            const [ source, $el, boxSize, options ] = call as [
                { language: string; getSource(): string; isReadOnly(): boolean },
                JQuery<HTMLElement>, string, object
            ];
            const figure = $el[0];
            return {
                language: source.language,
                source: source.getSource(),
                isReadOnly: source.isReadOnly(),
                boxSize,
                options,
                isInPage: figure.isConnected && figure.matches("figure.include-note"),
                data: { ...figure.dataset },
                height: figure.style.getPropertyValue("--include-note-height")
            };
        });
        expect(embeds).toEqual([
            {
                language: "mermaid", source: "graph TD;", isReadOnly: true, boxSize: "small",
                options: { isFocused: false }, isInPage: true,
                data: {
                    boxSize: "small", displayMode: "source", hideTitle: "true", language: "mermaid",
                    triliumBlockId: "b1", codeWrapLines: "true", codeLineNumbers: "false"
                },
                height: "12em"
            },
            {
                language: "mermaid", source: "graph LR;", isReadOnly: true, boxSize: "medium",
                options: { isFocused: false }, isInPage: true,
                data: {
                    boxSize: "medium", hideTitle: "true", language: "mermaid", triliumBlockId: "b2"
                },
                height: ""
            }
        ]);
        expect(container.querySelector("code.language-javascript")).not.toBeNull();
        expect(container.querySelector(".rendered-mermaid-diagram")).toBeNull();
        await unmount();
    });

    it("draws the diagrams in place while the content changes, and when printing", async () => {
        loadInlineEmbed.mockClear();
        const changing = await mountContent(true);
        expect(changing.container.querySelectorAll(".rendered-mermaid-diagram")).toHaveLength(2);
        await changing.unmount();

        vi.stubGlobal("glob", { ...glob, device: "print" });
        const printed = await mountContent();
        expect(printed.container.querySelectorAll(".rendered-mermaid-diagram")).toHaveLength(2);
        await printed.unmount();
        expect(loadInlineEmbed).not.toHaveBeenCalled();
    });
});

describe("ReadOnlyText extended code blocks", () => {
    it("shows each extended code block in the embed box of the editor, and no other", async () => {
        loadInlineEmbed.mockClear();
        const html = `<pre class="extended-code-block" data-box-size="medium"`
            + ` data-hide-title="true" data-code-tab-width="2" data-code-indent-with-tabs="false">`
            + `<code class="language-text-x-python">pass</code></pre>`
            + `<pre class="extended-code-block"><code data-trilium-block-id="b1">x</code></pre>`
            + `<pre><code class="language-text-x-python">plain</code></pre>`;
        const container = document.createElement("div");
        document.body.append(container);
        await act(async () => render(<ReadOnlyTextContent html={html} />, container));

        const embeds = loadInlineEmbed.mock.calls.map((call: unknown[]) => {
            const [ source, $el, boxSize ] = call as [
                { language: string; getSource(): string }, JQuery<HTMLElement>, string
            ];
            const figure = $el[0];
            return {
                language: source.language,
                source: source.getSource(),
                boxSize,
                className: figure.className,
                data: { ...figure.dataset }
            };
        });
        expect(embeds).toEqual([
            {
                language: "text-x-python", source: "pass", boxSize: "medium",
                className: "include-note extended-code-block",
                data: {
                    boxSize: "medium", hideTitle: "true", language: "text-x-python",
                    codeTabWidth: "2", codeIndentWithTabs: "false"
                }
            },
            {
                language: "text-plain", source: "x", boxSize: "full",
                className: "include-note extended-code-block",
                data: {
                    boxSize: "full", hideTitle: "true", language: "text-plain",
                    triliumBlockId: "b1"
                }
            }
        ]);
        expect(container.querySelector("pre > code.language-text-x-python")?.textContent)
            .toBe("plain");
        await act(async () => render(null, container));
        container.remove();
    });
});

describe("ReadOnlyText lists", () => {
    it("marks the list items whose first paragraph is aligned", async () => {
        const harness = setupHarness({ isVisible: true });
        harness.note.getBlob = async () => ({
            content: "<ul><li><p style=\"text-align:right;\">a</p></li><li>b</li></ul>"
        }) as never;

        await harness.mount();

        expect([ ...harness.container.querySelectorAll("li") ].map((item) => item.className))
            .toEqual([ "trilium-list-item-aligned-right", "" ]);
        await act(async () => render(null, harness.container));
        harness.container.remove();
    });
});

describe("ReadOnlyText tables", () => {
    it("sizes its tables for scrolling and keeps their header rows in view", async () => {
        const harness = setupHarness({ isVisible: true });
        harness.note.getBlob = async () => ({
            content: "<figure class=\"table\" style=\"width:150%;\"><table></table></figure>"
        }) as never;

        await harness.mount();

        const figure = harness.container.querySelector<HTMLElement>("figure.table");
        expect(figure?.style.getPropertyValue("--table-width"))
            .toBe("calc(var(--table-reference-width, 100%) * 150 / 100)");
        expect(applyStickyTableHeaders).toHaveBeenCalledWith(figure?.parentElement);

        disposeStickyTableHeaders.mockClear();
        await act(async () => render(null, harness.container));
        expect(disposeStickyTableHeaders).toHaveBeenCalledTimes(1);
        harness.container.remove();
    });
});

describe("ReadOnlyText tabs", () => {
    it("shows each tab title with text as a scrollable label", async () => {
        const harness = setupHarness({ isVisible: true });
        harness.note.getBlob = async () => ({
            content: "<div class=\"trilium-tabs\"><section class=\"trilium-tab\">"
                + "<p class=\"trilium-tab-title\">First <b>tab</b></p>"
                + "<div class=\"trilium-tab-panel\"><p>One</p></div></section>"
                + "<section class=\"trilium-tab\"><p class=\"trilium-tab-title\">&nbsp;</p>"
                + "<div class=\"trilium-tab-panel\"><p>Two</p></div></section>"
                + "</div>"
        }) as never;

        await harness.mount();

        const titles = harness.container.querySelectorAll<HTMLElement>(".trilium-tab-title");
        const [ first, second ] = titles;
        const label = first.querySelector(":scope > .scrollable-label");
        expect(label?.innerHTML).toBe("<span>First <b>tab</b></span>");
        expect(second.childNodes.length).toBe(0);

        second.click();
        label?.querySelector("b")?.click();
        expect(first.classList.contains("trilium-tab-title--active")).toBe(true);
        expect(second.classList.contains("trilium-tab-title--active")).toBe(false);

        await act(async () => render(null, harness.container));
        harness.container.remove();
    });
});
