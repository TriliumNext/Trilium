import { Tooltip } from "bootstrap";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

const {
    openTabWithNoteWithHoisting,
    triggerCommand,
    openContextMenu,
    getOriginBelow,
    disposeInteractiveContent,
    setupWindowShortcutsForElement,
    removeIndividualBinding
} = vi.hoisted(() => ({
    openTabWithNoteWithHoisting: vi.fn(),
    triggerCommand: vi.fn(),
    openContextMenu: vi.fn(),
    getOriginBelow: vi.fn((anchor: Element) => ({ below: anchor })),
    disposeInteractiveContent: vi.fn(),
    setupWindowShortcutsForElement: vi.fn(async (_$el: JQuery<HTMLElement>) => [ { shortcut: "ctrl+j" } ]),
    removeIndividualBinding: vi.fn()
}));

vi.mock("../../../services/i18n", () => ({
    t: (key: string, options?: { icon?: string }) => (options?.icon ? `${key} ${options.icon}` : key)
}));
vi.mock("../../../components/app_context", () => ({
    default: { tabManager: { openTabWithNoteWithHoisting }, triggerCommand }
}));
vi.mock("../../../menus/link_context_menu", () => ({
    default: { openContextMenu, getOriginBelow }
}));
vi.mock("../../../services/content_renderer", () => ({ default: { disposeInteractiveContent } }));
vi.mock("../../../services/keyboard_actions", () => ({
    default: { setupWindowShortcutsForElement }
}));
vi.mock("../../../services/shortcuts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    removeIndividualBinding
}));

import { registerContentEmbedTools } from "./content_embed_tools";
import ContentEmbed, {
    getNoteActions,
    type ContentEmbedProps,
    TinyContentEmbed,
    type TinyContentEmbedProps
} from "./ContentEmbed";

const ATTACHMENT_SCOPE = { viewMode: "attachments", attachmentId: "att1" } as const;

let container: HTMLElement;

beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    for (const tooltip of document.querySelectorAll(".tooltip")) {
        tooltip.remove();
    }
    Reflect.deleteProperty(document, "elementsFromPoint");
});

function element(html: string) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const first = template.content.firstElementChild;
    if (!(first instanceof HTMLElement)) {
        throw new Error(`Expected an element in: ${html}`);
    }
    return first;
}

/** Stubs `document.elementsFromPoint()`, which happy-dom lacks, to find `elements` at any point. */
function stubElementsFromPoint(elements: Element[]) {
    const elementsFromPoint = vi.fn((_x: number, _y: number) => elements);
    Object.defineProperty(document, "elementsFromPoint", {
        value: elementsFromPoint,
        configurable: true
    });
    return elementsFromPoint;
}

function renderBox(props: Partial<ContentEmbedProps> = {}) {
    const boxProps: ContentEmbedProps = {
        title: element(`<span><a href="#root/noteA">Note A</a></span>`),
        content: element(`<div class="rendered-content"><p>body</p></div>`),
        contentType: "text",
        notePath: "noteA",
        ...props
    };
    act(() => render(<ContentEmbed {...boxProps} />, container));
    return boxProps;
}

function renderTinyBox(props: Partial<TinyContentEmbedProps> = {}) {
    const boxProps: TinyContentEmbedProps = {
        icon: "bx bx-note",
        title: element(`<span><a href="#root/noteA">Note A</a></span>`),
        notePath: "noteA",
        actions: [],
        ...props
    };
    act(() => render(<TinyContentEmbed {...boxProps} />, container));
    return boxProps;
}

/** The include-note-* class of each element in the title row, in order. */
function titleRow() {
    return [ ...container.querySelectorAll(".include-note-title-row > *") ]
        .map((child) => [ ...child.classList ].find((name) => name.startsWith("include-note-")));
}

function button(className: string) {
    const found = container.querySelector<HTMLButtonElement>(`button.${className}`);
    if (!found) {
        throw new Error(`Expected a button.${className}.`);
    }
    return found;
}

function contentBox() {
    const found = container.querySelector<HTMLElement>(".include-note-content");
    if (!found) {
        throw new Error("Expected the content box.");
    }
    return found;
}

function tooltipOf(target: HTMLElement) {
    const tooltip = Tooltip.getInstance(target);
    act(() => tooltip?.show());
    const text = document.querySelector(".tooltip-inner")?.textContent;
    act(() => tooltip?.hide());
    return text;
}

/**
 * Right-clicks `target`, and tells whether the box opened the embed's menu for it, taking the
 * click from the browser and what surrounds the box.
 */
