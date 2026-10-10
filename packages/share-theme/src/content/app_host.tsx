import appContext from "@triliumnext/client/src/components/app_context.js";
import Component from "@triliumnext/client/src/components/component.js";
import TabManager from "@triliumnext/client/src/components/tab_manager.js";
import type FNote from "@triliumnext/client/src/entities/fnote.js";
import linkContextMenu from "@triliumnext/client/src/menus/link_context_menu.js";
import froca from "@triliumnext/client/src/services/froca.js";
import type { FrocaSource, SubtreeResponse } from "@triliumnext/client/src/services/froca-interface.js";
import { setImageUrlResolver } from "@triliumnext/client/src/services/image_urls.js";
import { parseNavigationStateFromUrl } from "@triliumnext/client/src/services/link.js";
import options, { type OptionValue } from "@triliumnext/client/src/services/options.js";
import { ParentComponent } from "@triliumnext/client/src/widgets/react/react_utils.js";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";

import {
    createShareFrocaSource, createStaticFrocaSource, type ShareFrocaRows, type StaticFrocaSource
} from "./share_froca_source.js";

/** What core embeds next to an app view on a shared page. */
export interface AppPayload extends ShareFrocaRows {
    options: Record<string, OptionValue | null>;
    /** Where the app's assets are, such as the translations its views read. */
    assetPath: string;
    /** The parent of the note on the share, which the note is shown below. */
    parentNoteId: string | null;
    /**
     * On a page of the static export, the path of the export's root from the page, such as
     * `../`, under which the notes the views read are files instead of the share's API.
     */
    exportBasePath?: string;
}

export interface HostedApp {
    /** The note the page shows, read-only. */
    note: FNote;
    /** The parent of the note on the share, which the note is shown below. */
    parentNoteId: string | null;
    /** Opens a note on its shared page, in place of the app's own way. */
    openNote(noteId: string): void;
    /** Whether the note has a shared page to open. */
    hasLink(noteId: string): boolean;
    /** On a page of the static export, the source reading the export's files. */
    staticSource?: StaticFrocaSource;
}

interface ShareAppHostProps {
    noteId: string;
    payload: AppPayload;
    children(app: HostedApp): ComponentChildren;
}

/**
 * Hosts app views on a shared page: fills `options` and froca from `payload`, has froca read any
 * other note from the share, marks the note `#readOnly` so the views leave out their editing
 * controls, starts the part of `appContext` the views rely on and mounts them under a component of
 * their own, as the app mounts every view. On a page of the static export, froca first takes every
 * note of the export, so a collection a view draws has its children. A click on a link into the note tree the views render,
 * which the app's link handler opens in the app, opens the note's shared page.
 */
export default function ShareAppHost({ noteId, payload, children }: ShareAppHostProps) {
    const [ app ] = useState(() => loadPayload(noteId, payload));
    const [ component ] = useState(() => new Component());
    const [ isLoaded, setLoaded ] = useState(!app?.staticSource);

    useLayoutEffect(() => {
        if (app?.staticSource) {
            void froca.reloadNotes([ app.note.noteId ]).then(() => setLoaded(true));
        }
    }, [ app ]);

    useLayoutEffect(() => {
        startAppContext();
        appContext.child(component);
        return () => appContext.removeChild(component);
    }, [ component ]);

    useLayoutEffect(() => {
        if (!app) {
            return;
        }
        const onClick = (event: MouseEvent) => openNoteLink(event, app);
        document.addEventListener("click", onClick);
        return () => document.removeEventListener("click", onClick);
    }, [ app ]);

    return app && isLoaded && (
        <ParentComponent.Provider value={component}>
            {children(app)}
        </ParentComponent.Provider>
    );
}

function loadPayload(noteId: string, payload: AppPayload): HostedApp | null {
    const { options: optionValues, links, ...rows } = payload;
    options.load(Object.fromEntries(Object.entries(optionValues)
        .flatMap(([ name, value ]) => (value === null ? [] : [ [ name, value ] ]))));

    const staticSource = payload.exportBasePath === undefined
        ? undefined : createStaticFrocaSource(links, payload.exportBasePath);
    froca.setSource(withRootAnchors(staticSource ?? createShareFrocaSource(links)));
    setImageUrlResolver(staticSource?.getImageUrl);
    linkContextMenu.setShareLinkResolver((linkedNoteId) => links[linkedNoteId] ?? null);
    froca.addResp({
        ...anchorAtRoot(rows),
        attributes: [ ...rows.attributes, {
            attributeId: `${noteId}-share-readOnly`,
            noteId,
            type: "label",
            name: "readOnly",
            value: "",
            position: 0,
            isInheritable: false
        } ]
    });

    const note = froca.getNoteFromCache(noteId);
    if (!note) {
        return null;
    }

    return {
        note,
        parentNoteId: payload.parentNoteId,
        openNote: (openedNoteId) => {
            const link = links[openedNoteId];
            if (link) {
                window.location.href = link;
            }
        },
        hasLink: (linkedNoteId) => !!links[linkedNoteId],
        staticSource
    };
}

/** Has `source` answer every note it loads with {@link anchorAtRoot}. */
function withRootAnchors(source: FrocaSource): FrocaSource {
    return { ...source, loadNotes: async (noteIds) => anchorAtRoot(await source.loadNotes(noteIds)) };
}

/**
 * Places each note of `rows` that has no parent among them below a stand-in `root`, which a
 * page holds none of, so that each note has a path, which a collection a view draws needs to mount.
 * The built-in templates, such as `_template_calendar`, stay outside the tree.
 */
function anchorAtRoot<T extends SubtreeResponse>(rows: T): T {
    const childNoteIds = new Set(rows.branches.map((branch) => branch.noteId));
    const orphans = rows.notes.filter((note) =>
        !childNoteIds.has(note.noteId) && note.noteId !== "root" && !note.noteId.startsWith("_"));
    const rootRows = froca.getNoteFromCache("root") ? [] : [ {
        noteId: "root", title: "root", isProtected: false, type: "text" as const,
        mime: "text/html", blobId: ""
    } ];
    return {
        ...rows,
        notes: [ ...rootRows, ...rows.notes ],
        branches: [ ...rows.branches, ...orphans.map((note) => ({
            branchId: `root_${note.noteId}`,
            noteId: note.noteId,
            parentNoteId: "root",
            notePosition: 0,
            fromSearchNote: false
        })) ]
    };
}

/**
 * Opens the shared page of the note a clicked link into the note tree names, such as a table's
 * `.reference-link[data-href="#root/…"]` cell. A link to a note the share does not hold is left alone.
 */
function openNoteLink(event: MouseEvent, app: HostedApp) {
    const link = (event.target as Element | null)?.closest("[data-href], a[href^='#']");
    const href = link?.getAttribute("data-href") ?? link?.getAttribute("href") ?? undefined;
    const noteId = parseNavigationStateFromUrl(href).notePath?.split("/").at(-1);
    if (noteId && app.hasLink(noteId)) {
        event.preventDefault();
        app.openNote(noteId);
    }
}

/**
 * Gives `appContext` the part of `start()` the views rely on, a `TabManager` for the note contexts
 * their panes register. The app's layout, commands and shortcuts are left out.
 */
function startAppContext() {
    if (!appContext.tabManager) {
        appContext.tabManager = new TabManager();
        appContext.child(appContext.tabManager);
    }
}
