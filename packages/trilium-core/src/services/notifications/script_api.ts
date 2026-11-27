/**
 * @module
 *
 * `api.notifications` of backend scripts: the notification API over the service, with the script's
 * note as the producer.
 */
import type {
    NotificationApi,
    NotificationInput,
    NotificationPatch,
    NotificationRef,
    TransientNotificationHandle,
    TransientNotificationInput,
    TriliumNotification
} from "@triliumnext/commons";

import { randomString } from "../utils/index.js";
import { getNotificationService } from "./index.js";
import { NotificationError } from "./model.js";
import type { NotificationProducer } from "./service.js";

const TRANSIENT_ID_LENGTH = 16;

/**
 * The notification API of a backend script. Each method works at once, inside the script's
 * transaction, and resolves to its result, so that a script reads as one of the frontend does.
 *
 * @param noteId the note of the script, which names it as the producer.
 */
export function createScriptNotificationApi(noteId: string): NotificationApi {
    const producer: NotificationProducer = { kind: "script", noteId };
    const service = () => getNotificationService();

    return {
        create: async (input: NotificationInput) => service().create(input, producer).notification,
        update: async (target: string | TriliumNotification, patch: NotificationPatch) => {
            const isNotification = typeof target !== "string";
            try {
                return service().update(isNotification ? target?.id : target, patch, producer,
                    isNotification ? target?.revision : undefined);
            } catch (e) {
                if (e instanceof NotificationError
                    && (e.code === "stale-revision" || e.code === "not-found")) {
                    return null;
                }
                throw e;
            }
        },
        dismiss: async (target: string | NotificationRef) => {
            if (typeof target === "string") {
                service().dismissById(target);
            } else {
                service().dismiss([ target ], "handler");
            }
        },
        getById: async (id: string) => service().getById(id),
        getByTag: async (tag: string) => service().getByTag(tag),
        createTransientNotification: (input: TransientNotificationInput) =>
            new ScriptTransientHandle(input, producer)
    };
}

/**
 * A transient notification of a backend script, which lasts until it is dismissed or the process
 * ends. Each setter sends the change at once, and throws what the service refuses.
 */
class ScriptTransientHandle implements TransientNotificationHandle {

    readonly id = randomString(TRANSIENT_ID_LENGTH);
    private input: TransientNotificationInput;
    private token: string;
    private isDismissed = false;

    /** @throws NotificationError for input that fails a check, and a create beyond the limits. */
    constructor(
        input: TransientNotificationInput,
        private readonly producer: NotificationProducer
    ) {
        this.input = { ...input };
        this.token = getNotificationService().putTransient(this.id, this.input, producer);
    }

    setTitle(title: string) {
        this.change({ title });
    }

    setDescription(description: string) {
        this.change({ description });
    }

    setProtectedTitle(protectedTitle: string) {
        this.change({ protectedTitle });
    }

    setProtectedDescription(protectedDescription: string) {
        this.change({ protectedDescription });
    }

    setIcon(icon: string) {
        this.change({ icon });
    }

    setProgress(progress: number) {
        this.change({ progress });
    }

    setProgressLabel(progressLabel: string) {
        this.change({ progressLabel });
    }

    setActions(actions: TransientNotificationInput["actions"]) {
        this.change({ actions });
    }

    dismiss() {
        if (this.isDismissed) {
            return;
        }
        this.isDismissed = true;
        getNotificationService().dismissTransient(this.id, this.token);
    }

    private change(patch: TransientNotificationInput) {
        if (this.isDismissed) {
            return;
        }
        const input = { ...this.input, ...patch };
        this.token = getNotificationService()
            .putTransient(this.id, input, this.producer, this.token);
        this.input = input;
    }

}
