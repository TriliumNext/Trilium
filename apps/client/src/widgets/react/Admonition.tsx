import "./Admonition.css";

import clsx from "clsx";
import { ComponentChildren, HTMLAttributes } from "preact";

import Collapsible from "./Collapsible";
import Icon from "./Icon";

interface AdmonitionProps extends Pick<HTMLAttributes<HTMLDivElement>, "style"> {
    type: "warning" | "note" | "caution";
    children: ComponentChildren;
    className?: string;
}

export default function Admonition({ type, children, className, ...props }: AdmonitionProps) {
    return (
        <div className={clsx("admonition", type, className)} role="alert" {...props}>
            {children}
        </div>
    );
}

interface ExtendedAdmonitionProps extends AdmonitionProps {
    /** Boxicons class for the header icon, e.g. `bx bx-error-circle`. */
    icon: string;
    /** Bold heading shown next to the icon. */
    title: string;
    /** Optional content revealed by a collapsible below the body. */
    details?: ComponentChildren;
    /** Label for the details collapsible toggle; provide it whenever `details` is set. */
    detailsLabel?: string;
}

/**
 * An {@link Admonition} with a richer layout: an icon + title header, a body
 * (`children`) and an optional collapsible "details" section. Reuse for inline
 * error/notice cards that need more than a single block of text.
 */
export function ExtendedAdmonition({ type, icon, title, details, detailsLabel, className, children, ...props }: ExtendedAdmonitionProps) {
    return (
        <div className={clsx("admonition", "extended-admonition", type, className)} role="alert" {...props}>
            <div className="admonition-header">
                <Icon icon={icon} />
                <span className="admonition-title">{title}</span>
            </div>
            <div className="admonition-body">
                {children}
            </div>
            {details && (
                <Collapsible className="admonition-details" title={detailsLabel ?? ""}>
                    {details}
                </Collapsible>
            )}
        </div>
    );
}
