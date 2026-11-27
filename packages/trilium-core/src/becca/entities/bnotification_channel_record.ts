import type {
    NotificationChannelRecordKind,
    NotificationChannelRecordRow
} from "@triliumnext/commons";

import AbstractBeccaEntity from "./abstract_becca_entity.js";

/** A fact about a channel: its definition, an activation, a revocation, settings or status. */
class BNotificationChannelRecord extends AbstractBeccaEntity<BNotificationChannelRecord> {

    static get entityName() {
        return "notification_channel_records";
    }
    static get primaryKeyName() {
        return "recordId";
    }
    static get hashedProperties() {
        return [ "recordId", "channelId", "kind", "content" ];
    }

    recordId!: string;
    channelId!: string;
    kind!: NotificationChannelRecordKind;
    content!: string;
    declare utcDateModified: string;

    constructor(row?: NotificationChannelRecordRow) {
        super();

        if (!row) {
            return;
        }

        this.updateFromRow(row);
        this.init();
    }

    updateFromRow(row: NotificationChannelRecordRow) {
        this.recordId = row.recordId;
        this.channelId = row.channelId;
        this.kind = row.kind;
        this.content = row.content;
        this.utcDateCreated = row.utcDateCreated;
        this.utcDateModified = row.utcDateModified;
    }

    override init() {
        this.becca.notificationChannelRecords[this.recordId] = this;
    }

    getPojo(): NotificationChannelRecordRow {
        return {
            recordId: this.recordId,
            channelId: this.channelId,
            kind: this.kind,
            content: this.content,
            utcDateCreated: this.utcDateCreated,
            utcDateModified: this.utcDateModified
        };
    }

}

export default BNotificationChannelRecord;
