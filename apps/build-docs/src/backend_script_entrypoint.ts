/**
 * The backend script API is accessible to code notes with the "JS (backend)" language.
 *
 * The entire API is exposed as a single global: {@link api}
 *
 * @module Backend Script API
 */

/**
 * This file creates the entrypoint for TypeDoc that simulates the context from within a
 * script note on the server side.
 *
 * Make sure to keep in line with backend's `script_context.ts`.
 */

export type {
    AbstractBeccaEntity,
    BAttachment,
    BAttribute,
    BBranch,
    BEtapiToken,
    BNote,
    BOption,
    BRecentNote,
    BRevision
} from "@triliumnext/core";

import { BNote, BackendScriptApi, type BackendScriptApiInterface as Api } from "@triliumnext/core";

export type { Api };

const fakeNote = new BNote();

/**
 * The `api` global variable allows access to the backend script API,
 * which is documented in {@link Api}.
 */
export const api: Api = new BackendScriptApi(fakeNote, {});
