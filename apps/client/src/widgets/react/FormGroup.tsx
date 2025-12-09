import { cloneElement, ComponentChildren, RefObject, VNode } from "preact";
import { CSSProperties } from "preact/compat";
import { useUniqueName } from "./hooks";

interface FormGroupProps {
    name: string;
    labelRef?: RefObject<HTMLLabelElement>;
    label?: string;
    title?: string;
    className?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    children: VNode<any>;
    description?: string | ComponentChildren;
    disabled?: boolean;
    style?: CSSProperties;
}

export default function FormGroup({ name, label, title, className, children, description, labelRef, disabled, style }: FormGroupProps) {
    const id = useUniqueName(name);
    const childWithId = cloneElement(children, { id });

    return (
        <div className={`form-group ${className} ${disabled ? "disabled" : ""}`} title={title} style={style}>
            { label &&
            <label style={{ width: "100%" }} ref={labelRef} htmlFor={id}>{label}</label>}

            {childWithId}

            {description && <div><small className="form-text">{description}</small></div>}
        </div>
    );
}

/**
 * Similar to {@link FormGroup} but allows more than one child. Due to this behaviour, there is no automatic ID assignment.
 */
export function FormMultiGroup({ label, children }: { label: string, children: ComponentChildren }) {
    return (
        <div className={`form-group`}>
            {label && <label>{label}</label>}
            {children}
        </div>
    );
}