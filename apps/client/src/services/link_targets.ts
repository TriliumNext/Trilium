import type {
    CreateReferenceRequest, CreateReferenceResponse, MarkedHeadingsResponse,
    NoteReferencesResponse, ReferenceConflictResponse, ReferenceKind, ReferenceLocator,
    ReferenceParams, ReferenceTarget
} from "@triliumnext/commons";
import {
    encodeBlockParameter, resolveBlockReference
} from "@triliumnext/commons/src/lib/block_reference.js";
import { HEADING_INDEX_ATTRIBUTE } from "@triliumnext/commons/src/lib/reference_targets.js";
import { LINK_TARGET_PARAMS } from "@triliumnext/commons/src/lib/server_api.js";
import { getHeadingAncestors } from "@triliumnext/commons/src/lib/toc.js";

import appContext from "../components/app_context";
import froca from "./froca";
import { t } from "./i18n";
import { getTocUrl, rememberHeadingTitles, type ViewScope } from "./link";
import { parseConflict } from "./note_save";
import server from "./server";

/** A place inside a note that a link can point at, such as a heading or an anchor. */
export interface LinkTarget {
    kind: ReferenceKind;
    title: string;
    /** For a kind that nests, the depth of the target, such as 2 for an `<h2>`. */
    level?: number;
    /** The link parameters that point at the target, absent while it has no reference. */
    params?: ReferenceParams;
    /** Gives the target a reference if it needs one, and returns the note path of a link to it. */
    createLinkPath(): string;
    /**
     * Gives a target of another note a reference on the server, before `createLinkPath()` is
     * called. Rejects when the server cannot give one.
     */
    createReference?(): Promise<void>;
}

/** How the lists of link targets show the targets of one kind. */
export interface LinkTargetKind {
    /** The icon of each target, with its `bx` prefix. */
    icon: string;
    /** The heading over the targets of the kind in the lists of a note. */
    getTitle(): string;
    /**
     * Whether a link without a text of its own mirrors the title of the target, as a link to a
     * heading shows its text. Otherwise the link mirrors the title of the note.
     */
    isTitleMirrored: boolean;
}

export const LINK_TARGET_KINDS: Record<ReferenceKind, LinkTargetKind> = {
    heading: {
        icon: "bx bx-heading",
        getTitle: () => t("add_link.link_to_heading"),
        isTitleMirrored: true
    },
    anchor: {
        icon: "bx bx-bookmark",
        getTitle: () => t("add_link.link_to_anchor"),
        isTitleMirrored: false
    }
};

/** The targets of a note or an attachment that the server lists. */
export interface LinkTargetListing {
    targets: LinkTarget[];
    /**
     * Whether the document has a table of contents that its viewer builds the first time it opens
     * the document, so that its headings are listed only then.
     */
    isTocPending: boolean;
}

/**
 * What `LinkTarget.createReference()` rejects with when the note changed since its targets were
 * listed: the target picked is then not known for sure, and the targets have to be listed again.
 */
export class StaleListingError extends Error {}

/**
 * The targets of the note `noteId` that the server reads, which link to it at `notePath`. A note
 * that is protected outside a protected session has none.
 */
export async function getLinkTargets(noteId: string, notePath: string): Promise<LinkTargetListing> {
    try {
        const note = await froca.getNote(noteId);
        if (!note?.isContentAvailable()) return noTargets();

        // Saved first, so that the save before a reference leaves the listing as it is.
        await appContext.triggerEvent("saveNoteChanges", { noteId });
        const { targets, blobId, pendingToc } = await server.get<NoteReferencesResponse>(
            `notes/${noteId}/references`, undefined, false, { silentBadRequest: true }
        );
        rememberLinkedHeadings(getTocUrl("notes", noteId), blobId, targets);
        const counts = new Map<ReferenceKind, number>();
        const noteTargets = targets.map((target) => {
            const index = counts.get(target.kind) ?? 0;
            counts.set(target.kind, index + 1);
            return createNoteTarget(noteId, notePath, target, index, blobId);
        });
        return { targets: noteTargets, isTocPending: !!pendingToc };
    } catch (e) {
        console.error(`Failed to read the link targets of note '${noteId}':`, e);
        return noTargets();
    }
}

/**
 * The targets of the attachment `attachmentId` of the note `noteId`, such as the headings of a
 * PDF, which link to it at `linkPath`. An attachment that is protected outside a protected
 * session has none.
 */
