/**
 * A listing of all the labels used by the system (i.e. not user-defined). Labels defined here have a data type which is not enforced, but offers type safety.
 */
type Labels = {
    color: string;
    iconClass: string;
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
    dateNote: string;

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
    "map:style": string;
    "map:scale": boolean;
    "board:groupBy": string;
    maxNestingDepth: number;
    includeArchived: boolean;
    "presentation:theme": string;
    "slide:background": string;

    // Note-type specific
    webViewSrc: string;
    readOnly: boolean;
    mapType: string;
    mapRootNoteId: string;
}

/**
 * A listing of all relations used by the system (i.e. not user-defined). Unlike labels, relations
 * always point to a note ID, so no specific data type is necessary.
 */
type Relations = [
    "searchScript",
    "ancestor",

    // Launcher-specific
    "target",
    "widget"
];

export type LabelNames = keyof Labels;
export type RelationNames = Relations[number];

export type FilterLabelsByType<U> = {
    [K in keyof Labels]: Labels[K] extends U ? K : never;
}[keyof Labels];
