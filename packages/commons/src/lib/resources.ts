/**
 * Resources are large files a feature needs at run time but that do not ship with the app, such as
 * the speech recognition model. The backend declares each one with its source and SHA-256, and
 * downloads it into the data directory on request; the client asks for resources by ID only.
 */

/** A resource as `GET /api/resources` reports it. */
export interface ResourceInfo {
    id: string;
    title: string;
    description: string;
    /** Boxicons classes, `bx bx-…`. */
    icon: string;
    /** The SPDX identifier of the license the resource is under, such as `CC-BY-4.0`. */
    license: string;
    /** The size of all its files, in bytes. */
    size: number;
    /** The bytes of its files already downloaded and verified, kept from an interrupted download. */
    downloadedSize: number;
    /**
     * The bytes of its files already in place with the right size but not yet checked against
     * their SHA-256, such as files copied from another device. The next download checks them
     * instead of downloading them.
     */
    unverifiedSize: number;
    /** The host names its files are downloaded from. */
    sources: string[];
    /** Who made the original work. */
    author: string;
    /** Where the original work is published. */
    homepage: string;
    /** Where its license is published. */
    licenseUrl: string;
    installed: boolean;
    /** The directory holding its files while it is installed, else `null`. */
    directory: string | null;
}

/** How far a download has got with one of the resources it fetches. */
export interface ResourceDownloadState {
    id: string;
    receivedBytes: number;
    totalBytes: number;
    done: boolean;
}

/** A download as it runs, and as the `resource-download` WebSocket message reports it. */
export interface ResourceDownloadProgress {
    downloadId: string;
    resourceIds: string[];
    status: "downloading" | "succeeded" | "failed" | "canceled";
    receivedBytes: number;
    totalBytes: number;
    /** The name of the file being downloaded. */
    file: string | null;
    /** Why the download failed, when `status` is `failed`. */
    error?: string;
    /** Each resource the download fetches, in the order it fetches them. */
    resources: ResourceDownloadState[];
}

/**
 * A file or directory in the resources directory that is not the directory of a registered
 * resource as it is now:
 * - `outdated`: a registered resource's directory for files it no longer has;
 * - `unregistered`: the directory of a resource that no feature registers;
 * - `unknown`: anything else, such as a file put there by hand.
 */
export interface ForeignResourceEntry {
    /** Its name in the resources directory. */
    name: string;
    path: string;
    kind: "outdated" | "unregistered" | "unknown";
    /** The ID its name carries, for `outdated` and `unregistered`. */
    resourceId: string | null;
    /** The title and icon of the registered resource, for `outdated`. */
    title: string | null;
    icon: string | null;
    /** The size of its files, in bytes. */
    size: number;
    isDirectory: boolean;
}

export interface ResourcesStatusResponse {
    resources: ResourceInfo[];
    /** The entries of the resources directory that are no registered resource, when listing all. */
    foreign?: ForeignResourceEntry[];
    /** The free space where resources are stored, in bytes, or `null` when it cannot be read. */
    freeBytes: number | null;
    /** The download that already fetches some of the resources, if one runs. */
    download: ResourceDownloadProgress | null;
}
