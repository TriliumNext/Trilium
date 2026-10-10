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
    /**
     * The further files of each group loaded on demand, by its name: a library such as `mermaid`,
     * `app` for what every app view loads, `view:<viewType>` for a collection's view and
     * `type:<noteType>` for a note type's widget.
     */
    lazy: Record<string, string[]>;
    /** The other groups whose files each group loads, by its name. */
    requires: Record<string, string[]>;
}
