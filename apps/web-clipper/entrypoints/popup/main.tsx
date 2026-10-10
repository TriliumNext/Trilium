import "@/assets/theme.css";
import "./popup.css";

import type { IconData, IconDefinition } from "@boxicons/js";
import ArrowLeft from "@boxicons/js/icons/ArrowLeft";
import Article from "@boxicons/js/icons/Article";
import Cog from "@boxicons/js/icons/Cog";
import Crop from "@boxicons/js/icons/Crop";
import FileX from "@boxicons/js/icons/FileX";
import Globe from "@boxicons/js/icons/Globe";
import HelpCircle from "@boxicons/js/icons/HelpCircle";
import Highlight from "@boxicons/js/icons/Highlight";
import Link from "@boxicons/js/icons/Link";
import Lock from "@boxicons/js/icons/Lock";
import RefreshCw from "@boxicons/js/icons/RefreshCw";
import Screenshot from "@boxicons/js/icons/Screenshot";
import Tabs from "@boxicons/js/icons/Tabs";
import Unlink from "@boxicons/js/icons/Unlink";
import type { ComponentChildren } from "preact";
import { Fragment, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { TriliumSearchNoteStatus, TriliumSearchStatus } from "../background/trilium_server_facade";

const HELP_URL = "https://docs.triliumnotes.org/user-guide/setup/web-clipper";
const DISCONNECTED_TITLE = "This action can't be performed without active connection to Trilium.";
const UNREACHABLE_TITLE = "This action is not available on this page.";

type PopupMessage = {
    name: "trilium-search-status";
    triliumSearch?: TriliumSearchStatus;
} | {
    name: "trilium-previously-visited";
    searchNote: TriliumSearchNoteStatus;
};

/** The keyboard shortcut of each command, by command name; unbound commands are absent. */
type Shortcuts = Record<string, string>;

/** Content as the content script reads it from the page, its images referenced in `content` by `imageId`. */
interface SelectedContent {
    title: string;
    content: string;
    images: { imageId: string, src: string }[];
    pageUrl: string;
}

/** The readable page, as the content script extracts it. */
interface ExtractedPage extends SelectedContent {
    clipType: "page";
    labels: Record<string, string>;
}

/** The current page: its readable version, or why there is none. */
type PageState = ExtractedPage | "unreadable" | "inaccessible";

/** What the active tab offers to save. */
interface TabContent {
    page: PageState;
    /** `null` when nothing is selected, or the page is out of reach. */
    selection: SelectedContent | null;
}

const PREVIEW_STYLE = `
    :root { color-scheme: light dark; }
    body { margin: 8px; font: 12px/1.5 system-ui, sans-serif; overflow-wrap: anywhere; }
    h1 { font-size: 1.3em; } h2 { font-size: 1.15em; } h3, h4, h5, h6 { font-size: 1em; }
    img, video, svg, iframe { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap; }
    a { color: light-dark(#0076af, #95c3d9); text-decoration: none; pointer-events: none; }
`;

const root = document.getElementById("root");
if (root) {
    render(<Popup />, root);
}

export function Popup() {
    const [ searchStatus, setSearchStatus ] = useState<TriliumSearchStatus>();
    const [ clippedNoteId, setClippedNoteId ] = useState<string | null>(null);
    const [ isWritingNote, setIsWritingNote ] = useState(false);
    const [ shortcuts, setShortcuts ] = useState<Shortcuts>({});

    useEffect(() => {
        function onMessage(message: PopupMessage) {
            if (message.name === "trilium-search-status") {
                setSearchStatus(message.triliumSearch);

                if (message.triliumSearch && isConnected(message.triliumSearch)) {
                    void sendMessage({ name: "trigger-trilium-search-note-url" });
                }
            } else if (message.name === "trilium-previously-visited") {
                const { searchNote } = message;
                setClippedNoteId(searchNote.status === "found" ? searchNote.noteId : null);
            }
        }

        browser.runtime.onMessage.addListener(onMessage);
        void sendMessage({ name: "send-trilium-search-status" });
        void browser.commands.getAll().then((commands) => setShortcuts(shortcutsByCommand(commands)));

        return () => browser.runtime.onMessage.removeListener(onMessage);
    }, []);

    const status = describeStatus(searchStatus);
    const isMismatch = searchStatus?.status === "version-mismatch";

    let body: ComponentChildren;
    if (isWritingNote) {
        body = <LinkWithNoteForm onBack={() => setIsWritingNote(false)} />;
    } else if (searchStatus?.status === "not-found") {
        body = <TriliumNotFound />;
    } else {
        body = (
            <CaptureActions
                disabled={!!searchStatus && !isConnected(searchStatus)}
                shortcuts={shortcuts}
                onWriteNote={() => setIsWritingNote(true)}
            />
        );
    }

    return (
        <div className="popup">
            {(clippedNoteId || isMismatch) && (
                <div className="notices">
                    {clippedNoteId && (
                        <div className="callout callout-info already-visited">
                            <span>Web page already clipped.</span>
                            <a
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    void sendMessage({ name: "openNoteInTrilium", noteId: clippedNoteId });
                                }}
                            >Open in Trilium</a>
                        </div>
                    )}
                    {searchStatus?.status === "version-mismatch" && (
                        <div className="callout callout-warning">
                            Trilium instance found, but it is not compatible with this extension version.
                            Please update {searchStatus.extensionMajor > searchStatus.triliumMajor ? "Trilium Notes" : "this extension"} to
                            the latest version.
                        </div>
                    )}
                </div>
            )}

            {body}

            <div className="connection">
                <span className={`status-${status.kind}`} title={status.title}>
                    <span className={`status-dot status-dot-${status.kind}`} />
                    {status.text}
                </span>

                <button
                    className="icon-action refresh"
                    title="Check the connection again"
                    aria-label="Check the connection again"
                    onClick={() => sendMessage({ name: "trigger-trilium-search" })}
                >
                    <Icon icon={RefreshCw} />
                </button>

                <button className="icon-action" title="Options" aria-label="Options" onClick={() => browser.runtime.openOptionsPage()}>
                    <Icon icon={Cog} />
                </button>
                <button className="icon-action" title="Help" aria-label="Help" onClick={() => window.open(HELP_URL, "_blank")}>
                    <Icon icon={HelpCircle} />
                </button>
            </div>
        </div>
    );
}

