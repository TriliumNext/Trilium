import appContext from "@triliumnext/client/src/components/app_context.js";
import Component from "@triliumnext/client/src/components/component.js";
import TabManager from "@triliumnext/client/src/components/tab_manager.js";
import type FNote from "@triliumnext/client/src/entities/fnote.js";
import linkContextMenu from "@triliumnext/client/src/menus/link_context_menu.js";
import froca from "@triliumnext/client/src/services/froca.js";
import { parseNavigationStateFromUrl } from "@triliumnext/client/src/services/link.js";
import options, { type OptionValue } from "@triliumnext/client/src/services/options.js";
import { ParentComponent } from "@triliumnext/client/src/widgets/react/react_utils.js";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";

import { createShareFrocaSource, type ShareFrocaRows } from "./share_froca_source.js";

/** What core embeds next to an app view on a shared page. */
export interface AppPayload extends ShareFrocaRows {
    options: Record<string, OptionValue | null>;
    /** Where the app's assets are, such as the translations its views read. */
    assetPath: string;
    /** The parent of the note on the share, which the note is shown below. */
    parentNoteId: string | null;
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
 * their own, as the app mounts every view. A click on a link into the note tree the views render,
 * which the app's link handler opens in the app, opens the note's shared page.
 */
export default function ShareAppHost({ noteId, payload, children }: ShareAppHostProps) {
    const [ app ] = useState(() => loadPayload(noteId, payload));
    const [ component ] = useState(() => new Component());

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

    return app && (
        <ParentComponent.Provider value={component}>
            {children(app)}
        </ParentComponent.Provider>
    );
}

function loadPayload(noteId: string, payload: AppPayload): HostedApp | null {
    const { options: optionValues, links, ...rows } = payload;
    options.load(Object.fromEntries(Object.entries(optionValues)
        .flatMap(([ name, value ]) => (value === null ? [] : [ [ name, value ] ]))));

    froca.setSource(createShareFrocaSource(links));
    linkContextMenu.setShareLinkResolver((linkedNoteId) => links[linkedNoteId] ?? null);
    froca.addResp({
        ...rows,
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
        hasLink: (linkedNoteId) => !!links[linkedNoteId]
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
