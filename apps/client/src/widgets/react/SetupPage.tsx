import clsx from "clsx";
import { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { replaceHtmlEscapedSlashes } from "../../services/utils";
import ActionButton from "./ActionButton";
import Admonition from "./Admonition";
import Button from "./Button";

/**
 * Shared full-height page shell used by the setup wizard and the set-password page.
 *
 * Renders the rounded card layout (illustration, heading, scrollable content and a
 * sticky footer) on top of the gradient background defined by `body.setup` in
 * `setup.css`. Consumers are expected to mount this inside a `.setup-container`.
 */
export default function SetupPage({ title, description, className, illustration, children, footer, error, errorId, onBack }: {
    title: string;
    description?: string;
    error?: string | null;
    errorId?: number;
    className?: string;
    illustration?: ComponentChildren;
    children?: ComponentChildren;
    footer?: ComponentChildren;
    onBack?: () => void;
}) {
    const [ showError, setShowError ] = useState(!!error);
    useEffect(() => {
        if (error) {
            setShowError(true);
        }
    }, [ error, errorId ]);

    return (
        <div className={clsx("page", className, { "contentless": !children })}>
            {onBack && (
                <Button
                    className="back-button"
                    icon="bx bx-arrow-back"
                    text={t("setup.button-back")}
                    onClick={onBack}
                    kind="lowProfile"
                />
            )}
            {error && showError && (
                <Admonition className="page-error" type="caution">
                    <ActionButton icon="bx bx-x" text={t("setup.dismiss-error")} onClick={() => setShowError(false)}  />
                    {replaceHtmlEscapedSlashes(error)}
                </Admonition>
            )}

            {illustration}
            <h1>{title}</h1>
            {description && <p class="page-description">{description}</p>}
            {children && <main>
                {children}
            </main>}
            {footer && <footer>{footer}</footer>}
        </div>
    );
}
