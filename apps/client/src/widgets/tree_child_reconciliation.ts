/**
 * Diffs a tree parent's children against froca. After a cut/move, fancytree can
 * keep a node at the old parent while froca already dropped that branch; the
 * leftover is the ghost note. `toRemove` / `toAdd` are branchIds.
 */
export function diffTreeChildren(treeChildBranchIds: string[], frocaChildBranchIds: string[]) {
    const frocaSet = new Set(frocaChildBranchIds);
    const treeSet = new Set(treeChildBranchIds);

    return {
        toRemove: treeChildBranchIds.filter((branchId) => !frocaSet.has(branchId)),
        toAdd: frocaChildBranchIds.filter((branchId) => !treeSet.has(branchId))
    };
}

/**
 * Whether a parent node's children should be synced from froca right now.
 * Collapsed unloaded folders stay lazy; an expanded froca branch (the backend
 * expands the target of a paste) must be filled from the cache so setExpanded
 * does not lazy-load a subtree mid-move.
 */
export function shouldShowReconciledChildren(opts: {
    isFolder: boolean;
    treeIsLoaded: boolean;
    treeIsExpanded: boolean;
    frocaIsExpanded: boolean;
}): boolean {
    if (!opts.isFolder) {
        return false;
    }

    return opts.treeIsLoaded || opts.treeIsExpanded || opts.frocaIsExpanded;
}
