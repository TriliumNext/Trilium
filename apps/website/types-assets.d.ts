declare module "*?raw" {
    var content: string;
    export default content;
}

declare module "*.svg" {
    var path: string;
    export default path;
}