function rightClick(target: Element | null) {
    if (!target) {
        throw new Error("Nothing to right-click.");
    }
    openContextMenu.mockClear();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const stopPropagation = vi.spyOn(event, "stopPropagation");
    act(() => {
        target.dispatchEvent(event);
    });
    const opened = openContextMenu.mock.calls.length === 1
        && openContextMenu.mock.calls[0][1] === event;
    return { opened, isTaken: event.defaultPrevented && stopPropagation.mock.calls.length > 0 };
}

/** Tools of content with an editable mode, which adds the Editable toggle to its embed. */
const EDITABLE_TOOLS = {
    hasEditableFlag: true,
    getTools: () => [],
    execute: () => {},
    subscribe: () => () => {}
};

/**
 * Moves the box into an embed of a text editor, whose `ContentEmbed` plugin selects the embed for
 * the commands it runs.
 */
function placeInHostEditor() {
    const selectEmbedAt = vi.fn((_element: Element) => true);
    const execute = vi.fn();
    const focus = vi.fn();
    const editable = document.createElement("div");
    editable.className = "ck-editor__editable";
    Object.assign(editable, {
        ckeditorInstance: {
            plugins: { get: () => ({ selectEmbedAt }) },
            execute,
            editing: { view: { focus } }
        }
    });
    const embed = document.createElement("figure");
    embed.className = "include-note";
    editable.append(embed);
    embed.append(container);
    document.body.append(editable);
    onTestFinished(() => editable.remove());

    return { editor: { selectEmbedAt, execute, focus }, embed };
}

/** Clicks `target` and tells whether the click was kept from what surrounds the box. */
function click(target: HTMLElement) {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const stopPropagation = vi.spyOn(event, "stopPropagation");
    act(() => {
        target.dispatchEvent(event);
    });
    return { event, isStopped: stopPropagation.mock.calls.length > 0 };
}

