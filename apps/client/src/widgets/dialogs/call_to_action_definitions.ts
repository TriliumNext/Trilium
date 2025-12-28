import appContext from "../../components/app_context";
import { t } from "../../services/i18n";
import options from "../../services/options";
import utils from "../../services/utils";

/**
 * A "call-to-action" is an interactive message for the user, generally to present new features.
 */
export interface CallToAction {
    /**
     * A unique identifier to allow the call-to-action to be dismissed by the user and then never shown again.
     */
    id: string;
    /**
     * The title of the call-to-action, displayed as a heading in the message.
     */
    title: string;
    /**
     * The message body of the call-to-action.
     */
    message: string;
    /**
     * Function that determines whether the call-to-action can be displayed to the user. The check can be based on options or
     * the platform of the user. If the user already dismissed this call-to-action, the value of this function doesn't matter.
     *
     * @returns whether to allow this call-to-action or to skip it, based on the user's environment.
     */
    enabled: () => boolean;
    /**
     * A list of buttons to display in the footer of the modal.
     */
    buttons: {
        /**
         * The text displayed on the button.
         */
        text: string;
        /**
         * The listener that will be called when the button is pressed. Async methods are supported and will be awaited before proceeding to the next step.
         */
        onClick: () => (void | Promise<void>);
    }[];
}

function isNextTheme() {
    return [ "next", "next-light", "next-dark" ].includes(options.get("theme"));
}

const CALL_TO_ACTIONS: CallToAction[] = [
    {
        id: "new_layout",
        title: t("call_to_action.new_layout_title"),
        message: t("call_to_action.new_layout_message"),
        enabled: () => true,
        buttons: [
            {

                text: t("call_to_action.new_layout_button"),
                onClick: () => appContext.tabManager.openInNewTab("_help_IjZS7iK5EXtb", "_help", true)
            }
        ]
    },
    {
        id: "background_effects",
        title: t("call_to_action.background_effects_title"),
        message: t("call_to_action.background_effects_message"),
        enabled: () => false,
        buttons: [
            {
                text: t("call_to_action.background_effects_button"),
                async onClick() {
                    await options.save("backgroundEffects", "true");
                    utils.restartDesktopApp();
                }
            }
        ]
    },
    {
        id: "next_theme",
        title: t("call_to_action.next_theme_title"),
        message: t("call_to_action.next_theme_message"),
        enabled: () => !isNextTheme(),
        buttons: [
            {
                text: t("call_to_action.next_theme_button"),
                async onClick() {
                    await options.save("theme", "next");
                    await options.save("backgroundEffects", "true");
                    utils.reloadFrontendApp("call-to-action");
                }
            }
        ]
    }
];

/**
 * Obtains the list of available call-to-actions, meaning those that are enabled based on the user's environment but also with
 * without the call-to-actions already dismissed by the user.
 *
 * @returns a list iof call to actions to display to the user.
 */
export function getCallToActions() {
    const seenCallToActions = new Set(getSeenCallToActions());

    return CALL_TO_ACTIONS.filter((callToAction) =>
        !seenCallToActions.has(callToAction.id) && callToAction.enabled());
}

/**
 * Marks the call-to-action as dismissed by the user, meaning that {@link getCallToActions()} will no longer list this particular action.
 *
 * @param id the corresponding ID of the call to action.
 * @returns a promise with the option saving. Generally it's best to wait for the promise to resolve before refreshing the page.
 */
export async function dismissCallToAction(id: string) {
    const seenCallToActions = getSeenCallToActions();
    if (seenCallToActions.find(seenId => seenId === id)) {
        return;
    }

    seenCallToActions.push(id);
    await options.save("seenCallToActions", JSON.stringify(seenCallToActions));
}

function getSeenCallToActions() {
    try {
        return JSON.parse(options.get("seenCallToActions")) as string[];
    } catch (e) {
        return [];
    }
}
