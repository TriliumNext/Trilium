import type { HiddenSubtreeItem } from "@triliumnext/commons";

export interface InAppHelpProvider {
    getHelpHiddenSubtreeData(): HiddenSubtreeItem[];
    cleanUpHelp(items: HiddenSubtreeItem[]): void;
}

let provider: InAppHelpProvider | null = null;

export function initInAppHelp(p: InAppHelpProvider) {
    provider = p;
}

export function getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
    return provider?.getHelpHiddenSubtreeData() ?? [];
}

export function cleanUpHelp(items: HiddenSubtreeItem[]): void {
    provider?.cleanUpHelp(items);
}