describe("ContentEmbed", () => {
    it("lays out the title row for each box size", () => {
        const plain = [ "title", "badges", "open", "menu" ];
        const withFullscreen = [ "title", "badges", "open", "fullscreen", "menu" ];
        const layouts: [ string | undefined, string[] ][] = [
            [ undefined, plain ],
            [ "small", plain ],
            [ "medium", withFullscreen ],
            [ "full", withFullscreen ],
            [ "expandable", [ "toggle", "title", "badges", "open", "menu" ] ]
        ];

        for (const [ boxSize, expected ] of layouts) {
            act(() => render(null, container));
            renderBox({ boxSize });
            expect(titleRow(), boxSize).toEqual(expected.map((name) => `include-note-${name}`));
        }
    });

    it("lays out an excerpt with an edit button in place of fullscreen", () => {
        const excerpt = [ "title", "badges", "open", "edit", "menu" ];
        const layouts: [ string, string[] ][] = [
            [ "small", excerpt ],
            [ "medium", excerpt ],
            [ "full", excerpt ],
            [ "expandable", [ "toggle", ...excerpt ] ]
        ];

        for (const [ boxSize, expected ] of layouts) {
            act(() => render(null, container));
            renderBox({ boxSize, isExcerpt: true });
            expect(titleRow(), boxSize).toEqual(expected.map((name) => `include-note-${name}`));
            expect(container.querySelector(".include-note-fullscreen-controls")).toBeNull();
        }
    });

    it("shows its title and content, and swaps them on a new render", () => {
        const titleChildren = () => [
            ...container.querySelector("h4.include-note-title")?.childNodes ?? []
        ];
        const first = renderBox({ contentType: "pdf" });
        const box = contentBox();
        expect(titleChildren()).toEqual([ first.title ]);
        expect(box.className).toBe("include-note-content type-pdf");
        expect(first.content.parentElement).toBe(box);

        const second = renderBox({ contentType: "image" });
        expect(titleChildren()).toEqual([ second.title ]);
        expect(contentBox()).toBe(box);
        expect(box.className).toBe("include-note-content type-image");
        expect([ ...box.children ]).toEqual([ second.content ]);
        expect(first.content.isConnected).toBe(false);
        expect(disposeInteractiveContent).toHaveBeenCalledOnce();
        expect(disposeInteractiveContent.mock.calls[0][0][0]).toBe(first.content);
    });

    it("disposes its content when unmounted", () => {
        const { content } = renderBox();

        act(() => render(null, container));

        expect(content.isConnected).toBe(false);
        expect(disposeInteractiveContent.mock.calls.map(([ $content ]) => $content[0]))
            .toEqual([ content ]);
    });

    it("keeps the content of an expandable box hidden until its toggle opens it", () => {
        renderBox({ boxSize: "expandable" });
        const toggle = button("include-note-toggle");
        expect(contentBox().hidden).toBe(true);
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(Tooltip.getInstance(toggle)).toBeNull();

        expect(click(toggle).isStopped).toBe(true);
        expect(contentBox().hidden).toBe(false);
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(toggle.classList.contains("expanded")).toBe(true);

        click(toggle);
        expect(contentBox().hidden).toBe(true);
        expect(toggle.classList.contains("expanded")).toBe(false);

        act(() => render(null, container));
        renderBox({ boxSize: "full" });
        expect(contentBox().hidden).toBe(false);
    });

    it("opens the note in a new tab, and its context menu, from the title row", () => {
        renderBox({ notePath: "owner", viewScope: ATTACHMENT_SCOPE });
        const open = button("include-note-open");
        const menu = button("include-note-menu");
        expect(open.className).toContain("bx-link-external");
        expect(menu.className).toContain("bx-dots-vertical-rounded");
        expect(tooltipOf(open)).toBe("common.open_in_new_tab");
        expect(tooltipOf(menu)).toBe("common.more_actions");

        expect(click(open).isStopped).toBe(true);
        expect(openTabWithNoteWithHoisting).toHaveBeenCalledWith("owner", {
            viewScope: ATTACHMENT_SCOPE,
            activate: true,
            placement: "afterCurrent"
        });

        expect(click(menu).isStopped).toBe(true);
        expect(openContextMenu)
            .toHaveBeenCalledWith("owner", { below: menu }, ATTACHMENT_SCOPE);
    });

    it("marks an excerpt, with the icon of the button that opens the whole note", () => {
        renderBox({ viewScope: { block: "blockA:blockB" }, isExcerpt: true });
        const badge = container.querySelector<HTMLElement>(".include-note-badges > .excerpt-badge");
        expect(badge?.textContent).toBe("block_reference.excerpt");
        expect(titleRow()).toContain("include-note-badges");

        const tooltip = badge ? Tooltip.getInstance(badge) : null;
        act(() => tooltip?.show());
        const tooltipText = document.querySelector(".tooltip-inner");
        expect(tooltipText?.textContent?.trim()).toBe("block_reference.excerpt_description");
        expect(tooltipText?.querySelector(".bx.bx-link-external")).not.toBeNull();
        expect(button("include-note-open").className).toContain("bx-link-external");
        act(() => tooltip?.hide());

        for (const viewScope of [ undefined, ATTACHMENT_SCOPE ]) {
            act(() => render(null, container));
            renderBox({ viewScope });
            expect(container.querySelector(".excerpt-badge")).toBeNull();
        }
    });

    it("turns the editing of an excerpt on and off through the editor around it", async () => {
        const { editor, embed } = placeInHostEditor();
        const { content } = renderBox({ boxSize: "medium", isExcerpt: true });
        const edit = button("include-note-edit");
        expect(edit.className).toContain("bx-pencil");
        expect(tooltipOf(edit)).toBe("block_reference.edit_excerpt");
        expect(edit.disabled).toBe(true);

        let unregister = () => {};
        act(() => {
            unregister = registerContentEmbedTools(content, EDITABLE_TOOLS);
        });
        expect(edit.disabled).toBe(false);
        expect(edit.classList.contains("active")).toBe(false);

        expect(click(edit).isStopped).toBe(true);
        expect(editor.selectEmbedAt).toHaveBeenCalledWith(contentBox());
        expect(editor.execute).toHaveBeenCalledWith("toggleContentEmbedEditable");
        expect(document.activeElement).toBe(contentBox());

        await act(async () => {
            embed.dataset.editable = "true";
        });
        expect(edit.classList.contains("active")).toBe(true);
        click(edit);
        expect(editor.execute).toHaveBeenCalledTimes(2);
        expect(editor.focus).toHaveBeenCalledOnce();

        act(() => unregister());
        expect(edit.disabled).toBe(true);
        expect(edit.classList.contains("active")).toBe(false);
    });

    it("keeps the edit button of an excerpt disabled without an editor around it", () => {
        const { content } = renderBox({ boxSize: "medium", isExcerpt: true });
        act(() => {
            onTestFinished(registerContentEmbedTools(content, EDITABLE_TOOLS));
        });

        expect(button("include-note-edit").disabled).toBe(true);
    });

    it("opens an expandable excerpt to edit it, and focuses it once shown", () => {
        placeInHostEditor();
        const { content } = renderBox({ boxSize: "expandable", isExcerpt: true });
        act(() => {
            onTestFinished(registerContentEmbedTools(content, EDITABLE_TOOLS));
        });
        const box = contentBox();
        const isHiddenOnFocus: boolean[] = [];
        box.addEventListener("focus", () => isHiddenOnFocus.push(box.hasAttribute("hidden")));
        expect(box.hidden).toBe(true);

        click(button("include-note-edit"));

        expect(box.hidden).toBe(false);
        expect(document.activeElement).toBe(box);
        expect(isHiddenOnFocus).toEqual([ false ]);
    });

    it("gives its content the screen, and takes it back from the overlay button", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const exitFullscreen = vi.fn<() => Promise<void>>(async () => {});
        Object.defineProperty(document, "exitFullscreen", {
            value: exitFullscreen,
            configurable: true
        });
        renderBox({ boxSize: "medium" });
        const box = contentBox();
        box.requestFullscreen = vi.fn(async () => {});

        const fullscreen = button("include-note-fullscreen");
        expect(fullscreen.className).toContain("bx-fullscreen");
        expect(tooltipOf(fullscreen)).toBe("common.fullscreen");
        expect(click(fullscreen).isStopped).toBe(true);
        expect(box.requestFullscreen).toHaveBeenCalledOnce();

        const group = box.querySelector<HTMLElement>(
            ":scope > .include-note-fullscreen-controls > .tn-overlay-control-group"
        );
        const exit = group?.querySelector("button");
        expect(group?.classList.contains("include-note-exit-fullscreen")).toBe(true);
        expect(group?.dataset.placement).toBe("top-end");
        expect(exit?.textContent).toBe("common.exit_fullscreen");
        expect(exit?.querySelector(".bx.bx-exit")).not.toBeNull();
        if (!exit) return;
        expect(click(exit).isStopped).toBe(true);
        expect(exitFullscreen).toHaveBeenCalledOnce();

        // Refused requests are logged rather than left unhandled.
        box.requestFullscreen = vi.fn(async () => {
            throw new Error("Denied");
        });
        exitFullscreen.mockRejectedValueOnce(new Error("Not in fullscreen"));
        click(fullscreen);
        click(exit);
        await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));

        warn.mockRestore();
        Reflect.deleteProperty(document, "exitFullscreen");
    });

    it("tells its content when its fullscreen changes, and once it took the new size", () => {
        const observers: { callback: (entries: unknown[]) => void; isObserving: boolean }[] = [];
        vi.stubGlobal("ResizeObserver", class {
            private readonly entry;

            constructor(callback: (entries: unknown[]) => void) {
                this.entry = { callback, isObserving: false };
                observers.push(this.entry);
            }

            observe() {
                this.entry.isObserving = true;
            }

            disconnect() {
                this.entry.isObserving = false;
            }
        });
        const resize = () => {
            for (const observer of observers.filter((entry) => entry.isObserving)) {
                observer.callback([]);
            }
        };
        const setFullscreenElement = (element: Element | null) => {
            Object.defineProperty(document, "fullscreenElement", {
                value: element,
                configurable: true
            });
            document.dispatchEvent(new Event("fullscreenchange"));
        };
        renderBox({ boxSize: "medium" });
        const box = contentBox();
        const events: string[] = [];
        const listener = (event: Event) => events.push(`${event.type}:${event.target === box}`);
        const names = [ "fullscreenChangeStart", "enterFullscreen", "leaveFullscreen" ];
        for (const name of names) {
            document.addEventListener(name, listener);
        }

        setFullscreenElement(box);
        expect(events).toEqual([ "fullscreenChangeStart:true" ]);
        resize();
        resize();
        expect(events).toEqual([ "fullscreenChangeStart:true", "enterFullscreen:true" ]);

        setFullscreenElement(null);
        resize();
        expect(events.slice(2)).toEqual([ "fullscreenChangeStart:true", "leaveFullscreen:true" ]);

        // Another element in fullscreen leaves the box as it is.
        setFullscreenElement(document.body);
        resize();
        expect(events).toHaveLength(4);

        for (const name of names) {
            document.removeEventListener(name, listener);
        }
        Reflect.deleteProperty(document, "fullscreenElement");
        vi.unstubAllGlobals();
    });

    it("opens its menu on a right click on the title row, leaving the title link its own", () => {
        renderBox({ notePath: "owner", viewScope: ATTACHMENT_SCOPE });
        const row = container.querySelector(".include-note-title-row");

        for (const target of [ row, row?.querySelector("h4"), button("include-note-open") ]) {
            expect(rightClick(target ?? null)).toEqual({ opened: true, isTaken: true });
            expect(openContextMenu.mock.calls[0][2]).toEqual(ATTACHMENT_SCOPE);
        }

        // The title link opens the same menu, and a quick edit with Ctrl, through `link.ts`.
        expect(rightClick(row?.querySelector("a") ?? null))
            .toEqual({ opened: false, isTaken: false });
    });

    it("leaves the fullscreen controls out of a box that offers no fullscreen", () => {
        renderBox({ boxSize: "small" });
        expect(container.querySelector(".include-note-fullscreen-controls")).toBeNull();
    });

    it("keeps its content behind a backdrop until a click on it focuses what is under it", async () => {
        const content = element(
            `<div class="rendered-content"><p>body</p><div tabindex="0"><img></div></div>`
        );
        renderBox({ content });
        const box = contentBox();
        const text = content.querySelector("p");
        const viewer = content.querySelector<HTMLElement>("[tabindex]");
        const image = content.querySelector("img");
        const isActive = () => box.parentElement?.classList.contains("active");
        const backdrop = () => container.querySelector<HTMLElement>(
            ".include-note-body > .include-note-content + .include-note-backdrop"
        );
        const firstBackdrop = backdrop();
        expect(firstBackdrop).not.toBeNull();
        expect(box.tabIndex).toBe(-1);
        expect(isActive()).toBe(false);
        if (!firstBackdrop || !text || !viewer || !image) return;

        // What takes the focus under the pointer gets it, as it would from a click on it.
        const elementsFromPoint = stubElementsFromPoint([ firstBackdrop, image, viewer, box ]);
        act(() => {
            firstBackdrop.dispatchEvent(new MouseEvent("click", { clientX: 40, clientY: 30 }));
        });
        expect(elementsFromPoint).toHaveBeenCalledWith(40, 30);
        expect(document.activeElement).toBe(viewer);
        expect(backdrop()).toBeNull();
        expect(isActive()).toBe(true);

        act(() => viewer.blur());
        await vi.waitFor(() => expect(backdrop()).not.toBeNull());
        expect(isActive()).toBe(false);

        // Over text, the content box takes it.
        const secondBackdrop = backdrop();
        if (!secondBackdrop) return;
        stubElementsFromPoint([ secondBackdrop, text, box ]);
        click(secondBackdrop);
        expect(document.activeElement).toBe(box);
        expect(isActive()).toBe(true);
    });

    it("runs the window shortcuts from its content, whose keys the editor keeps to itself", async () => {
        renderBox();
        const box = contentBox();
        expect(setupWindowShortcutsForElement).toHaveBeenCalledOnce();
        expect(setupWindowShortcutsForElement.mock.calls[0][0][0]).toBe(box);

        await act(async () => render(null, container));
        await vi.waitFor(() => {
            expect(removeIndividualBinding).toHaveBeenCalledWith({ shortcut: "ctrl+j" });
        });
    });

    it("lets a drag reach its content, with the backdrop back once the drag leaves or ends", () => {
        renderBox();
        const box = contentBox();
        const body = box.parentElement;
        const backdrop = () => container.querySelector<HTMLElement>(".include-note-backdrop");
        if (!body) throw new Error("Expected the body of the embed.");
        body.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
        const drag = (target: EventTarget, type: string, clientX = 50) => act(() => {
            target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY: 50 }));
        });

        const firstBackdrop = backdrop();
        expect(firstBackdrop).not.toBeNull();
        if (!firstBackdrop) return;
        drag(firstBackdrop, "dragenter");
        expect(backdrop()).toBeNull();
        // Moving between the elements of the content keeps the drag inside.
        drag(box, "dragleave");
        expect(backdrop()).toBeNull();
        drag(box, "dragleave", 150);
        expect(backdrop()).not.toBeNull();

        for (const [ target, end ] of [ [ box, "drop" ], [ document, "dragend" ] ] as const) {
            const shown = backdrop();
            if (!shown) return;
            drag(shown, "dragenter");
            expect(backdrop()).toBeNull();
            drag(target, end);
            expect(backdrop()).not.toBeNull();
        }
    });
});

