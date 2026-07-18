import type FNote from "../../entities/fnote";
import server from "../../services/server";
import { ViewTypeOptions } from "../collections/interface";

const ATTACHMENT_ROLE = "viewConfig";

export type ViewModeStorageType = ViewTypeOptions | "pdfHistory";

export default class ViewModeStorage<T extends object> {

    private note: FNote;
    readonly attachmentName: string;
    /** The serialized content last stored or restored, used to tell our own echoes apart from external changes. */
    private lastKnownContent?: string;

    constructor(note: FNote, viewType: ViewModeStorageType) {
        this.note = note;
        this.attachmentName = `${viewType}.json`;
    }

    async store(data: T) {
        const content = JSON.stringify(data);
        this.lastKnownContent = content;
        const payload = {
            role: ATTACHMENT_ROLE,
            title: this.attachmentName,
            mime: "application/json",
            content,
            position: 0
        };
        await server.post(`notes/${this.note.noteId}/attachments?matchBy=title`, payload);
    }

    async restore() {
        const content = await this.fetchContent();
        if (content === undefined) {
            return undefined;
        }
        this.lastKnownContent = content;
        return JSON.parse(content) as T;
    }

    /**
     * Like {@link restore}, but resolves to `undefined` if the stored content matches what was last
     * stored or restored, so that callers only react to genuinely external changes (e.g. the same
     * view opened in another split, or synced from another instance).
     */
    async restoreIfChanged() {
        const content = await this.fetchContent();
        if (content === undefined || content === this.lastKnownContent) {
            return undefined;
        }
        this.lastKnownContent = content;
        return JSON.parse(content) as T;
    }

    private async fetchContent() {
        const existingAttachments = (await this.note.getAttachmentsByRole(ATTACHMENT_ROLE))
            .filter(a => a.title === this.attachmentName);
        if (existingAttachments.length === 0) {
            return undefined;
        }

        if (existingAttachments.length > 1) {
            // Clean up duplicates.
            await Promise.all(existingAttachments.slice(1).map(async a => await server.remove(`attachments/${a.attachmentId}`)));
        }

        const attachment = existingAttachments[0];
        const attachmentData = await server.get<{ content: string } | null>(`attachments/${attachment.attachmentId}/blob`);
        return attachmentData?.content ?? "{}";
    }
}
