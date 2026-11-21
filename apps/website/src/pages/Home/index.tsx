import "./index.css";

import { ComponentChildren } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { Trans, useTranslation } from 'react-i18next';

import importIcon from "../../assets/boxicons/bx-archive-arrow-down.svg?raw";
import exportIcon from "../../assets/boxicons/bx-archive-arrow-up.svg?raw";
import calendarIcon from "../../assets/boxicons/bx-calendar.svg?raw";
import arrowIcon from "../../assets/boxicons/bx-chevron-right.svg?raw";
import hoistingIcon from "../../assets/boxicons/bx-chevrons-up.svg?raw";
import codeIcon from "../../assets/boxicons/bx-code.svg?raw";
import scriptApiIcon from "../../assets/boxicons/bx-code-alt.svg?raw";
import aiToolsIcon from "../../assets/boxicons/bx-cog.svg?raw";
import boardIcon from "../../assets/boxicons/bx-columns-3.svg?raw";
import templatesIcon from "../../assets/boxicons/bx-copy.svg?raw";
import dashboardIcon from "../../assets/boxicons/bx-dashboard.svg?raw";
import dockerIcon from "../../assets/boxicons/bx-docker.svg?raw";
import restApiIcon from "../../assets/boxicons/bx-extension.svg?raw";
import fileIcon from "../../assets/boxicons/bx-file.svg?raw";
import savedSearchIcon from "../../assets/boxicons/bx-file-search.svg?raw";
import authIcon from "../../assets/boxicons/bx-fingerprint.svg?raw";
import noteStructureIcon from "../../assets/boxicons/bx-folder.svg?raw";
import gitHubIcon from "../../assets/boxicons/bx-github.svg?raw";
import shareIcon from "../../assets/boxicons/bx-globe.svg?raw";
import webViewIcon from "../../assets/boxicons/bx-globe-alt.svg?raw";
import revisionsIcon from "../../assets/boxicons/bx-history.svg?raw";
import apiKeyIcon from "../../assets/boxicons/bx-key.svg?raw";
import widgetsIcon from "../../assets/boxicons/bx-layout.svg?raw";
import geomapIcon from "../../assets/boxicons/bx-map.svg?raw";
import mindmapIcon from "../../assets/boxicons/bx-network-chart.svg?raw";
import textNoteIcon from "../../assets/boxicons/bx-note.svg?raw";
import webClipperIcon from "../../assets/boxicons/bx-paperclip.svg?raw";
import canvasIcon from "../../assets/boxicons/bx-pen.svg?raw";
import printerIcon from "../../assets/boxicons/bx-printer.svg?raw";
import syncIcon from "../../assets/boxicons/bx-refresh-cw.svg?raw";
import botIcon from "../../assets/boxicons/bx-robot.svg?raw";
import searchIcon from "../../assets/boxicons/bx-search.svg?raw";
import backendIcon from "../../assets/boxicons/bx-server.svg?raw";
import protectedNotesIcon from "../../assets/boxicons/bx-shield.svg?raw";
import presentationIcon from "../../assets/boxicons/bx-slideshow.svg?raw";
import tableIcon from "../../assets/boxicons/bx-table.svg?raw";
import attributesIcon from "../../assets/boxicons/bx-tag.svg?raw";
import mermaidIcon from "../../assets/boxicons/bx-vector-square.svg?raw";
import renderIcon from "../../assets/boxicons/bx-window.svg?raw";
import markdownIcon from "../../assets/boxicons/bxs-markdown.svg?raw";
import noteMapIcon from "../../assets/boxicons/bxs-network-chart.svg?raw";
import starIcon from "../../assets/boxicons/bxs-star.svg?raw";
import anytypeIcon from "../../assets/import/anytype.svg?raw";
import evernoteIcon from "../../assets/import/evernote.svg?raw";
import keepIcon from "../../assets/import/keep.svg?raw";
import notionIcon from "../../assets/import/notion.svg?raw";
import obsidianIcon from "../../assets/import/obsidian.svg?raw";
import oneNoteIcon from "../../assets/import/onenote.svg?raw";
import Button, { Link } from '../../components/Button.js';
import Card from '../../components/Card.js';
import DownloadButton from '../../components/DownloadButton.js';
import Icon from '../../components/Icon.js';
import Section from '../../components/Section.js';
import SectionNav, { SectionNavItem } from '../../components/SectionNav.js';
import { usePageTitle } from '../../hooks.js';
import { StargazersContext } from '../../index.js';

