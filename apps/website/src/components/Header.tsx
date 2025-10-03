import "./Header.css";
import { Link } from "./Button.js";
import { SocialButtons, SocialButton } from "./Footer.js";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from 'preact-iso';
import DownloadButton from './DownloadButton.js';
import githubIcon from "../assets/boxicons/bx-github.svg?raw";
import Icon from "./Icon.js";
import logoPath from "../assets/icon-color.svg";
import menuIcon from "../assets/boxicons/bx-menu.svg?raw";

interface HeaderLink {
    url: string;
    text: string;
    external?: boolean;
}

const HEADER_LINKS: HeaderLink[] = [
    { url: "/get-started/", text: "Get started" },
    { url: "https://docs.triliumnotes.org/", text: "Documentation", external: true },
    { url: "/support-us/", text: "Support us" }
]

export function Header(props: {repoStargazersCount: number}) {
	const { url } = useLocation();
    const [ mobileMenuShown, setMobileMenuShown ] = useState(false);

	return (
		<header>
            <div class="content-wrapper">
                <div class="first-row">
                    <a class="banner" href="/">
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
                    {HEADER_LINKS.map(link => (
                        <Link
                            href={link.url}
                            className={url === link.url ? "active" : ""}
                            openExternally={link.external}
                            onClick={() => {
                                setMobileMenuShown(false);
                            }}
                        >{link.text}</Link>
                    ))}

                    <SocialButtons className="mobile-only" withText />
                </nav>

                <DownloadButton />
                
                <div class="desktop-only">
                    <SocialButton
                        name="GitHub"
                        iconSvg={githubIcon}
                        counter={(props.repoStargazersCount / 1000).toFixed(1) + "K+"}
                        url="https://github.com/TriliumNext/Trilium"
                    />
                </div>

            </div>
		</header>
	);
}