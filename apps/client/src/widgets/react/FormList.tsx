import "./FormList.css";

import { Dropdown as BootstrapDropdown, Tooltip } from "bootstrap";
import clsx from "clsx";
import { ComponentChildren, RefObject } from "preact";
import { type CSSProperties,useEffect, useMemo, useRef, useState } from "preact/compat";

import { CommandNames } from "../../components/app_context";
import { handleRightToLeftPlacement, isMobile, openInAppHelpFromUrl } from "../../services/utils";
import FormToggle from "./FormToggle";
import { useStaticTooltip, useSyncedRef } from "./hooks";
import Icon from "./Icon";

interface FormListOpts {
    children: ComponentChildren;
    onSelect?: (value: string) => void;
    style?: CSSProperties;
    wrapperClassName?: string;
    fullHeight?: boolean;
}

export default function FormList({ children, onSelect, style, fullHeight, wrapperClassName }: FormListOpts) {
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
        };
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
        <div className={clsx("dropdownWrapper", wrapperClassName)} ref={wrapperRef} style={builtinStyles}>
            <div className="dropdown" style={builtinStyles}>
                <button
                    ref={triggerRef}
                    type="button" style="display: none;"
                    data-bs-toggle="dropdown" data-bs-display="static" />

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
    postContent?: ComponentChildren;
    itemRef?: RefObject<HTMLLIElement>;
}

const TOOLTIP_CONFIG: Partial<Tooltip.Options> = {
    placement: handleRightToLeftPlacement("right"),
    fallbackPlacements: [ handleRightToLeftPlacement("right") ]
};

export function FormListItem({ className, icon, value, title, active, disabled, checked, container, onClick, selected, rtl, triggerCommand, description, itemRef: externalItemRef, ...contentProps }: FormListItemOpts) {
    const itemRef = useSyncedRef<HTMLLIElement>(externalItemRef, null);

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

export function FormListToggleableItem({ title, currentValue, onChange, disabled, helpPage, ...props }: Omit<FormListItemOpts, "onClick" | "children"> & {
    title: string;
    currentValue: boolean;
    helpPage?: string;
    onChange(newValue: boolean): void | Promise<void>;
}) {
    const isWaiting = useRef(false);

    return (
        <FormListItem
            {...props}
            disabled={disabled}
            onClick={async (e) => {
                if ((e.target as HTMLElement | null)?.classList.contains("contextual-help")) {
                    return;
                }

                e.stopPropagation();
                if (!disabled && !isWaiting.current) {
                    isWaiting.current = true;
                    await onChange(!currentValue);
                    isWaiting.current = false;
                }
            }}>
            <FormToggle
                switchOnName={title}
                switchOffName={title}
                currentValue={currentValue}
                onChange={() => {}}
                afterName={<>
                    {helpPage && (
                        <span
                            class="bx bx-help-circle contextual-help"
                            onClick={() => openInAppHelpFromUrl(helpPage)}
                        />
                    )}
                    <span class="switch-spacer" />
                </>}
            />
        </FormListItem>
    );
}

function FormListContent({ children, badges, description, disabled, disabledTooltip }: Pick<FormListItemOpts, "children" | "badges" | "description" | "disabled" | "disabledTooltip">) {
    return <>
        {children}
        {badges && badges.map(({ className, text }) => (
            <span className={`badge ${className ?? ""}`}>{text}</span>
        ))}
        {disabled && disabledTooltip && (
            <span class="bx bx-info-circle contextual-help" title={disabledTooltip} />
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
    );
}

export function FormDropdownDivider() {
    return <div
        className="dropdown-divider"
        onClick={e => e.stopPropagation()}
    />;
}

export function FormDropdownSubmenu({ icon, title, children, dropStart, onDropdownToggleClicked }: {
    icon: string,
    title: ComponentChildren,
    children: ComponentChildren,
    onDropdownToggleClicked?: () => void,
    dropStart?: boolean
}) {
    const [ openOnMobile, setOpenOnMobile ] = useState(false);

    return (
        <li className={clsx("dropdown-item dropdown-submenu", { "submenu-open": openOnMobile, "dropstart": dropStart })}>
            <span
                className="dropdown-toggle"
                onClick={(e) => {
                    e.stopPropagation();

                    if (isMobile()) {
                        setOpenOnMobile(!openOnMobile);
                    } else if (onDropdownToggleClicked) {
                        onDropdownToggleClicked();
                    }
                }}
            >
                <Icon icon={icon} />
                &nbsp;
                {title}
            </span>

            <ul className={`dropdown-menu ${openOnMobile ? "show" : ""}`}>
                {children}
            </ul>
        </li>
    );
}
