import "./SetupForm.css";

import clsx from "clsx";
import { ComponentChildren } from "preact";

import { t } from "../../../services/i18n";
import { openInAppHelpFromUrl } from "../../../services/utils";
import LinkButton from "../../react/LinkButton";

interface SetupFormProps {
    icon: string;
    onSubmit?: () => void;
    children: ComponentChildren;
    inAppHelpPage?: string;
}

export default function SetupForm({ icon, children, onSubmit, inAppHelpPage }: SetupFormProps) {
    return (
        <div class="setup-form">
            <form class="tn-centered-form" onSubmit={onSubmit}>
                <span className={clsx(icon, "form-icon")} />

                {children}

                {inAppHelpPage && (
                    <LinkButton
                        text={t("setup_form.more_info")}
                        onClick={() => openInAppHelpFromUrl(inAppHelpPage)}
                    />
                )}
            </form>
        </div>
    );
}
