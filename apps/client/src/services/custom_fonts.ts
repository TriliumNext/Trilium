import { customFontFamily, customFontNoteId, type UserFont } from "@triliumnext/commons";

import froca from "./froca.js";
import type LoadResults from "./load_results.js";
import options from "./options.js";
import server from "./server.js";
import { logError } from "./ws.js";

/** The font options that can name one of the user's own fonts. */
const FONT_FAMILY_OPTIONS = [ "mainFontFamily", "treeFontFamily", "detailFontFamily", "monospaceFontFamily" ] as const;

/** A face registered with the document, and the file it was built from. */
interface RegisteredFont {
    face: FontFace;
    blobId: string;
}

/** The faces registered for the fonts the options currently name, by the note each is stored in. */
const registeredFonts = new Map<string, RegisteredFont>();

/**
 * The file each note's in-flight load is fetching. Loads for one note are not ordered — a newer one
 * can overtake an older — so this is what an older load reads to find that it has been superseded
 * and must not install the file it went to fetch.
 */
const loadingFonts = new Map<string, string>();

/**
 * Registers the user's own fonts that the font options name, so the families the fonts stylesheet
 * declares (see `getFontCss`) resolve to the files those notes hold. Fonts no longer named by any
 * option are unregistered.
 *
 * Lives here rather than beside the stylesheet in `font.ts` because that module is loaded by
 * `index.ts` before jQuery is: froca and the options reach i18next through their imports, which
 * touches `$` as it loads.
 */
export async function applyCustomFontsFromOptions() {
    const wanted = namedFontNoteIds();

    for (const [ noteId, { face } ] of registeredFonts) {
        if (!wanted.has(noteId)) {
            document.fonts.delete(face);
            registeredFonts.delete(noteId);
        }
    }

    // A load still in flight for a font no longer named has nothing left to install.
    for (const noteId of loadingFonts.keys()) {
        if (!wanted.has(noteId)) {
            loadingFonts.delete(noteId);
        }
    }

    await Promise.all([ ...wanted ].map(async (noteId) => {
        const note = await froca.getNote(noteId);
        if (!note) return;

        // What is already registered is checked by blob, not by note: a file replaced through a new
        // revision has to be fetched again, under the same family the stylesheet already names.
        const blobId = note.blobId ?? "";
        if (registeredFonts.get(noteId)?.blobId === blobId) return;

        loadingFonts.set(noteId, blobId);

        try {
            const face = await registerFontNote(noteId, customFontFamily(noteId), blobId);
            const current = registeredFonts.get(noteId);
            // A concurrent call might have registered this same file while the bytes were being
            // fetched, in which case this face is one too many.
            if (current?.blobId === blobId) {
                document.fonts.delete(face);
                return;
            }

            // These bytes are no longer the ones to draw with: while they were being fetched, a load
            // for a file that replaced this one started, or the font stopped being named at all.
            // Installing them here would put the older file back over the newer.
            if (loadingFonts.get(noteId) !== blobId) {
                document.fonts.delete(face);
                return;
            }

            // The face built from the file this note held before goes only now that its replacement
            // is registered, so nothing renders in the fallback family in between.
            if (current) {
                document.fonts.delete(current.face);
            }
            registeredFonts.set(noteId, { face, blobId });
            loadingFonts.delete(noteId);
        } catch (e) {
            logError(`Could not load the font stored in note '${noteId}': ${e}`);
        }
    }));
}

/**
 * Whether a reload touched the file of a font the options name. Replacing that file leaves the
 * options themselves untouched, so nothing else in the reload says that the faces have to be built
 * again.
 */
export function hasCustomFontContentChanged(loadResults: LoadResults) {
    for (const noteId of namedFontNoteIds()) {
        if (loadResults.isNoteContentReloaded(noteId)) {
            return true;
        }
    }

    return false;
}

/** The fonts the user offers to the font picker: the file notes labelled `#customFont`. */
export async function getCustomFonts() {
    return await server.get<UserFont[]>("options/user-fonts");
}

/**
 * Loads a font note's file and registers it with the document under `family`, so anything styled
 * with that family renders in it. The caller owns the returned face and must hand it to
 * `document.fonts.delete()` once it is done with it.
 *
 * The bytes are fetched and handed to `FontFace` rather than referenced by their API URL: a `url()`
 * source is loaded by the engine itself, outside the host document's service worker and Capacitor
 * request interceptors, which is where standalone and iOS answer an API request from (see
 * `loadIconPackFont`). `version` — a blobId — keeps a replaced file from being served from the
 * cache of the one it replaced.
 */
export async function registerFontNote(noteId: string, family: string, version: string) {
    // Resolved against the host document's base URL, which also covers Electron's `trilium-app://`.
    const url = new URL(`api/notes/${noteId}/open?v=${encodeURIComponent(version)}`, document.baseURI).href;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Font request failed with HTTP ${response.status}.`);
    }

    const face = await new FontFace(family, await response.arrayBuffer()).load();
    document.fonts.add(face);

    return face;
}

/** The notes the font options name, without the families the browser resolves for itself. */
function namedFontNoteIds() {
    return new Set(FONT_FAMILY_OPTIONS
        .map((optionName) => customFontNoteId(options.get(optionName)))
        .filter((noteId) => noteId !== null));
}
