import "./LanguageSelector.css";

import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { useTranslation } from "react-i18next";

import { LocaleContext } from "..";
import chevronIcon from "../assets/boxicons/bx-chevron-down.svg?raw";
import globeIcon from "../assets/boxicons/bx-globe.svg?raw";
import { LOCALES, swapLocaleInUrl } from "../i18n";
import { Link } from "./Button.js";
import Icon from "./Icon.js";

interface LanguageSelectorProps {
    className?: string;
    /** Render the locales inline (no dropdown) — used inside the mobile menu. */
    inline?: boolean;
    onSelect?: () => void;
}

export default function LanguageSelector({ className, inline, onSelect }: LanguageSelectorProps) {
    const { t } = useTranslation();
    const { url } = useLocation();
    const currentLocale = useContext(LocaleContext);
    const [ open, setOpen ] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const current = LOCALES.find(l => l.id === currentLocale) ?? LOCALES.find(l => l.id === "en");

    useEffect(() => {
        if (inline) return;
        if (!open) return;

        function onPointerDown(e: PointerEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") setOpen(false);
        }

        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [ open, inline ]);

    if (inline) {
        return (
            <div className={`language-selector inline ${className ?? ""}`}>
                <span className="language-label">
                    <Icon svg={globeIcon} className="globe" />
                    {t("header.language")}
                </span>
                <ul className="language-menu">
                    {LOCALES.map(locale => (
                        <li key={locale.id}>
                            <Link
                                href={swapLocaleInUrl(url, locale.id)}
                                className={locale.id === currentLocale ? "active" : ""}
                                aria-current={locale.id === currentLocale ? "page" : undefined}
                                onClick={onSelect}
                            >
                                {locale.name}
                            </Link>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    return (
        <div className={`language-selector ${className ?? ""}`} ref={ref}>
            <button
                type="button"
                className="language-toggle"
                aria-haspopup="true"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
            >
                <Icon svg={globeIcon} className="globe" />
                <span className="current-language">{current?.name}</span>
                <Icon svg={chevronIcon} className="chevron" />
            </button>

            {open && (
                <ul className="language-menu">
                    {LOCALES.map(locale => (
                        <li key={locale.id}>
                            <Link
                                href={swapLocaleInUrl(url, locale.id)}
                                className={locale.id === currentLocale ? "active" : ""}
                                aria-current={locale.id === currentLocale ? "page" : undefined}
                                onClick={() => setOpen(false)}
                            >
                                {locale.name}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
