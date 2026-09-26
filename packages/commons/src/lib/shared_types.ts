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
 * Where the client's `share_mermaid` entry and every file it can load are, each path relative to
 * the manifest. The client build writes it; shared pages read it to import mermaid, and the
 * share-theme export reads it to copy the files. All the files sit in one directory.
 */
export interface ShareMermaidManifest {
    entry: string;
    files: string[];
}
