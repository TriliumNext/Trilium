import type {
    HeadingReference, HeadingReferenceRequest, HeadingReferenceResponse, NoteReferencesResponse
} from "@triliumnext/commons";
import { encodeBlockParameter } from "@triliumnext/commons/src/lib/block_reference.js";

import appContext from "../components/app_context";
import froca from "./froca";
import server from "./server";

/** A heading that a link can point at, in the document the link goes into or in another note. */
export interface LinkHeading {
    title: string;
    /** 1 for `<h1>`, up to 6 for `<h6>`. */
    level: number;
    /** The block id of the heading, if it has one. */
    blockId?: string;
    /** Gives the heading a block id if it has none, and returns the note path of a link to it. */
    createLinkPath(): string;
    /**
     * Gives a heading of another note a block id on the server, before `createLinkPath()` is
     * called. Rejects when the server cannot give one.
     */
    createReference?(): Promise<void>;
}

/** The headings and anchors of a note, which a link to the note can point at. */
export interface LinkTargets {
    /** In document order. */
    headings: LinkHeading[];
    anchors: string[];
}

export const NO_LINK_TARGETS: LinkTargets = { headings: [], anchors: [] };

/**
 * The headings and anchors of the note `noteId` that the server reads, for a link at `notePath`.
 * A note that is not a text note, or is protected outside a protected session, has neither. A note
 * whose content cannot change lists only the headings that have a block id.
 */
export async function getLinkTargets(noteId: string, notePath: string): Promise<LinkTargets> {
    try {
        const note = await froca.getNote(noteId);
        if (note?.type !== "text" || !note.isContentAvailable()) return NO_LINK_TARGETS;

        const { headings, anchors, isWritable } = await server.get<NoteReferencesResponse>(
            `notes/${noteId}/references`, undefined, false, { silentBadRequest: true }
        );
        return {
            headings: headings.flatMap((heading, index) => heading.blockId || isWritable
                ? [ createNoteHeading(noteId, notePath, heading, index) ]
                : []),
            anchors: [ ...anchors ].sort((a, b) => a.localeCompare(b))
        };
    } catch (e) {
        console.error(`Failed to read the headings and anchors of note '${noteId}':`, e);
        return NO_LINK_TARGETS;
    }
}

/**
 * The heading of note `noteId` that the server lists at `index`, which links to its block in the
 * note at `notePath`, and which the server gives a block id when it has none.
 */
function createNoteHeading(
    noteId: string, notePath: string, { level, text, blockId }: HeadingReference, index: number
): LinkHeading {
    const heading: LinkHeading = {
        title: text,
        level,
        blockId,
        createLinkPath() {
            return heading.blockId
                ? addParameter(notePath, "block", encodeBlockParameter(heading.blockId))
                : notePath;
        },
        async createReference() {
            if (heading.blockId) return;
            // An editor with unsaved changes skips the content the server writes, and its next
            // save would drop the id.
            await appContext.triggerEvent("saveNoteChanges", { noteId });
            const request: HeadingReferenceRequest = { index, text };
            const response = await server.postWithSilentErrors<HeadingReferenceResponse>(
                `notes/${noteId}/references/heading`, request
            );
            heading.blockId = response.blockId;
        }
    };
    return heading;
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
): LinkHeading[] {
    return headings.map((heading) => ({
        title: heading.text,
        level: heading.level,
        blockId: heading.blockId,
        createLinkPath() {
            const blockId = assignBlockId(heading);
            return blockId
                ? addParameter(notePath, "block", encodeBlockParameter(blockId))
                : notePath;
        }
    }));
}

/**
 * The headings nested under each heading of `headings`, with the top level under `null`. A heading
 * nests under the closest heading before it with a lower level.
 */
export function nestHeadings(headings: LinkHeading[]) {
    const tree = new Map<LinkHeading | null, LinkHeading[]>();
    for (const [ heading, ancestors ] of getHeadingAncestors(headings)) {
        const parent = ancestors.at(-1) ?? null;
        tree.set(parent, [ ...(tree.get(parent) ?? []), heading ]);
    }

    return tree;
}

/**
 * The headings that each heading of `headings` nests under, the outermost first, as
 * `nestHeadings()` nests them.
 */
export function getHeadingAncestors(headings: LinkHeading[]) {
    const ancestorsOf = new Map<LinkHeading, LinkHeading[]>();
    const ancestors: LinkHeading[] = [];
    for (const heading of headings) {
        while ((ancestors.at(-1)?.level ?? 0) >= heading.level) {
            ancestors.pop();
        }

        ancestorsOf.set(heading, [ ...ancestors ]);
        ancestors.push(heading);
    }

    return ancestorsOf;
}

/** The headings that `heading` nests under in `headingTree`, from its parent up. */
export function getParentHeadings(
    headingTree: Map<LinkHeading | null, LinkHeading[]>, heading: LinkHeading
) {
    const parents: LinkHeading[] = [];
    let child = heading;
    for (;;) {
        const parent = [ ...headingTree ].find(([ , children ]) => children.includes(child))?.[0];
        if (!parent) return parents;
        parents.push(parent);
        child = parent;
    }
}

/** `notePath` without its `block` parameter, and the value of that parameter. */
export function splitBlockParameter(notePath: string) {
    const [ path, query = "" ] = notePath.split("?", 2);
    const params = new URLSearchParams(query);
    const block = params.get("block");
    if (block === null) return { path: notePath, block };

    params.delete("block");
    const rest = params.toString();
    return { path: rest ? `${path}?${rest}` : path, block };
}

/** `notePath` with the parameter `name` set to `value`, which is encoded already. */
export function addParameter(notePath: string, name: string, value: string) {
    return `${notePath}${notePath.includes("?") ? "&" : "?"}${name}=${value}`;
}

/** The path of a link to the anchor `name` of the note at `notePath`. */
export function getAnchorLinkPath(notePath: string, name: string) {
    return addParameter(notePath, "bookmark", encodeURIComponent(name));
}
