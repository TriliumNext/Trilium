declare module "katex/contrib/mhchem" {}

interface Window {
    /** Set by `boot_script.ejs` before the first paint. */
    glob?: {
        isStatic: boolean;
        theme: string;
    };
}

interface Document {
    /** Whether the page is being prerendered (Speculation Rules); not yet in TypeScript's DOM types. */
    readonly prerendering?: boolean;
}