export function Home() {
    const { t } = useTranslation();
    usePageTitle("");

    const navItems: SectionNavItem[] = [
        { id: "organization", label: t("section_nav.organization") },
        { id: "productivity", label: t("section_nav.productivity") },
        { id: "note-types", label: t("section_nav.note_types") },
        { id: "import-export", label: t("section_nav.import") },
        { id: "collections", label: t("section_nav.collections") },
        { id: "scripting", label: t("section_nav.scripting") },
        { id: "ai-integration", label: t("section_nav.ai_integration") },
        { id: "faq", label: t("section_nav.faq") }
    ];

    return (
        <>
            <SectionNav items={navItems} />
            <HeroSection />
            <OrganizationBenefitsSection />
            <ProductivityBenefitsSection />
            <NoteTypesSection />
            <ImportSection />
            <CollectionsSection />
            <ScriptingSection />
            <AiIntegrationSection />
            <FaqSection />
            <FinalCta />
        </>
    );
}

function HeroSection() {
    const { t } = useTranslation();
    const stargazersCount = useContext(StargazersContext);

    return (
        <Section className="hero-section">
            <div class="title-section">
                <h1>{t("hero_section.title")}</h1>
                <p>{t("hero_section.subtitle")}</p>

                <div className="download-wrapper">
                    <DownloadButton big />
                    <Button href="./get-started/" className="mobile-only" text={t("hero_section.get_started")} />
                    <div className="additional-options">
                        <Button iconSvg={gitHubIcon} outline text={<>{t("hero_section.github")}<span className="github-stars"><Icon svg={starIcon} />{`${(stargazersCount / 1000).toFixed(1)}K+`}</span></>} href="https://github.com/TriliumNext/Trilium/" openExternally />
                        <Button iconSvg={dockerIcon} outline text={t("hero_section.dockerhub")} href="https://hub.docker.com/r/triliumnext/trilium" openExternally />
                    </div>
                </div>

            </div>

            <div className="screenshot-container">
                <HeroSnapshot title={t("hero_section.screenshot_alt")} />
            </div>

            <p className="hero-tagline">
                <Link href="https://docs.triliumnotes.org/user-guide/misc/license" openExternally>{t("hero_section.tagline_license")}</Link>
                <span className="dot" aria-hidden="true" />
                <span>{t("hero_section.tagline_no_account")}</span>
                <span className="dot" aria-hidden="true" />
                <span>{t("hero_section.tagline_cross_platform")}</span>
            </p>
        </Section>
    );
}

/**
 * The snapshots of the app and the viewports they were captured at: `HERO.variants` in
 * apps/showcase/src/shared/scenes.ts.
 */
const HERO_SNAPSHOTS = {
    desktop: { src: "/hero.html", width: 1360, height: 920 },
    mobile: { src: "/hero-mobile.html", width: 360, height: 760 }
};

/** Matches the breakpoint from which `index.css` shows the desktop snapshot. */
const HERO_WIDE_QUERY = "(min-width: 720px)";

/**
 * Shows the mobile snapshot in a phone, in front of the desktop snapshot on wide screens and
 * alone otherwise. The desktop snapshot mounts only on a wide screen, so a phone never downloads
 * it.
 */
