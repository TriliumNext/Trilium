import type {
    NotificationAttentionLevel,
    NotificationCategory,
    NotificationRow,
    NotificationType
} from "@triliumnext/commons";

import AbstractBeccaEntity from "./abstract_becca_entity.js";

/** One generation of a notification: the raise of its `id` at `raisedAt`. */
class BNotification extends AbstractBeccaEntity<BNotification> {

    static get entityName() {
        return "notifications";
    }
    static get primaryKeyName() {
        return "notificationId";
    }
    /** Without the dates, so that instances that write the same row compute the same hash. */
    static get hashedProperties() {
        return [
            "notificationId", "id", "raisedAt", "tag", "noteId", "category", "type",
            "attentionLevel", "isSensitive", "producer", "content"
        ];
    }

    notificationId!: string;
    id!: string;
    raisedAt!: string;
    tag!: string | null;
    noteId!: string | null;
    category!: NotificationCategory;
    type!: NotificationType;
    attentionLevel!: NotificationAttentionLevel;
    isSensitive!: boolean;
    producer!: string;
    content!: string;
    declare utcDateModified: string;

    constructor(row?: NotificationRow) {
        super();

        if (!row) {
            return;
        }

        this.updateFromRow(row);
        this.init();
    }

    updateFromRow(row: NotificationRow) {
        this.notificationId = row.notificationId;
        this.id = row.id;
        this.raisedAt = row.raisedAt;
        this.tag = row.tag;
        this.noteId = row.noteId;
        this.category = row.category;
        this.type = row.type;
        this.attentionLevel = row.attentionLevel;
        this.isSensitive = !!row.isSensitive;
        this.producer = row.producer;
        this.content = row.content;
        this.utcDateCreated = row.utcDateCreated;
        this.utcDateModified = row.utcDateModified;
    }

    override init() {
        this.becca.notifications[this.notificationId] = this;
    }

    getPojo(): NotificationRow {
        return {
            notificationId: this.notificationId,
            id: this.id,
            raisedAt: this.raisedAt,
            tag: this.tag,
            noteId: this.noteId,
            category: this.category,
            type: this.type,
            attentionLevel: this.attentionLevel,
            isSensitive: this.isSensitive,
            producer: this.producer,
            content: this.content,
            utcDateCreated: this.utcDateCreated,
            utcDateModified: this.utcDateModified
        };
    }

}

export default BNotification;
