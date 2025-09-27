import { Dropdown as BootstrapDropdown, Tooltip } from "bootstrap";
import { ComponentChildren } from "preact";
import Icon from "./Icon";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "preact/compat";
import "./FormList.css";
import { CommandNames } from "../../components/app_context";
import { useStaticTooltip } from "./hooks";
import { isMobile } from "../../services/utils";

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
            style.overflow = "auto";
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
                    const dropdownItem = (e.target as HTMLElement).closest(".dropdown-item") as HTMLElement | null;
                    const value = dropdownItem?.dataset?.value;
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
    /** Will indicate the reason why the item is disabled via an icon, when hovered over it. */
    disabledTooltip?: string;
    checked?: boolean | null;
    selected?: boolean;
    container?: boolean;
    onClick?: (e: MouseEvent) => void;
    triggerCommand?: CommandNames;
    description?: string;
    className?: string;
    rtl?: boolean;
}

const TOOLTIP_CONFIG: Partial<Tooltip.Options> = {
    placement: "right",
    fallbackPlacements: [ "right" ]
}

export function FormListItem({ className, icon, value, title, active, disabled, checked, container, onClick, selected, rtl, triggerCommand, description, ...contentProps }: FormListItemOpts) {
    const itemRef = useRef<HTMLLIElement>(null);

    if (checked) {
        icon = "bx bx-check";
    }

    useStaticTooltip(itemRef, TOOLTIP_CONFIG);

    return (
        <li
            ref={itemRef}
            class={`dropdown-item ${active ? "active" : ""} ${disabled ? "disabled" : ""} ${selected ? "selected" : ""} ${container ? "dropdown-container-item": ""} ${className ?? ""}`}
            data-value={value} title={title}
            tabIndex={container ? -1 : 0}
            onClick={onClick}
            data-trigger-command={triggerCommand}
            dir={rtl ? "rtl" : undefined}
        >
            <Icon icon={icon} />&nbsp;
            {description ? (
                <div>
                    <FormListContent description={description} disabled={disabled} {...contentProps} />
                </div>
            ) : (
                <FormListContent description={description} disabled={disabled} {...contentProps} />
            )}
        </li>
    );
}

function FormListContent({ children, badges, description, disabled, disabledTooltip }: Pick<FormListItemOpts, "children" | "badges" | "description" | "disabled" | "disabledTooltip">) {
    return <>
        {children}
        {badges && badges.map(({ className, text }) => (
            <span className={`badge ${className ?? ""}`}>{text}</span>
        ))}
        {disabled && disabledTooltip && (
            <span class="bx bx-info-circle disabled-tooltip" title={disabledTooltip} />
        )}
        {description && <div className="description">{description}</div>}
    </>;
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

export function FormDropdownSubmenu({ icon, title, children }: { icon: string, title: ComponentChildren, children: ComponentChildren }) {
    const [ openOnMobile, setOpenOnMobile ] = useState(false);

    return (
        <li className={`dropdown-item dropdown-submenu ${openOnMobile ? "submenu-open" : ""}`}>
            <span
                className="dropdown-toggle"
                onClick={(e) => {
                    e.stopPropagation();

                    if (isMobile()) {
                        setOpenOnMobile(!openOnMobile);
                    }
                }}
            >
                <Icon icon={icon} />{" "}
                {title}
            </span>

            <ul className={`dropdown-menu ${openOnMobile ? "show" : ""}`}>
                {children}
            </ul>
        </li>
    )
}
