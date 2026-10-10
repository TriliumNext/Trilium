import "./popup.css";

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

const root = document.getElementById("root");
if (root) {
    render(<Popup />, root);
}

export function Popup() {
    const [ searchStatus, setSearchStatus ] = useState<TriliumSearchStatus>();
    const [ clippedNoteId, setClippedNoteId ] = useState<string | null>(null);
    const [ isWritingNote, setIsWritingNote ] = useState(false);

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

        return () => browser.runtime.onMessage.removeListener(onMessage);
    }, []);

    const needsConnection = {
        disabled: !!searchStatus && !isConnected(searchStatus),
        title: searchStatus && !isConnected(searchStatus)
            ? "This action can't be performed without active connection to Trilium."
            : undefined
    };

    function sendAndClose(name: string) {
        void sendMessage({ name });
        window.close();
    }

    return (
        <div className="popup">
            <div className="popup-header">
                <h3>Trilium Web Clipper</h3>

                <div className="popup-header-buttons">
                    <button className="button" onClick={() => browser.runtime.openOptionsPage()}>Options</button>
                    <button className="button" onClick={() => window.open(HELP_URL, "_blank")}>Help</button>
                </div>
            </div>

            <div className="already-visited">
                {clippedNoteId && (
                    <>
                        Web page already clipped.{" "}
                        <a
                            href="#"
                            onClick={(e) => {
                                e.preventDefault();
                                void sendMessage({ name: "openNoteInTrilium", noteId: clippedNoteId });
                            }}
                        >Open in Trilium.</a>
                    </>
                )}
            </div>

            <button className="button full" {...needsConnection} onClick={() => sendAndClose("save-cropped-screenshot")}>
                Crop screenshot
            </button>
            <button className="button full" {...needsConnection} onClick={() => sendAndClose("save-whole-screenshot")}>
                Save whole screenshot
            </button>
            <button className="button full" {...needsConnection} onClick={() => sendMessage({ name: "save-whole-page" })}>
                Save whole page
            </button>
            <button className="button full" {...needsConnection} onClick={() => setIsWritingNote(true)}>
                Save link with a note
            </button>
            <button className="button full" {...needsConnection} onClick={() => sendMessage({ name: "save-tabs" })}>
                Save window's tabs as a list
            </button>

            {isWritingNote && <LinkWithNoteForm onCancel={() => setIsWritingNote(false)} />}

            <div className="connection">
                <button className="button check-connection-button" onClick={() => sendMessage({ name: "trigger-trilium-search" })}>
                    check
                </button>

                <div>Status: <ConnectionStatus status={searchStatus} /></div>
            </div>
        </div>
    );
}

function LinkWithNoteForm({ onCancel }: { onCancel: () => void }) {
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
            <textarea
                ref={textAreaRef}
                rows={5}
                value={text}
                onInput={(e) => setText(e.currentTarget.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && e.ctrlKey) {
                        e.preventDefault();
                        void save();
                    }
                }}
            />

            <div>
                <label>
                    <input
                        type="checkbox"
                        checked={keepTitle}
                        onChange={(e) => setKeepTitle(e.currentTarget.checked)}
                    />
                    {" "}Keep page title as note title
                </label>
            </div>
            <div className="save-link-with-note-buttons">
                <button type="submit" className="button wide save-button" onClick={save}>Save</button>
                <button
                    type="submit"
                    className="button wide"
                    onClick={() => {
                        onCancel();
                        window.close();
                    }}
                >Cancel</button>
            </div>
        </div>
    );
}

function ConnectionStatus({ status }: { status: TriliumSearchStatus | undefined }) {
    switch (status?.status) {
        case undefined:
            return <span>unknown</span>;
        case "searching":
            return <span>searching</span>;
        case "not-found":
            return <span className="status-error">Not found</span>;
        case "version-mismatch": {
            const whatToUpgrade = status.extensionMajor > status.triliumMajor ? "Trilium Notes" : "this extension";
            return (
                <span className="status-warning">
                    Trilium instance found, but it is not compatible with this extension version.
                    Please update {whatToUpgrade} to the latest version.
                </span>
            );
        }
        case "found-desktop":
            return <span className="status-ok">Connected on port {status.port}</span>;
        case "found-server":
            return <span className="status-ok" title={`Connected to ${status.url}`}>Connected to the server</span>;
    }
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
