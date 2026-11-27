/**
 * @module
 *
 * The contracts of channels: a built-in type of channel, what an attempt hands it, how it fails,
 * and the storage of the delivery record, each of which a host implements.
 */
import type {
    NotificationChannelConfig,
    NotificationChannelDelivery,
    NotificationChannelPayload,
    NotificationDeliveryErrorCode
} from "@triliumnext/commons";

/** A built-in kind of channel that the user creates instances of, such as `webhook`. */
export interface NotificationChannelType {
    readonly type: string;
    readonly title: string;
    readonly icon: string;
    /** False where the runtime cannot run it under its policy. */
    isAvailable(): boolean;
    /**
     * Checks the part of a channel's configuration that is not secret, as a create or an edit
     * passes it, and returns it as it is stored.
     *
     * @throws NotificationError `invalid-input` or `invalid-template`.
     */
    checkConfig(config: unknown): NotificationChannelConfig;
    /** What this instance holds of the channel's address, or `null` when none is entered here. */
    getAddressState(channelId: string): ChannelAddressState | null;
    /**
     * Starts an attempt. Everything that it reads, the address and the secrets among them, is
     * read before it returns, so a change made after the call cannot reach the request.
     *
     * @throws ChannelSendError with the code of the failure; anything else counts as `network`.
     */
    send(request: ChannelSendRequest): Promise<void>;
}

/** What a host holds of a built-in channel's address. */
export interface ChannelAddressState {
    /** A new random ID at every change of the address. */
    configurationId: string;
    /** The SHA-256 of the template that the credentials were entered for, in hex. */
    templateHash: string;
    /** When the address was last changed. */
    changedAt: string;
}

/** One attempt of a built-in channel. */
export interface ChannelSendRequest {
    channelId: string;
    /** The template that the attempt compared with its hash, read once for the attempt. */
    template: string | undefined;
    payload: NotificationChannelPayload;
    delivery: NotificationChannelDelivery;
}

/** A failed attempt, by its code. It carries no message of the receiver or of the address. */
export class ChannelSendError extends Error {

    constructor(
        readonly code: NotificationDeliveryErrorCode,
        readonly details: {
            /** The status of an `http` failure. */
            httpStatus?: number;
            /** How long the receiver asked the channel to wait, at most an hour. */
            retryAfterMs?: number;
        } = {}
    ) {
        super(code);
        this.name = "ChannelSendError";
    }

}

/**
 * The storage of the delivery record, outside the database: a file of the data directory on the
 * server, two slots of the origin's private file system in standalone.
 */
export interface DeliveryRecordPort {
    /** The name that the settings page shows, for the user to find the record. */
    readonly name: string;
    /**
     * Reads the record.
     *
     * @returns its text, or `null` when no record exists.
     * @throws when a record exists and cannot be read.
     */
    read(): Promise<string | null>;
    /**
     * Writes the record so that a crash leaves the old or the new text, never a mix: a temporary
     * file flushed and renamed over it, or the slot that does not hold the newest text.
     */
    write(text: string): Promise<void>;
}
