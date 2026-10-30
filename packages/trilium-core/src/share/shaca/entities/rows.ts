/**
 * `noteId`, `title`, `type`, `mime`, `blobId`, `utcDateCreated`, `utcDateModified` and
 * `isProtected`, in the order `shaca_loader.ts` selects them.
 */
export type SNoteRow = [string, string, string, string, string, string, string, boolean];
export type SBranchRow = [string, string, string, string, string, boolean];
export type SAttributeRow = [string, string, string, string, string, boolean, number];
export type SAttachmentRow = [string, string, string, string, string, string, string];
