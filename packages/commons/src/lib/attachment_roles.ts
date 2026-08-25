import { getMimeIcon } from "./notes.js";

/**
 * What the app knows about an attachment of a given role.
 *
 * A role is not a label — it is what the code branches on, and each of these is a branch that used to
 * be written out by name at every site that cared. Spelling them here instead is what makes adding a
 * role a decision taken once: {@link ATTACHMENT_ROLES} is checked against this shape, so a role that
 * arrives without an answer to every question below does not compile, rather than half-working —
 * served but never cleaned up, cleaned up but never served, listed but rendered as an unknown file.
 */
export interface AttachmentRoleTraits {
    /**
     * Whether the content is a picture, and so is served, rendered and converted as one.
     *
     * `image` alone used to mean this, so every such branch spelled it that way, and a second picture
     * role had to be admitted to all of them at once.
     */
    picture: boolean;
    /**
     * Whether a second attachment of this role and title should reuse the first rather than be stored
     * again.
     *
     * Only for pictures the app fetched and named itself, where the title says which thing it is and
     * the same thing is fetched again and again: a note that links a site once usually links it many
     * times, and each link would otherwise bring its own copy of that site's icon. The title is the
     * key, so for these it is the caller's job to make it identify the thing — a site's hostname for a
     * favicon, a page's URL for its cover — and the server's not to shorten it.
     *
     * Never for a picture the user placed. Two images they happened to give the same name are two
     * images, and quietly collapsing them would lose one.
     */
    deduplicated: boolean;
    /**
     * Whether the attachment lives in the note's content, and so is scheduled for erasure once nothing
     * there refers to it any more.
     *
     * False for the ones their owner manages explicitly — a collection's saved view, a canvas's
     * library, the file an import was read from. Nothing in the content ever refers to those, so
     * leaving them to the cleanup would erase every one of them on the next save.
     */
    embedded: boolean;
    /**
     * What a copy of this becomes when a person carries it into a note themselves.
     *
     * A role says who made the attachment and why, so a copy made by hand has a new answer: the
     * pictures a link preview fetched are the app's while they belong to that preview, but pasted
     * into a note as a picture they are one the reader placed, and nothing about them is the app's to
     * manage any more. Keeping the role would leave the copy deduplicated by title against that
     * note's own previews, denied the OCR and compression offered to a picture, and filed under the
     * half of the attachment list nobody opens.
     *
     * Always one of the two roles that mean "someone put this here" — handing a copy to another of
     * the app's roles would only move the problem. A picture stays a picture: see the spec.
     */
    copiedAs: "image" | "file";
    /**
     * The icon standing for an attachment of this role, or `null` where the role has nothing to say
     * about what the thing is.
     *
     * Null for exactly the two roles that mean "someone put this here": between a spreadsheet, a PDF
     * and a video the difference a reader is looking for is the content's, not the role's, so those
     * read their media type instead — and get the same icon a note of that content would.
     *
     * A role the app created is the opposite case. Its content is an implementation detail (a
     * favicon is a PNG, a saved view is JSON) and what the reader wants told is which of the app's
     * doings put it there, which is the role and nothing else.
     */
    icon: string | null;
}

/**
 * Every role the app itself creates, and what it does with each.
 *
 * Not a closed set at runtime: a script or ETAPI client can attach anything under a role of its own,
 * which is why the questions are asked of a `string` below rather than of this union. It is closed to
 * *us*, though — see {@link AttachmentRoleTraits}.
 */
