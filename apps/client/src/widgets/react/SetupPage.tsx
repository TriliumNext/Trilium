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
    /**
     * A plain sentence, or a fragment for a failure that has more to say than one: what went wrong,
     * with the technical detail underneath it rather than in place of it.
     */
    error?: ComponentChildren;
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
                    {/* A message built from components renders as it was built; a bare sentence still
                        gets the slashes a server error may have had escaped along the way. */}
                    {typeof error === "string" ? replaceHtmlEscapedSlashes(error) : error}
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
