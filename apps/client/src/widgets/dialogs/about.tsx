import Modal from "../react/Modal.js";
import { t } from "../../services/i18n.js";
import { formatDateTime } from "../../utils/formatters.js";
import server from "../../services/server.js";
import utils from "../../services/utils.js";
import openService from "../../services/open.js";
import { useState, useCallback, useRef } from "preact/hooks";
import type { AppInfo, Contributor, ContributorList } from "@triliumnext/commons";
import { useTooltip, useTriliumEvent } from "../react/hooks.jsx";
import { PropertySheet, PropertySheetItem } from "../react/PropertySheet.js";
import "./about.css";
import { Trans } from "react-i18next";
import type React from "react";
import contributors from "../../../../../contributors.json"; 
import { Fragment } from "preact/jsx-runtime";
import type { ComponentChildren } from "preact";
import { useMemo, memo } from "preact/compat";
import clsx from "clsx";

export default function AboutDialog() {
    const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
    const [isShown, setIsShown] = useState(false);
    const [isNightly, setNightly] = useState(false);
    const [icon, setIcon] = useState("default");
    const [altIcon, setAltIcon] = useState<string | null>(null);

    const hasLoaded = useRef(false);

    const onLoad = useCallback(async () => {
        if (!hasLoaded.current) {
            const info = await server.get<AppInfo>("app-info");
            if (info.appVersion.includes("test")) {
                setNightly(true);
                setIcon("nightly");
            }
            setAppInfo(info);
            hasLoaded.current = true;

        }
        setIsShown(true);
    }, []);

    useTriliumEvent("openAboutDialog", onLoad);

    const createContributorHoverHandler = () => {
        let timeoutID: ReturnType<typeof setTimeout>;
        return (contributor: Contributor, isHovering: boolean, part: "name" | "role") => {
            if (part === "role" && contributor.role === "original-dev") {
                if (isHovering) {
                    timeoutID = setTimeout(() => {
                        setAltIcon("classic");
                    }, 500);
                } else {
                    clearTimeout(timeoutID);
                    setAltIcon(null);
                }
            }
        }
    };

    /* Cache the contributor list to prevent its rerendering.
     * When the icon changes, it triggers a rerender of the dialog. If this happens while an
     * element with a tooltip is hovered, its tooltip will break. */
    const CachedContributors = useMemo(() => memo(function CachedContributors() {
        return <Contributors 
            data={contributors as ContributorList}
            onHover={createContributorHoverHandler()}
            />
    }), []);

    return (
        <Modal
            className={clsx(["about-dialog", {"nightly": isNightly}])}
            size="md"
            isFullPageOnMobile
            show={isShown}
            onHidden={() => setIsShown(false)}
        >
           <div className="about-dialog-content">
               
                <div className={"icon"} data-icon={altIcon ?? icon} />
                <h2>Trilium Notes {isNightly && <span className="channel-name">Nightly</span>}</h2>
                <a className="tn-link" href="https://triliumnotes.org/" target="_blank" rel="noopener noreferrer">
                    triliumnotes.org
                </a>

                <PropertySheet className="about-dialog-property-sheet">
                    <PropertySheetItem label={t("about.version_label")}>
                        {t("about.version", {
                            appVersion: appInfo?.appVersion,
                            dbVersion: appInfo?.dbVersion,
                            syncVersion: appInfo?.syncVersion
                        })}
                        <div className="build-info">
                            <Trans
                                i18nKey="about.build_info"
                                values={{
                                    buildDate: appInfo?.buildDate ? formatDateTime(appInfo.buildDate) : ""
                                }}
                                components={{
                                    buildRevision: <RevisionLink appInfo={appInfo} /> as React.ReactElement
                                }}
                            />
                        </div>
                    </PropertySheetItem>

                    <PropertySheetItem className="contributor-list use-tn-links" label={t("about.contributors_label")}>
                        <CachedContributors />

                        <a href="https://github.com/TriliumNext/Trilium/graphs/contributors" target="_blank" rel="noopener noreferrer">
                            {t("about.contributor_full_list")}
                        </a>
                    </PropertySheetItem>

                    <PropertySheetItem label={t("about.data_directory")}>
                        <div style={{wordBreak: "break-all"}}>
                            {appInfo?.dataDirectory && (<DirectoryLink directory={appInfo.dataDirectory} />)}
                        </div>
                    </PropertySheetItem>
                </PropertySheet>
           </div>

           <footer>
                <FooterLink 
                    text="GitHub"
                    url="https://github.com/TriliumNext/Trilium"
                    tooltip={t("about.github_tooltip")}>

                    <i className='bx bxl-github'></i>
                </FooterLink>
                
                <FooterLink
                    text="AGPL 3.0"
                    url="https://docs.triliumnotes.org/user-guide/misc/license"
                    tooltip={t("about.license_tooltip")}>

                    {/* https://pictogrammers.com/library/mdi/icon/scale-balance/ */}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12,3C10.73,3 9.6,3.8 9.18,5H3V7H4.95L2,14C1.53,16 3,17 5.5,17C8,17 9.56,16 9,14L6.05,7H9.17C9.5,7.85 10.15,8.5 11,8.83V20H2V22H22V20H13V8.82C13.85,8.5 14.5,7.85 14.82,7H17.95L15,14C14.53,16 16,17 18.5,17C21,17 22.56,16 22,14L19.05,7H21V5H14.83C14.4,3.8 13.27,3 12,3M12,5A1,1 0 0,1 13,6A1,1 0 0,1 12,7A1,1 0 0,1 11,6A1,1 0 0,1 12,5M5.5,10.25L7,14H4L5.5,10.25M18.5,10.25L20,14H17L18.5,10.25Z" /></svg>
                </FooterLink>

                <FooterLink
                    text={t("about.donate")}
                    url="https://triliumnotes.org/en/support-us"
                    tooltip={t("about.donate_tooltip")}
                    className="donate-link">

                    <i className='bx bx-heart' ></i>
                </FooterLink>
           </footer>
        </Modal>
    );
}

