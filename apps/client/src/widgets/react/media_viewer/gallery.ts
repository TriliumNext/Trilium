import { useEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import type { ViewScope } from "../../../services/link";
import type LoadResults from "../../../services/load_results";
import { createImageSrcUrl } from "../../../services/utils";
import { useTriliumEvent } from "../hooks";
import { getParentFromNotePath } from "../sibling_navigation";

/** One viewable image of a gallery: a note of type `image` or an image-role attachment. */
export interface MediaViewerItem {
    /** noteId or attachmentId, depending on {@link MediaViewerItem.kind}. */
    id: string;
    title: string;
    /** Full-resolution URL, versioned (`?v=`) by the content so it stays stable until the content changes. */
    src: string;
    /** Drives download/open-externally routing. */
    kind: "note" | "attachment";
    mime: string;
}

/**
 * The gallery a media viewer operates over: the ordered viewable items, which one is current, and
 * app-navigation-driven movement between them (prev/next wrap around). `items` is seeded synchronously
 * with the current item where possible and expands once the siblings load.
 */
export interface MediaGallery {
    items: MediaViewerItem[];
    /** Index of the current item within {@link items}; -1 when it is missing (e.g. still loading). */
    currentIndex: number;
    /** Stable identity of the viewing surface (parent + kind); changes only when the collection identity does. */
    surfaceKey: string;
    navigateToIndex(index: number): void;
    navigatePrevious(): void;
    navigateNext(): void;
    navigateFirst(): void;
    navigateLast(): void;
}

/** Gallery over the current note and its image-type siblings within the parent of the current tab (clone-aware). */
export function useImageNoteGallery(note: FNote, noteContext: NoteContext | undefined): MediaGallery {
    const parent = getParentFromNotePath(noteContext?.notePath);
    return useMediaGallery({
        currentId: note.noteId,
        // The note prop lags one render behind rapid navigation; the context's notePath is
        // updated synchronously by setNote, so it is the authoritative "where are we now".
        liveCurrentId: () => noteContext?.notePath?.split("/").at(-1) ?? note.noteId,
        surfaceKey: `note-gallery:${parent?.parentPath ?? note.noteId}`,
        seedItems: () => buildNoteGalleryItems([], note),
        loadItems: async () => {
            if (!parent) return buildNoteGalleryItems([], note);
            const parentNote = await froca.getNote(parent.parentNoteId);
            const children = (await parentNote?.getChildNotes()) ?? [];
            return buildNoteGalleryItems(children, note);
        },
        navigateTo: (id) => {
            if (parent) void noteContext?.setNote(`${parent.parentPath}/${id}`);
        },
        shouldRefresh: (loadResults, itemIds) => !!parent && noteGalleryShouldRefresh(loadResults, parent.parentNoteId, itemIds)
    });
}

/** Gallery over the note's attachments sharing the currently-shown attachment's role (e.g. image-with-image). */
export function useImageAttachmentGallery(note: FNote | undefined, noteContext: NoteContext | undefined, viewScope: ViewScope | undefined): MediaGallery {
    const attachmentId = viewScope?.attachmentId;
    // Key on the role rather than the id, so cycling same-role attachments keeps the loaded gallery.
    const role = note?.attachments?.find((attachment) => attachment.attachmentId === attachmentId)?.role;
    return useMediaGallery({
        currentId: attachmentId,
        // Same live-over-lagged rule as note galleries, via the context's synchronously
        // updated viewScope.
        liveCurrentId: () => noteContext?.viewScope?.attachmentId ?? attachmentId,
        surfaceKey: `attachment-gallery:${note?.noteId ?? ""}:${role ?? attachmentId ?? ""}`,
        seedItems: () => [],
        loadItems: async () => {
            if (!note || !attachmentId) return [];
            return buildAttachmentGalleryItems(Array.from(await note.getAttachments()), attachmentId);
        },
        navigateTo: (id) => {
            const notePath = noteContext?.notePath;
            if (notePath) void noteContext?.setNote(notePath, { viewScope: { ...viewScope, attachmentId: id } });
        },
        shouldRefresh: (loadResults) => !!note && attachmentGalleryShouldRefresh(loadResults, note.noteId)
    });
}

/** The pluggable parts distinguishing the note gallery from the attachment gallery. */
interface MediaGalleryProvider {
    /** Id of the item currently shown; undefined when there is nothing to show. */
    currentId: string | undefined;
    /**
     * Resolves the current item id at call time, ahead of the next render. Relative navigation
     * uses this so that a second navigation issued before the props caught up (rapid keys,
     * swipes) moves from where the app actually is — not from the previous render's snapshot.
     */
    liveCurrentId?(): string | undefined;
    /** See {@link MediaGallery.surfaceKey}; also the load effect's key. */
    surfaceKey: string;
    /** Synchronous best-effort items shown until {@link loadItems} resolves. */
    seedItems(): MediaViewerItem[];
    /** Loads the ordered gallery items (including the current one where resolvable). */
    loadItems(): Promise<MediaViewerItem[]>;
    /** Navigates the current tab to the item with the given id. */
    navigateTo(id: string): void;
    /** Whether an `entitiesReloaded` event touches this gallery (given the currently-loaded item ids). */
    shouldRefresh(loadResults: LoadResults, itemIds: string[]): boolean;
}

/**
 * The shared gallery engine: loads the items, keeps them fresh across entity/froca reloads, and exposes
 * wrap-around navigation. Navigation drives the app (via the provider), not the viewer directly — the
 * resulting prop change flows back down as a new `currentIndex`.
 */
function useMediaGallery(provider: MediaGalleryProvider): MediaGallery {
    const [ loaded, setLoaded ] = useState<{ key: string; items: MediaViewerItem[] } | null>(null);
    const [ refreshCounter, setRefreshCounter ] = useState(0);
    // Read the freshest provider from inside async work/listeners without re-running effects per render.
    const providerRef = useRef(provider);
    providerRef.current = provider;

    const { surfaceKey, currentId } = provider;

    useEffect(() => {
        let active = true;
        providerRef.current.loadItems()
            .then((items) => { if (active) setLoaded({ key: surfaceKey, items }); })
            .catch(() => { if (active) setLoaded({ key: surfaceKey, items: [] }); });
        return () => { active = false; };
    }, [ surfaceKey, refreshCounter ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const itemIds = (loaded?.key === surfaceKey ? loaded.items : []).map((item) => item.id);
        if (providerRef.current.shouldRefresh(loadResults, itemIds)) {
            setRefreshCounter((counter) => counter + 1);
        }
    });

    // froca replaces every cached entity on a full reload (e.g. a protected-session unlock).
    useTriliumEvent("frocaReloaded", () => setRefreshCounter((counter) => counter + 1));

    // Until the load for this surface resolves, fall back to the synchronous seed.
    const items = loaded?.key === surfaceKey ? loaded.items : provider.seedItems();
    const currentIndex = currentId ? items.findIndex((item) => item.id === currentId) : -1;

    const navigateToIndex = (index: number) => {
        if (items.length < 2) return;
        const item = items[((index % items.length) + items.length) % items.length];
        if (item) providerRef.current.navigateTo(item.id);
    };

    // Relative navigation resolves "current" at call time (see liveCurrentId): during rapid
    // navigation the rendered currentIndex is one step behind the app.
    const resolveCurrentIndex = () => {
        const liveId = providerRef.current.liveCurrentId?.();
        if (liveId) {
            const liveIndex = items.findIndex((item) => item.id === liveId);
            if (liveIndex >= 0) return liveIndex;
        }
        return currentIndex;
    };

    return {
        items,
        currentIndex,
        surfaceKey,
        navigateToIndex,
        navigatePrevious: () => navigateToIndex(resolveCurrentIndex() - 1),
        navigateNext: () => navigateToIndex(resolveCurrentIndex() + 1),
        navigateFirst: () => navigateToIndex(0),
        navigateLast: () => navigateToIndex(items.length - 1)
    };
}

/**
 * Maps the candidate sibling notes to gallery items, keeping only available image notes. The current
 * note is guaranteed to be represented: when it is not among the (filtered) candidates — no parent, no
 * loaded siblings yet, or an unexpected surface — the gallery degrades to just the current note.
 */
export function buildNoteGalleryItems(candidates: readonly FNote[], currentNote: FNote): MediaViewerItem[] {
    const items = candidates
        .filter((note) => note.type === "image" && note.isContentAvailable())
        .map((note) => toNoteItem(note));
    return items.some((item) => item.id === currentNote.noteId) ? items : [ toNoteItem(currentNote) ];
}

function toNoteItem(note: FNote): MediaViewerItem {
    return {
        id: note.noteId,
        title: note.title,
        src: createImageSrcUrl(note),
        kind: "note",
        mime: note.mime
    };
}

/**
 * Maps the note's attachments sharing the current attachment's role to gallery items (so the viewer
 * cycles e.g. image-with-image). Empty when the current attachment is absent.
 */
export function buildAttachmentGalleryItems(attachments: readonly FAttachment[], currentAttachmentId: string | undefined): MediaViewerItem[] {
    const role = attachments.find((attachment) => attachment.attachmentId === currentAttachmentId)?.role;
    if (!role) return [];
    return attachments
        .filter((attachment) => attachment.role === role)
        .map((attachment) => ({
            id: attachment.attachmentId,
            title: attachment.title,
            src: `api/attachments/${attachment.attachmentId}/image/${encodeURIComponent(attachment.title)}?v=${encodeURIComponent(attachment.blobId ?? attachment.utcDateModified)}`,
            kind: "attachment" as const,
            mime: attachment.mime
        }));
}

/** Whether an `entitiesReloaded` event touches the note gallery: the parent's tree or a member note changed. */
export function noteGalleryShouldRefresh(loadResults: LoadResults, parentNoteId: string, itemIds: readonly string[]): boolean {
    return loadResults.getBranchRows().some((branch) => branch.parentNoteId === parentNoteId)
        || loadResults.getNoteIds().some((noteId) => itemIds.includes(noteId));
}

/** Whether an `entitiesReloaded` event touches the attachment gallery: the owning note's attachments changed. */
export function attachmentGalleryShouldRefresh(loadResults: LoadResults, ownerNoteId: string): boolean {
    return loadResults.getAttachmentRows().some((row) => row.ownerId === ownerNoteId);
}
