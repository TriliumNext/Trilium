import "@/assets/theme.css";
import "./popup.css";

import type { IconData, IconDefinition } from "@boxicons/js";
import ArrowLeft from "@boxicons/js/icons/ArrowLeft";
import Article from "@boxicons/js/icons/Article";
import Cog from "@boxicons/js/icons/Cog";
import Crop from "@boxicons/js/icons/Crop";
import HelpCircle from "@boxicons/js/icons/HelpCircle";
import Link from "@boxicons/js/icons/Link";
import RefreshCw from "@boxicons/js/icons/RefreshCw";
import Screenshot from "@boxicons/js/icons/Screenshot";
import Tabs from "@boxicons/js/icons/Tabs";
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { TriliumSearchNoteStatus, TriliumSearchStatus } from "../background/trilium_server_facade";

const HELP_URL = "https://docs.triliumnotes.org/user-guide/setup/web-clipper";

type PopupMessage = {
    name: "trilium-search-status";
    triliumSearch?: TriliumSearchStatus;
} | {
    name: "trilium-previously-visited";
    searchNote: TriliumSearchNoteStatus;
};

/** The keyboard shortcut of each command, by command name; unbound commands are absent. */
type Shortcuts = Record<string, string>;

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
            <div className="popup-header">
                <img className="logo" src="/icons/48.png" alt="" />
                <h3>Trilium Web Clipper</h3>
                <span className={`status-dot status-dot-${status.kind}`} title={status.text} />

                <div className="popup-header-buttons">
                    <button className="icon-action" title="Options" aria-label="Options" onClick={() => browser.runtime.openOptionsPage()}>
                        <Icon icon={Cog} />
                    </button>
                    <button className="icon-action" title="Help" aria-label="Help" onClick={() => window.open(HELP_URL, "_blank")}>
                        <Icon icon={HelpCircle} />
                    </button>
                </div>
            </div>

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

            {body}

            <div className="connection">
                <span className={`status-${status.kind}`} title={status.title}>{status.text}</span>

                <button
                    className="icon-action"
                    title="Check the connection again"
                    aria-label="Check the connection again"
                    onClick={() => sendMessage({ name: "trigger-trilium-search" })}
                >
                    <Icon icon={RefreshCw} />
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
    const actionProps = {
        disabled,
        title: disabled ? "This action can't be performed without active connection to Trilium." : undefined
    };

    function sendAndClose(name: string) {
        void sendMessage({ name });
        window.close();
    }

    return (
        <div className="capture-actions">
            <button className="btn btn-primary primary-action" {...actionProps} onClick={() => sendMessage({ name: "save-whole-page" })}>
                <Icon icon={Article} />
                <span className="action-label">Save whole page</span>
                <Shortcut keys={shortcuts.saveWholePage} />
            </button>

            <div className="action-tiles">
                <button className="btn btn-secondary action-tile" {...actionProps} onClick={() => sendAndClose("save-cropped-screenshot")}>
                    <Icon icon={Crop} />
                    <span className="action-label">Crop screenshot</span>
                    <Shortcut keys={shortcuts.saveCroppedScreenshot} />
                </button>
                <button className="btn btn-secondary action-tile" {...actionProps} onClick={() => sendAndClose("save-whole-screenshot")}>
                    <Icon icon={Screenshot} />
                    <span className="action-label">Visible area screenshot</span>
                </button>
                <button className="btn btn-secondary action-tile" {...actionProps} onClick={onWriteNote}>
                    <Icon icon={Link} />
                    <span className="action-label">Link with a note</span>
                </button>
                <button className="btn btn-secondary action-tile" {...actionProps} onClick={() => sendMessage({ name: "save-tabs" })}>
                    <Icon icon={Tabs} />
                    <span className="action-label">All tabs in window</span>
                    <Shortcut keys={shortcuts.saveTabs} />
                </button>
            </div>
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

            <div className="save-link-with-note-buttons">
                <span className="hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> to save</span>
                <button type="submit" className="btn btn-primary" onClick={save}>Save</button>
            </div>
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
            return { kind: "ok", text: `Connected to the desktop app on port ${status.port}` };
        case "found-server":
            return { kind: "ok", text: "Connected to the server", title: `Connected to ${status.url}` };
    }
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
