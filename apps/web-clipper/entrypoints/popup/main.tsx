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
import Link from "@boxicons/js/icons/Link";
import Lock from "@boxicons/js/icons/Lock";
import RefreshCw from "@boxicons/js/icons/RefreshCw";
import Screenshot from "@boxicons/js/icons/Screenshot";
import Tabs from "@boxicons/js/icons/Tabs";
import type { ComponentChildren } from "preact";
import { render } from "preact";
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

/** A page as the content script extracts it, its images referenced in `content` by `imageId`. */
interface ExtractedPage {
    title: string;
    content: string;
    images: { imageId: string, src: string }[];
    pageUrl: string;
    clipType: "page";
    labels: Record<string, string>;
}

/** The current page: its readable version, or why there is none. */
type PageState = ExtractedPage | "unreadable" | "inaccessible";

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
    const [ page, setPage ] = useState<PageState>();

    useEffect(() => {
        void extractPage().then(setPage);
    }, []);

    function sendAndClose(name: string) {
        void sendMessage({ name });
        window.close();
    }

    const disabledReason = disabled ? DISCONNECTED_TITLE : undefined;
    const pageDisabledReason = disabledReason ?? (page === "inaccessible" ? UNREACHABLE_TITLE : undefined);

    let main: ComponentChildren;
    if (page === "inaccessible") {
        main = (
            <EmptyState icon={Lock}>
                {"The extension cannot access this page.\nIf it is a regular web page, reload it."}
            </EmptyState>
        );
    } else if (page === "unreadable") {
        main = <EmptyState icon={FileX}>This page has no article to save.</EmptyState>;
    } else {
        main = <PagePreview page={page} disabled={disabled} shortcut={shortcuts.saveWholePage} />;
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
function EmptyState({ icon, children }: { icon: IconDefinition, children: ComponentChildren }) {
    return (
        <div className="no-items">
            <Icon icon={icon} />
            {children}
        </div>
    );
}

/**
 * The readable version of the current page, with its title editable, and the button that saves it.
 * The page's HTML comes from an arbitrary website, so it is shown only in a sandboxed frame.
 */
function PagePreview({ page, disabled, shortcut }: {
    /** `undefined` while the page is read. */
    page: ExtractedPage | undefined;
    disabled: boolean;
    shortcut: string | undefined;
}) {
    const [ title, setTitle ] = useState("");

    useEffect(() => setTitle(page?.title ?? ""), [ page ]);

    function save(extracted: ExtractedPage) {
        void sendMessage({ name: "save-whole-page", page: { ...extracted, title: title.trim() || extracted.title } });
        window.close();
    }

    const published = page?.labels.publishedDate;

    return (
        <div className="page-preview">
            {page && (
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
                        />
                        <div className="page-meta">
                            {new URL(page.pageUrl).hostname}{published && ` · Published ${published}`}
                        </div>
                    </div>
                </div>
            )}

            <div className="page-body">
                {page
                    ? <iframe className="page-content" title="Preview of the page" sandbox="" srcDoc={previewDocument(page)} />
                    : <div className="page-preview-placeholder">Reading the page…</div>}
            </div>

            <button
                className="btn btn-primary primary-action"
                disabled={disabled || !page}
                title={disabled ? DISCONNECTED_TITLE : undefined}
                onClick={page ? () => save(page) : undefined}
            >
                <Icon icon={Article} />
                <span className="action-label">Save page to Trilium</span>
                <Shortcut keys={shortcut} />
            </button>
        </div>
    );
}

function Shortcut({ keys }: { keys: string | undefined }) {
    return keys ? <kbd>{keys}</kbd> : null;
}

function TriliumNotFound() {
    return (
        <div className="not-found">
            <strong>Trilium was not found.</strong>
            <p>Start the Trilium desktop application, or connect to a Trilium server in the options.</p>

            <div className="not-found-buttons">
                <button className="btn btn-primary" onClick={() => sendMessage({ name: "trigger-trilium-search" })}>Retry</button>
                <button className="btn btn-secondary" onClick={() => browser.runtime.openOptionsPage()}>Open options</button>
            </div>
        </div>
    );
}

function LinkWithNoteForm({ onBack }: { onBack: () => void }) {
    const [ text, setText ] = useState("");
    const [ keepTitle, setKeepTitle ] = useState(false);
    const textAreaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => textAreaRef.current?.focus(), []);

    async function save() {
        const { title, content } = parseLinkNote(text, keepTitle);
        const result = await sendMessage({ name: "save-link-with-note", title, content: textToHtml(content) });

        if (result) {
            setText("");
            window.close();
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

            <textarea
                ref={textAreaRef}
                rows={5}
                value={text}
                placeholder={keepTitle
                    ? "The note's text."
                    : "The first sentence becomes the note's title, the rest its text."}
                onInput={(e) => setText(e.currentTarget.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && e.ctrlKey) {
                        e.preventDefault();
                        void save();
                    }
                }}
            />

            <label className="tn-checkbox">
                <input
                    type="checkbox"
                    checked={keepTitle}
                    onChange={(e) => setKeepTitle(e.currentTarget.checked)}
                />
                {" "}Keep page title as note title
            </label>

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

/**
 * Asks the content script of the active tab for its readable page, as it extracts it for saving.
 * Returns `null` on pages where no content script runs (browser pages, extension stores) and when
 * the page cannot be extracted.
 */
/**
 * Asks the content script of the active tab for its readable page. The script answers `undefined`
 * when Readability cannot parse the page, and the message fails where no content script runs.
 */
async function extractPage(): Promise<PageState> {
    try {
        const [ tab ] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined) return "inaccessible";
        return await browser.tabs.sendMessage(tab.id, { name: "trilium-save-page" }) ?? "unreadable";
    } catch {
        return "inaccessible";
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

/**
 * Splits the text of a link note into the note's title and content: the first sentence or line is
 * the title, unless the page title is kept, in which case all of the text is content.
 */
export function parseLinkNote(text: string, keepTitle: boolean) {
    const trimmed = text.trim();

    if (!trimmed) {
        return { title: "", content: "" };
    }

    if (keepTitle) {
        return { title: "", content: trimmed };
    }

    const match = /^(.*?)([.?!]\s|\n)/.exec(trimmed);
    if (!match) {
        return { title: trimmed, content: "" };
    }

    const title = match[0].trim();
    return { title, content: trimmed.substring(title.length).trim() };
}

/** Escapes plain text as HTML, with one paragraph per line. */
export function textToHtml(text: string) {
    const escaped = text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");

    return `<p>${escaped.replaceAll("\n", "</p><p>")}</p>`;
}
