import { HOME_NOTE_ID_PREFIX } from "@triliumnext/commons";
import { t } from "i18next";

import { getUserId, isSystem } from "../services/context.js";
import NoteSet from "../services/search/note_set.js";
import { getSql } from "../services/sql/index.js";
import dateUtils from "../services/utils/date.js";
import type Becca from "./becca-interface.js";
import { getNoteVisibilityVersion } from "./note_visibility_version.js";
import BAttribute from "./entities/battribute.js";
import BBranch from "./entities/bbranch.js";
import BNote from "./entities/bnote.js";

/**
 * The virtual note at the top of a member's tree that lists the notes they can see but not reach
 * from their tree: notes shared with them whose parents they cannot see, and their own notes left
 * under a grant they lost.
 */
export const SHARED_WITH_ME_NOTE_ID = "_sharedWithMe";

/**
 * What one member sees of the Becca. Admins and system scopes have no view: they read the Becca
 * as it is. A member sees `root`, the `_` system notes, the notes they own and every note below a
 * note shared with them or with one of their groups. Owning a note grants nothing below it, as in
 * `permission_service`.
 */
export class NoteView {
    readonly notes: Record<string, BNote>;
    readonly branches: Record<string, BBranch>;
    readonly attributes: Record<string, BAttribute>;
    readonly childParentToBranch: Record<string, BBranch>;

    private readonly visibleNoteIds: Set<string>;
    private readonly homeNoteId: string;
    private readonly homeBranch: BBranch | null;
    private readonly sharedWithMe: BNote | null;
    private readonly sharedWithMeRootBranch: BBranch | null;
    private readonly sharedWithMeBranches = new Map<string, BBranch>();
    private noteSet: NoteSet | null = null;

    constructor(private readonly becca: Becca, userId: string) {
        this.visibleNoteIds = collectVisibleNoteIds(becca, userId);
        this.homeNoteId = `${HOME_NOTE_ID_PREFIX}${userId}`;

        const home = becca.allNotes[this.homeNoteId];
        this.homeBranch = home && this.canSeeNote(this.homeNoteId) && !home.allParents.some((parent) => parent.noteId === "root")
            ? virtualBranch("root", this.homeNoteId, 0, true)
            : null;

        const unreachable = this.findUnreachableNotes();
        this.sharedWithMe = unreachable.length ? createSharedWithMeNote() : null;
        this.sharedWithMeRootBranch = this.sharedWithMe ? virtualBranch("root", SHARED_WITH_ME_NOTE_ID, 1, true) : null;
        for (const [ index, note ] of unreachable.entries()) {
            this.sharedWithMeBranches.set(note.noteId, virtualBranch(SHARED_WITH_ME_NOTE_ID, note.noteId, (index + 1) * 10, false));
        }

        this.notes = filteredRecord(() => becca.allNotes, (note) => this.canSeeNote(note.noteId), this.overlayNotes());
        this.branches = filteredRecord(() => becca.allBranches, (branch) => this.canSeeBranch(branch), this.overlayBranches("branchId"));
        this.attributes = filteredRecord(() => becca.allAttributes, (attribute) => this.canSeeNote(attribute.noteId), {});
        this.childParentToBranch = filteredRecord(() => becca.allChildParentToBranch, (branch) => this.canSeeBranch(branch),
            this.overlayBranches("childParent"));
    }

    canSeeNote(noteId: string) {
        return this.visibleNoteIds.has(noteId) || (noteId === SHARED_WITH_ME_NOTE_ID && !!this.sharedWithMe);
    }

    canSeeBranch(branch: BBranch) {
        return this.canSeeNote(branch.noteId) && (branch.parentNoteId === "none" || this.canSeeNote(branch.parentNoteId));
    }