function CaptureActions({ disabled, shortcuts, onWriteNote }: {
    disabled: boolean;
    shortcuts: Shortcuts;
    onWriteNote: () => void;
}) {
    /** `undefined` while the page is read. */
    const [ tab, setTab ] = useState<TabContent>();

    useEffect(() => {
        void readActiveTab().then(setTab);
    }, []);

    function sendAndClose(name: string) {
        void sendMessage({ name });
        window.close();
    }

    const disabledReason = disabled ? DISCONNECTED_TITLE : undefined;
    const pageDisabledReason = disabledReason ?? (tab?.page === "inaccessible" ? UNREACHABLE_TITLE : undefined);

    let main: ComponentChildren;
    if (tab?.page === "inaccessible") {
        main = (
            <EmptyState icon={Lock}>
                {"The extension cannot access this page.\nIf it is a regular web page, reload it."}
            </EmptyState>
        );
    } else if (tab?.page === "unreadable" && !tab.selection) {
        main = <EmptyState icon={FileX}>This page has no article to save.</EmptyState>;
    } else {
        main = (
            <PagePreview
                article={typeof tab?.page === "object" ? tab.page : undefined}
                selection={tab?.selection ?? undefined}
                disabled={disabled}
                shortcuts={shortcuts}
            />
        );
    }

    return (
        <div className="capture-actions">
            {main}

            <div className="toolbar">
                <ToolbarAction
                    icon={Crop} label="Crop" name="Crop screenshot"
                    shortcut={shortcuts.saveCroppedScreenshot} disabledReason={pageDisabledReason}
                    onClick={() => sendAndClose("save-cropped-screenshot")}
                />
                <ToolbarAction
                    icon={Screenshot} label="Screenshot" name="Visible area screenshot"
                    disabledReason={pageDisabledReason}
                    onClick={() => sendAndClose("save-whole-screenshot")}
                />
                <ToolbarAction
                    icon={Link} label="Note" name="Link with a note"
                    disabledReason={disabledReason} onClick={onWriteNote}
                />
                <ToolbarAction
                    icon={Tabs} label="Tabs" name="All tabs in window"
                    shortcut={shortcuts.saveTabs} disabledReason={disabledReason}
                    onClick={() => sendMessage({ name: "save-tabs" })}
                />
            </div>
        </div>
    );
}

