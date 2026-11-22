import type {
    CreateReferenceRequest, MarkedHeadingsResponse, NoteReferencesResponse, PendingToc,
    ReferenceConflictResponse, ReferenceParams, ReferenceTarget
} from "@triliumnext/commons";

import BAttachment from "../../becca/entities/battachment.js";
import type BNote from "../../becca/entities/bnote.js";
import { ConflictError, DetailedConflictError, ValidationError } from "../../errors.js";
import markdownReferences from "./markdown.js";
import textReferences from "./text.js";
import tocReferences from "./toc.js";

/** What a provider reads targets from: a note, or an attachment of a note. */
export type ReferenceSource = BNote | BAttachment;

/** What a provider found, with what the listing reports besides the targets. */
export interface FoundTargets {
    targets: ReferenceTarget[];
    /** The blob that the targets were read from, when it is not the one the source had first. */
    blobId?: string;
    /** Set when the targets come from a table of contents that the viewer has yet to build. */
    pendingToc?: PendingToc;
}

/**
 * Lists the places inside the content of one kind of note that a link can point at, and gives a
 * place a reference when it has none yet.
 */
export interface ReferenceProvider {
    /** Whether the provider reads the content of notes of `type` and `mime`. */
    isFor(type: string, mime: string): boolean;
    /** The targets of `source`, in the order that the lists show them. */
    findTargets(
        source: ReferenceSource
    ): ReferenceTarget[] | FoundTargets | Promise<ReferenceTarget[] | FoundTargets>;
    /**
     * `content` with a reference to the target that `request` names, and the link parameters of
     * the target, or `null` when no target matches. Needed only when `findTargets()` lists targets
     * without `params`. Synchronous, as the route reads and writes in one transaction.
     */
    createReference?(
        content: string | Uint8Array, request: CreateReferenceRequest
    ): CreatedReference | null;
    /** Whether `createReference()` finds a target by `request.line`, in a source of its own. */
    acceptsLine?: boolean;
    /**
     * The heading targets of `content`, and `content` with each of them marked with its position.
     * HTML only. `null` when the content cannot be marked.
     */
    markHeadings?(content: string | Uint8Array): Omit<MarkedHeadingsResponse, "blobId"> | null;
}

export interface CreatedReference {
    /** The content to save, `content` itself when the target has a reference already. */
    content: string | Uint8Array;
    params: ReferenceParams;
}

/** The providers that apps bring, after the built-in ones. */
let registeredProviders: ReferenceProvider[] = [];

/** Adds a provider that an app brings, such as one built on a parser that needs Node. */
export function registerReferenceProvider(provider: ReferenceProvider) {
    registeredProviders = [ ...registeredProviders, provider ];
}

export function unregisterReferenceProvider(provider: ReferenceProvider) {
    registeredProviders = registeredProviders.filter((other) => other !== provider);
}

/**
 * The targets of `source`, none when no provider reads it, and the blob that they were read
 * from. A target without `params` is left out when its provider cannot create references, or
 * when the content of `source` cannot be saved.
 */
export async function findReferenceTargets(
    source: ReferenceSource
): Promise<NoteReferencesResponse> {
    const provider = getProvider(source);
    if (!provider) {
        return { targets: [] };
    }

    // The blob is read together with the content, before the provider can wait.
    const { blobId } = source;
    const found = await provider.findTargets(source);
    const { targets, pendingToc, blobId: readBlobId = blobId } = Array.isArray(found)
        ? { targets: found }
        : found;
    const isWritable = provider.createReference && isContentWritable(source);
    return {
        targets: isWritable ? targets : targets.filter((target) => target.params),
        blobId: readBlobId,
        ...(pendingToc ? { pendingToc } : {})
    };
}

/**
 * Gives the target of `note` that `request` names a reference, unless it has one, and returns the
 * link parameters of the target. Read-only notes get it too: a reference is invisible. A request
 * picked from a listing of another blob is refused: neither the index nor the title shows which
 * target was picked.
 */
export function createReference(note: BNote, request: CreateReferenceRequest) {
    const provider = getProvider(note);
    if (!provider?.createReference) {
        throw new ValidationError(`The targets of note '${note.noteId}' take no references.`);
    }
    if (!note.isContentWritable()) {
        throw new ValidationError(`The content of note '${note.noteId}' cannot be changed.`);
    }
    if (request.line !== undefined && !provider.acceptsLine) {
        throw new ValidationError(`The targets of note '${note.noteId}' are not found by line.`);
    }
    if (request.blobId !== undefined && request.blobId !== note.blobId) {
        const message = `The targets of note '${note.noteId}' changed since they were listed.`;
        throw new DetailedConflictError<ReferenceConflictResponse>(message, {
            reason: "listing", message
        });
    }

    const content = readContent(note);
    const created = provider.createReference(content, request);
    // The message leaves the title out: it reaches the log, and it can come from a protected note.
    if (!created) {
        const place = request.line === undefined ? request.index : `at line ${request.line}`;
        throw new ConflictError(`The targets of note '${note.noteId}' changed: `
            + `${request.kind} ${place} was not found.`);
    }

    // A plain save: a reference is invisible, so it takes no revision and changes no link.
    if (created.content !== content) {
        note.setContent(created.content);
    }
    return created.params;
}

/**
 * The heading targets of `note` before any filtering, its content with each of them marked with
 * its position, and the blob both were read from. Writes nothing.
 */
export function findMarkedHeadings(note: BNote): MarkedHeadingsResponse {
    const { blobId } = note;
    const marked = getProvider(note)?.markHeadings?.(readContent(note));
    if (!marked) {
        throw new ValidationError(`The headings of note '${note.noteId}' cannot be marked.`);
    }
    return { blobId, ...marked };
}

/**
 * The content of `source`, for a provider that reads it. Throws `ValidationError` for a protected
 * source outside a protected session.
 */
export function readContent(source: ReferenceSource): string | Uint8Array {
    if (!source.isContentAvailable()) {
        const name = source instanceof BAttachment
            ? `Attachment '${source.attachmentId}'`
            : `Note '${source.noteId}'`;
        throw new ValidationError(`${name} has no content available.`);
    }
    return source.getContent();
}

/** The first provider whose `isFor()` accepts the source reads it. */
function getProvider(source: ReferenceSource) {
    // An attachment of the role `file` reads like a note of the type `file`.
    const type = source instanceof BAttachment ? source.role : source.type;
    return [ textReferences, markdownReferences, tocReferences, ...registeredProviders ]
        .find((provider) => provider.isFor(type, source.mime));
}

function isContentWritable(source: ReferenceSource) {
    return !(source instanceof BAttachment) && source.isContentWritable();
}