export async function getAttachmentLinkTargets(
    noteId: string, attachmentId: string, linkPath: string
): Promise<LinkTargetListing> {
    try {
        const note = await froca.getNote(noteId);
        if (!note?.isContentAvailable()) return noTargets();

        const { targets, blobId, pendingToc } = await server.get<NoteReferencesResponse>(
            `attachments/${attachmentId}/references`, undefined, false,
            { silentBadRequest: true, silentNotFound: true }
        );
        rememberLinkedHeadings(getTocUrl("attachments", attachmentId), blobId, targets);
        const attachmentTargets = targets.map(({ kind, title, level, params }): LinkTarget => ({
            kind, title, level, params, createLinkPath: () => addParameters(linkPath, params)
        }));
        return { targets: attachmentTargets, isTocPending: !!pendingToc };
    } catch (e) {
        console.error(`Failed to read the link targets of attachment '${attachmentId}':`, e);
        return noTargets();
    }
}

/**
 * What the lists show for a note without targets: that its viewer lists its headings once it has
 * opened it, when `isTocPending`.
 */
export function getNoTargetsText(isTocPending: boolean) {
    return isTocPending ? t("add_link.open_file_for_targets") : t("add_link.no_link_targets");
}

function noTargets(): LinkTargetListing {
    return { targets: [], isTocPending: false };
}

/** Remembers the titles of the headings that `targets` link to, for the labels of such links. */
function rememberLinkedHeadings(
    tocUrl: string, blobId: string | undefined, targets: ReferenceTarget[]
) {
    const headings = targets.flatMap(({ title, params }) =>
        params?.heading ? [ { id: params.heading, title } ] : []);
    if (blobId && headings.length > 0) {
        rememberHeadingTitles(tocUrl, blobId, headings);
    }
}

/**
 * The `index`-th target of its kind that the server lists for note `noteId` from its blob
 * `blobId`, which links to it in the note at `notePath`, and which the server gives a reference
 * when it has none.
 */
function createNoteTarget(
    noteId: string, notePath: string, { kind, title, level, params }: ReferenceTarget,
    index: number, blobId: string | undefined
): LinkTarget {
    const target: LinkTarget = {
        kind,
        title,
        level,
        params,
        createLinkPath: () => addParameters(notePath, target.params),
        async createReference() {
            if (target.params) return;
            // An editor with unsaved changes skips the content the server writes, and its next
            // save would drop the reference.
            await appContext.triggerEvent("saveNoteChanges", { noteId });
            target.params = await postReference(noteId, { kind, index, title, blobId });
        }
    };
    return target;
}

/**
 * Requests a reference for the target that `request` names, and returns the link
 * parameters. Rejects with `StaleListingError` when the note is no longer at `request.blobId`.
 */
async function postReference(noteId: string, request: CreateReferenceRequest) {
    try {
        const response = await server.postWithSilentErrors<CreateReferenceResponse>(
            `notes/${noteId}/references`, request
        );
        return response.params;
    } catch (e) {
        if (parseConflict<ReferenceConflictResponse>(e)?.reason === "listing") {
            throw new StaleListingError(`The targets of note '${noteId}' changed.`);
        }
        throw e;
    }
}

/** A heading of the document in a text editor, as the editor lists it. */
interface EditorHeading {
    text: string;
    level: number;
    blockId?: string;
}

/**
 * The `headings` of the document in a text editor, which link to their blocks in the note at
 * `notePath`. `assignBlockId` returns the block id of a heading, which the editor gives one first
 * if it has none, or `undefined` once the editor is gone.
 */
export function createEditorHeadings<T extends EditorHeading>(
    headings: T[], notePath: string, assignBlockId: (heading: T) => string | undefined
): LinkTarget[] {
    return headings.map((heading) => ({
        kind: "heading",
        title: heading.text,
        level: heading.level,
        params: heading.blockId ? { block: heading.blockId } : undefined,
        createLinkPath() {
            const blockId = assignBlockId(heading);
            return blockId ? addParameters(notePath, { block: blockId }) : notePath;
        }
    }));
}

/** The anchors `names` of the note at `notePath`, which link to it through `?bookmark=`. */
export function createAnchorTargets(names: string[], notePath: string): LinkTarget[] {
    return names.map((name) => {
        const params = { bookmark: name };
        return {
            kind: "anchor",
            title: name,
            params,
            createLinkPath: () => addParameters(notePath, params)
        };
    });
}

/** A heading in an editor of a note, for `createEditorTarget()`. */
export interface EditorTargetOptions {
    noteId: string;
    notePath: string;
    title: string;
    level: number;
    /** The id of the heading, which the editor gives it first if it has none; `null` if gone. */
    assignId(): string | null | undefined;
    /** Whether `id` resolves to a heading in `content`, the saved content of the note. */
    isSaved(content: string, id: string): boolean;
}