/** A secondary action: an icon over a short label, its full name and shortcut in the tooltip. */
function ToolbarAction({ icon, label, name, shortcut, disabledReason, onClick }: {
    icon: IconDefinition;
    label: string;
    name: string;
    shortcut?: string;
    /** Why the action is disabled, shown in place of its name; the action is enabled without one. */
    disabledReason: string | undefined;
    onClick: () => void;
}) {
    const title = disabledReason ?? (shortcut ? `${name} (${shortcut})` : name);

    return (
        <button className="toolbar-action" disabled={!!disabledReason} title={title} aria-label={name} onClick={onClick}>
            <Icon icon={icon} />
            <span className="action-label">{label}</span>
        </button>
    );
}

/** Takes the place of the page preview when the page cannot be saved, in the style of the app's `NoItems`. */
function EmptyState({ icon, className, children }: {
    icon: IconDefinition;
    className?: string;
    children: ComponentChildren;
}) {
    return (
        <div className={className ? `no-items ${className}` : "no-items"}>
            <Icon icon={icon} />
            {children}
        </div>
    );
}

/**
 * What the popup saves from the page, with its title editable, and the button that saves it: the
 * selection when there is one, otherwise the readable page, with a switch between the two when the
 * page has both. The page's HTML comes from an arbitrary website, so it is shown only in a sandboxed
 * frame.
 */
function PagePreview({ article, selection, disabled, shortcuts }: {
    /** `undefined` while the page is read, or when it has no article. */
    article: ExtractedPage | undefined;
    selection: SelectedContent | undefined;
    disabled: boolean;
    shortcuts: Shortcuts;
}) {
    const [ mode, setMode ] = useState<"selection" | "page">("selection");
    /** `undefined` until the user edits the title. */
    const [ title, setTitle ] = useState<string>();

    const clip = selection && (mode === "selection" || !article) ? selection : article;
    const isSelection = !!clip && clip === selection;
    const shownTitle = title ?? (article ?? selection)?.title ?? "";

    function save(content: SelectedContent | ExtractedPage) {
        const titled = { ...content, title: shownTitle.trim() || content.title };
        void sendMessage(isSelection
            ? { name: "save-selection", selection: titled }
            : { name: "save-whole-page", page: titled });
        window.close();
    }

    const published = clip && !isSelection ? article?.labels.publishedDate : undefined;

    return (
        <div className="page-preview">
            {clip && (
                <div className="page-heading">
                    <span className="page-icon"><Icon icon={Globe} /></span>
                    <div className="page-heading-text">
                        <input
                            type="text"
                            className="page-title"
                            aria-label="Note title"
                            placeholder="Note title"
                            value={shownTitle}
                            onInput={(e) => setTitle(e.currentTarget.value)}
                        />
                        <div className="page-meta">
                            {new URL(clip.pageUrl).hostname}{published && ` · Published ${published}`}
                        </div>
                    </div>
                </div>
            )}

            {article && selection && (
                <div className="clip-mode" role="group" aria-label="What to save">
                    <button aria-pressed={mode === "selection"} onClick={() => setMode("selection")}>Selection</button>
                    <button aria-pressed={mode === "page"} onClick={() => setMode("page")}>Whole page</button>
                </div>
            )}

            <div className="page-body">
                {clip
                    ? <iframe className="page-content" title="Preview of the page" sandbox="" srcDoc={previewDocument(clip)} />
                    : <div className="page-preview-placeholder">Reading the page…</div>}
            </div>

            <button
                className="btn btn-primary primary-action"
                disabled={disabled || !clip}
                title={disabled ? DISCONNECTED_TITLE : undefined}
                onClick={clip ? () => save(clip) : undefined}
            >
                <Icon icon={isSelection ? Highlight : Article} />
                <span className="action-label">{isSelection ? "Save selection" : "Save page to Trilium"}</span>
                <Shortcut keys={isSelection ? shortcuts.saveSelection : shortcuts.saveWholePage} />
            </button>
        </div>
    );
}

