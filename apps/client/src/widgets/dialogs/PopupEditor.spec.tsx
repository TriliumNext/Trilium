import { type ComponentChildren, render, type RefObject } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";
import type { ViewScope } from "../../services/link";

const mocks = vi.hoisted(() => ({
    triggerCommand: vi.fn(),
    openInNewTab: vi.fn(),
    openContextWithNote: vi.fn(),
    getNote: vi.fn(),
    getAttachment: vi.fn(),
    /** Every context the popup created, newest last — one is built per open. */
    contexts: [] as { setNote: ReturnType<typeof vi.fn>, viewScope?: ViewScope, noteId: string }[],
    isMobile: vi.fn(() => false)
}));

vi.mock("../../components/app_context", () => ({
    default: {
        triggerCommand: mocks.triggerCommand,
        tabManager: {
            openInNewTab: mocks.openInNewTab,
            openContextWithNote: mocks.openContextWithNote
        }
    }
}));

// A real NoteContext would drag in the whole tab/froca stack; the popup only ever builds one,
// points it at a note and reads back what it resolved.
vi.mock("../../components/note_context", () => ({
    default: class {
        ntxId: string;
        noteId = "n1";
        hoistedNoteId = "root";
        viewScope: ViewScope | undefined;
        note = undefined;
        triggerEvent = vi.fn();
        setNote = vi.fn(async (_notePath: string, opts?: { viewScope?: ViewScope }) => {
            this.viewScope = opts?.viewScope;
        });

        constructor(ntxId: string) {
            this.ntxId = ntxId;
            mocks.contexts.push(this);
        }
    }
}));

vi.mock("../../services/froca", () => ({
    default: { getNote: mocks.getNote, getAttachment: mocks.getAttachment }
}));

vi.mock("../../services/tree", () => ({
    default: {
        getNoteIdAndParentIdFromUrl: (url: string) => ({ noteId: url.split("/").at(-1) }),
        // Read by link.ts when the popup resolves a link clicked inside itself.
        getNoteIdFromUrl: (url: string) => url.split("/").at(-1)
    }
}));

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

// Keep the rest of `utils` real: it is loaded by half the client stack (e.g. keyboard_actions),
// and only the platform check decides anything here.
vi.mock("../../services/utils", async (importActual) => {
    const actual = await importActual<typeof import("../../services/utils")>();
    return { ...actual, default: { ...actual.default, isMobile: mocks.isMobile } };
});

vi.mock("../../services/experimental_features", () => ({ isExperimentalFeatureEnabled: () => false }));

// The modal itself is Bootstrap-driven; the popup's own state is what it hands over.
interface ModalStubProps {
    title?: ComponentChildren;
    children?: ComponentChildren;
    show?: boolean;
    customTitleBarButtons?: { onClick: () => void }[];
    modalRef?: RefObject<HTMLDivElement>;
    onShown?: () => void;
    onHidden?: () => void;
}

vi.mock("../react/Modal", () => ({
    default: ({ title, children, show, customTitleBarButtons, modalRef, onShown, onHidden }: ModalStubProps) => (
        <div ref={modalRef} className="modal-stub" data-shown={String(!!show)}>
            <button
                className="maximize-stub"
                onClick={() => customTitleBarButtons?.[0]?.onClick()}
            />
            {/* Bootstrap's own lifecycle, which the stub leaves to the test to drive. */}
            <button className="shown-stub" onClick={() => onShown?.()} />
            <button className="hidden-stub" onClick={() => onHidden?.()} />
            {title}
            {children}
        </div>
    )
}));

