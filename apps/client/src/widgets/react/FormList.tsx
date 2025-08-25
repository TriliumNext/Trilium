import { Dropdown as BootstrapDropdown } from "bootstrap";
import { ComponentChildren } from "preact";
import Icon from "./Icon";
import { useEffect, useMemo, useRef, type CSSProperties } from "preact/compat";
import "./FormList.css";
import { CommandNames } from "../../components/app_context";

interface FormListOpts {
    children: ComponentChildren;
    onSelect?: (value: string) => void;
    style?: CSSProperties;
    fullHeight?: boolean;
}

export default function FormList({ children, onSelect, style, fullHeight }: FormListOpts) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!triggerRef.current || !wrapperRef.current) {
            return;
        }
        
        const $wrapperRef = $(wrapperRef.current);
        const dropdown = BootstrapDropdown.getOrCreateInstance(triggerRef.current);
        $wrapperRef.on("hide.bs.dropdown", (e) => e.preventDefault());

        return () => {
            $wrapperRef.off("hide.bs.dropdown");
            dropdown.dispose();
        }
    }, [ triggerRef, wrapperRef ]);

    const builtinStyles = useMemo(() => {
        const style: CSSProperties = {};
        if (fullHeight) {
            style.height = "100%";
        }
        return style;
    }, [ fullHeight ]);

    return (
        <div className="dropdownWrapper" ref={wrapperRef} style={builtinStyles}>
            <div className="dropdown" style={builtinStyles}>
                <button
                    ref={triggerRef}
                    type="button" style="display: none;"
                    data-bs-toggle="dropdown" data-bs-display="static">
                </button>

                <div class="dropdown-menu static show" style={{
                    ...style ?? {},
                    ...builtinStyles,
                    position: "relative",
                }} onClick={(e) => {
                    const value = (e.target as HTMLElement)?.dataset?.value;
                    if (value && onSelect) {
                        onSelect(value);
                    }
                }}>
                    {children}
                </div>
            </div>
        </div>
    );
}

export interface FormListBadge {
    className?: string;
    text: string;
}

interface FormListItemOpts {
    children: ComponentChildren;
    icon?: string;
    value?: string;
    title?: string;
    active?: boolean;
    badges?: FormListBadge[];
    disabled?: boolean;
    checked?: boolean | null;
    selected?: boolean;
    onClick?: (e: MouseEvent) => void;
    triggerCommand?: CommandNames;
    description?: string;
    className?: string;
    rtl?: boolean;
}

export function FormListItem({ children, icon, value, title, active, badges, disabled, checked, onClick, description, selected, rtl, triggerCommand }: FormListItemOpts) {
    if (checked) {
        icon = "bx bx-check";
    }

    return (
        <a
            class={`dropdown-item ${active ? "active" : ""} ${disabled ? "disabled" : ""} ${selected ? "selected" : ""}`}
            data-value={value} title={title}
            tabIndex={0}
            onClick={onClick}
            data-trigger-command={triggerCommand}
            dir={rtl ? "rtl" : undefined}
        >
            <Icon icon={icon} />&nbsp;
            <div>
                {children}
                {badges && badges.map(({ className, text }) => (
                    <span className={`badge ${className ?? ""}`}>{text}</span>
                ))}
                {description && <div className="description">{description}</div>}
            </div>
        </a>
    );
}

interface FormListHeaderOpts {
    text: string;
}

export function FormListHeader({ text }: FormListHeaderOpts) {
    return (
        <li>
            <h6 className="dropdown-header">{text}</h6>
        </li>
    )
}

export function FormDropdownDivider() {
    return <div className="dropdown-divider" />;
}