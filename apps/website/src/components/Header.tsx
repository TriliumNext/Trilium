import "./Header.css";
import { Link } from "./Button.js";
import { SocialButtons, SocialButton } from "./Footer.js";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from 'preact-iso';
import DownloadButton from './DownloadButton.js';
import githubIcon from "../assets/boxicons/bx-github.svg?raw";
import Icon from "./Icon.js";
import logoPath from "../assets/icon-color.svg";
import menuIcon from "../assets/boxicons/bx-menu.svg?raw";
import { LocaleContext } from "..";
import { useTranslation } from "react-i18next";
import { swapLocaleInUrl } from "../i18n";

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

    const [ headerLinks, setHeaderLinks ] = useState<HeaderLink[]>([]);
    useEffect(() => {
        setHeaderLinks([
            { url: "/get-started", text: t("header.get-started") },
            { url: "https://docs.triliumnotes.org/", text: t("header.documentation"), external: true },
            { url: "/support-us", text: t("header.support-us") }
        ]);
    }, [ locale, t ]);

	return (
		<header>
            <div class="content-wrapper">
                <div class="first-row">
                    <a class="banner" href={`/${locale}/`}>
                        <img src={logoPath} width="300" height="300" alt="Trilium Notes logo" />&nbsp;<span>Trilium Notes</span>
                    </a>

                    <Link
                        href="#"
                        className="mobile-only menu-toggle"
                        onClick={(e) => {
                            e.preventDefault();
                            setMobileMenuShown(!mobileMenuShown)
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
                        >{link.text}</Link>)
                    })}

                    <SocialButtons className="mobile-only" withText />
                </nav>

                <div class="desktop-only repository-button">
                    <SocialButton
                        name="GitHub"
                        iconSvg={githubIcon}
                        counter={(props.repoStargazersCount / 1000).toFixed(1) + "K+"}
                        url="https://github.com/TriliumNext/Trilium"
                    />
                </div>

                <DownloadButton />

            </div>
		</header>
	);
}
