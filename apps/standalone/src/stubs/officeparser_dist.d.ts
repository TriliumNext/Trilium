/**
 * officeparser's dist/index.mjs is reached directly by path (bypassing the package's
 * `exports` map, which only exposes the prebuilt browser monolith to bundlers), so it
 * carries no type information of its own. It re-exports exactly the package's public
 * API, so borrow the types from the package entry.
 */
declare module "*/officeparser/dist/index.mjs" {
    export * from "officeparser";
}