describe("ContentEmbed focused on mount", () => {
    it("gives the focus to the first focusable element of its content, or to the box", () => {
        const content = element(
            `<div class="rendered-content"><p>body</p><div tabindex="0"></div></div>`
        );
        renderBox({ content, isFocusedOnMount: true });
        expect(document.activeElement).toBe(content.querySelector("[tabindex]"));
        expect(contentBox().parentElement?.classList.contains("active")).toBe(true);

        act(() => render(null, container));
        renderBox({ isFocusedOnMount: true });
        expect(document.activeElement).toBe(contentBox());
    });

    it("leaves the focus where it went when it left the editor before the box mounted", () => {
        const editable = element(`<div class="ck-editor__editable" tabindex="0"></div>`);
        const field = element(`<input>`);
        document.body.append(editable, field);
        editable.append(container);

        field.focus();
        const firstContent = element(`<div><div tabindex="0"></div></div>`);
        renderBox({ content: firstContent, isFocusedOnMount: true });
        expect(document.activeElement).toBe(field);

        act(() => render(null, container));
        editable.focus();
        const content = element(`<div><div tabindex="0"></div></div>`);
        renderBox({ content, isFocusedOnMount: true });
        expect(document.activeElement).toBe(content.querySelector("[tabindex]"));

        editable.remove();
        field.remove();
    });

    it("leaves the focus where it is by default", () => {
        const content = element(`<div class="rendered-content"><div tabindex="0"></div></div>`);
        renderBox({ content });
        expect(document.activeElement).toBe(document.body);
    });
});

