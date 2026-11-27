declare module "*?raw" {
    var content: string;
    export default content;
}

declare module "*.svg" {
    var path: string;
    export default path;
}

/** The version the website offers for download, from `pickReleaseVersion()`. */
declare const __RELEASE_VERSION__: string;