/**
 * A heading of the document in an editor of the note, for a link from outside the editor.
 * `createReference()` takes the id that `assignId()` returns, saves the note, reads the note as
 * saved on the server, and resolves once `isSaved()` finds the id there.
 */
export function createEditorTarget(options: EditorTargetOptions): LinkTarget {
    const { noteId, notePath, title, level } = options;
    const target: LinkTarget = {
        kind: "heading",
        title,
        level,
        createLinkPath: () => addParameters(notePath, target.params),
        async createReference() {
            const id = options.assignId();
            if (!id) {
                throw new Error(`The editor of note '${noteId}' no longer shows the heading.`);
            }

            await appContext.triggerEvent("saveNoteChanges", { noteId });
            // Not `froca.getBlob()`: its cache can answer with the blob from before the save.
            const { content } = await server.getWithSilentErrors<{ content: unknown }>(
                `notes/${noteId}/blob`
            );
            if (typeof content !== "string" || !options.isSaved(content, id)) {
                throw new Error(`The saved content of note '${noteId}' lacks the heading's id.`);
            }
            target.params = { block: id };
        }
    };
    return target;
}

/** A heading of one version of a note: its locator and its title, in the blob `blobId`. */
export type SavedHeadingRequest = { title: string } & ReferenceLocator & { blobId: string };

/**
 * The heading that `request` names in the blob `request.blobId` of the note `noteId`.
 * `createReference()` saves the editors of the note, then requests a reference, and rejects
 * with `StaleListingError` when the note is no longer at that blob.
 */
export function createSavedHeadingTarget(
    noteId: string, notePath: string, request: SavedHeadingRequest
): LinkTarget {
    const target: LinkTarget = {
        kind: "heading",
        title: request.title,
        createLinkPath: () => addParameters(notePath, target.params),
        async createReference() {
            if (target.params) return;
            await appContext.triggerEvent("saveNoteChanges", { noteId });
            target.params = await postReference(noteId, { kind: "heading", ...request });
        }
    };
    return target;
}

/** A heading whose link parameters are in the saved note already, such as an owned block id. */
export function createLinkedTarget(
    notePath: string, title: string, params: ReferenceParams
): LinkTarget {
    return {
        kind: "heading",
        title,
        params,
        createLinkPath: () => addParameters(notePath, params)
    };
}

/** The headings of the note `noteId` as saved on the server now, with the marked content. */
export function getMarkedHeadings(noteId: string) {
    return server.getWithSilentErrors<MarkedHeadingsResponse>(
        `notes/${noteId}/references/marked`
    );
}

/**
 * The position that `marked` gives `element`, one of `shown`: the headings of a page showing the
 * same blob, in document order. `null` when the parse of the marked content does not show the
 * same headings one for one, or the heading has no mark of this listing.
 */
export function findMarkedIndex(
    marked: MarkedHeadingsResponse, shown: Element[], element: Element
): number | null {
    const parsed = Array.from(parseAsPage(marked.markedContent).querySelectorAll(HEADING_TAGS))
        .filter((heading) => !heading.closest(".include-note"));
    const position = shown.indexOf(element);
    const isSameHeadings = parsed.length === shown.length
        && parsed.every((heading, index) => heading.tagName === shown[index].tagName);
    if (position < 0 || !isSameHeadings) {
        return null;
    }

    const prefix = `${marked.markToken}.`;
    const value = parsed[position].getAttribute(HEADING_INDEX_ATTRIBUTE) ?? "";
    const digits = value.slice(prefix.length);
    const index = Number(digits);
    return value.startsWith(prefix) && /^(?:0|[1-9]\d*)$/.test(digits)
        && Number.isSafeInteger(index)
        ? index
        : null;
}

/** Whether `id` resolves to a heading in `content`, the HTML of a text note. */
export function isTextHeadingId(content: string, id: string) {
    const { start } = resolveBlockReference(parseAsPage(content), id);
    return !!start?.tagName && /^H[1-6]$/i.test(start.tagName);
}

const HEADING_TAGS = "h1,h2,h3,h4,h5,h6";

/**
 * `html` parsed into a template, by the rules that a page's `<div>` parses its `innerHTML` by. A
 * template starts in its own rules for table parts; a leading `<wbr>` switches it to the page's.
 */
function parseAsPage(html: string) {
    const template = document.createElement("template");
    template.innerHTML = `<wbr>${html}`;
    return template.content;
}

