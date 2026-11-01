import "./Header.css";

import { useContext, useState } from "preact/hooks";
import { useLocation } from 'preact-iso';
import { useTranslation } from "react-i18next";

import { LocaleContext } from "..";
import menuIcon from "../assets/boxicons/bx-menu.svg?raw";
import logoPath from "../assets/icon-color.svg";
import { swapLocaleInUrl } from "../i18n";
import { Link } from "./Button.js";
import DownloadButton from './DownloadButton.js';
import { SocialButtons } from "./Footer.js";
import Icon from "./Icon.js";
import LanguageSelector from "./LanguageSelector.js";

export function Header() {
    const { url } = useLocation();
    const { t } = useTranslation();
    const locale = useContext(LocaleContext);
    const [ mobileMenuShown, setMobileMenuShown ] = useState(false);

    const headerLinks = [
        { url: "/get-started", text: t("header.get-started") },
        { url: "/resources", text: t("header.resources") },
        { url: "https://docs.triliumnotes.org/", text: t("header.documentation"), external: true },
        { url: "/support-us", text: t("header.support-us") }
    ];

    return (
        <header>
            <div class="content-wrapper">
                <div class="first-row">
                    <a class="banner" href={`/${locale}/`}>
                        <img src={logoPath} width="300" height="300" alt="Trilium Notes logo" />
                    </a>

                    <Link
                        href="#"
                        className="mobile-only menu-toggle"
                        onClick={(e) => {
                            e.preventDefault();
                            setMobileMenuShown(!mobileMenuShown);
                        }}
                    >
                        <Icon svg={menuIcon} />
                    </Link>
                </div>

                <nav className={`${mobileMenuShown ? "mobile-shown" : ""}`}>
                    <div className="nav-links">
                        {headerLinks.map(link => {
                            const linkHref = link.external ? link.url : swapLocaleInUrl(link.url, locale);
                            return (<Link
                                href={linkHref}
                                className={url === linkHref ? "active" : ""}
                                openExternally={link.external}
                                onClick={() => {
                                    setMobileMenuShown(false);
                                }}
                            >{link.text}</Link>);
                        })}
                    </div>

                    <div className="nav-bottom mobile-only">
                        <LanguageSelector inline onSelect={() => setMobileMenuShown(false)} />
                        <SocialButtons withText />
                    </div>
                </nav>

                <LanguageSelector className="desktop-only" />
                <DownloadButton />
            </div>
        </header>
    );
}
