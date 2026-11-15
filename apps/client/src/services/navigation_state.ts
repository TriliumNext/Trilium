import { encodeBlockParameter } from "@triliumnext/commons/src/lib/block_reference.js";

import type { NoteCommandData } from "../components/app_context.js";

export type ViewMode = "default" | "source" | "attachments" | "contextual-help" | "note-map";

export interface ViewScope {
    /**
     * - "source", when viewing the source code of a note.
     * - "attachments", when viewing the attachments of a note.
     * - "contextual-help", if the current view represents a help window that was opened to the side of the main content.
     * - "default", otherwise.
     */
    viewMode?: ViewMode;
    attachmentId?: string;
    readOnlyTemporarilyDisabled?: boolean;
    /**
     * If true, it indicates that the note in the view should be opened in read-only mode (for supported note types such as text or code).
     *
     * The reason why we store this information here is that a note can become read-only as the user types content in it, and we wouldn't want
     * to immediately enter read-only mode.
     */
    isReadOnly?: boolean;
    /**
     * If true, a text note is edited with the floating toolbar whatever the user's editor-type
     * option says — the toolbar following the selection rather than standing in a bar of its own.
     *
     * For views too narrow to carry a full toolbar, such as the geo map's marker pane: a classic bar
     * built for the width of a note either spills out of them or eats the room the note is left.
     */
    floatingToolbar?: boolean;
    /** When set, scrolls to a bookmark anchor within the note after navigation. */
    bookmark?: string;
    /**
     * The blocks of a text note a reference points at, `id` or `startId:endId`, which the note
     * scrolls to and flashes once it renders. Consumed once, as `bookmark` is.
     */
    block?: string;
    /**
     * Search terms to highlight and jump to after navigating from search results; consumed once
     * by the destination type widget (mirrors `bookmark` semantics).
     */
    searchTerms?: string[];
    /**
     * The id of the board column a reference points at, which the board reveals once it has drawn
     * it. Consumed once, as `bookmark` is.
     */
    column?: string;
    /**
     * The title, icon and colour a column reference renders as, copied from the board when the
     * reference was made. Carried in the link because reading them needs the board's own
     * configuration; {@link column} is what the board resolves, so a rename only dates the label.
     */
    columnTitle?: string;
    columnIcon?: string;
    columnColor?: string;
    /**
     * The note id of the board card a reference points at, revealed the same way {@link column}
     * is.
     */
    card?: string;
    /**
     * The PDF page a reference points at, which the PDF viewer turns to once it has opened the
     * document. Consumed once, as `bookmark` is.
     */
    page?: string;
    /**
     * The id of the PDF annotation a reference points at, which the viewer scrolls to on
     * {@link page}. A reference to an annotation always carries its page too, so a deleted
     * annotation still leaves the reader on the right page.
     */
    annotation?: string;
}

/**
 * The state of a single split pane, as carried by the `splits` hash parameter when a tab is
 * moved or copied into a window of its own.
 */
export interface HashPane {
    notePath?: string | null;
    hoistedNoteId?: string | null;
    viewScope?: ViewScope;
}

/** A note path as it may appear in a hash: slash-separated note ids. */
const NOTE_PATH_PATTERN = /^[_a-z0-9]{4,}(\/[_a-z0-9]{4,})*$/i;

/**
 * How many extra panes a hash is allowed to carry. Well beyond any layout a user would build by
 * hand, but low enough that a hand-written address can't ask the app to open hundreds of panes.
 */
const MAX_SPLIT_PANES_IN_HASH = 8;

/** Hash parameters that belong to a pane's view scope rather than to the window as a whole. */
const VIEW_SCOPE_PARAMS = ["viewMode", "attachmentId", "bookmark", "block", "column",
    "columnTitle", "columnIcon", "columnColor", "card", "page", "annotation"];