function HeroSnapshot({ title }: { title: string }) {
    const [ wide, setWide ] = useState(false);

    useEffect(() => {
        const query = window.matchMedia(HERO_WIDE_QUERY);
        const update = () => setWide(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);

    return (
        <>
            <SnapshotFrame
                snapshot={HERO_SNAPSHOTS.desktop} title={title} className="desktop" load={wide}
            />
            <div className="hero-phone">
                <SnapshotFrame snapshot={HERO_SNAPSHOTS.mobile} title={title}>
                    <PhoneChrome />
                </SnapshotFrame>
            </div>
        </>
    );
}

/**
 * Shows a snapshot at the viewport it was captured at and scales it, with `children`, to the
 * width of its frame, since the app lays out against the viewport and cannot reflow.
 */
function SnapshotFrame({ snapshot, title, className, load = true, children }: {
    snapshot: typeof HERO_SNAPSHOTS.desktop;
    title: string;
    className?: string;
    load?: boolean;
    children?: ComponentChildren;
}) {
    const frameRef = useRef<HTMLDivElement>(null);
    const [ scale, setScale ] = useState<number>();

    useEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        const observer = new ResizeObserver(() => {
            setScale(frame.clientWidth / snapshot.width);
        });
        observer.observe(frame);
        return () => observer.disconnect();
    }, [ snapshot ]);

    return (
        <div
            ref={frameRef}
            className={[ "screenshot", className, scale && "scaled" ].filter(Boolean).join(" ")}
            style={scale ? { "--hero-scale": scale } : undefined}
        >
            {load && (
                <iframe
                    src={snapshot.src} title={title} tabIndex={-1}
                    width={snapshot.width} height={snapshot.height}
                />
            )}
            {children}
        </div>
    );
}

/** The status bar and home indicator a phone draws over the safe area of the mobile snapshot. */
function PhoneChrome() {
    return (
        <div className="phone-chrome" aria-hidden="true">
            <div className="status-bar">
                <span>9:41</span>
                <span className="status-icons">
                    <svg viewBox="0 0 18 12">
                        <rect x="0" y="8" width="3" height="4" rx="1" />
                        <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
                        <rect x="10" y="3" width="3" height="9" rx="1" />
                        <rect x="15" y="0" width="3" height="12" rx="1" />
                    </svg>
                    <svg viewBox="0 0 16 12">
                        <path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.3-1.4A11 11 0 0 0 8 .3 11 11 0 0 0 .4 3.3l1.3 1.4A9 9 0 0 1 8 2.2Zm0 3.8c1.4 0 2.7.5 3.7 1.4L13 6a7.3 7.3 0 0 0-10 0l1.3 1.4C5.3 6.5 6.6 6 8 6Zm0 3.7c-.6 0-1.1.2-1.5.6L8 12l1.5-1.7c-.4-.4-.9-.6-1.5-.6Z" />
                    </svg>
                    <svg viewBox="0 0 26 12">
                        <rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity="0.4" />
                        <rect x="2.5" y="2.5" width="15" height="7" rx="1.5" />
                        <rect x="24" y="4" width="1.5" height="4" rx="0.75" opacity="0.4" />
                    </svg>
                </span>
            </div>
            <div className="home-indicator" />
        </div>
    );
}

