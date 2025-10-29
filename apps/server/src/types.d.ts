/*
 * This file contains type definitions for libraries that did not have one
 * in its library or in `@types/*` packages.
 */

declare module "unescape" {
    function unescape(str: string, type?: string): string;
    export default unescape;
}

declare module "html2plaintext" {
    function html2plaintext(htmlText: string): string;
    export default html2plaintext;
}

declare module "normalize-strings" {
    function normalizeString(string: string): string;
    export default normalizeString;
}

declare module "is-animated" {
    function isAnimated(buffer: Buffer): boolean;
    export default isAnimated;
}

declare module "@triliumnext/ckeditor5/content.css" {
    const content: string;
    export default content;
}


declare module "@triliumnext/share-theme/*.ejs" {
    const content: string;
    export default content;
}

declare module "@triliumnext/share-theme/styles.css" {
    const content: string;
    export default content;
}

declare module '*.css' {}
declare module '*?raw' {
  const src: string
  export default src
}
