declare module "katex/contrib/mhchem" {}

interface Window {
    /** Set by `boot_script.ejs` before the first paint. */
    glob?: {
        isStatic: boolean;
        theme: string;
    };
}