    parentBranchesOf(note: BNote): BBranch[] {
        const branches = note.allParentBranches.filter((branch) => this.canSeeBranch(branch));
        const extra = note.noteId === this.homeNoteId ? this.homeBranch : this.sharedWithMeBranches.get(note.noteId);
        if (extra) {
            branches.push(extra);
        }
        if (note.noteId === SHARED_WITH_ME_NOTE_ID && this.sharedWithMeRootBranch) {
            branches.push(this.sharedWithMeRootBranch);
        }

        return branches;
    }

    parentsOf(note: BNote): BNote[] {
        return this.parentBranchesOf(note)
            .map((branch) => this.notes[branch.parentNoteId])
            .filter((parent): parent is BNote => !!parent);
    }

    childrenOf(note: BNote): BNote[] {
        if (note.noteId === SHARED_WITH_ME_NOTE_ID) {
            return [ ...this.sharedWithMeBranches.keys() ].map((noteId) => this.becca.allNotes[noteId]);
        }

        const children = note.allChildren.filter((child) => this.canSeeNote(child.noteId));
        if (note.noteId === "root") {
            const home = this.homeBranch ? this.becca.allNotes[this.homeNoteId] : null;
            if (home) {
                children.unshift(home);
            }
            if (this.sharedWithMe) {
                children.splice(home ? 1 : 0, 0, this.sharedWithMe);
            }
        }

        return children;
    }

    /** The note set search starts from, which holds only what the member can see. */
    getAllNoteSet(allNoteSet: NoteSet) {
        this.noteSet ??= new NoteSet(allNoteSet.notes.filter((note) => this.canSeeNote(note.noteId)));
        return this.noteSet;
    }

    private overlayNotes(): Record<string, BNote> {
        return this.sharedWithMe ? { [SHARED_WITH_ME_NOTE_ID]: this.sharedWithMe } : {};
    }

    private overlayBranches(keyedBy: "branchId" | "childParent"): Record<string, BBranch> {
        const branches = [ ...this.sharedWithMeBranches.values(), this.homeBranch, this.sharedWithMeRootBranch ]
            .filter((branch): branch is BBranch => !!branch);

        return Object.fromEntries(branches.map((branch) => [
            keyedBy === "branchId" ? branch.branchId : `${branch.noteId}-${branch.parentNoteId}`, branch
        ]));
    }

    /** Visible notes none of whose parents the member can see, which their tree would otherwise not show. */
    private findUnreachableNotes() {
        const unreachable: BNote[] = [];
        for (const noteId of this.visibleNoteIds) {
            if (noteId === "root" || noteId === this.homeNoteId || noteId.startsWith("_")) {
                continue;
            }

            const note = this.becca.allNotes[noteId];
            if (note && !note.allParents.some((parent) => this.visibleNoteIds.has(parent.noteId))) {
                unreachable.push(note);
            }
        }

        return unreachable.sort((a, b) => a.title.localeCompare(b.title));
    }
}

/**
 * The view the current scope reads the Becca through, or `null` for an admin, a system scope, or a
 * scope without a user.
 */
export function getNoteView(becca: Becca): NoteView | null {
    const version = getNoteVisibilityVersion();
    if (!hasMembers(version) || isSystem()) {
        return null;
    }

    const userId = getUserId();
    if (!userId) {
        return null;
    }

    let cached = viewsByUser.get(userId);
    if (!cached || cached.version !== version || cached.becca !== becca) {
        cached = { version, becca, view: isUserAdmin(userId) ? null : new NoteView(becca, userId) };
        viewsByUser.set(userId, cached);
    }

    return cached.view;
}

const viewsByUser = new Map<string, { version: number; becca: Becca; view: NoteView | null }>();
let members: { version: number; exist: boolean } | null = null;

/**
 * Whether any user is not an admin; without one, no scope reads a filtered Becca. A database from
 * before migration 243 has no `users` table, and so no members.
 */
function hasMembers(version: number) {
    if (members?.version !== version) {
        let exist = false;
        try {
            exist = !!getSql().getValue<number>("SELECT 1 FROM users WHERE isDeleted = 0 AND isAdmin = 0 LIMIT 1");
        } catch {
            exist = false;
        }
        members = { version, exist };
    }

    return members.exist;
}

