import "./OptionsRow.css";

import clsx from "clsx";
import { cloneElement, ComponentChildren, VNode } from "preact";
import { useContext } from "preact/hooks";

import Button from "../../../react/Button";
import { CardSection } from "../../../react/Card";
import FormToggle from "../../../react/FormToggle";
import { useUniqueName } from "../../../react/hooks";
import { OptionsCardContext } from "./OptionsSection";

interface OptionsRowProps {
    name: string;
    label?: ComponentChildren;
    description?: ComponentChildren;
    children: VNode;
    centered?: boolean;
    /** When true, stacks label above input with full-width input */
    stacked?: boolean;
}

export default function OptionsRow({ name, label, description, children, centered, stacked }: OptionsRowProps) {
    const id = useUniqueName(name);
    const childWithId = cloneElement(children, { id, name: (children.props as { name?: string }).name ?? name });

    return (
        <OptionsRowShell className={clsx({ centered, stacked })}>
            <div className="option-row-label">
                {label && <label for={id}>{label}</label>}
                {description && <small className="option-row-description">{description}</small>}
            </div>
            <div className="option-row-input">
                {childWithId}
            </div>
        </OptionsRowShell>
    );
}

interface OptionsRowShellProps {
    as?: "section" | "a" | "button";
    className?: string;
    children: ComponentChildren;
    [prop: string]: unknown;
}

/**
 * The box a row lives in. Inside an options card the row is a segment of that card in its own right,
 * seamed off from the rows around it; everywhere else (the import, delete and login dialogs) it stays
 * a plain row, divided from its neighbours by a hairline.
 */
export function OptionsRowShell({ as, className, children, ...rest }: OptionsRowShellProps) {
    const segmented = useContext(OptionsCardContext);
    const rowClassName = clsx("option-row", className);

    if (!segmented) {
        const Tag = as ?? "div";
        return <Tag className={rowClassName} {...rest}>{children}</Tag>;
    }

    return <CardSection as={as ?? "section"} className={rowClassName} {...rest}>{children}</CardSection>;
}

interface OptionsRowLinkProps {
    label: string;
    description?: string;
    href: string;
    onClick?: (e: MouseEvent) => void;
    /** Opts out of the options dialog's contained link navigation (which runs before `onClick`),
     *  so that `onClick` gets to handle the click itself. */
    noContainedNavigation?: boolean;
}

export function OptionsRowLink({ label, description, href, onClick, noContainedNavigation }: OptionsRowLinkProps) {
    return (
        <OptionsRowShell
            as="a"
            className="option-row-link no-tooltip-preview"
            href={href}
            onClick={onClick}
            data-no-contained-navigation={noContainedNavigation ? "" : undefined}
        >
            <div className="option-row-label">
                <label>{label}</label>
                {description && <small className="option-row-description">{description}</small>}
            </div>
            <div className="option-row-input">
                <span className="bx bx-chevron-right" />
            </div>
        </OptionsRowShell>
    );
}

interface OptionsRowWithToggleProps {
    name: string;
    label: ComponentChildren;
    description?: ComponentChildren;
    currentValue: boolean | null;
    onChange: (newValue: boolean) => void;
    disabled?: boolean;
    helpPage?: string;
}

export function OptionsRowWithToggle({ name, label, description, currentValue, onChange, disabled, helpPage }: OptionsRowWithToggleProps) {
    return (
        <OptionsRow name={name} label={label} description={description}>
            <FormToggle
                switchOnName=""
                switchOffName=""
                currentValue={currentValue}
                onChange={onChange}
                disabled={disabled}
                helpPage={helpPage}
            />
        </OptionsRow>
    );
}

interface OptionsRowWithButtonProps {
    label: ComponentChildren;
    description?: string;
    /** Icon for the action button, in {@link Button} format (e.g. `bx-refresh`, without the leading `bx `). */
    icon?: string;
    disabled?: boolean;
    onClick: () => void;
    /** Label of the action button shown on the right of the row. */
    buttonText: string;
    /** Extra class on the action button, e.g. to tint a destructive action. */
    buttonClassName?: string;
}

/**
 * A settings row with passive label/description text and a discrete action button on the right.
 * The button — not the whole row — is the affordance, which reads more clearly as clickable.
 */
export function OptionsRowWithButton({ label, description, icon, disabled, onClick, buttonText, buttonClassName }: OptionsRowWithButtonProps) {
    return (
        <OptionsRowShell>
            <div className="option-row-label">
                <label>{label}</label>
                {description && <small className="option-row-description">{description}</small>}
            </div>
            <div className="option-row-input">
                <Button className={buttonClassName} text={buttonText} icon={icon} disabled={disabled} onClick={onClick} />
            </div>
        </OptionsRowShell>
    );
}