/**
 * A shortcut as the app draws it: a key cap per key, joined by "+". The browser formats the shortcut;
 * on macOS, Chrome gives the glyphs without a "+" (`⌥⇧S`), which stay in one key cap there too.
 */
function Shortcut({ keys }: { keys: string | undefined }) {
    if (!keys) return null;

    return (
        <span className="shortcut">
            {keys.split("+").map((key, index) => (
                <Fragment key={index}>{index > 0 && "+"}<kbd>{key}</kbd></Fragment>
            ))}
        </span>
    );
}

function TriliumNotFound() {
    return (
        <EmptyState icon={Unlink} className="not-found">
            <h4>Trilium was not found</h4>
            <p>Start the desktop app, or connect to a server in the options.</p>

            <div className="not-found-buttons">
                <button className="btn btn-primary" onClick={() => sendMessage({ name: "trigger-trilium-search" })}>
                    <Icon icon={RefreshCw} />Retry
                </button>
                <button className="btn btn-secondary" onClick={() => browser.runtime.openOptionsPage()}>
                    <Icon icon={Cog} />Open options
                </button>
            </div>
        </EmptyState>
    );
}

function LinkWithNoteForm({ onBack }: { onBack: () => void }) {
    const [ title, setTitle ] = useState("");
    const [ pageUrl, setPageUrl ] = useState<string>();
    const [ text, setText ] = useState("");
    const textAreaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        textAreaRef.current?.focus();
        void browser.tabs.query({ active: true, currentWindow: true }).then(([ tab ]) => {
            setTitle(tab?.title ?? "");
            setPageUrl(tab?.url);
        });
    }, []);

    async function save() {
        const content = text.trim();
        const result = await sendMessage({
            name: "save-link-with-note",
            title: title.trim(),
            content: content ? textToHtml(content) : ""
        });

        if (result) {
            window.close();
        }
    }

    function saveOnCtrlEnter(e: KeyboardEvent) {
        if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            void save();
        }
    }

    return (
        <div className="save-link-with-note">
            <div className="view-header">
                <button className="icon-action" title="Back" aria-label="Back" onClick={onBack}>
                    <Icon icon={ArrowLeft} />
                </button>
                <h4>Link with a note</h4>
            </div>

            <div className="page-heading">
                <span className="page-icon"><Icon icon={Globe} /></span>
                <div className="page-heading-text">
                    <input
                        type="text"
                        className="page-title"
                        aria-label="Note title"
                        placeholder="Note title"
                        value={title}
                        onInput={(e) => setTitle(e.currentTarget.value)}
                        onKeyDown={saveOnCtrlEnter}
                    />
                    {pageUrl && <div className="page-meta">{new URL(pageUrl).hostname}</div>}
                </div>
            </div>

            <textarea
                ref={textAreaRef}
                rows={5}
                value={text}
                placeholder="Your note about this page"
                onInput={(e) => setText(e.currentTarget.value)}
                onKeyDown={saveOnCtrlEnter}
            />

            <button type="submit" className="btn btn-primary primary-action" onClick={save}>
                <span className="action-label">Save</span>
                <Shortcut keys="Ctrl+Enter" />
            </button>
        </div>
    );
}