function collectVisibleNoteIds(becca: Becca, userId: string) {
    const visible = new Set<string>([ "root" ]);
    for (const [ noteId, note ] of Object.entries(becca.allNotes)) {
        if (noteId.startsWith("_") || note.ownerId === userId) {
            visible.add(noteId);
        }
    }

    const grantedNoteIds = getSql().getColumn<string>(
        `SELECT noteId FROM note_permissions
          WHERE (canRead = 1 OR canWrite = 1)
            AND (userId = ? OR groupId IN (SELECT groupId FROM user_group_members WHERE userId = ?))`,
        [ userId, userId ]
    );

    const descended = new Set<string>();
    const pending = grantedNoteIds.filter((noteId) => noteId in becca.allNotes);
    while (pending.length) {
        const noteId = pending.pop() as string;
        if (descended.has(noteId)) {
            continue;
        }

        descended.add(noteId);
        visible.add(noteId);
        for (const child of becca.allNotes[noteId]?.allChildren ?? []) {
            pending.push(child.noteId);
        }
    }

    return visible;
}

/** Reads the role directly: `user_service` goes through options, which would close an import cycle with the Becca. */
function isUserAdmin(userId: string) {
    return !!getSql().getValue<number>("SELECT isAdmin FROM users WHERE userId = ? AND isDeleted = 0", [ userId ]);
}

/**
 * A record whose reads see only the entries `canSee` lets through, plus `overlay`, and whose writes
 * go to the Becca's own record, which `source` returns.
 */
function filteredRecord<T>(source: () => Record<string, T>, canSee: (value: T) => boolean, overlay: Record<string, T>) {
    const isVisible = (key: string | symbol) => {
        if (typeof key !== "string") {
            return false;
        }
        if (Object.hasOwn(overlay, key)) {
            return true;
        }
        const value = source()[key];
        return value !== undefined && Object.hasOwn(source(), key) && canSee(value);
    };

    return new Proxy({} as Record<string, T>, {
        get: (_target, key) => typeof key === "string" && isVisible(key)
            ? (Object.hasOwn(overlay, key) ? overlay[key] : source()[key])
            : undefined,
        has: (_target, key) => isVisible(key),
        ownKeys: () => [ ...Object.keys(source()).filter(isVisible), ...Object.keys(overlay).filter((key) => !Object.hasOwn(source(), key)) ],
        getOwnPropertyDescriptor: (_target, key) => isVisible(key)
            ? { configurable: true, enumerable: true, writable: true, value: Object.hasOwn(overlay, key as string) ? overlay[key as string] : source()[key as string] }
            : undefined,
        set: (_target, key, value) => {
            source()[key as string] = value;
            return true;
        },
        deleteProperty: (_target, key) => {
            delete source()[key as string];
            return true;
        }
    });
}

function virtualBranch(parentNoteId: string, noteId: string, notePosition: number, isExpanded: boolean) {
    const branch = new BBranch().update([ `${parentNoteId}_${noteId}`, noteId, parentNoteId, null, notePosition, isExpanded, dateUtils.utcNowDateTime() ]);
    branch.isVirtual = true;
    return branch;
}

function createSharedWithMeNote() {
    const now = dateUtils.utcNowDateTime();
    const note = new BNote().update([
        SHARED_WITH_ME_NOTE_ID, t("user_homes.shared-with-me-title"), "book", "", false, null,
        dateUtils.localNowDateTime(), dateUtils.localNowDateTime(), now, now, null
    ]);
    note.initRelations();
    note.isVirtual = true;

    const icon = new BAttribute().update([
        `v_${SHARED_WITH_ME_NOTE_ID}_liconClass`, SHARED_WITH_ME_NOTE_ID, "label", "iconClass", "bx bx-share-alt", false, 10, now
    ]);
    icon.isVirtual = true;
    note.ownedAttributes.push(icon);

    return note;
}
