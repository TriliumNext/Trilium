import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { attachmentIcon } from "@triliumnext/commons";
import type { VNode } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";

vi.mock("../../../services/froca", () => ({
    default: { getNote: vi.fn(), getAttachment: vi.fn() }
}));
vi.mock("../../../services/link", () => ({
    default: { createLink: vi.fn() }
}));
vi.mock("../../../services/content_renderer", () => ({
    default: {
        getRenderedContent: vi.fn(),
        disposeInteractiveContent: vi.fn(),
        mountInteractiveWidget: vi.fn()
    }
}));
vi.mock("./ContentEmbed", () => ({
    default: () => null,
    TinyContentEmbed: () => null,
    getNoteActions: vi.fn()
}));
vi.mock("../../../services/attachment_actions", () => ({
    getOpenExternallyAction: vi.fn(),
    getDownloadAction: vi.fn()
}));
vi.mock("../../../menus/link_context_menu", () => ({
    default: {
        openContextMenu: vi.fn(),
        getOriginBelow: vi.fn((anchor: Element, target: Element) => ({ anchor, target }))
    }
}));

import linkContextMenu from "../../../menus/link_context_menu";
import { getDownloadAction, getOpenExternallyAction } from "../../../services/attachment_actions";
import content_renderer from "../../../services/content_renderer";
import froca from "../../../services/froca";
import link from "../../../services/link";
import { registerContentEmbedTools } from "./content_embed_tools";
import ContentEmbed, {
    getNoteActions,
    type ContentEmbedAction,
    type ContentEmbedProps,
    TinyContentEmbed,
    type TinyContentEmbedProps
} from "./ContentEmbed";
import {
    getAttachmentHref,
    loadEmbeddedAttachment,
    loadEmbeddedNote,
    openContentEmbedMenu,
    refreshEmbeddedNote,
    watchContentEmbeds
} from "./utils";

const note = { noteId: "noteY", getIcon: () => "bx bx-note" } as unknown as FNote;
const attachment = {
    attachmentId: "att1",
    ownerId: "owner",
    role: "file",
    mime: "application/pdf",
    contentLength: 2048
} as unknown as FAttachment;
const ATTACHMENT_SCOPE = { viewMode: "attachments", attachmentId: "att1" };

let title: HTMLElement;
let content: HTMLElement;

beforeEach(() => {
    vi.clearAllMocks();
    title = document.createElement("span");
    content = document.createElement("div");
    vi.mocked(froca.getNote).mockResolvedValue(note);
    vi.mocked(froca.getAttachment).mockResolvedValue(attachment);
    vi.mocked(link.createLink).mockResolvedValue($(title));
    vi.mocked(content_renderer.getRenderedContent)
        .mockResolvedValue({ $renderedContent: $(content), type: "pdf" } as never);
});

function action(title: string): ContentEmbedAction {
    return { title, icon: `bx bx-${title}`, run: vi.fn() };
}

/** The embed box mounted last, and the element it was mounted in. */
function lastMount() {
    const call = vi.mocked(content_renderer.mountInteractiveWidget).mock.lastCall;
    if (!call) {
        throw new Error("Expected a mounted embed box.");
    }
    const vnode = call[0] as VNode<ContentEmbedProps & TinyContentEmbedProps>;
    return { type: vnode.type, props: vnode.props, container: call[1] };
}

afterEach(() => {
    document.body.replaceChildren();
});

/** Puts `element` in the page, where the embeds that load are. */
function inPage<T extends HTMLElement>(element: T) {
    document.body.append(element);
    return element;
}

function createWrapper() {
    const wrapper = inPage(document.createElement("div"));
    wrapper.className = "include-note-wrapper";
    return wrapper;
}