export function calculateHash(
    { notePath, ntxId, hoistedNoteId, viewScope = {}, splits, activeSplit }: NoteCommandData
) {
    notePath = notePath || "";
    const params = [
        ntxId ? { ntxId } : null,
        hoistedNoteId && hoistedNoteId !== "root" ? { hoistedNoteId } : null,
        viewScope.viewMode && viewScope.viewMode !== "default" ? { viewMode: viewScope.viewMode } : null,
        viewScope.attachmentId ? { attachmentId: viewScope.attachmentId } : null,
        viewScope.block ? { block: viewScope.block } : null,
        viewScope.column ? { column: viewScope.column } : null,
        viewScope.columnTitle ? { columnTitle: viewScope.columnTitle } : null,
        viewScope.columnIcon ? { columnIcon: viewScope.columnIcon } : null,
        viewScope.columnColor ? { columnColor: viewScope.columnColor } : null,
        viewScope.card ? { card: viewScope.card } : null,
        viewScope.page ? { page: viewScope.page } : null,
        viewScope.annotation ? { annotation: viewScope.annotation } : null,
        viewScope.searchTerms?.length
            ? { searchTerms: viewScope.searchTerms.map(encodeURIComponent).join(",") }
            : null,
        splits?.length ? { splits: splits.map(encodeSplitPane).join(",") } : null,
        splits?.length && activeSplit ? { activeSplit: String(activeSplit) } : null
    ].filter((p) => !!p);

    const paramStr = params
        .map((pair) => {
            const name = Object.keys(pair)[0];
            const value = (pair as Record<string, string | undefined>)[name];

            /* v8 ignore next -- `value` is never undefined: every retained pair holds a string. It
               can be empty, but only for a `splits` list whose panes are all empty. */
            const encodedValue = name === "block"
                ? encodeBlockParameter(value || "")
                : encodeURIComponent(value || "");
            return `${encodeURIComponent(name)}=${encodedValue}`;
        })
        .join("&");

    if (!notePath && !paramStr) {
        return "";
    }

    let hash = `#${notePath}`;

    if (paramStr) {
        hash += `?${paramStr}`;
    }

    return hash;
}

/**
 * Serializes one extra pane into an entry of the `splits` parameter: its own hash body, minus the
 * leading `#`. Entries are joined with commas, which is unambiguous because neither a note path nor
 * an encoded parameter value can contain one. A pane holding no note yields an empty entry, so that
 * the pane count of the original tab survives the trip.
 */
function encodeSplitPane(pane: HashPane) {
    return calculateHash(pane).slice(1);
}

/** The subset of `window.location` needed to build a URL, which a plain `URL` also satisfies. */
interface UrlParts {
    protocol: string;
    host: string;
    pathname: string;
    search: string;
}

/**
 * Builds the address of a detached ("extra") window showing the given target.
 *
 * The current query string is carried over rather than replaced. On the server it holds nothing of
 * interest, but in standalone the query *is* the environment (`?safeMode`, `?startNoteId` — see
 * `QUERY_TO_ENV` in the standalone platform provider), so a window that dropped it would boot with
 * different settings than the one it was opened from, and would apply those to every other window
 * should it later inherit the database lock.
 */
export function calculateExtraWindowUrl(target: NoteCommandData, location: UrlParts = window.location) {
    const params = new URLSearchParams(location.search);
    params.set("extraWindow", "1");

    return `${location.protocol}//${location.host}${location.pathname}?${params}${calculateHash(target)}`;
}

/** Whether the query string of `url` (everything before `hashIdx`) carries the `extraWindow` marker. */
function isExtraWindowUrl(url: string, hashIdx: number) {
    return /[?&]extraWindow(?:[=&]|$)/.test(url.slice(0, hashIdx));
}

/**
 * Parses the navigation state in the hash of `url`. A full URL is internal when it addresses the
 * document at `location` or has an accepted internal form. Any other URL is external: `{}`.
 */
export function parseNavigationStateFromUrl(
    url: string | undefined,
    location: UrlParts = window.location
) {
    if (!url) {
        return {};
    }

    url = url.trim();
    const hashIdx = url.indexOf("#");
    if (hashIdx === -1) {
        return {};
    }

    const isExtraWindow = isExtraWindowUrl(url, hashIdx);

    // Exclude external links that contain #
    if (
        hashIdx !== 0
        && !url.includes("/#root")
        && !url.includes("/#?searchString")
        && !isExtraWindow
        && !isSameDocumentUrl(url, hashIdx, location)
    ) {
        return {};
    }

    const hash = url.substr(hashIdx + 1); // strip also the initial '#'
    const [notePath, paramString] = hash.split("?");

    const viewScope: ViewScope = {
        viewMode: "default"
    };
    let ntxId: string | null = null;
    let hoistedNoteId: string | null = null;
    let searchString: string | null = null;
    let openInPopup = false;
    let splits: HashPane[] | null = null;
    let activeSplit = 0;

    for (const [name, value] of parseHashParams(paramString)) {
        if (name === "ntxId") {
            ntxId = value;
        } else if (name === "hoistedNoteId") {
            hoistedNoteId = value;
        } else if (name === "searchString") {
            searchString = value; // supports triggering search from URL, e.g. #?searchString=blabla
        } else if (name === "searchTerms") {
            // `value` already went through one decodeURIComponent() in parseHashParams (undoing the
            // generic pipeline's outer encode); each comma-separated token needs its own inner decode.
            // A malformed token (corrupted URL, hand-edited link) must not break navigation for
            // the rest of the link, so drop it rather than letting decodeURIComponent throw.
            viewScope.searchTerms = value
                .split(",")
                .map((token) => {
                    try {
                        return decodeURIComponent(token);
                    } catch {
                        return null;
                    }
                })
                .filter((token): token is string => token !== null);
        } else if (VIEW_SCOPE_PARAMS.includes(name)) {
            (viewScope as any)[name] = value;
        } else if (name === "popup") {
            openInPopup = true;
        } else if (name === "splits") {
            // Splits lay out the whole window, so they are honoured only while booting a
            // detached one. A link inside a note reaches this same parser, and no note should
            // be able to rearrange the panes of the window it is read in.
            splits = isExtraWindow ? parseSplitPanes(value) : null;
        } else if (name === "activeSplit") {
            activeSplit = Number.parseInt(value, 10) || 0;
        } else {
            console.warn(`Unrecognized hash parameter '${name}'.`);
        }
    }

    if (searchString) {
        return { searchString };
    }

    // A hash carrying splits is one we wrote ourselves, so its main pane may hold no note —
    // that is how a tab whose first pane was empty keeps the rest of its panes.
    const isEmptyMainPaneWithSplits = !notePath && !!splits?.length;

    if (!isEmptyMainPaneWithSplits && !NOTE_PATH_PATTERN.test(notePath)) {
        return {};
    }

    return {
        notePath,
        noteId: getNoteIdFromUrl(notePath),
        ntxId,
        hoistedNoteId,
        viewScope,
        searchString,
        openInPopup,
        splits,
        activeSplit
    };
}