describe("TinyContentEmbed", () => {
    it("lays out a single row: icon, title and description, actions, menu", () => {
        const run = vi.fn();
        const { title } = renderTinyBox({
            icon: "bx bx-file",
            description: "2 KiB",
            notePath: "owner",
            viewScope: ATTACHMENT_SCOPE,
            actions: [
                { title: "Download", icon: "bx bx-download", run },
                { title: "Other", icon: "bx bx-cog", run: vi.fn() }
            ]
        });

        expect(titleRow()).toEqual([
            "include-note-icon", "include-note-heading",
            "include-note-action", "include-note-action", "include-note-menu"
        ]);
        expect(container.querySelector(".include-note-content")).toBeNull();
        expect(container.querySelector(".include-note-icon")?.className).toContain("bx-file");
        expect([ ...container.querySelector("h4.include-note-title")?.childNodes ?? [] ])
            .toEqual([ title ]);
        expect(container.querySelector(".include-note-heading > small.include-note-description")
            ?.textContent).toBe("2 KiB");

        const download = container.querySelector<HTMLButtonElement>("button.include-note-action");
        expect(download?.className).toContain("bx-download");
        if (!download) return;
        expect(tooltipOf(download)).toBe("Download");
        expect(click(download).isStopped).toBe(true);
        expect(run).toHaveBeenCalledOnce();

        const menu = button("include-note-menu");
        expect(click(menu).isStopped).toBe(true);
        expect(openContextMenu)
            .toHaveBeenCalledWith("owner", { below: menu }, ATTACHMENT_SCOPE);
    });

    it("opens its menu on a right click on the row, leaving the title link its own", () => {
        renderTinyBox({ notePath: "owner", viewScope: ATTACHMENT_SCOPE });
        const row = container.querySelector(".include-note-title-row");

        expect(rightClick(row?.querySelector(".include-note-icon") ?? null))
            .toEqual({ opened: true, isTaken: true });
        expect(openContextMenu.mock.calls[0][0]).toBe("owner");
        expect(rightClick(row?.querySelector("a") ?? null))
            .toEqual({ opened: false, isTaken: false });
    });

    it("leaves out the description line when there is none", () => {
        renderTinyBox();
        expect(container.querySelector(".include-note-description")).toBeNull();
    });
});

describe("getNoteActions", () => {
    it("quick edits the note, or opens it in a new tab", async () => {
        const [ quickEdit, open ] = getNoteActions("noteA");
        expect([ quickEdit.title, quickEdit.icon ])
            .toEqual([ "link_context_menu.open_note_in_popup", "bx bx-edit" ]);
        expect([ open.title, open.icon ])
            .toEqual([ "common.open_in_new_tab", "bx bx-link-external" ]);

        await quickEdit.run();
        expect(triggerCommand).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "noteA" });

        await open.run();
        expect(openTabWithNoteWithHoisting).toHaveBeenCalledWith("noteA", {
            viewScope: undefined,
            activate: true,
            placement: "afterCurrent"
        });
    });
});