describe("loadEmbeddedNote", () => {
    it("mounts a box with the note, its own embeds reduced to reference links", async () => {
        const wrapper = createWrapper();

        await loadEmbeddedNote("noteY", $(wrapper), "medium");

        expect(link.createLink).toHaveBeenCalledWith("noteY", {
            showTooltip: false,
            showNoteIcon: true
        });
        expect(content_renderer.getRenderedContent).toHaveBeenCalledWith(note, {
            interactive: true,
            embedsAsReferenceLinks: true,
            mediaEnvironment: "embedded"
        });
        const mount = lastMount();
        expect(mount.type).toBe(ContentEmbed);
        expect(mount.container).toBe(wrapper);
        expect(mount.props).toEqual({
            boxSize: "medium",
            title,
            content,
            contentType: "pdf",
            notePath: "noteY"
        });
    });

    it("leaves the box alone for a note that no longer exists", async () => {
        vi.mocked(froca.getNote).mockResolvedValue(null);

        await loadEmbeddedNote("noteY", $(createWrapper()), "small");

        expect(link.createLink).not.toHaveBeenCalled();
        expect(content_renderer.mountInteractiveWidget).not.toHaveBeenCalled();
    });

    it("mounts a tiny box with the note's path, without the note or a caption", async () => {
        const actions = [ action("edit"), action("open") ];
        vi.mocked(getNoteActions).mockReturnValue(actions);
        const figure = inPage(document.createElement("figure"));
        figure.className = "include-note";
        figure.dataset.boxSize = "tiny";
        figure.innerHTML = "<figcaption>Caption</figcaption>";

        await loadEmbeddedNote("noteY", $(figure));

        expect(link.createLink).toHaveBeenCalledWith("noteY", {
            showTooltip: false,
            showNotePath: true
        });
        expect(content_renderer.getRenderedContent).not.toHaveBeenCalled();
        expect(getNoteActions).toHaveBeenCalledWith("noteY");
        const mount = lastMount();
        expect(mount.type).toBe(TinyContentEmbed);
        expect([ ...figure.childNodes ]).toEqual([ mount.container ]);
        expect(mount.props).toEqual({
            icon: "bx bx-note",
            title,
            notePath: "noteY",
            actions
        });
    });
});

describe("loadEmbeddedAttachment", () => {
    it("mounts a box with the attachment, opened in its note", async () => {
        const wrapper = createWrapper();

        await loadEmbeddedAttachment("att1", $(wrapper), "full");

        expect(froca.getAttachment).toHaveBeenCalledWith("att1", true);
        expect(link.createLink).toHaveBeenCalledWith("owner", {
            showTooltip: false,
            showNoteIcon: true,
            viewScope: ATTACHMENT_SCOPE
        });
        expect(content_renderer.getRenderedContent)
            .toHaveBeenCalledWith(attachment, { interactive: true, mediaEnvironment: "embedded" });
        const mount = lastMount();
        expect(mount.type).toBe(ContentEmbed);
        expect(mount.container).toBe(wrapper);
        expect(mount.props).toEqual({
            boxSize: "full",
            title,
            content,
            contentType: "pdf",
            notePath: "owner",
            viewScope: ATTACHMENT_SCOPE
        });
    });

    it("passes the attachment editor to the renderer, and the focus to the box", async () => {
        const attachmentEditor = { canEdit: vi.fn() } as never;

        await loadEmbeddedAttachment("att1", $(createWrapper()), "medium", {
            attachmentEditor,
            isFocused: true
        });

        expect(content_renderer.getRenderedContent).toHaveBeenCalledWith(attachment, {
            interactive: true,
            mediaEnvironment: "embedded",
            attachmentEditor
        });
        expect(lastMount().props).toMatchObject({ isFocusedOnMount: true });
    });

    it("leaves the box alone for a deleted attachment", async () => {
        vi.mocked(froca.getAttachment).mockResolvedValue(null);

        await loadEmbeddedAttachment("att1", $(createWrapper()), "small");

        expect(link.createLink).not.toHaveBeenCalled();
        expect(content_renderer.mountInteractiveWidget).not.toHaveBeenCalled();
    });

    it("mounts a tiny box with the size of the attachment, and its file actions", async () => {
        const [ openExternally, download ] = [ action("open-externally"), action("download") ];
        vi.mocked(getOpenExternallyAction).mockReturnValue(openExternally);
        vi.mocked(getDownloadAction).mockReturnValue(download);
        const wrapper = createWrapper();

        await loadEmbeddedAttachment("att1", $(wrapper), "tiny");

        expect(link.createLink).toHaveBeenCalledWith("owner", {
            showTooltip: false,
            viewScope: ATTACHMENT_SCOPE
        });
        expect(content_renderer.getRenderedContent).not.toHaveBeenCalled();
        expect(getOpenExternallyAction).toHaveBeenCalledWith(attachment);
        expect(getDownloadAction).toHaveBeenCalledWith(attachment);
        const mount = lastMount();
        expect(mount.type).toBe(TinyContentEmbed);
        expect(mount.container).toBe(wrapper);
        expect(mount.props).toEqual({
            icon: attachmentIcon("file", "application/pdf"),
            title,
            description: "2 KiB",
            notePath: "owner",
            viewScope: ATTACHMENT_SCOPE,
            actions: [ openExternally, download ]
        });
    });
});

