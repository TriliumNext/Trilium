import type { NotificationPrivateTextRow } from "@triliumnext/commons";

import AbstractBeccaEntity from "./abstract_becca_entity.js";

/** The private text of a sensitive notification, sealed, in a row of its own. */
class BNotificationPrivateText extends AbstractBeccaEntity<BNotificationPrivateText> {

    static get entityName() {
        return "notification_private_texts";
    }
    static get primaryKeyName() {
        return "notificationId";
    }
    /** Without the dates, so that the same sealed text has the same hash on every instance. */
    static get hashedProperties() {
        return [ "notificationId", "content" ];
    }

    notificationId!: string;
    content!: string;
    declare utcDateModified: string;

    constructor(row?: NotificationPrivateTextRow) {
        super();

        if (!row) {
            return;
        }

        this.updateFromRow(row);
        this.init();
    }

    updateFromRow(row: NotificationPrivateTextRow) {
        this.notificationId = row.notificationId;
        this.content = row.content;
        this.utcDateCreated = row.utcDateCreated;
        this.utcDateModified = row.utcDateModified;
    }

    override init() {
        this.becca.notificationPrivateTexts[this.notificationId] = this;
    }

    getPojo(): NotificationPrivateTextRow {
        return {
            notificationId: this.notificationId,
            content: this.content,
            utcDateCreated: this.utcDateCreated,
            utcDateModified: this.utcDateModified
        };
    }

}

export default BNotificationPrivateText;
