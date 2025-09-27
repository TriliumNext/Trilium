import "./Header.css";
import { useLocation } from 'preact-iso';
import DownloadButton from './DownloadButton';
import { Link } from "./Button";
import Icon from "./Icon";
import logoPath from "../assets/icon-color.svg";
import menuIcon from "../assets/boxicons/bx-menu.svg?raw";
import { useState } from "preact/hooks";
import { SocialButtons } from "./Footer";

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

export function Header() {
	const { url } = useLocation();
    const [ mobileMenuShown, setMobileMenuShown ] = useState(false);

	return (
		<header>
            <div class="content-wrapper">
                <div class="first-row">
                    <a class="banner" href="/">
                        <img src={logoPath} width="300" height="300" />&nbsp;<span>Trilium Notes</span>
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
            </div>
		</header>
	);
}