describe("the element an embed box is mounted in", () => {
    it("is a wrapper created in a read-only embed ahead of its caption", async () => {
        const figure = inPage(document.createElement("figure"));
        figure.className = "include-note";
        figure.dataset.boxSize = "expandable";
        figure.innerHTML = "&nbsp;<figcaption>Caption</figcaption>";
        const caption = figure.querySelector("figcaption");

        await loadEmbeddedNote("noteY", $(figure));

        const { container, props } = lastMount();
        expect(caption).not.toBeNull();
        expect([ ...figure.childNodes ]).toEqual([ container, caption ]);
        expect(container.className).toBe("include-note-wrapper");
        expect(props.boxSize).toBe("expandable");

        // Loading again, as a refresh does, reuses the wrapper.
        await loadEmbeddedNote("noteY", $(figure), "small");
        expect(lastMount().container).toBe(container);
        expect(lastMount().props.boxSize).toBe("small");
    });

    it("is a wrapper created in a legacy <section> embed", async () => {
        const section = inPage(document.createElement("section"));
        section.className = "include-note";
        section.dataset.boxSize = "medium";

        await loadEmbeddedNote("noteY", $(section));

        expect([ ...section.childNodes ]).toEqual([ lastMount().container ]);
        expect(lastMount().props.boxSize).toBe("medium");
    });

    it("is the wrapper an editor embed holds, leaving the editor's own elements", async () => {
        const figure = inPage(document.createElement("figure"));
        figure.className = "include-note ck-widget";
        figure.dataset.boxSize = "full";
        const wrapper = createWrapper();
        const caption = document.createElement("figcaption");
        const typeAround = document.createElement("div");
        figure.append(wrapper, caption, typeAround);

        await loadEmbeddedAttachment("att1", $(figure));

        expect(lastMount().container).toBe(wrapper);
        expect(lastMount().props.boxSize).toBe("full");
        expect([ ...figure.children ]).toEqual([ wrapper, caption, typeAround ]);
    });
});

describe("an embed that leaves the page while it loads", () => {
    it("gets no box, and the content rendered for it is disposed", async () => {
        const loads: [ (wrapper: HTMLElement) => Promise<void>, boolean ][] = [
            [ (wrapper) => loadEmbeddedNote("noteY", $(wrapper), "medium"), true ],
            [ (wrapper) => loadEmbeddedNote("noteY", $(wrapper), "tiny"), false ],
            [ (wrapper) => loadEmbeddedAttachment("att1", $(wrapper), "full"), true ],
            [ (wrapper) => loadEmbeddedAttachment("att1", $(wrapper), "tiny"), false ]
        ];

        for (const [ load, rendersContent ] of loads) {
            vi.mocked(content_renderer.mountInteractiveWidget).mockClear();
            vi.mocked(content_renderer.disposeInteractiveContent).mockClear();
            const wrapper = createWrapper();
            vi.mocked(link.createLink).mockImplementation(async () => {
                wrapper.remove();
                return $(title);
            });

            await load(wrapper);

            expect(content_renderer.mountInteractiveWidget).not.toHaveBeenCalled();
            expect(vi.mocked(content_renderer.disposeInteractiveContent).mock.calls
                .map(([ $element ]) => $element[0])).toEqual(rendersContent ? [ content ] : []);
        }
    });
});

describe("refreshEmbeddedNote", () => {
    it("reloads every embed of the note, of either element", async () => {
        const container = inPage(document.createElement("div"));
        container.innerHTML = `<figure class="include-note" data-note-id="noteY"></figure>`
            + `<section class="include-note" data-note-id="noteY"></section>`
            + `<figure class="include-note" data-note-id="other"></figure>`;
        const [ figure, section ] = [ ...container.children ];

        refreshEmbeddedNote(container, "noteY");

        await vi.waitFor(() => {
            expect(content_renderer.mountInteractiveWidget).toHaveBeenCalledTimes(2);
        });
        const mountedIn = vi.mocked(content_renderer.mountInteractiveWidget).mock.calls
            .map(([ , wrapper ]) => wrapper.parentElement);
        expect(mountedIn).toEqual([ figure, section ]);
    });
});

