import type {
    NotificationChannelDelivery, NotificationChannelPayload
} from "@triliumnext/commons";
import type { ScriptRequest, ScriptResponse } from "@triliumnext/commons/src/lib/script_api.js";

import type BNote from "../becca/entities/bnote.js";
import AbstractBeccaEntity from "../becca/entities/abstract_becca_entity.js";

export interface ApiParams {
    startNote?: BNote | null;
    originEntity?: AbstractBeccaEntity<any> | null;
    pathParams?: string[];
    req?: ScriptRequest;
    res?: ScriptResponse;
    /** The payload of a notification channel's attempt. */
    notification?: NotificationChannelPayload;
    /** The attempt of a notification channel. */
    delivery?: NotificationChannelDelivery;
    /** The owned labels of a channel note, as its activation holds them. */
    channelSettings?: Record<string, string>;
}
