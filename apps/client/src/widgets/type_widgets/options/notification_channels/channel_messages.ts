/**
 * @module
 *
 * The sentences of the channels card for the codes of the channel routes: refusals of a request,
 * outcomes of a delivery or a test send, and the attribute changes of a review.
 */
import type {
    NotificationChannelAttributeChange, NotificationChannelTestResponse, NotificationErrorCode
} from "@triliumnext/commons";

import { t } from "../../../../services/i18n";
import { markBidiControls } from "../../../../services/notification_display";
import { NotificationRequestError } from "../../../../services/notifications";

/** The refusals that the card explains. Any other is shown as a failed request. */
const EXPLAINED_REFUSALS: NotificationErrorCode[] = [
    "invalid-input", "invalid-template", "too-large", "not-found", "stale-revision", "rate-limit",
    "not-forwarding", "password-not-set", "safe-mode", "not-runnable", "type-unavailable"
];

/** The code of a failed request of the card, `internal` for one that has none. */
export function getRefusalCode(error: unknown): NotificationErrorCode {
    return error instanceof NotificationRequestError ? error.code : "internal";
}

/** The sentence for a failed request of the card. */
export function getRefusalMessage(error: unknown) {
    const code = getRefusalCode(error);
    return EXPLAINED_REFUSALS.includes(code)
        ? t(`notification_channels.refusals.${code}`)
        : t("notification_channels.refusals.internal");
}

/** The sentence for the outcome of a delivery or a test send. */
export function getOutcomeText(code: NotificationChannelTestResponse["code"]) {
    return t(`notification_channels.outcomes.${code}`);
}

/**
 * An attribute change of a review in the syntax of the attribute editor, `#name="value"`, with
 * bidirectional control characters marked.
 */
export function formatAttributeChange({
    type, name, value, previousValue, change
}: NotificationChannelAttributeChange) {
    const attribute = `${type === "label" ? "#" : "~"}${name}`;
    if (change === "changed") {
        const values = `${JSON.stringify(previousValue ?? "")} → ${JSON.stringify(value ?? "")}`;
        return markBidiControls(`${attribute}=${values}`);
    }

    const shownValue = value ?? previousValue;
    return markBidiControls(shownValue ? `${attribute}=${JSON.stringify(shownValue)}` : attribute);
}