describe("watchContentEmbeds", () => {
    let container: HTMLElement;
    const update = vi.fn();
    const editor = { ui: { update } } as unknown as CKTextEditor;

    beforeEach(() => {
        container = document.createElement("div");
        container.innerHTML = `<p>text</p><figure class="include-note"></figure>`
            + `<blockquote><figure class="include-note"></figure></blockquote>`;
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function disposed() {
        return vi.mocked(content_renderer.disposeInteractiveContent).mock.calls
            .map(([ $element ]) => $element[0]);
    }

    function flush() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    it("unmounts what is removed from the container, but not what is moved within it", async () => {
        const stop = watchContentEmbeds(container);
        const [ paragraph, embed, quote ] = [ ...container.children ];

        embed.remove();
        quote.remove();
        container.append(quote);
        paragraph.firstChild?.remove();
        await flush();

        expect(disposed()).toEqual([ embed ]);
        stop();
    });

    it("unmounts what is left on stop, and stops watching", async () => {
        const stop = watchContentEmbeds(container);
        const embed = container.querySelector("figure");
        embed?.remove();

        stop();
        expect(disposed()).toEqual([ embed, container ]);

        container.querySelector("blockquote")?.remove();
        await flush();
        expect(disposed()).toHaveLength(2);
    });

    it("updates the editor when content in an embed adds buttons to its toolbar", () => {
        const provider = { getTools: () => [], execute: vi.fn(), subscribe: () => () => {} };
        const [ inside, outside ] = [ container, document.body ].map((parent) => {
            const element = document.createElement("div");
            parent.append(element);
            return element;
        });
        update.mockClear();
        const stop = watchContentEmbeds(container, editor);

        const unregister = [ registerContentEmbedTools(inside, provider) ];
        expect(update).toHaveBeenCalledTimes(1);
        unregister.push(registerContentEmbedTools(outside, provider));
        stop();
        unregister.push(registerContentEmbedTools(inside, provider));
        expect(update).toHaveBeenCalledTimes(1);

        for (const stopRegistration of unregister) {
            stopRegistration();
        }
        outside.remove();
    });
});

describe("openContentEmbedMenu", () => {
    it("opens the menu of the note or attachment an embed shows, below the anchor", async () => {
        const anchor = document.createElement("button");
        const noteEmbed = inPage(document.createElement("figure"));
        noteEmbed.dataset.noteId = "noteY";
        const embed = inPage(document.createElement("figure"));
        embed.dataset.attachmentId = "att1";

        await openContentEmbedMenu(noteEmbed, anchor);
        await openContentEmbedMenu(embed, anchor);

        expect(vi.mocked(linkContextMenu.openContextMenu).mock.calls).toEqual([
            [ "noteY", { anchor, target: noteEmbed }, {} ],
            [ "owner", { anchor, target: embed }, ATTACHMENT_SCOPE ]
        ]);
    });

    it("opens nothing for an embed of a deleted attachment, or of nothing", async () => {
        vi.mocked(froca.getAttachment).mockResolvedValue(null);
        const embed = inPage(document.createElement("figure"));
        embed.dataset.attachmentId = "att1";

        await openContentEmbedMenu(embed, document.createElement("button"));
        await openContentEmbedMenu(inPage(document.createElement("figure")), document.createElement("button"));

        expect(linkContextMenu.openContextMenu).not.toHaveBeenCalled();
    });
});

describe("getAttachmentHref", () => {
    it("links to the attachment in its note, or to nothing once it is deleted", async () => {
        vi.mocked(froca.getAttachment)
            .mockResolvedValueOnce({ ownerId: "owner" } as unknown as FAttachment)
            .mockResolvedValueOnce(null);

        expect(await getAttachmentHref("att1"))
            .toBe("#root/owner?viewMode=attachments&attachmentId=att1");
        expect(await getAttachmentHref("att1")).toBeNull();
    });
});
