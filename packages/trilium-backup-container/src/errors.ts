/**
 * Machine-readable cause of a container failure.
 *
 * The human-readable message on the error is fixed English meant for logs. Anything user-facing
 * must be selected from this reason instead, so that the module carries no translations.
 */
export type BackupContainerErrorReason =
    /** The first bytes are not the container magic, i.e. this is not a backup container at all. */
    | "not-a-container"
    /** Written by a newer version of the format than this reader implements. */
    | "unsupported-version"
    /** A reserved flag bit is set, or the flags are otherwise not understood. */
    | "unsupported-flags"
    /**
     * The header length is not the value this version and these flags require, or it is out of
     * range.
     */
    | "invalid-header-length"
    /** The key derivation function id is not one this reader implements. */
    | "unsupported-kdf"
    /** Key derivation parameters are outside the accepted bounds, or too expensive to honour. */
    | "invalid-kdf-params"
    /** The container is encrypted and no passphrase was supplied. */
    | "passphrase-required"
    /** The verifier tag did not match: a wrong passphrase, or a damaged header. */
    | "wrong-passphrase-or-damaged-header"
    /** A frame failed authentication, i.e. the payload is damaged or was tampered with. */
    | "damaged-payload"
    /** A frame declared a length the format does not allow. */
    | "invalid-frame-length"
    /** Bytes follow the final frame. */
    | "trailing-data"
    /** The file ends before the container does. */
    | "truncated"
    /** The payload digest did not match the payload as read. */
    | "digest-mismatch"
    /** The output length disagrees with the plaintext size recorded in the header. */
    | "size-mismatch"
    /** The output exceeded the ceiling before it was written, e.g. a crafted compressed payload. */
    | "output-too-large"
    /** The unwrapped payload is not a SQLite database. */
    | "not-a-database"
    /** The input is larger than the format can represent. */
    | "payload-too-large"
    /** The caller passed options this module cannot act on. */
    | "invalid-options";

/** Error thrown by every entry point in this module. */
export class BackupContainerError extends Error {

    /** Machine-readable cause, for callers that must map failures to their own messages. */
    readonly reason: BackupContainerErrorReason;

    constructor(reason: BackupContainerErrorReason, message: string) {
        super(message);
        this.name = "BackupContainerError";
        this.reason = reason;
    }

}

/** Narrowing helper for callers that catch errors from this module. */
export function isBackupContainerError(error: unknown): error is BackupContainerError {
    return error instanceof BackupContainerError;
}
