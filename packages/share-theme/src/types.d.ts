declare module "katex/contrib/mhchem" {}

interface Window {
    /** Set by `boot_script.ejs` before the first paint. */
    glob?: {
        isShare: boolean;
        isStatic: boolean;
        theme: string;
        /** Set by `setupAppView()` for the app's views, which read their translations from it. */
        assetPath?: string;
    };
}

interface Document {
    /** Whether the page is being prerendered (Speculation Rules); not yet in TypeScript's DOM types. */
    readonly prerendering?: boolean;
}
