import type {
    CreateReferenceRequest, ReferenceParams, ReferenceTarget
} from "@triliumnext/commons";

import type BNote from "../../becca/entities/bnote.js";
import { ConflictError, ValidationError } from "../../errors.js";
import textReferences from "./text.js";

/**
 * Lists the places inside the content of one kind of note that a link can point at, and gives a
 * place a reference when it has none yet.
 */
export interface ReferenceProvider {
    /** Whether the provider reads the content of notes of `type` and `mime`. */
    isFor(type: string, mime: string): boolean;
    /** The targets in `content`, in the order that the lists show them. */
    findTargets(content: string | Uint8Array): ReferenceTarget[] | Promise<ReferenceTarget[]>;
    /**
     * `content` with a reference to the target that `request` names, and the link parameters of
     * the target, or `null` when no target matches. Needed only when `findTargets()` lists targets
     * without `params`. Synchronous, as the route reads and writes in one transaction.
     */
    createReference?(
        content: string | Uint8Array, request: CreateReferenceRequest
    ): CreatedReference | null;
}

export interface CreatedReference {
    /** The content to save, `content` itself when the target has a reference already. */
    content: string | Uint8Array;
    params: ReferenceParams;
}

/** The first provider whose `isFor()` accepts a note reads it. */
let providers: ReferenceProvider[] = [ textReferences ];

/** Adds a provider that an app brings, such as one built on a parser that needs Node. */
export function registerReferenceProvider(provider: ReferenceProvider) {
    providers = [ ...providers, provider ];
}

export function unregisterReferenceProvider(provider: ReferenceProvider) {
    providers = providers.filter((other) => other !== provider);
}

/**
 * The targets of `note`, none when no provider reads it. A target without `params` is left out
 * when its provider cannot create references, or when the content of `note` cannot be saved.
 */
export async function findReferenceTargets(note: BNote): Promise<ReferenceTarget[]> {
    const provider = getProvider(note);
    if (!provider) {
        return [];
    }

    const targets = await provider.findTargets(getContent(note));
    if (provider.createReference && note.isContentWritable()) {
        return targets;
    }
    return targets.filter((target) => target.params);
}

/**
 * Gives the target of `note` that `request` names a reference, unless it has one, and returns the
 * link parameters of the target. Read-only notes get it too: a reference is invisible.
 */
export function createReference(note: BNote, request: CreateReferenceRequest) {
    const provider = getProvider(note);
    if (!provider?.createReference) {
        throw new ValidationError(`The targets of note '${note.noteId}' take no references.`);
    }
    if (!note.isContentWritable()) {
        throw new ValidationError(`The content of note '${note.noteId}' cannot be changed.`);
    }

    const content = getContent(note);
    const created = provider.createReference(content, request);
    // The message leaves the title out: it reaches the log, and it can come from a protected note.
    if (!created) {
        throw new ConflictError(`The targets of note '${note.noteId}' changed: `
            + `${request.kind} ${request.index} was not found.`);
    }

    // A plain save: a reference is invisible, so it takes no revision and changes no link.
    if (created.content !== content) {
        note.setContent(created.content);
    }
    return created.params;
}

function getProvider(note: BNote) {
    return providers.find((provider) => provider.isFor(note.type, note.mime));
}

function getContent(note: BNote) {
    if (!note.isContentAvailable()) {
        throw new ValidationError(`Note '${note.noteId}' has no content available.`);
    }
    return note.getContent();
}
