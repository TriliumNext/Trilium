import type { OptionNames } from "@triliumnext/commons";

import { getCrypto } from "../services/encryption/crypto.js";
import { getScryptHash } from "../services/encryption/scrypt.js";
import optionService from "../services/options.js";
import { encodeBase64, encodeUtf8 } from "../services/utils/binary.js";
import { getAppAssetPath, SHARED_OPTIONS } from "../share/content_renderer.js";
import { buildFrocaRows } from "../share/froca_payload.js";
import type SNote from "../share/shaca/entities/snote.js";

/** Opens the subtree of the note that owns it to editing on the shared page. */
export const SHARE_EDIT_LABEL = "shareEdit";

/**
 * The password that unlocks editing, as `<salt>$<hash>` in base64. Without it, or empty below a
 * password-protected ancestor, anyone can edit.
 */
export const SHARE_EDIT_PASSWORD_LABEL = "shareEditPassword";

/** Lets guests who edit upload images and files into the notes. */
export const SHARE_ATTACHMENTS_LABEL = "shareAttachments";

export const MIN_SHARE_EDIT_PASSWORD_LENGTH = 4;

/** How guests of a shared page can edit a note. */
export interface ShareEditPolicy {
    /**
     * The note whose `#shareEdit` opens the subtree, inherited by every note below it. The password
     * unlocks the subtree as a whole, so a session's grant is kept by this note.
     */
    rootNoteId: string;
    needsPassword: boolean;
    attachments: boolean;
    /**
     * What a session's grant on the subtree must hold: the salt of the password's hash, new with
     * every password the host sets, or `open`. A grant holding another one unlocks nothing.
     */
    grantKey: string;
}

/** The policy guests edit `note` under, or `null` where its subtree is not open to editing. */
export function getShareEditPolicy(note: SNote): ShareEditPolicy | null {
    const label = note.getLabel(SHARE_EDIT_LABEL);
    if (!label || label.value === "false") {
        return null;
    }

    const password = note.getSecretLabelValue(SHARE_EDIT_PASSWORD_LABEL);
    return {
        rootNoteId: label.note.noteId,
        needsPassword: !!password,
        attachments: note.isLabelTruthy(SHARE_ATTACHMENTS_LABEL),
        grantKey: password ? password.split("$")[0] : "open"
    };
}

/** The value of `#shareEditPassword` for `password`, with a salt of its own. */
export async function hashShareEditPassword(password: string): Promise<string> {
    const salt = encodeBase64(getCrypto().randomBytes(32));
    const hash = encodeBase64(await getScryptHash(password, salt));
    return `${salt}$${hash}`;
}

/** Whether `password` is the one `stored` holds, as {@link hashShareEditPassword} wrote it. */
export async function verifyShareEditPassword(password: string, stored: string | null): Promise<boolean> {
    const [ salt, hash ] = (stored ?? "").split("$");
    if (!salt || !hash) {
        return false;
    }

    const given = encodeBase64(await getScryptHash(password, salt));
    return getCrypto().constantTimeCompare(encodeUtf8(given), encodeUtf8(hash));
}

/**
 * The options the app's text editor reads, which a guest's editor starts from, on top of those
 * every hosted view reads. Nothing here names a note or a credential.
 */
export const EDIT_OPTIONS = [
    ...SHARED_OPTIONS,
    "textNoteEditorMultilineToolbar", "textNoteEmojiCompletionEnabled",
    "textNoteSymbolReplacementsEnabled", "textNotePunctuationReplacementsEnabled",
    "textNoteMathReplacementsEnabled", "textNoteSingleQuoteStyle", "textNoteDoubleQuoteStyle",
    "textNoteCustomReplacements", "textNoteHtmlSupportEnabled", "allowedHtmlTags",
    "textNoteContentHintsEnabled", "mathFieldEnabled", "defaultContentLanguage", "languages",
    "customDateTimeFormat", "codeBlockWordWrap", "codeBlockTheme", "codeBlockThemeMatchesApp",
    "codeBlockTabWidth", "codeNotesMimeTypes", "clipboardImageEmbedEnabled"
] as const satisfies readonly OptionNames[];

/**
 * What a guest's editor reads regardless of the host's settings: the toolbar stands above the
 * note, and the features that reach into the host's other notes or services stay off.
 */
export const EDIT_OPTION_OVERRIDES = {
    textNoteEditorType: "ckeditor-classic",
    textNoteCompletionEnabled: "false",
    textNoteSlashCommandsEnabled: "false",
    textNoteAutoLinkPreviewsEnabled: "false",
    aiEnabled: "false",
    databaseReadonly: "false"
} as const satisfies Partial<Record<OptionNames, string>>;

/**
 * The notes and options the share theme mounts the app's text editor with for `note`, of those
 * `canAccess` lets the visitor read, in the shape of a hosted view's payload.
 */
export function buildEditPayload(note: SNote, canAccess: (note: SNote) => boolean) {
    const options = Object.fromEntries(EDIT_OPTIONS.map((name) => [ name, optionService.getOptionOrNull(name) ]));
    return {
        ...buildFrocaRows([ note ], canAccess),
        options: { ...options, ...EDIT_OPTION_OVERRIDES },
        assetPath: getAppAssetPath(),
        parentNoteId: note.getParentBranches()[0]?.parentNoteId ?? null
    };
}
