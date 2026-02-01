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
    default as AbstractBeccaEntity
} from "../../server/src/becca/entities/abstract_becca_entity.js";
export type {
    default as BAttachment
} from "../../server/src/becca/entities/battachment.js";
export type { default as BAttribute } from "../../server/src/becca/entities/battribute.js";
export type { default as BBranch } from "../../server/src/becca/entities/bbranch.js";
export type { default as BEtapiToken } from "../../server/src/becca/entities/betapi_token.js";
export type { BNote };
export type { default as BOption } from "../../server/src/becca/entities/boption.js";
export type { default as BRecentNote } from "../../server/src/becca/entities/brecent_note.js";
export type { default as BRevision } from "../../server/src/becca/entities/brevision.js";

import BNote from "../../server/src/becca/entities/bnote.js";
import BackendScriptApi, { type Api } from "../../server/src/services/backend_script_api.js";

export type { Api };

const fakeNote = new BNote();

/**
 * The `api` global variable allows access to the backend script API,
 * which is documented in {@link Api}.
 */
export const api: Api = new BackendScriptApi(fakeNote, {});
