import type { NoteType } from "@triliumnext/commons";

import { ValidationError } from "../errors.js";

/**
 * Virtual notes are notes that exist only in becca (and, through it, in the client's froca) —
 * they are never persisted to the database and never produce entity changes, so they are
 * invisible to sync, backups and consistency checks. They are meant for content whose structure
 * is owned by the application (or an external source) rather than by the user: the in-app help,
 * and in the future e.g. computed hierarchies or read-only mounts of external data.
 *
 * A {@link VirtualNoteProvider} declares a subtree of {@link VirtualSubtreeItem}s under an
 * existing anchor note. The subtree is (re)built by `becca_loader` on every becca load, so a
 * provider can be refreshed by triggering `becca_loader.reload()`.
 *
 * Ground rules enforced by this module and the becca entities:
 *
 * - Virtual entities carry `isVirtual = true` and refuse `save()`, `setContent()` and
 *   `markAsDeleted()` — they are read-only and their lifecycle is owned by the provider.
 * - Persisted (non-virtual) branches and attributes may not be attached to virtual notes, so
 *   virtual notes cannot be cloned into the user's tree, moved, or annotated. Relations
 *   *pointing to* virtual notes from regular notes are allowed — the target resolves in becca.
 * - Provider namespaces must start with `_` (the hidden-subtree convention), keeping virtual
 *   notes out of user-facing note operations that already special-case `_`-prefixed IDs.
 */
export interface VirtualNoteProvider {
    /**
     * Unique note-ID prefix owned by this provider (e.g. `_help`). Must start with `_`.
     * Every item ID in the provided subtree must start with this namespace, which guarantees
     * providers cannot collide with each other or with user note IDs.
     */
    namespace: string;

    /**
     * ID of the (persisted) note the virtual subtree is attached under, e.g. `_hidden`.
     * If the anchor is not present in becca at load time (e.g. during initial database
     * creation, before the hidden subtree exists), injection is skipped for that load and
     * happens on the next one.
     */
    parentNoteId: string;

    /**
     * Returns the root item(s) of the virtual subtree. Called on every becca (re)load, so the
     * result may change between calls (e.g. after an application upgrade ships new help pages).
     */
    getSubtree(): VirtualSubtreeItem[];

    /**
     * Content of a virtual note. When absent, or when it returns `null` or `undefined`, the
     * content is `""`.
     */
    getContent?(noteId: string): string | Uint8Array | null | undefined;

    /**
     * Files that the note's content references by URL (pictures, downloads). An export carries
     * them as attachments of the note, so the exported copy works without the provider.
     */
    getAssets?(noteId: string): VirtualNoteAsset[];

    /**
     * Saves new content of a virtual note. Without it, the provider's notes are read-only. The
     * write stays on this instance, since virtual notes never sync.
     */
    setContent?(noteId: string, content: string | Uint8Array): void;
}

export interface VirtualNoteAsset {
    /** Stands in for an attachment ID in an export, so it uses only `[a-zA-Z0-9_]`. */
    id: string;
    /** The URL exactly as `getContent()` writes it into the note. */
    url: string;
    title: string;
    mime: string;
    /** Resolves to `null` when the file cannot be read; the export then leaves it out. */
    getContent(): Promise<Uint8Array | null>;
}

export interface VirtualSubtreeItem {
    /** Must start with the owning provider's namespace. */
    id: string;
    title: string;
    type: NoteType;
    /** MIME type; defaults to "". */
    mime?: string;
    /** Icon in `bx-icon-name` format (without the leading `bx `), exposed as an `iconClass` label. */
    icon?: string;
    attributes?: VirtualSubtreeAttribute[];
    children?: VirtualSubtreeItem[];
    isExpanded?: boolean;
    /** Position among siblings; defaults to definition order. */
    notePosition?: number;
}

export interface VirtualSubtreeAttribute {
    type: "label" | "relation";
    name: string;
    value?: string;
    isInheritable?: boolean;
}

const providers = new Map<string, VirtualNoteProvider>();

/**
 * Registers a provider. Re-registering the same namespace replaces the previous provider
 * (making repeated initialization idempotent). Takes effect on the next becca load, so
 * providers should be registered during application initialization, before the database
 * is ready.
 */
export function registerVirtualNoteProvider(provider: VirtualNoteProvider) {
    if (!provider.namespace.startsWith("_")) {
        throw new Error(`Virtual note provider namespace must start with '_', got '${provider.namespace}'.`);
    }

    for (const existing of providers.keys()) {
        if (existing === provider.namespace) {
            continue; // same namespace replaces the previous registration
        }

        if (existing.startsWith(provider.namespace) || provider.namespace.startsWith(existing)) {
            throw new Error(`Virtual note provider namespace '${provider.namespace}' overlaps with already registered namespace '${existing}'.`);
        }
    }

    providers.set(provider.namespace, provider);
}

export function unregisterVirtualNoteProvider(namespace: string) {
    providers.delete(namespace);
}

export function getVirtualNoteProviders(): VirtualNoteProvider[] {
    return [...providers.values()];
}

/** Returns the provider owning the given note ID, based on its namespace prefix. */
export function getVirtualNoteProvider(noteId: string): VirtualNoteProvider | null {
    for (const provider of providers.values()) {
        if (noteId.startsWith(provider.namespace)) {
            return provider;
        }
    }

    return null;
}

/** Content of a virtual note, delegated to its provider; `""` when the provider has none. */
export function getVirtualNoteContent(noteId: string): string | Uint8Array {
    return getVirtualNoteProvider(noteId)?.getContent?.(noteId) ?? "";
}

/** Whether the provider of a virtual note can save its content. */
export function isVirtualNoteContentWritable(noteId: string) {
    return !!getVirtualNoteProvider(noteId)?.setContent;
}

/** @throws ValidationError when the note's provider cannot save content. */
export function setVirtualNoteContent(noteId: string, content: string | Uint8Array) {
    const provider = getVirtualNoteProvider(noteId);
    if (!provider?.setContent) {
        throw new ValidationError(`Note '${noteId}' is read-only.`);
    }

    provider.setContent(noteId, content);
}

/** Assets of a virtual note, delegated to its provider; empty when the provider has none. */
export function getVirtualNoteAssets(noteId: string): VirtualNoteAsset[] {
    return getVirtualNoteProvider(noteId)?.getAssets?.(noteId) ?? [];
}

/**
 * Rewrites the asset URLs in a virtual note's HTML into the references a persisted note uses for
 * its attachments: `api/attachments/<id>/image/<title>` for a picture, an attachment link for any
 * other file. The export rewrites those references to the exported files.
 */
export function referenceAssetsAsAttachments(noteId: string, content: string, assets: VirtualNoteAsset[]) {
    for (const asset of assets) {
        const attachmentLink = `#root/${noteId}?viewMode=attachments&attachmentId=${asset.id}`;
        if (asset.mime.startsWith("image/")) {
            content = content.replaceAll(`src="${asset.url}"`,
                `src="api/attachments/${asset.id}/image/${encodeURIComponent(asset.title)}"`);
        }
        content = content.replaceAll(`href="${asset.url}"`, `href="${attachmentLink}"`);
    }

    return content;
}
