/**
 * Counts changes to which notes exist, where they sit and who may see them. Every member's view is
 * built for one count and rebuilt once it moves. Kept free of imports, since user and permission
 * services, which sit below the Becca, bump it.
 */
let version = 0;

export function invalidateNoteVisibility() {
    version++;
}

export function getNoteVisibilityVersion() {
    return version;
}
