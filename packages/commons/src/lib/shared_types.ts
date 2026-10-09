export interface ContributorList {
    contributors: Contributor[];
}

export interface Contributor {
    name: string;
    fullName?: string;
    url: string;
    role?: "lead-dev" | "original-dev";
}
/**
 * The files the share theme loads, which the app build writes beside its own chunks. The
 * share-theme export reads it to copy them. Each path is relative to the manifest.
 */
export interface ShareThemeManifest {
    /** The files every page can load. */
    files: string[];
    /** The further files of each library loaded on demand, such as `mermaid`, by its name. */
    lazy: Record<string, string[]>;
}
