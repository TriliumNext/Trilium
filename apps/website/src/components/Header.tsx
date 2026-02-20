import "./Header.css";

import { useContext, useEffect, useState } from "preact/hooks";
import { useLocation } from 'preact-iso';
import { useTranslation } from "react-i18next";

import { LocaleContext } from "..";
import githubIcon from "../assets/boxicons/bx-github.svg?raw";
import menuIcon from "../assets/boxicons/bx-menu.svg?raw";
import logoPath from "../assets/icon-color.svg";
import { swapLocaleInUrl } from "../i18n";
import { Link } from "./Button.js";
import DownloadButton from './DownloadButton.js';
import { SocialButton,SocialButtons } from "./Footer.js";
import Icon from "./Icon.js";

interface HeaderLink {
    url: string;
    text: string;
    external?: boolean;
}

export function Header(props: {repoStargazersCount: number}) {
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
                        <img src={logoPath} width="300" height="300" alt="Trilium Notes logo" />&nbsp;<span>Trilium Notes</span>
                    </a>

                    <RepositoryButton repoStargazersCount={props.repoStargazersCount} className="mobile-only" />

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

                    <SocialButtons className="mobile-only" withText />
                </nav>

                <RepositoryButton repoStargazersCount={props.repoStargazersCount} className="desktop-only" />
                <DownloadButton />
            </div>
        </header>
    );
}

function RepositoryButton({ repoStargazersCount, className }: {
    repoStargazersCount: number;
    className: string
}){
    return (
        <div class={`repository-button ${className}`}>
            <SocialButton
                name="GitHub"
                iconSvg={githubIcon}
                counter={`${(repoStargazersCount / 1000).toFixed(1)}K+`}
                url="https://github.com/TriliumNext/Trilium"
            />
        </div>
    );
}