/**
 * The targets nested under each target of `targets`, with the top level under `null`. A target
 * with a `level` nests under the closest target of its kind before it with a lower level.
 */
export function nestTargets(targets: LinkTarget[]) {
    const tree = new Map<LinkTarget | null, LinkTarget[]>();
    for (const [ target, ancestors ] of getTargetAncestors(targets)) {
        const parent = ancestors.at(-1) ?? null;
        tree.set(parent, [ ...(tree.get(parent) ?? []), target ]);
    }

    return tree;
}

/**
 * The targets that each target of `targets` nests under, the outermost first, as `nestTargets()`
 * nests them.
 */
export function getTargetAncestors(targets: LinkTarget[]) {
    const ancestors = getHeadingAncestors(
        targets, (target) => target.level, (target) => target.kind);
    return new Map(targets.map((target, index) => [ target, ancestors[index] ]));
}

/** The targets that `target` nests under in `targetTree`, from its parent up. */
export function getParentTargets(
    targetTree: Map<LinkTarget | null, LinkTarget[]>, target: LinkTarget
) {
    const parents: LinkTarget[] = [];
    let child = target;
    for (;;) {
        const parent = [ ...targetTree ].find(([ , children ]) => children.includes(child))?.[0];
        if (!parent) return parents;
        parents.push(parent);
        child = parent;
    }
}

/** The target of `targets` whose link parameters are exactly `params`, if there is one. */
export function findTarget(targets: LinkTarget[], params: ReferenceParams) {
    const names = Object.keys(params);
    return targets.find((target) => {
        const targetParams = target.params ?? {};
        return Object.keys(targetParams).length === names.length && names.length > 0
            && names.every((name) => targetParams[name] === params[name]);
    });
}

/** `notePath` without the link parameters that point inside the note, and those parameters. */
export function splitTargetParameters(notePath: string) {
    const [ path, query = "" ] = notePath.split("?", 2);
    const params = new URLSearchParams(query);
    const targetParams: ReferenceParams = {};
    for (const name of LINK_TARGET_PARAMS) {
        const value = params.get(name);
        if (value !== null) {
            targetParams[name] = value;
            params.delete(name);
        }
    }
    if (Object.keys(targetParams).length === 0) {
        return { path: notePath, params: targetParams };
    }

    const rest = params.toString();
    return { path: rest ? `${path}?${rest}` : path, params: targetParams };
}

/** `notePath` with the link parameters `params`, which are not encoded yet. */
export function addParameters(notePath: string, params: ReferenceParams = {}) {
    let path = notePath;
    for (const [ name, value ] of Object.entries(params)) {
        const encoded = name === "block" ? encodeBlockParameter(value) : encodeURIComponent(value);
        path = `${path}${path.includes("?") ? "&" : "?"}${name}=${encoded}`;
    }
    return path;
}

/** A parameter of a link that points inside a note, such as `block` or `page`. */
export type LinkTargetParam = (typeof LINK_TARGET_PARAMS)[number];

/** The place that a link opens a note at, as {@link takeLinkTarget} reads it from a view scope. */
export interface LandingTarget {
    block?: string;
    bookmark?: string;
    /** The page number, absent unless the `page` parameter is a whole number of at least 1. */
    page?: number;
    annotation?: string;
    heading?: string;
}

/**
 * Takes the link parameters `names` out of `viewScope`, setting them to `undefined` so that a link
 * lands once, and returns them with the page parsed. Returns `undefined` and leaves `viewScope` as
 * it is when it holds none of them.
 */
export function takeLinkTarget(
    viewScope: ViewScope | null | undefined, names: readonly LinkTargetParam[]
): LandingTarget | undefined {
    if (!viewScope || !names.some((name) => viewScope[name])) {
        return undefined;
    }

    const params: Partial<Record<LinkTargetParam, string | undefined>> = {};
    for (const name of names) {
        params[name] = viewScope[name];
        viewScope[name] = undefined;
    }
    return toLandingTarget(params);
}

/** The place that the link parameters `params` name, with the page parsed. */
export function toLandingTarget(
    params: Partial<Record<LinkTargetParam, string | undefined>>
): LandingTarget {
    const target: LandingTarget = {};
    for (const name of LINK_TARGET_PARAMS) {
        if (!(name in params)) {
            continue;
        }
        const value = params[name];
        if (name === "page") {
            const page = Number.parseInt(value ?? "", 10);
            target.page = page >= 1 ? page : undefined;
        } else {
            target[name] = value;
        }
    }
    return target;
}
