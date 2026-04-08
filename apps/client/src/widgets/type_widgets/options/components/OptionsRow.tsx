import "./OptionsRow.css";

import { cloneElement, VNode } from "preact";

import { useUniqueName } from "../../../react/hooks";

interface OptionsRowProps {
    name: string;
    label?: string;
    description?: string;
    children: VNode;
    centered?: boolean;
}

export default function OptionsRow({ name, label, description, children, centered }: OptionsRowProps) {
    const id = useUniqueName(name);
    const childWithId = cloneElement(children, { id });

    return (
        <div className={`option-row ${centered ? "centered" : ""}`}>
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
        <a href={href} className="option-row option-row-link use-tn-links no-tooltip-preview">
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