// The popup's body: each is exercised by its own spec, and none of it decides what the popup shows.
vi.mock("../NoteDetail", () => ({ default: () => <div className="note-detail-stub" /> }));
vi.mock("../collections/NoteList", () => ({ default: () => null }));
vi.mock("../FloatingButtons", () => ({ default: () => null }));
vi.mock("../FloatingButtonsDefinitions", () => ({
    DESKTOP_FLOATING_BUTTONS: [ "kept", "hidden" ],
    POPUP_HIDDEN_FLOATING_BUTTONS: [ "hidden" ]
}));
vi.mock("../PromotedAttributes", () => ({ default: () => null }));
vi.mock("../ReadOnlyNoteInfoBar", () => ({ default: () => null }));
vi.mock("../layout/NoteBadges", () => ({ default: () => null }));
vi.mock("../ribbon/components/StandaloneRibbonAdapter", () => ({ default: () => null }));
vi.mock("../ribbon/FormattingToolbar", () => ({ default: () => null, showFormattingToolbar: () => false }));
vi.mock("../type_widgets/text/mobile_editor_toolbar", () => ({ default: () => <div className="mobile-toolbar-stub" /> }));
vi.mock("../note_icon", () => ({ default: () => <div className="note-icon-stub" /> }));
vi.mock("../note_title", () => ({ default: () => <div className="note-title-stub" /> }));

import Component from "../../components/component";
import { ParentComponent } from "../react/react_utils";
import PopupEditor from "./PopupEditor";

const ATTACHMENT_SCOPE: ViewScope = { viewMode: "attachments", attachmentId: "att-1" };
/** A view mode of the note itself, as the sidebar's note map card expands into the popup with. */
const NOTE_MAP_SCOPE: ViewScope = { viewMode: "note-map" };

function fakeNote(labels: string[] = [], isOptions = false) {
    return {
        noteId: "n1",
        isOptions: () => isOptions,
        hasLabel: (name: string) => labels.includes(name)
    } as unknown as FNote;
}

let container: HTMLDivElement;
let parent: Component;

async function openPopup(data: { noteIdOrPath: string, viewScope?: ViewScope }) {
    await act(async () => {
        await parent.handleEvent("openInPopup", data as never);
    });
}

/** An entity reload naming one attachment. Other row kinds are read by the dialog's own hooks. */
async function attachmentsReloaded(attachmentId: string) {
    await act(async () => {
        await parent.handleEvent("entitiesReloaded", {
            loadResults: {
                getAttachmentRows: () => [ { attachmentId } ],
                getAttributeRows: () => []
            }
        } as never);
    });
}

/** The context the popup built for the current open. */
function lastContext() {
    const context = mocks.contexts.at(-1);
    expect(context).toBeDefined();
    return context;
}