/** Whether `url` addresses the document at `location`, query string included, hash ignored. */
function isSameDocumentUrl(url: string, hashIdx: number, location: UrlParts) {
    const documentUrl = url.slice(0, hashIdx);

    const { protocol, host, pathname, search } = location;
    return documentUrl === `${protocol}//${host}${pathname}${search}`;
}

/** Iterates the `name=value` pairs of a hash's parameter string, decoding both sides. */
function parseHashParams(paramString: string | undefined) {
    if (!paramString) {
        return [];
    }

    return paramString.split("&").map((pair) => {
        const [name, value] = pair.split("=");

        return [decodeURIComponent(name), decodeURIComponent(value ?? "")] as const;
    });
}

/**
 * Parses the `splits` parameter — the panes that stood beside the main one, in order. Entries that
 * aren't a well-formed pane are dropped rather than failing the whole hash, so a mangled address
 * still opens what it can.
 */
function parseSplitPanes(value: string): HashPane[] {
    return value
        .split(",")
        .slice(0, MAX_SPLIT_PANES_IN_HASH)
        .map(parseSplitPane)
        .filter((pane) => !!pane);
}

function parseSplitPane(entry: string): HashPane | null {
    const [notePath, paramString] = entry.split("?");

    // An empty entry is a pane that held no note; anything else has to be a real note path.
    if (notePath && !NOTE_PATH_PATTERN.test(notePath)) {
        return null;
    }

    const pane: HashPane = {
        notePath: notePath || null,
        hoistedNoteId: null,
        viewScope: { viewMode: "default" }
    };

    for (const [name, paramValue] of parseHashParams(paramString)) {
        if (name === "hoistedNoteId") {
            pane.hoistedNoteId = paramValue;
        } else if (VIEW_SCOPE_PARAMS.includes(name)) {
            (pane.viewScope as any)[name] = paramValue;
        }
        // Everything else — `ntxId`, `searchString`, a nested `splits` — describes a window rather
        // than a pane, and has no meaning this far down.
    }

    return pane;
}

/** The id of the note a URL or a note path leads to: the last segment of the path. */
export function getNoteIdFromUrl(urlOrNotePath: string | null | undefined) {
    if (!urlOrNotePath) {
        return null;
    }

    const [notePath] = urlOrNotePath.split("?");
    const segments = notePath.split("/");

    return segments[segments.length - 1];
}

/** The ids of the note a URL or a note path leads to and of its parent, `root` at the top. */
export function getNoteIdAndParentIdFromUrl(urlOrNotePath: string) {
    if (!urlOrNotePath) {
        return {};
    }

    const [notePath] = urlOrNotePath.split("?");

    if (notePath === "root") {
        return {
            noteId: "root",
            parentNoteId: "none"
        };
    }

    let parentNoteId = "root";
    let noteId = "";

    if (notePath) {
        const segments = notePath.split("/");

        noteId = segments[segments.length - 1];

        if (segments.length > 1) {
            parentNoteId = segments[segments.length - 2];
        }
    }

    return {
        parentNoteId,
        noteId
    };
}
