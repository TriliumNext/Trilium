import type FNote from "../../entities/fnote";
import type { ViewTypeOptions } from "../../services/note_list_renderer";
import server from "../../services/server";

const ATTACHMENT_ROLE = "viewConfig";

export default class ViewModeStorage<T extends object> {

    private note: FNote;
    private attachmentName: string;

    constructor(note: FNote, viewType: ViewTypeOptions) {
        this.note = note;
        this.attachmentName = viewType + ".json";
    }

    async store(data: T) {
        const payload = {
            role: ATTACHMENT_ROLE,
            title: this.attachmentName,
            mime: "application/json",
            content: JSON.stringify(data),
            position: 0
        };
        await server.post(`notes/${this.note.noteId}/attachments?matchBy=title`, payload);
    }

    async restore() {
        const existingAttachments = await this.note.getAttachmentsByRole(ATTACHMENT_ROLE);
        if (existingAttachments.length === 0) {
            return undefined;
        }

        const attachment = existingAttachments
            .find(a => a.title === this.attachmentName);
        if (!attachment) {
            return undefined;
        }

        const attachmentData = await server.get<{ content: string } | null>(`attachments/${attachment.attachmentId}/blob`);
        return JSON.parse(attachmentData?.content ?? "{}");
    }
}
