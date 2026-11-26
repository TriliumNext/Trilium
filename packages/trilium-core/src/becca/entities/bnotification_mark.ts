import type { NotificationMarkKind, NotificationMarkRow } from "@triliumnext/commons";

import AbstractBeccaEntity from "./abstract_becca_entity.js";

/** A fact about a generation: seen, read or sensitive. It is written once and never changed. */
class BNotificationMark extends AbstractBeccaEntity<BNotificationMark> {

    static get entityName() {
        return "notification_marks";
    }
    static get primaryKeyName() {
        return "markId";
    }
    static get hashedProperties() {
        return [ "markId", "notificationId", "kind" ];
    }

    markId!: string;
    notificationId!: string;
    kind!: NotificationMarkKind;

    constructor(row?: NotificationMarkRow) {
        super();

        if (!row) {
            return;
        }

        this.updateFromRow(row);
        this.init();
    }

    updateFromRow(row: NotificationMarkRow) {
        this.markId = row.markId;
        this.notificationId = row.notificationId;
        this.kind = row.kind;
        this.utcDateCreated = row.utcDateCreated;
    }

    override init() {
        this.becca.notificationMarks[this.markId] = this;
    }

    getPojo(): NotificationMarkRow {
        return {
            markId: this.markId,
            notificationId: this.notificationId,
            kind: this.kind,
            utcDateCreated: this.utcDateCreated
        };
    }

}

export default BNotificationMark;
