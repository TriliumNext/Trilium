import "./OptionsRow.css";

import { cloneElement, ComponentChildren, VNode } from "preact";

import FormToggle from "../../../react/FormToggle";
import { useUniqueName } from "../../../react/hooks";

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

    const className = `option-row ${centered ? "centered" : ""} ${stacked ? "stacked" : ""}`;

    return (
        <div className={className}>
            <div className="option-row-label">
                {label && <label for={id}>{label}</label>}
                {description && <small className="option-row-description">{description}</small>}
            </div>
            <div className="option-row-input">
                {childWithId}
            </div>
        </div>
    );
}

interface OptionsRowLinkProps {
    label: string;
    description?: string;
    href: string;
}

export function OptionsRowLink({ label, description, href }: OptionsRowLinkProps) {
    return (
        <a href={href} className="option-row option-row-link no-tooltip-preview">
            <div className="option-row-label">
                <label style={{ cursor: "pointer" }}>{label}</label>
                {description && <small className="option-row-description">{description}</small>}
            </div>
            <div className="option-row-input">
                <span className="bx bx-chevron-right" />
            </div>
        </a>
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
    label: string;
    description?: string;
    icon?: string;
    onClick: () => void;
}

export function OptionsRowWithButton({ label, description, icon, onClick }: OptionsRowWithButtonProps) {
    return (
        <button
            type="button"
            className="option-row option-row-link"
            onClick={onClick}
            aria-label={label}
        >
            <div className="option-row-label">
                <span style={{ cursor: "pointer" }}>{label}</span>
                {description && <small className="option-row-description">{description}</small>}
            </div>
            {icon && (
                <div className="option-row-input">
                    <span className={icon} />
                </div>
            )}
        </button>
    );
}