/** A left click on a link rendered inside the popup, which the dialog handles itself. */
function clickLink(href: string) {
    const link = modal()?.appendChild(document.createElement("a"));
    link?.setAttribute("href", href);
    act(() => {
        link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    link?.remove();
}

function modal() {
    const el = container.querySelector<HTMLElement>(".modal-stub");
    expect(el).not.toBeNull();
    return el;
}

beforeEach(async () => {
    vi.clearAllMocks();
    mocks.contexts = [];
    mocks.isMobile.mockReturnValue(false);
    mocks.getNote.mockResolvedValue(fakeNote());
    mocks.getAttachment.mockResolvedValue({ title: "diagram.png" });

    parent = new Component();
    container = document.body.appendChild(document.createElement("div"));
    await act(async () => {
        render(
            <ParentComponent.Provider value={parent}>
                <PopupEditor />
            </ParentComponent.Provider>,
            container
        );
    });

    // The popup builds an empty context up front to render against; only the ones an open creates
    // are of interest here.
    mocks.contexts = [];
});

afterEach(() => {
    render(null, container);
    container.remove();
    document.body.className = "";
});

describe("PopupEditor", () => {
    it("opens a note editable, unless the user made it read-only themselves", async () => {
        await openPopup({ noteIdOrPath: "root/n1" });

        expect(lastContext()?.setNote).toHaveBeenCalledWith("root/n1", {
            viewScope: { readOnlyTemporarilyDisabled: true },
            keepActiveDialog: true
        });
        expect(modal()?.dataset.shown).toBe("true");
        expect(document.body.classList.contains("popup-editor-open")).toBe(true);

        mocks.getNote.mockResolvedValue(fakeNote([ "readOnly" ]));
        await openPopup({ noteIdOrPath: "root/n2" });
        expect(lastContext()?.setNote).toHaveBeenCalledWith("root/n2", {
            viewScope: { readOnlyTemporarilyDisabled: false },
            keepActiveDialog: true
        });
    });

    it("shows the attachment a view scope names, with its own read-only title", async () => {
        await openPopup({ noteIdOrPath: "root/n1", viewScope: ATTACHMENT_SCOPE });

        // The caller's scope decides what is displayed; the popup's own editability default stays
        // underneath it rather than overwriting it.
        expect(lastContext()?.setNote).toHaveBeenCalledWith("root/n1", {
            viewScope: { readOnlyTemporarilyDisabled: true, ...ATTACHMENT_SCOPE },
            keepActiveDialog: true
        });

        await vi.waitFor(() => {
            expect(container.querySelector(".attachment-title")?.textContent)
                .toBe("popup-editor.attachment_title");
        });
        expect(mocks.getAttachment).toHaveBeenCalledWith("att-1");
        // The note's own header is what an attachment replaces: no icon picker, no editable title.
        expect(container.querySelector(".note-icon-stub")).toBeNull();
        expect(container.querySelector(".note-title-stub")).toBeNull();
    });

    it("keeps a note's own header when no attachment is in view", async () => {
        await openPopup({ noteIdOrPath: "root/n1" });

        expect(container.querySelector(".note-icon-stub")).not.toBeNull();
        expect(container.querySelector(".note-title-stub")).not.toBeNull();
        expect(container.querySelector(".attachment-title")).toBeNull();
    });

    it("re-reads the attachment title when it is renamed while the popup is open", async () => {
        await openPopup({ noteIdOrPath: "root/n1", viewScope: ATTACHMENT_SCOPE });
        await vi.waitFor(() => expect(mocks.getAttachment).toHaveBeenCalledTimes(1));

        await attachmentsReloaded("att-1");
        expect(mocks.getAttachment).toHaveBeenCalledTimes(2);

        // Another attachment's change is none of this popup's business.
        await attachmentsReloaded("att-other");
        expect(mocks.getAttachment).toHaveBeenCalledTimes(2);
    });

    it("sends settings pages to their own dialog instead of opening the popup", async () => {
        mocks.getNote.mockResolvedValue(fakeNote([], true));
        await openPopup({ noteIdOrPath: "root/_optionsAppearance" });

        expect(mocks.triggerCommand).toHaveBeenCalledWith("showOptions", { section: "_optionsAppearance" });
        expect(mocks.contexts).toHaveLength(0);
        expect(modal()?.dataset.shown).toBe("false");
    });

    it("opens nothing for a path with no note, or a note that no longer exists", async () => {
        await openPopup({ noteIdOrPath: "" });
        mocks.getNote.mockResolvedValue(null);
        await openPopup({ noteIdOrPath: "root/gone" });

        expect(mocks.contexts).toHaveLength(0);
        expect(modal()?.dataset.shown).toBe("false");
    });

    it("maximizes into a tab, carrying along whatever is in view instead of the note itself", async () => {
        await openPopup({ noteIdOrPath: "root/n1" });
        await act(async () => container.querySelector<HTMLElement>(".maximize-stub")?.click());

        expect(mocks.openInNewTab).toHaveBeenCalledWith("n1", "root", true);
        expect(modal()?.dataset.shown).toBe("false");

        await openPopup({ noteIdOrPath: "root/n1", viewScope: ATTACHMENT_SCOPE });
        await act(async () => container.querySelector<HTMLElement>(".maximize-stub")?.click());

        // Otherwise maximizing would silently fall back to the attachment's owning note.
        expect(mocks.openContextWithNote).toHaveBeenCalledWith("n1", {
            hoistedNoteId: "root",
            viewScope: expect.objectContaining(ATTACHMENT_SCOPE),
            activate: true
        });

        // Likewise for a view mode of the note itself: the last rung of the map's expand ladder is the
        // popup's own maximize, which would otherwise land on the note and leave the map behind.
        await openPopup({ noteIdOrPath: "root/n1", viewScope: NOTE_MAP_SCOPE });
        await act(async () => container.querySelector<HTMLElement>(".maximize-stub")?.click());

        expect(mocks.openContextWithNote).toHaveBeenLastCalledWith("n1", {
            hoistedNoteId: "root",
            viewScope: expect.objectContaining(NOTE_MAP_SCOPE),
            activate: true
        });
    });

    it("stands aside when something within it has sent the reader elsewhere", async () => {
        await openPopup({ noteIdOrPath: "root/n1" });
        expect(modal()?.dataset.shown).toBe("true");

        // What a press on a node of the note map amounts to: the map navigates the pane behind the
        // popup, so the popup would otherwise be left covering the note it has just gone to.
        await act(async () => { await parent.handleEvent("closePopupEditor", {} as never); });
        expect(modal()?.dataset.shown).toBe("false");
    });

    it("stays put when there is no note to maximize", async () => {
        await openPopup({ noteIdOrPath: "root/n1" });
        const context = lastContext();
        if (context) {
            context.noteId = "";
        }

        await act(async () => container.querySelector<HTMLElement>(".maximize-stub")?.click());

        expect(mocks.openInNewTab).not.toHaveBeenCalled();
        expect(mocks.openContextWithNote).not.toHaveBeenCalled();
        expect(modal()?.dataset.shown).toBe("true");
    });

    it("follows a link inside itself instead of letting it navigate the tab behind", async () => {
        await openPopup({ noteIdOrPath: "root/n1" });
        const context = lastContext();
        if (context) {
            context.setNote.mockClear();
        }

        clickLink("#root/note2222");
        expect(context?.setNote).toHaveBeenCalledWith("root/note2222", {
            viewScope: { viewMode: "default" },
            keepActiveDialog: true
        });

        // A settings page cannot be shown here: it has its own dialog, with the page selector.
        clickLink("#root/_optionsAppearance");
        expect(mocks.triggerCommand).toHaveBeenCalledWith("showOptions", { section: "_optionsAppearance" });
        expect(context?.setNote).toHaveBeenCalledTimes(1);
    });

    it("reports its lifecycle: focuses the content when shown, and forgets itself when hidden", async () => {
        const handleEvent = vi.spyOn(parent, "handleEvent");
        await openPopup({ noteIdOrPath: "root/n1" });

        await act(async () => container.querySelector<HTMLElement>(".shown-stub")?.click());
        expect(handleEvent).toHaveBeenCalledWith("focusOnDetail", { ntxId: "_popup-editor" });

        await act(async () => container.querySelector<HTMLElement>(".hidden-stub")?.click());
        expect(modal()?.dataset.shown).toBe("false");
        expect(document.body.classList.contains("popup-editor-open")).toBe(false);
    });

    it("raises its own backdrop when it opens over another dialog", async () => {
        const underlying = document.body.appendChild(document.createElement("div"));
        underlying.className = "modal show";
        const backdrop = document.body.appendChild(document.createElement("div"));
        backdrop.className = "modal-backdrop";

        await openPopup({ noteIdOrPath: "root/n1" });

        // Bootstrap stacks neither the dialog nor its backdrop on its own.
        expect(document.body.classList.contains("popup-editor-stacked")).toBe(true);
        expect(backdrop.classList.contains("popup-editor-backdrop")).toBe(true);

        await act(async () => container.querySelector<HTMLElement>(".hidden-stub")?.click());
        expect(backdrop.classList.contains("popup-editor-backdrop")).toBe(false);

        // Bootstrap may not have appended a backdrop yet; the popup still opens.
        backdrop.remove();
        await openPopup({ noteIdOrPath: "root/n1" });
        expect(document.body.classList.contains("popup-editor-stacked")).toBe(true);

        underlying.remove();
    });

    it("gives mobile its own toolbar and hides the buttons that make no sense in a popup", async () => {
        expect(container.querySelector(".mobile-toolbar-stub")).toBeNull();

        mocks.isMobile.mockReturnValue(true);
        const mobileContainer = document.body.appendChild(document.createElement("div"));
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <PopupEditor />
                </ParentComponent.Provider>,
                mobileContainer
            );
        });

        expect(mobileContainer.querySelector(".mobile-toolbar-stub")).not.toBeNull();
        render(null, mobileContainer);
        mobileContainer.remove();
    });
});
