import "./Badge.css";

import clsx from "clsx";
import { ComponentChildren, HTMLAttributes } from "preact";
import { useRef } from "preact/hooks";

import { isDefinitionName } from "../../entities/fattribute";
import { escapeHtml } from "../../services/utils";
import { attributeKindIcon } from "../attribute_widgets/attribute_types";
import Dropdown, { DropdownProps } from "./Dropdown";
import { useStaticTooltip } from "./hooks";
import Icon from "./Icon";
import RawHtml from "./RawHtml";

interface SimpleBadgeProps {
    className?: string;
    title: ComponentChildren;
}

interface BadgeProps extends Pick<HTMLAttributes<HTMLDivElement>, "onClick" | "style"> {
    text?: ComponentChildren;
    icon?: string;
    className?: string;
    tooltip?: string;
    href?: string;
    /** Renders the badge as a colored outline (transparent fill) instead of a solid background. */
    outline?: boolean;
}

export default function SimpleBadge({ title, className }: SimpleBadgeProps) {
    return <span class={`badge ${className ?? ""}`}>{title}</span>;
}

export function Badge({ icon, className, text, tooltip, href, outline, ...containerProps }: BadgeProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    useStaticTooltip(containerRef, {
        placement: "bottom",
        fallbackPlacements: [ "bottom" ],
        animation: false,
        html: true,
        title: tooltip,
        customClass: "pre-wrap-text"
    });

    const content = <>
        {icon && <Icon icon={icon} />}
        <span class="text">{text}</span>
    </>;

    return (
        <div
            ref={containerRef}
            className={clsx("ext-badge", className, { "clickable": !!containerProps.onClick, "outline": outline })}
            {...containerProps}
        >
            {href ? <a href={href}>{content}</a> : <span>{content}</span>}
        </div>
    );
}

/**
 * A search result's `highlightedAttributeSnippet`, which the server joins with `<br>`, as one outline
 * badge per attribute, its search highlights kept: the icon of its kind, its name, and its value in a
 * segment of its own. A line that does not parse is shown as it came.
 */
export function AttributeSnippetBadges({ snippet, className }: { snippet: string | undefined; className: string }) {
    const lines = snippet?.split(/<br\s*\/?>/i).map((line) => line.trim()).filter(Boolean);
    if (!lines?.length) return null;

    return (
        <div className={className}>
            {lines.map((line, index) => {
                const attribute = parseAttributeSnippetLine(line);
                if (!attribute) {
                    return <Badge key={index} outline text={<RawHtml html={line} />} />;
                }

                return (
                    <Badge
                        key={index}
                        outline
                        className={clsx("attribute-badge", { "has-value": !!attribute.value })}
                        text={<>
                            {/* The icon goes with the name, the two sharing the key's shading. */}
                            <span className="attribute-badge-key">
                                <Icon icon={attribute.icon} />
                                <RawHtml className="attribute-badge-name" html={attribute.name} />
                            </span>
                            {attribute.value && (
                                // The segment spans the badge's height; the text in it can end in an
                                // ellipsis, which a flex container's own text cannot.
                                <span className="attribute-badge-value"><RawHtml html={attribute.value} /></span>
                            )}
                        </>}
                    />
                );
            })}
        </div>
    );
}

/**
 * One attribute of a search result's snippet: its kind's icon, and its name and value as highlighted
 * HTML.
 */
export interface AttributeSnippetLine {
    icon: string;
    name: string;
    value?: string;
}

/**
 * Reads a line of `highlightedAttributeSnippet` as `extractAttributeSnippet()` writes it, `#name`,
 * `#name="value"` or `~name="target title"`, escaped, so its quotes arrive as `&quot;`. The icon is
 * the attributes panel's; a definition (`#label:name="promoted,…"`) is shown by its bare name, the
 * icon standing for the field it sets up, and its options only where the search matched them. Returns
 * `null` for a line in no such shape, such as one the server cut short.
 */
export function parseAttributeSnippetLine(line: string): AttributeSnippetLine | null {
    const match = /^([#~])(.+?)(?:=&quot;(.*)&quot;)?$/s.exec(line);
    if (!match || match[2].includes("=&quot;")) return null;

    const [ , prefix, name, value ] = match;
    const type = prefix === "#" ? "label" : "relation";
    const plainName = htmlToText(name);
    const icon = attributeKindIcon(type, plainName, htmlToText(value ?? ""));

    if (type === "label" && isDefinitionName(plainName)) {
        const definitionPrefix = plainName.substring(0, plainName.indexOf(":") + 1);
        // A highlight across the prefix leaves no bare name to keep it in, so the name is shown as text.
        const bareName = name.startsWith(definitionPrefix)
            ? name.substring(definitionPrefix.length)
            : escapeHtml(plainName.substring(definitionPrefix.length));
        // Its options are no value of the note's, unless the search matched them.
        return { icon, name: bareName, ...(value?.includes("<b") ? { value } : {}) };
    }

    return { icon, name, ...(value ? { value } : {}) };
}

function htmlToText(html: string) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.textContent ?? "";
}

export function BadgeWithDropdown({ text, children, tooltip, className, dropdownProps, ...props }: BadgeProps & {
    children: ComponentChildren,
    dropdownProps?: Partial<DropdownProps>
}) {
    return (
        <Dropdown
            className={`dropdown-badge dropdown-${className}`}
            text={<Badge
                text={<>
                    <span class="text-inner">{text}</span>
                    <Icon className="arrow" icon="bx bx-chevron-down" />
                </>}
                className={className}
                {...props}
            />}
            noSelectButtonStyle
            hideToggleArrow
            title={tooltip}
            titlePosition="bottom"
            {...dropdownProps}
            placement="bottom"
        >{children}</Dropdown>
    );
}
