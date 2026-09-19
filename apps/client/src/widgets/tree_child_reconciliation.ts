/**
 * Compares the tree and froca child lists by branch ID.
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
 * Reconciles loaded tree nodes and branches that froca marks as expanded.
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