export const ATTACHMENT_ROLES = {
    /** A picture the user placed in the note. */
    image: { picture: true, deduplicated: false, embedded: true, copiedAs: "image", icon: null },
    /** A file the user attached to the note. */
    file: { picture: false, deduplicated: false, embedded: true, copiedAs: "file", icon: null },
    /**
     * A link preview's two pictures, kept apart from `image` so they can be told from one the user
     * chose. Both arrive already sized by the server (a 16x16 icon, a 256px thumbnail), so the
     * compression inventory has nothing to gain from either and offering to recompress one is noise.
     * They are embedded all the same: nothing else manages them, so deleting the preview has to be
     * what eventually takes them with it. Carried into a note by hand, though, they are pictures like
     * any other — the preview they belonged to stayed behind.
     */
    favicon: { picture: true, deduplicated: true, embedded: true, copiedAs: "image", icon: "bx bx-globe" },
    coverImage: { picture: true, deduplicated: true, embedded: true, copiedAs: "image", icon: "bx bx-image-alt" },
    /** How a collection remembers the way it is being looked at, and a PDF where the reader had got to. */
    viewConfig: { picture: false, deduplicated: false, embedded: false, copiedAs: "file", icon: "bx bx-cog" },
    /** Shapes saved into an Excalidraw canvas's library. */
    canvasLibraryItem: { picture: false, deduplicated: false, embedded: false, copiedAs: "file", icon: "bx bx-shape-square" },
    /** The file an import was read from, kept so an import that went wrong can be looked at again. */
    importSource: { picture: false, deduplicated: false, embedded: false, copiedAs: "file", icon: "bx bx-import" },
    /**
     * One ES module of an npm package installed for backend scripts. Managed by the install that
     * wrote it and named in its note's manifest, never referred to from note content, so it is not
     * embedded — the cleanup that erases what content no longer mentions would take every one.
     */
    scriptModule: { picture: false, deduplicated: false, embedded: false, copiedAs: "file", icon: "bx bx-cube" }
} as const satisfies Record<string, AttachmentRoleTraits>;

/** A role the app itself creates. Arbitrary strings reach the same fields — see {@link ATTACHMENT_ROLES}. */
export type AttachmentRole = keyof typeof ATTACHMENT_ROLES;

/**
 * The roles worth spelling out to a reader: the ones the app created, which is the same set as the ones
 * with a mark of their own.
 *
 * Read off the icon column rather than listed again, so the two cannot drift. A role that cannot say what
 * the thing is has nothing to add once the thing is shown — "Image" over a picture is not worth a word,
 * let alone a word in every language.
 *
 * @see AttachmentRoleTraits.icon
 */
export type NamedAttachmentRole = {
    [Role in AttachmentRole]: typeof ATTACHMENT_ROLES[Role]["icon"] extends null ? never : Role
}[AttachmentRole];

/** The roles whose content is a picture, read off {@link ATTACHMENT_ROLES} rather than listed again. */
export type ImageAttachmentRole = {
    [Role in AttachmentRole]: typeof ATTACHMENT_ROLES[Role]["picture"] extends true ? Role : never
}[AttachmentRole];

/** @see ImageAttachmentRole */
export const IMAGE_ATTACHMENT_ROLES: readonly ImageAttachmentRole[] =
    attachmentRolesWhere("picture") as readonly ImageAttachmentRole[];

/** Whether an attachment of this role holds a picture, whoever created it. */
export function isImageAttachmentRole(role: string | undefined | null): role is ImageAttachmentRole {
    return attachmentRoleTraits(role)?.picture ?? false;
}

/** @see AttachmentRoleTraits.deduplicated */
export function isDeduplicatedAttachmentRole(role: string | undefined | null): boolean {
    return attachmentRoleTraits(role)?.deduplicated ?? false;
}

/** @see AttachmentRoleTraits.embedded */
export function isEmbeddedAttachmentRole(role: string | undefined | null): boolean {
    return attachmentRoleTraits(role)?.embedded ?? false;
}

/**
 * The icon for an attachment, from its role where the role says what the thing is and from its media
 * type where it does not.
 *
 * A role nobody here has heard of — a script's own — is treated as the user's own upload rather than
 * given a mark for "unknown": whatever a script attached, the reader is still looking at a file, and
 * its media type describes it as well as it describes anyone else's.
 *
 * @see AttachmentRoleTraits.icon
 */
export function attachmentIcon(role: string | undefined | null, mime: string | undefined | null): string {
    return attachmentRoleTraits(role)?.icon ?? getMimeIcon(mime);
}

/**
 * What the app knows about this role, or nothing at all for one it does not recognise — a script's
 * own, or a role from a newer version reached over sync.
 *
 * `hasOwn` rather than a plain lookup: the role is whatever was stored, so `"constructor"` and
 * `"toString"` reach this, and reading them off the object would answer with something from its
 * prototype instead of with nothing.
 */
export function attachmentRoleTraits(role: string | undefined | null): AttachmentRoleTraits | undefined {
    return role && Object.hasOwn(ATTACHMENT_ROLES, role) ? ATTACHMENT_ROLES[role as AttachmentRole] : undefined;
}

function attachmentRolesWhere(trait: keyof AttachmentRoleTraits): readonly AttachmentRole[] {
    return (Object.keys(ATTACHMENT_ROLES) as AttachmentRole[]).filter((role) => ATTACHMENT_ROLES[role][trait]);
}
