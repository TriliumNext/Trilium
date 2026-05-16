"use strict";

import dateUtils from "../../services/utils/date";
import AbstractBeccaEntity from "./abstract_becca_entity.js";
import type { OptionRow } from "@triliumnext/commons";

/**
 * Option represents a name-value pair, either directly configurable by the user or some system property.
 */
class BOption extends AbstractBeccaEntity<BOption> {
    static get entityName() {
        return "options";
    }
    static get primaryKeyName() {
        return "name";
    }
    static get hashedProperties() {
        return ["name", "value"];
    }

    name!: string;
    value!: string;

    constructor(row?: OptionRow) {
        super();

        if (row) {
            this.updateFromRow(row);
        }
        this.becca.options[this.name] = this;
    }

    updateFromRow(row: OptionRow) {
        this.name = row.name;
        this.value = row.value;
        this.isSynced = !!row.isSynced;
        this.utcDateModified = row.utcDateModified;
    }

    override beforeSaving() {
        super.beforeSaving();

        this.utcDateModified = dateUtils.utcNowDateTime();
    }

    getPojo() {
        return {
            name: this.name,
            value: this.value,
            isSynced: this.isSynced,
            utcDateModified: this.utcDateModified
        };
    }
}

export default BOption;
