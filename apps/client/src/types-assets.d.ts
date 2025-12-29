declare module "*.png" {
    var path: string;
    export default path;
}

declare module "*.json" {
    var content: any;
    export default content;
}

declare module "*?url" {
    var path: string;
    export default path;
}

declare module "*?raw" {
    var content: string;
    export default content;
}
