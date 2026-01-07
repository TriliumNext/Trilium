import optionsApiRoute from "./api/options";
import treeApiRoute from "./api/tree";
import keysApiRoute from "./api/keys";
import notesApiRoute from "./api/notes";

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

    apiRoute(PST, "/api/notes/:noteId/convert-to-attachment", notesApiRoute.convertNoteToAttachment);
    apiRoute(GET, "/api/notes/:noteId", notesApiRoute.getNote);
    apiRoute(GET, "/api/notes/:noteId/blob", notesApiRoute.getNoteBlob);
    apiRoute(GET, "/api/notes/:noteId/metadata", notesApiRoute.getNoteMetadata);
    apiRoute(PUT, "/api/notes/:noteId/data", notesApiRoute.updateNoteData);
    apiRoute(DEL, "/api/notes/:noteId", notesApiRoute.deleteNote);
    apiRoute(PUT, "/api/notes/:noteId/undelete", notesApiRoute.undeleteNote);
    apiRoute(PST, "/api/notes/:noteId/revision", notesApiRoute.forceSaveRevision);
    apiRoute(PST, "/api/notes/:parentNoteId/children", notesApiRoute.createNote);
    apiRoute(PUT, "/api/notes/:noteId/sort-children", notesApiRoute.sortChildNotes);
    apiRoute(PUT, "/api/notes/:noteId/protect/:isProtected", notesApiRoute.protectNote);
    apiRoute(PUT, "/api/notes/:noteId/type", notesApiRoute.setNoteTypeMime);
    apiRoute(PUT, "/api/notes/:noteId/title", notesApiRoute.changeTitle);
    apiRoute(PST, "/api/notes/:noteId/duplicate/:parentNoteId", notesApiRoute.duplicateSubtree);
    apiRoute(PST, "/api/notes/erase-deleted-notes-now", notesApiRoute.eraseDeletedNotesNow);
    apiRoute(PST, "/api/notes/erase-unused-attachments-now", notesApiRoute.eraseUnusedAttachmentsNow);
    apiRoute(PST, "/api/delete-notes-preview", notesApiRoute.getDeleteNotesPreview);

    apiRoute(GET, "/api/keyboard-actions", keysApiRoute.getKeyboardActions);
    apiRoute(GET, "/api/keyboard-shortcuts-for-notes", keysApiRoute.getShortcutsForNotes);
}