/** The state of the connection to Trilium: a kind for its color, and its description. */
function describeStatus(status: TriliumSearchStatus | undefined) {
    switch (status?.status) {
        case undefined:
        case "searching":
            return { kind: "pending", text: "Looking for Trilium…" };
        case "not-found":
            return { kind: "error", text: "Not found" };
        case "version-mismatch":
            return { kind: "warning", text: "Incompatible version" };
        case "found-desktop":
            return { kind: "ok", text: "Connected to the desktop app", title: `Connected to port ${status.port}` };
        case "found-server":
            return { kind: "ok", text: "Connected to the server", title: `Connected to ${status.url}` };
    }
}

/** Asks the content script of the active tab for its readable page and its selection, together. */
async function readActiveTab(): Promise<TabContent> {
    const [ tab ] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return { page: "inaccessible", selection: null };

    const [ page, selection ] = await Promise.all([ extractPage(tab.id), readSelection(tab.id) ]);
    return { page, selection };
}

/**
 * The content script answers `undefined` when Readability cannot parse the page, and the message
 * fails where no content script runs.
 */
async function extractPage(tabId: number): Promise<PageState> {
    try {
        return await browser.tabs.sendMessage(tabId, { name: "trilium-save-page" }) ?? "unreadable";
    } catch {
        return "inaccessible";
    }
}

/**
 * The selection on the page, or `null` when there is none. A click on the page leaves a collapsed
 * selection, which the content script still answers with, empty.
 */
async function readSelection(tabId: number): Promise<SelectedContent | null> {
    try {
        const selection: SelectedContent | undefined = await browser.tabs.sendMessage(tabId, { name: "trilium-save-selection" });
        if (!selection) return null;

        const text = new DOMParser().parseFromString(selection.content, "text/html").body.textContent;
        return text.trim() || selection.images.length ? selection : null;
    } catch {
        return null;
    }
}

/** A standalone document showing the page's content, its images loaded from the website. */
export function previewDocument({ content, images }: Pick<ExtractedPage, "content" | "images">) {
    const doc = new DOMParser().parseFromString(content, "text/html");
    for (const img of doc.querySelectorAll("img")) {
        const image = images.find(({ imageId }) => imageId === img.getAttribute("src"));
        if (image) {
            img.setAttribute("src", image.src);
        }
    }

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PREVIEW_STYLE}</style></head>`
        + `<body>${doc.body.innerHTML}</body></html>`;
}

/** Maps each bound command to its shortcut, as the browser shows it. */
export function shortcutsByCommand(commands: { name?: string, shortcut?: string }[]): Shortcuts {
    const shortcuts: Shortcuts = {};
    for (const { name, shortcut } of commands) {
        if (name && shortcut) {
            shortcuts[name] = shortcut;
        }
    }
    return shortcuts;
}

/** A Boxicons v3 icon, drawn inline in the current text color. */
function Icon({ icon }: { icon: IconDefinition }) {
    const { viewBox, content } = basicIcon(icon);
    return (
        <svg
            className="icon"
            viewBox={viewBox}
            fill="currentColor"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: content }}
        />
    );
}

/** The outlined variant of an icon, the one matching the app's Boxicons. */
export function basicIcon(icon: IconDefinition): IconData {
    const data = icon.packs.basic;
    if (!data) {
        throw new Error(`Boxicons has no basic variant of '${icon.name}'.`);
    }
    return data;
}

/** A version mismatch counts as connected, so the buttons stay enabled and report it on use. */
function isConnected(status: TriliumSearchStatus) {
    return status.status === "found-desktop" || status.status === "found-server" || status.status === "version-mismatch";
}

async function sendMessage(message: object) {
    try {
        console.log("Sending message", message);
        return await browser.runtime.sendMessage(message);
    } catch (e) {
        console.log("Calling browser runtime failed:", e);
        alert("Calling browser runtime failed. Refreshing page might help.");
    }
}

/** Escapes plain text as HTML, with one paragraph per line. */
export function textToHtml(text: string) {
    const escaped = text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");

    return `<p>${escaped.replaceAll("\n", "</p><p>")}</p>`;
}
