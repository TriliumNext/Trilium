"use strict";

import type { EtapiTokenRow } from "@triliumnext/commons";

import dateUtils from "../../services/utils/date";
import AbstractBeccaEntity from "./abstract_becca_entity.js";

/**
 * EtapiToken is an entity representing token used to authenticate against Trilium REST API from client applications.
 * Used by:
 * - Trilium Sender
 * - ETAPI clients
 *
 * The format user is presented with is "<etapiTokenId>_<tokenHash>". This is also called "authToken" to distinguish it
 * from tokenHash and token.
 */
class BEtapiToken extends AbstractBeccaEntity<BEtapiToken> {
    static get entityName() {
        return "etapi_tokens";
    }
    static get primaryKeyName() {
        return "etapiTokenId";
    }
    static get hashedProperties() {
        return ["etapiTokenId", "name", "tokenHash", "utcDateCreated", "utcDateModified", "isDeleted"];
    }

    etapiTokenId?: string;
    name!: string;
    tokenHash!: string;
    private _isDeleted?: boolean;

    constructor(row?: EtapiTokenRow) {
        super();

        if (!row) {
            return;
        }

        this.updateFromRow(row);
        this.init();
    }

    override get isDeleted() {
        return !!this._isDeleted;
    }

    updateFromRow(row: EtapiTokenRow) {
        this.etapiTokenId = row.etapiTokenId;
        this.name = row.name;
        this.tokenHash = row.tokenHash;
        this.utcDateCreated = row.utcDateCreated || dateUtils.utcNowDateTime();
        this.utcDateModified = row.utcDateModified || this.utcDateCreated;
        this._isDeleted = !!row.isDeleted;

        if (this.etapiTokenId) {
            this.becca.etapiTokens[this.etapiTokenId] = this;
        }
    }

    override init() {
        if (this.etapiTokenId) {
            this.becca.etapiTokens[this.etapiTokenId] = this;
        }
    }

    getPojo() {
        return {
            etapiTokenId: this.etapiTokenId,
            name: this.name,
            tokenHash: this.tokenHash,
            utcDateCreated: this.utcDateCreated,
            utcDateModified: this.utcDateModified,
            isDeleted: this.isDeleted
        };
    }

    override beforeSaving() {
        this.utcDateModified = dateUtils.utcNowDateTime();

        super.beforeSaving();

        if (this.etapiTokenId) {
            this.becca.etapiTokens[this.etapiTokenId] = this;
        }
    }
}

export default BEtapiToken;
