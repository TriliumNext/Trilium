import type { ConstructorData } from "./becca-interface.js";
import type AbstractBeccaEntity from "./entities/abstract_becca_entity.js";
import BAttachment from "./entities/battachment.js";
import BAttribute from "./entities/battribute.js";
import BBlob from "./entities/bblob.js";
import BBranch from "./entities/bbranch.js";
import BEtapiToken from "./entities/betapi_token.js";
import BNote from "./entities/bnote.js";
import BOption from "./entities/boption.js";
import BRecentNote from "./entities/brecent_note.js";
import BRevision from "./entities/brevision.js";

type EntityClass = new (row?: any) => AbstractBeccaEntity<any>;

const ENTITY_NAME_TO_ENTITY: Record<string, ConstructorData<any> & EntityClass> = {
    attachments: BAttachment,
    attributes: BAttribute,
    blobs: BBlob,
    branches: BBranch,
    etapi_tokens: BEtapiToken,
    notes: BNote,
    options: BOption,
    recent_notes: BRecentNote,
    revisions: BRevision
};

function getEntityFromEntityName(entityName: keyof typeof ENTITY_NAME_TO_ENTITY) {
    if (!(entityName in ENTITY_NAME_TO_ENTITY)) {
        throw new Error(`Entity for table '${entityName}' not found!`);
    }

    return ENTITY_NAME_TO_ENTITY[entityName];
}

export default {
    getEntityFromEntityName
};