function RevisionLink({appInfo}: {appInfo: AppInfo | null}) {
    return <>
        {appInfo?.buildRevision && <a href={`https://github.com/TriliumNext/Trilium/commit/${appInfo.buildRevision}`} target="_blank" rel="noopener noreferrer" className="tn-link">
            {appInfo.buildRevision.substring(0, 7)}
        </a>}
    </>;
}

function FooterLink(props: {children: ComponentChildren, text: string, url: string, tooltip: string, className?: string}) {
    
    const linkRef = useRef<HTMLAnchorElement>(null);

    useTooltip(linkRef, {
        title: props.tooltip,
        delay: 250,
        placement: "bottom"
    })
    
    return <a ref={linkRef} href={props.url} className={props.className} target="_blank" rel="noopener noreferrer" draggable={false}>
        {props.children}
        {props.text}
    </a>
}

type HoverCallback = (contributor: Contributor, isHovering: boolean, part: "name" | "role") => void;

function Contributors({data, onHover}: {data: ContributorList, onHover?: HoverCallback}) {
    return data.contributors.map((c, index, array) => {
        return <Fragment key={c.name}>
            <ContributorListItem data={c} onHover={onHover} />
            
            {/* Add a comma between items */}
            {(index < array.length - 1) ? ", " : ". "}
        </Fragment>
    });
}


function ContributorListItem({data, onHover}: {data: Contributor, onHover?: HoverCallback}) {
    const roleRef = useRef<HTMLSpanElement>(null);
    const roleString = (data.role) ? t(`about.contributor_roles.${data.role}`) : "";

    useTooltip(roleRef, (data.role) ? {
        title: t(`about.role_brief_history.${data.role}`),
        customClass: "about-dialog-brief-history-tooltip",
        placement: "bottom",
        offset: [0, 10],
        delay: 500
    }: {});

    return <>
        <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            onMouseEnter={() => onHover?.(data, true, "name")}
            onMouseLeave={() => onHover?.(data, false, "name")}>
    
            {data.fullName ?? data.name}
        </a>

        {roleString && <span
            ref={roleRef}
            onMouseEnter={() => onHover?.(data, true, "role")}
            onMouseLeave={() => onHover?.(data, false, "role")}>
            
            (<span className="contributor-role">{roleString}</span>)
        </span>} 
    </>
}

function DirectoryLink({ directory }: { directory: string}) {
    if (utils.isElectron()) {
        const onClick = (e: MouseEvent) => {
            e.preventDefault();
            openService.openDirectory(directory);
        };

        return <a className="tn-link selectable-text" href="#" onClick={onClick}>{directory}</a>
    } else {
        return <span className="selectable-text">{directory}</span>;
    }
}