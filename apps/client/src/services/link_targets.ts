import type {
    CreateReferenceRequest, CreateReferenceResponse, NoteReferencesResponse, ReferenceKind,
    ReferenceParams, ReferenceTarget
} from "@triliumnext/commons";
import { encodeBlockParameter } from "@triliumnext/commons/src/lib/block_reference.js";

import appContext from "../components/app_context";
import froca from "./froca";
import { t } from "./i18n";
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

/** The link parameters that point inside a note, which the targets of a note use. */
const TARGET_PARAMS = [ "block", "bookmark" ];

/**
 * The targets of the note `noteId` that the server reads, which link to it at `notePath`. A note
 * that is protected outside a protected session has none.
 */
export async function getLinkTargets(noteId: string, notePath: string): Promise<LinkTarget[]> {
    try {
        const note = await froca.getNote(noteId);
        if (!note?.isContentAvailable()) return [];

        const { targets } = await server.get<NoteReferencesResponse>(
            `notes/${noteId}/references`, undefined, false, { silentBadRequest: true }
        );
        const counts = new Map<ReferenceKind, number>();
        return targets.map((target) => {
            const index = counts.get(target.kind) ?? 0;
            counts.set(target.kind, index + 1);
            return createNoteTarget(noteId, notePath, target, index);
        });
    } catch (e) {
        console.error(`Failed to read the link targets of note '${noteId}':`, e);
        return [];
    }
}

/**
 * The `index`-th target of its kind that the server lists for note `noteId`, which links to it in
 * the note at `notePath`, and which the server gives a reference when it has none.
 */
function createNoteTarget(
    noteId: string, notePath: string, { kind, title, level, params }: ReferenceTarget,
    index: number
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
            const request: CreateReferenceRequest = { kind, index, title };
            const response = await server.postWithSilentErrors<CreateReferenceResponse>(
                `notes/${noteId}/references`, request
            );
            target.params = response.params;
        }
    };
    return target;
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
    const ancestorsOf = new Map<LinkTarget, LinkTarget[]>();
    // The targets that the next target of each kind can nest under.
    const openByKind = new Map<ReferenceKind, LinkTarget[]>();
    for (const target of targets) {
        const { level } = target;
        if (level === undefined) {
            ancestorsOf.set(target, []);
            continue;
        }

        const ancestors = [ ...(openByKind.get(target.kind) ?? []) ];
        while ((ancestors.at(-1)?.level ?? 0) >= level) {
            ancestors.pop();
        }

        ancestorsOf.set(target, ancestors);
        openByKind.set(target.kind, [ ...ancestors, target ]);
    }

    return ancestorsOf;
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
    for (const name of TARGET_PARAMS) {
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
