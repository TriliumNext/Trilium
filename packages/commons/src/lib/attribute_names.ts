/**
 * A listing of all the labels used by the system (i.e. not user-defined). Labels defined here have a data type which is not enforced, but offers type safety.
 */
type Labels = {
    color: string;
    iconClass: string;
    iconPack: string;
    workspace: boolean;
    workspaceTabBackgroundColor: string;
    workspaceIconClass: string;
    executeButton: boolean;
    executeDescription: string;
    executeTitle: string;
    limit: string; // should be probably be number
    calendarRoot: boolean;
    workspaceCalendarRoot: boolean;
    archived: boolean;
    sorted: boolean;
    template: boolean;
    autoReadOnlyDisabled: boolean;
    language: string;
    originalFileName: string;
    pageUrl: string;
    docUrl: string;
    dateNote: string;

    // Scripting
    run: string;
    widget: boolean;
    "disabled:widget": boolean;
    customRequestHandler: string;

    // Tree specific
    subtreeHidden: boolean;

    // Search
    searchString: string;
    ancestorDepth: string;
    orderBy: string;
    orderDirection: string;

    // Launch bar
    bookmarkFolder: boolean;
    command: string;
    keyboardShortcut: string;

    // Collection-specific
    viewType: string;
    status: string;
    pageSize: number;
    geolocation: string;
    expanded: string;
    "calendar:hideWeekends": boolean;
    "calendar:weekNumbers": boolean;
    "calendar:view": string;
    "calendar:initialDate": string;
    "calendar:slotDuration": string;
    "calendar:slotLabelInterval": string;
    "map:style": string;
    "map:scale": boolean;
    "map:hideLabels": boolean;
    "board:groupBy": string;
    maxNestingDepth: number;
    includeArchived: boolean;
    "presentation:theme": string;
    "slide:background": string;

    // Print/export
    printLandscape: boolean;
    printPageSize: string;
    printScale: string;
    printMargins: string;

    // Note-type specific
    webViewSrc: string;
    "disabled:webViewSrc": string;
    readOnly: boolean;
    openAtBottom: boolean;
    fullContentWidth: boolean;
    displayMode: string;
    tabWidth: number;
    indentWithTabs: boolean;
    wrapLines: boolean;
    mapType: string;
    mapRootNoteId: string;

    appTheme: string;
    appThemeBase: string;
}

/**
 * A listing of all relations used by the system (i.e. not user-defined). Unlike labels, relations
 * always point to a note ID, so no specific data type is necessary.
 */
type Relations = [
    "searchScript",
    "ancestor",

    // Active content
    "renderNote",
    "disabled:renderNote",

    // Launcher-specific
    "target",
    "widget"
];

export type LabelNames = keyof Labels;
export type RelationNames = Relations[number];

/**
 * The characters an attribute name may consist of: letters, numbers, underscore and colon. Kept as a
 * single source of truth so that {@link filterAttributeName} and {@link isValidAttributeName} cannot
 * drift apart.
 *
 * Note that {@link sanitizeAttributeName} in `trilium-core` deliberately applies the *same* character
 * set with different semantics (it substitutes an underscore and renames the empty string, rather than
 * stripping), so it is not expressed in terms of these helpers.
 */
const ATTRIBUTE_NAME_CHARS = "\\p{L}\\p{N}_:";
const DISALLOWED_MATCHER = new RegExp(`[^${ATTRIBUTE_NAME_CHARS}]`, "gu");
const ATTR_NAME_MATCHER = new RegExp(`^[${ATTRIBUTE_NAME_CHARS}]+$`, "u");

/** Strips every character an attribute name may not contain, returning a usable (possibly empty) name. */
export function filterAttributeName(name: string) {
    return name.replace(DISALLOWED_MATCHER, "");
}

/** Whether the name is a valid attribute name, i.e. non-empty and free of disallowed characters. */
export function isValidAttributeName(name: string) {
    return ATTR_NAME_MATCHER.test(name);
}

export type FilterLabelsByType<U> = {
    [K in keyof Labels]: Labels[K] extends U ? K : never;
}[keyof Labels];
