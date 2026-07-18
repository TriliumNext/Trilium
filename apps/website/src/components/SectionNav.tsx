import "./SectionNav.css";

import { useEffect, useRef, useState } from "preact/hooks";
import { useTranslation } from "react-i18next";

export interface SectionNavItem {
    id: string;
    label: string;
}

export default function SectionNav({ items }: { items: SectionNavItem[] }) {
    const { t } = useTranslation();
    const [ activeId, setActiveId ] = useState<string>();
    const activeRef = useRef<HTMLAnchorElement>(null);

    useActiveSection(items, setActiveId);

    // Keep the active chip in view on the horizontally-scrollable mobile strip.
    useEffect(() => {
        activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    }, [ activeId ]);

    return (
        <nav className="section-nav" aria-label={t("section_nav.aria_label")}>
            <div className="content-wrapper">
                <ul>
                    {items.map((item) => {
                        const isActive = item.id === activeId;
                        return (
                            <li key={item.id}>
                                <a
                                    href={`#${item.id}`}
                                    className={isActive ? "active" : ""}
                                    aria-current={isActive ? "true" : undefined}
                                    ref={isActive ? activeRef : undefined}
                                >
                                    {item.label}
                                </a>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </nav>
    );
}

function useActiveSection(items: SectionNavItem[], setActiveId: (id: string) => void) {
    // Hold the latest items in a ref so the observer reads current values without
    // being torn down and rebuilt whenever the parent passes a fresh array literal.
    const itemsRef = useRef(items);
    itemsRef.current = items;
    const itemIds = items.map((item) => item.id).join(",");

    useEffect(() => {
        const sections = itemsRef.current
            .map((item) => document.getElementById(item.id))
            .filter((el): el is HTMLElement => el !== null);
        if (sections.length === 0) {
            return;
        }

        const visible = new Set<string>();
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        visible.add(entry.target.id);
                    } else {
                        visible.delete(entry.target.id);
                    }
                }
                // The topmost section that has crossed the trigger line wins.
                const current = itemsRef.current.find((item) => visible.has(item.id));
                if (current) {
                    setActiveId(current.id);
                }
            },
            // Trigger line sits just below the sticky header + nav; the bottom
            // margin keeps only the upper slice of the viewport "active".
            { rootMargin: "-160px 0px -65% 0px", threshold: 0 }
        );

        sections.forEach((section) => observer.observe(section));
        return () => observer.disconnect();
    }, [ itemIds, setActiveId ]);
}
