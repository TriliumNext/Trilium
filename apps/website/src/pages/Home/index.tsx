import "./index.css";

import { ComponentChildren } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
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
import { getPlatform } from '../../download-helper.js';
import { useColorScheme, usePageTitle } from '../../hooks.js';
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
            <HeroSection />
            <SectionNav items={navItems} />
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
    const platform = getPlatform();
    const colorScheme = useColorScheme();
    const stargazersCount = useContext(StargazersContext);
    const [ screenshotUrl, setScreenshotUrl ] = useState<string>();

    useEffect(() => {
        switch (platform) {
            case "macos":
                setScreenshotUrl(`/screenshot_desktop_mac_${colorScheme}.webp`);
                break;
            case "linux":
                setScreenshotUrl(`/screenshot_desktop_linux_${colorScheme}.webp`);
                break;
            case "windows":
            default:
                setScreenshotUrl(`/screenshot_desktop_win_${colorScheme}.webp`);
                break;
        }
    }, [ colorScheme ]);

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
                {screenshotUrl && <img class="screenshot" src={screenshotUrl} alt={t("hero_section.screenshot_alt")} />}
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

function OrganizationBenefitsSection() {
    const { t } = useTranslation();
    return (
        <>
            <Section id="organization" className="benefits organization" title={t("organization_benefits.title")}>
                <div className="organization-split">
                    <div className="organization-screenshot">
                        <img src="/feature_tree.webp" alt={t("organization_benefits.screenshot_alt")} loading="lazy" />
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
                    <Card iconSvg={authIcon} title={t("productivity_benefits.auth_title")} moreInfoUrl="https://docs.triliumnotes.org/user-guide/installation/server/authentication">{t("productivity_benefits.auth_content")}</Card>
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
                    iconSvg: textNoteIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/text",
                    description: t("note_types.text_description")
                },
                {
                    title: t("note_types.markdown_title"),
                    imageUrl: "/type_markdown.webp",
                    iconSvg: markdownIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/markdown",
                    description: t("note_types.markdown_description")
                },
                {
                    title: t("note_types.code_title"),
                    imageUrl: "/type_code.webp",
                    iconSvg: codeIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/code",
                    description: t("note_types.code_description")
                },
                {
                    title: t("note_types.spreadsheet_title"),
                    imageUrl: "/type_spreadsheet.webp",
                    iconSvg: tableIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/Spreadsheets",
                    description: t("note_types.spreadsheet_description")
                },
                {
                    title: t("note_types.canvas_title"),
                    imageUrl: "/type_canvas.webp",
                    iconSvg: canvasIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/canvas",
                    description: t("note_types.canvas_description")
                },
                {
                    title: t("note_types.mermaid_title"),
                    imageUrl: "/type_mermaid.webp",
                    iconSvg: mermaidIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/mermaid-diagrams",
                    description: t("note_types.mermaid_description")
                },
                {
                    title: t("note_types.mindmap_title"),
                    imageUrl: "/type_mindmap.webp",
                    iconSvg: mindmapIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/note-types/mindmap",
                    description: t("note_types.mindmap_description")
                },
                {
                    title: t("note_types.file_title"),
                    imageUrl: "/type_file.webp",
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
                    iconSvg: calendarIcon,
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/calendar",
                    description: t("collections.calendar_description")
                },
                {
                    title: t("collections.table_title"),
                    iconSvg: tableIcon,
                    imageUrl: "/collection_table.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/table",
                    description: t("collections.table_description")
                },
                {
                    title: t("collections.board_title"),
                    iconSvg: boardIcon,
                    imageUrl: "/collection_board.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/kanban-board",
                    description: t("collections.board_description")
                },
                {
                    title: t("collections.geomap_title"),
                    iconSvg: geomapIcon,
                    imageUrl: "/collection_geomap.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/geomap",
                    description: t("collections.geomap_description")
                },
                {
                    title: t("collections.presentation_title"),
                    iconSvg: presentationIcon,
                    imageUrl: "/collection_presentation.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/presentation",
                    description: t("collections.presentation_description")
                },
                {
                    title: t("collections.dashboard_title"),
                    iconSvg: dashboardIcon,
                    imageUrl: "/collection_dashboard.webp",
                    moreInfo: "https://docs.triliumnotes.org/user-guide/collections/Dashboard",
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
                    <img src="/feature_llm.webp" alt={t("ai_integration.screenshot_alt")} loading="lazy" />
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
                    <img src={active.imageUrl} alt={active.title} loading="lazy" />
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
