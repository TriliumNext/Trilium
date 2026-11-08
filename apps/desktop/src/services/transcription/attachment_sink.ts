import {
    parseTranscript, setSpeakerName, type Transcript, TRANSCRIPT_MIME, type TranscriptUtterance
} from "@triliumnext/commons";
import { becca, binary_utils, cls, getSql } from "@triliumnext/core";
import { t } from "i18next";

import type { TranscriptSink } from "./session";

/**
 * Keeps the transcript in a `transcript` attachment of the meeting note, rewritten after every
 * utterance. Each write commits its own transaction, which sends the change to every open window,
 * and keeps the speaker names stored in the attachment, which the user can change meanwhile. An
 * utterance that cannot be saved (a protected note while the protected session is locked) is kept
 * and saved with the next write or {@link save}.
 */
export class AttachmentSink implements TranscriptSink {
    private transcript: Transcript | null = null;
    /** The transcript attachment, once {@link open} has created it. */
    attachmentId: string | null = null;

    constructor(private readonly noteId: string) {}

    open(startedAt: number) {
        this.transcript = {
            version: 1,
            startedAt: new Date(startedAt).toISOString(),
            utterances: []
        };
        const content = serialize(this.transcript);
        this.attachmentId = inTransaction(() => becca.getNoteOrThrow(this.noteId).saveAttachment({
            role: "transcript",
            mime: TRANSCRIPT_MIME,
            title: t("transcription.attachment-title"),
            content
        }).attachmentId) ?? null;
    }

    write(utterance: TranscriptUtterance) {
        const { transcript, attachmentId } = this;
        if (!transcript || !attachmentId) {
            throw new Error("The transcript attachment was not created.");
        }

        transcript.utterances.push(utterance);
        this.save();
    }

    /** Rewrites the attachment with every utterance written so far. */
    save() {
        this.rewrite((speakers) => speakers);
    }

    /**
     * Names a speaker in the names as stored, which another window can have changed, or restores
     * its default name when `name` is blank.
     */
    renameSpeaker(key: string, name: string) {
        this.rewrite((speakers, transcript) =>
            setSpeakerName({ ...transcript, speakers }, key, name).speakers);
    }

    /** Rewrites the attachment in one transaction, the stored names passed through `rename`. */
    private rewrite(rename: (speakers: SpeakerNames | undefined, transcript: Transcript) =>
        SpeakerNames | undefined) {
        const { transcript, attachmentId } = this;
        if (!transcript || !attachmentId) {
            throw new Error("The transcript attachment was not created.");
        }

        inTransaction(() => {
            const attachment = becca.getAttachmentOrThrow(attachmentId);
            const stored = parseTranscript(binary_utils.decodeUtf8(attachment.getContent()));
            transcript.speakers = rename(stored?.speakers, transcript);
            attachment.setContent(serialize(transcript));
        });
    }
}

type SpeakerNames = Transcript["speakers"];

function serialize(transcript: Transcript) {
    return JSON.stringify(transcript, null, 2);
}

function inTransaction<T>(callback: () => T): T {
    return cls.init(() => getSql().transactional(callback));
}