function OrganizationBenefitsSection() {
    const { t } = useTranslation();
    return (
        <>
            <Section id="organization" className="benefits organization" title={t("organization_benefits.title")}>
                <div className="organization-split">
                    <div className="organization-screenshot">
                        <Screenshot src="/feature_tree.webp" darkSrc="/feature_tree-dark.webp" alt={t("organization_benefits.screenshot_alt")} />
                    </div>
                    <div className="benefits-container organization-cards">
                        <Card iconSvg={noteStructureIcon} title={t("organization_benefits.note_structure_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/notes">{t("organization_benefits.note_structure_description")}</Card>
                        <Card iconSvg={attributesIcon} title={t("organization_benefits.attributes_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/advanced-usage/attributes">{t("organization_benefits.attributes_description")}</Card>
                        <Card iconSvg={hoistingIcon} title={t("organization_benefits.hoisting_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting">{t("organization_benefits.hoisting_description")}</Card>
                    </div>
                </div>
            </Section>
        </>
    );
}

function ProductivityBenefitsSection() {
    const { t } = useTranslation();
    return (
        <>
            <Section id="productivity" className="benefits accented" title={t("productivity_benefits.title")}>
                <div className="benefits-container grid-3-cols">
                    <Card iconSvg={syncIcon} title={t("productivity_benefits.sync_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/setup/synchronization">{t("productivity_benefits.sync_content")}</Card>
                    <Card iconSvg={searchIcon} title={t("productivity_benefits.search_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/navigation/search">{t("productivity_benefits.search_content")}</Card>
                    <Card iconSvg={revisionsIcon} title={t("productivity_benefits.revisions_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions">{t("productivity_benefits.revisions_content")}</Card>
                    <Card iconSvg={protectedNotesIcon} title={t("productivity_benefits.protected_notes_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes">{t("productivity_benefits.protected_notes_content")}</Card>
                    <Card iconSvg={templatesIcon} title={t("productivity_benefits.templates_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/advanced-usage/template">{t("productivity_benefits.templates_content")}</Card>
                    <Card iconSvg={webClipperIcon} title={t("productivity_benefits.web_clipper_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/setup/web-clipper">{t("productivity_benefits.web_clipper_content")}</Card>
                    <Card iconSvg={shareIcon} title={t("productivity_benefits.share_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/advanced-usage/sharing">{t("productivity_benefits.share_content")}</Card>
                    <Card iconSvg={authIcon} title={t("productivity_benefits.auth_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/setup/server/auth">{t("productivity_benefits.auth_content")}</Card>
                    <Card iconSvg={restApiIcon} title={t("productivity_benefits.api_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/advanced-usage/etapi">{t("productivity_benefits.api_content")}</Card>
                </div>
            </Section>
        </>
    );
}

function NoteTypesSection() {
    const { t } = useTranslation();
    return (
        <Section id="note-types" className="note-types" title={t("note_types.title")} subtitle={t("note_types.subtitle")}>
            <TabbedShowcase items={[
                {
                    title: t("note_types.text_title"),
                    imageUrl: "/type_text.webp",
                    darkImageUrl: "/type_text-dark.webp",
                    iconSvg: textNoteIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/text",
                    description: t("note_types.text_description")
                },
                {
                    title: t("note_types.markdown_title"),
                    imageUrl: "/type_markdown.webp",
                    darkImageUrl: "/type_markdown-dark.webp",
                    iconSvg: markdownIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/markdown",
                    description: t("note_types.markdown_description")
                },
                {
                    title: t("note_types.code_title"),
                    imageUrl: "/type_code.webp",
                    darkImageUrl: "/type_code-dark.webp",
                    iconSvg: codeIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/code",
                    description: t("note_types.code_description")
                },
                {
                    title: t("note_types.spreadsheet_title"),
                    imageUrl: "/type_spreadsheet.webp",
                    darkImageUrl: "/type_spreadsheet-dark.webp",
                    iconSvg: tableIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/spreadsheets",
                    description: t("note_types.spreadsheet_description")
                },
                {
                    title: t("note_types.canvas_title"),
                    imageUrl: "/type_canvas.webp",
                    darkImageUrl: "/type_canvas-dark.webp",
                    iconSvg: canvasIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/canvas",
                    description: t("note_types.canvas_description")
                },
                {
                    title: t("note_types.mermaid_title"),
                    imageUrl: "/type_mermaid.webp",
                    darkImageUrl: "/type_mermaid-dark.webp",
                    iconSvg: mermaidIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/mermaid-diagrams",
                    description: t("note_types.mermaid_description")
                },
                {
                    title: t("note_types.mindmap_title"),
                    imageUrl: "/type_mindmap.webp",
                    darkImageUrl: "/type_mindmap-dark.webp",
                    iconSvg: mindmapIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/mindmap",
                    description: t("note_types.mindmap_description")
                },
                {
                    title: t("note_types.file_title"),
                    imageUrl: "/type_file.webp",
                    darkImageUrl: "/type_file-dark.webp",
                    iconSvg: fileIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/file",
                    description: t("note_types.file_description")
                }
            ]} />
            <div className="more-note-types">
                <span className="more-note-types-label">{t("note_types.others_label")}</span>
                <Button iconSvg={noteMapIcon} outline text={t("note_types.notemap_title")} href="https://docs.triliumnotes.org/user-guide/note-types/note-map" openExternally />
                <Button iconSvg={noteMapIcon} outline text={t("note_types.relationmap_title")} href="https://docs.triliumnotes.org/user-guide/note-types/relation-map" openExternally />
                <Button iconSvg={savedSearchIcon} outline text={t("note_types.savedsearch_title")} href="https://docs.triliumnotes.org/user-guide/note-types/saved-search" openExternally />
                <Button iconSvg={restApiIcon} outline text={t("note_types.rendernote_title")} href="https://docs.triliumnotes.org/user-guide/note-types/render-note" openExternally />
                <Button iconSvg={webViewIcon} outline text={t("note_types.webview_title")} href="https://docs.triliumnotes.org/user-guide/note-types/webview" openExternally />
            </div>
        </Section>
    );
}

function CollectionsSection() {
    const { t } = useTranslation();
    return (
        <Section id="collections" className="collections" title={t("collections.title")} subtitle={t("collections.subtitle")}>
            <TabbedShowcase items={[
                {
                    title: t("collections.calendar_title"),
                    imageUrl: "/collection_calendar.webp",
                    darkImageUrl: "/collection_calendar-dark.webp",
                    iconSvg: calendarIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/calendar",
                    description: t("collections.calendar_description")
                },
                {
                    title: t("collections.table_title"),
                    iconSvg: tableIcon,
                    imageUrl: "/collection_table.webp",
                    darkImageUrl: "/collection_table-dark.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/table",
                    description: t("collections.table_description")
                },
                {
                    title: t("collections.board_title"),
                    iconSvg: boardIcon,
                    imageUrl: "/collection_board.webp",
                    darkImageUrl: "/collection_board-dark.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/kanban-board",
                    description: t("collections.board_description")
                },
                {
                    title: t("collections.geomap_title"),
                    iconSvg: geomapIcon,
                    imageUrl: "/collection_geomap.webp",
                    darkImageUrl: "/collection_geomap-dark.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/geomap",
                    description: t("collections.geomap_description")
                },
                {
                    title: t("collections.presentation_title"),
                    iconSvg: presentationIcon,
                    imageUrl: "/collection_presentation.webp",
                    darkImageUrl: "/collection_presentation-dark.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/presentation",
                    description: t("collections.presentation_description")
                },
                {
                    title: t("collections.dashboard_title"),
                    iconSvg: dashboardIcon,
                    imageUrl: "/collection_dashboard.webp",
                    darkImageUrl: "/collection_dashboard-dark.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/dashboard",
                    description: t("collections.dashboard_description")
                }
            ]} />
        </Section>
    );
}

function AiIntegrationSection() {
    const { t } = useTranslation();
    return (
        <Section id="ai-integration" className="benefits ai-integration" title={t("ai_integration.title")} subtitle={t("ai_integration.subtitle")} cta={{ text: t("ai_integration.learn_more"), href: "https://docs.triliumnotes.org/user-guide/llm" }}>
            <div className="feature-split">
                <div className="feature-screenshot">
                    <Screenshot src="/feature_llm.webp" darkSrc="/feature_llm-dark.webp" alt={t("ai_integration.screenshot_alt")} />
                </div>
                <div className="benefits-container feature-cards">
                    <Card iconSvg={botIcon} title={t("ai_integration.chat_title")}>{t("ai_integration.chat_description")}</Card>
                    <Card iconSvg={aiToolsIcon} title={t("ai_integration.tools_title")}>{t("ai_integration.tools_description")}</Card>
                    <Card iconSvg={apiKeyIcon} title={t("ai_integration.providers_title")}>{t("ai_integration.providers_description")}</Card>
                </div>
            </div>
        </Section>
    );
}

function ScriptingSection() {
    const { t } = useTranslation();
    return (
        <Section id="scripting" className="benefits scripting accented" title={t("scripting.title")} subtitle={t("scripting.subtitle")}>
            <div className="feature-split">
                <div className="feature-screenshot">
                    <img src="/feature_scripting.webp" alt={t("scripting.screenshot_alt")} loading="lazy" />
                </div>
                <div className="benefits-container feature-cards">
                    <Card iconSvg={widgetsIcon} title={t("scripting.widgets_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/scripts/frontend-basics/custom-widget">{t("scripting.widgets_description")}</Card>
                    <Card iconSvg={backendIcon} title={t("scripting.backend_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/scripts/backend-basics">{t("scripting.backend_description")}</Card>
                    <Card iconSvg={renderIcon} title={t("scripting.render_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/note-types/render-note">{t("scripting.render_description")}</Card>
                    <Card iconSvg={scriptApiIcon} title={t("scripting.api_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/scripts/script-api">{t("scripting.api_description")}</Card>
                </div>
            </div>
        </Section>
    );
}

function ImportSection() {
    const { t } = useTranslation();
    return (
        <Section id="import-export" className="benefits import accented" title={t("import.title")} subtitle={t("import.subtitle")}>
            <div className="benefits-container grid-3-cols">
                <Card iconSvg={importIcon} title={t("import.pillar_import_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/import-export">
                    {t("import.pillar_import_description")}
                    <div className="import-logos">
                        <span className="import-logos-label">{t("import.sources_label")}</span>
                        <div className="import-logos-row">
                            <span className="import-logo" role="img" aria-label={t("import.onenote_title")} title={t("import.onenote_title")}><Icon svg={oneNoteIcon} /></span>
                            <span className="import-logo" role="img" aria-label={t("import.notion_title")} title={t("import.notion_title")}><Icon svg={notionIcon} /></span>
                            <span className="import-logo" role="img" aria-label={t("import.keep_title")} title={t("import.keep_title")}><Icon svg={keepIcon} /></span>
                            <span className="import-logo" role="img" aria-label={t("import.evernote_title")} title={t("import.evernote_title")}><Icon svg={evernoteIcon} /></span>
                            <span className="import-logo" role="img" aria-label={t("import.anytype_title")} title={t("import.anytype_title")}><Icon svg={anytypeIcon} /></span>
                            <span className="import-logo" role="img" aria-label={t("import.obsidian_title")} title={t("import.obsidian_title")}><Icon svg={obsidianIcon} /></span>
                        </div>
                    </div>
                </Card>
                <Card iconSvg={exportIcon} title={t("import.pillar_export_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/concepts/import-export">
                    {t("import.pillar_export_description")}
                    <ul className="format-list">
                        <li>{t("import.pillar_export_markdown")}</li>
                        <li>{t("import.pillar_export_html")}</li>
                        <li>{t("import.pillar_export_opml")}</li>
                    </ul>
                </Card>
                <Card iconSvg={printerIcon} title={t("import.pillar_pdf_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/note-types/file/pdf">
                    {t("import.pillar_pdf_description")}
                    <ul className="format-list">
                        <li>{t("import.pillar_pdf_single")}</li>
                        <li>{t("import.pillar_pdf_subtree")}</li>
                        <li>{t("import.pillar_pdf_ready")}</li>
                    </ul>
                </Card>
            </div>
        </Section>
    );
}

interface ShowcaseItem {
    title: string;
    imageUrl: string;
    /** The screenshot in the dark theme, shown when the visitor's system is dark. */
    darkImageUrl?: string;
    description: string;
    moreInfo: string;
    iconSvg?: string;
}

function TabbedShowcase({ items }: { items: ShowcaseItem[] }) {
    const [ activeIndex, setActiveIndex ] = useState(0);
    const active = items[activeIndex];

    return (
        <div className="tabbed-showcase">
            <ul className="showcase-tabs" role="tablist">
                {items.map((item, index) => {
                    const isActive = index === activeIndex;
                    return (
                        <li role="presentation" key={item.title}>
                            <button
                                type="button"
                                role="tab"
                                id={`showcase-tab-${index}`}
                                aria-selected={isActive}
                                aria-controls={`showcase-panel-${index}`}
                                className={`showcase-tab ${isActive ? "active" : ""}`}
                                onClick={() => setActiveIndex(index)}
                                onFocus={() => setActiveIndex(index)}
                            >
                                {item.iconSvg && <span className="tab-icon"><Icon svg={item.iconSvg} /></span>}
                                <span className="tab-label">{item.title}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>

            <div className="showcase-preview" key={activeIndex} role="tabpanel" id={`showcase-panel-${activeIndex}`} aria-labelledby={`showcase-tab-${activeIndex}`}>
                <div className="showcase-image-frame">
                    <Screenshot src={active.imageUrl} darkSrc={active.darkImageUrl} alt={active.title} />
                </div>
                <div className="showcase-details">
                    <h3>
                        <Link href={active.moreInfo} className="card-heading-link" openExternally>
                            <span>{active.title}</span>
                            <Icon svg={arrowIcon} className="card-arrow" />
                        </Link>
                    </h3>
                    <p>{active.description}</p>
                </div>
            </div>
        </div>
    );
}

/** A lazily loaded screenshot, with `darkSrc` in its place when the visitor's system is dark. */
function Screenshot({ src, darkSrc, alt }: { src: string; darkSrc?: string; alt: string }) {
    return (
        <picture>
            {darkSrc && <source srcSet={darkSrc} media="(prefers-color-scheme: dark)" />}
            <img src={src} alt={alt} loading="lazy" />
        </picture>
    );
}

function FaqSection() {
    const { t } = useTranslation();
    return (
        <Section id="faq" className="faq" title={t("faq.title")}>
            <div className="faq-list">
                <FaqItem question={t("faq.free_question")}>{t("faq.free_answer")}</FaqItem>
                <FaqItem question={t("faq.mobile_question")}>{t("faq.mobile_answer")}</FaqItem>
                <FaqItem question={t("faq.server_question")}>{t("faq.server_answer")}</FaqItem>
                <FaqItem question={t("faq.cloud_question")}>
                    <Trans
                        i18nKey="faq.cloud_answer"
                        components={[
                            <Link key="pikapods" href="https://www.pikapods.com/pods?run=trilium-next" openExternally />
                        ]}
                    />
                </FaqItem>
                <FaqItem question={t("faq.collaboration_question")}>{t("faq.collaboration_answer")}</FaqItem>
                <FaqItem question={t("faq.database_question")}>{t("faq.database_answer")}</FaqItem>
                <FaqItem question={t("faq.scaling_question")}>{t("faq.scaling_answer")}</FaqItem>
                <FaqItem question={t("faq.network_share_question")}>{t("faq.network_share_answer")}</FaqItem>
                <FaqItem question={t("faq.security_question")}>{t("faq.security_answer")}</FaqItem>
            </div>

            <p className="faq-more">
                <Trans
                    i18nKey="faq.more_questions"
                    components={[
                        <Link key="discussions" href="https://github.com/orgs/TriliumNext/discussions" openExternally />
                    ]}
                />
            </p>
        </Section>
    );
}

function FaqItem({ question, children }: { question: string; children: ComponentChildren }) {
    return (
        <details className="faq-item">
            <summary>{question}</summary>
            <div className="faq-answer">{children}</div>
        </details>
    );
}

function FinalCta() {
    const { t } = useTranslation();
    return (
        <Section className="final-cta accented" title={t("final_cta.title")}>
            <p>{t("final_cta.description")}</p>

            <div class="buttons">
                <Button href="./get-started/" text={t("final_cta.get_started")} />
            </div>
        </Section>
    );
}
