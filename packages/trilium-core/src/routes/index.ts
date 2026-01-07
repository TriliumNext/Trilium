import optionsApiRoute from "./api/options";
import treeApiRoute from "./api/tree";
import keysApiRoute from "./api/keys";

// TODO: Deduplicate with routes.ts
const GET = "get",
    PST = "post",
    PUT = "put",
    PATCH = "patch",
    DEL = "delete";

export function buildSharedApiRoutes(apiRoute: any) {
    apiRoute(GET, '/api/tree', treeApiRoute.getTree);
    apiRoute(PST, '/api/tree/load', treeApiRoute.load);

    apiRoute(GET, "/api/options", optionsApiRoute.getOptions);
    // FIXME: possibly change to sending value in the body to avoid host of HTTP server issues with slashes
    apiRoute(PUT, "/api/options/:name/:value", optionsApiRoute.updateOption);
    apiRoute(PUT, "/api/options", optionsApiRoute.updateOptions);
    apiRoute(GET, "/api/options/user-themes", optionsApiRoute.getUserThemes);
    apiRoute(GET, "/api/options/locales", optionsApiRoute.getSupportedLocales);

    apiRoute(GET, "/api/keyboard-actions", keysApiRoute.getKeyboardActions);
    apiRoute(GET, "/api/keyboard-shortcuts-for-notes", keysApiRoute.getShortcutsForNotes);
}
