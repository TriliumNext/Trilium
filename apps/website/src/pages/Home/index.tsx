import { ComponentChildren } from 'preact';
import Card from '../../components/Card.js';
import Section from '../../components/Section.js';
import DownloadButton from '../../components/DownloadButton.js';
import "./index.css";
import { useColorScheme, usePageTitle } from '../../hooks.js';
import Button, { Link } from '../../components/Button.js';
import gitHubIcon from "../../assets/boxicons/bx-github.svg?raw";
import dockerIcon from "../../assets/boxicons/bx-docker.svg?raw";
import noteStructureIcon from "../../assets/boxicons/bx-folder.svg?raw";
import attributesIcon from "../../assets/boxicons/bx-tag.svg?raw";
import hoistingIcon from "../../assets/boxicons/bx-chevrons-up.svg?raw";
import revisionsIcon from "../../assets/boxicons/bx-history.svg?raw";
import syncIcon from "../../assets/boxicons/bx-refresh-cw.svg?raw";
import protectedNotesIcon from "../../assets/boxicons/bx-shield.svg?raw";
import jumpToIcon from "../../assets/boxicons/bx-send-alt.svg?raw";
import searchIcon from "../../assets/boxicons/bx-search.svg?raw";
import webClipperIcon from "../../assets/boxicons/bx-paperclip.svg?raw";
import importExportIcon from "../../assets/boxicons/bx-swap-horizontal.svg?raw";
import shareIcon from "../../assets/boxicons/bx-globe.svg?raw";
import codeIcon from "../../assets/boxicons/bx-code.svg?raw";
import restApiIcon from "../../assets/boxicons/bx-extension.svg?raw";
import textNoteIcon from "../../assets/boxicons/bx-note.svg?raw";
import fileIcon from "../../assets/boxicons/bx-file.svg?raw";
import canvasIcon from "../../assets/boxicons/bx-pen.svg?raw";
import mermaidIcon from "../../assets/boxicons/bx-vector-square.svg?raw";
import mindmapIcon from "../../assets/boxicons/bx-network-chart.svg?raw";
import calendarIcon from "../../assets/boxicons/bx-calendar.svg?raw";
import tableIcon from "../../assets/boxicons/bx-table.svg?raw";
import boardIcon from "../../assets/boxicons/bx-columns-3.svg?raw";
import geomapIcon from "../../assets/boxicons/bx-map.svg?raw";
import { getPlatform } from '../../download-helper.js';
import { useEffect, useState } from 'preact/hooks';

export function Home() {
    usePageTitle("");

	return (
        <>
            <HeroSection />
            <OrganizationBenefitsSection />
            <ProductivityBenefitsSection />
            <NoteTypesSection />
            <ExtensibilityBenefitsSection />
            <CollectionsSection />
            <FaqSection />
            <FinalCta />
        </>
	);
}

function HeroSection() {
    const platform = getPlatform();
    const colorScheme = useColorScheme();
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
                <h1>Organize your thoughts. Build your personal knowledge base.</h1>
                <p>Trilium is an open-source solution for note-taking and organizing a personal knowledge base. Use it locally on your desktop, or sync it with your self-hosted server to keep your notes everywhere you go.</p>

                <div className="download-wrapper">
                    <DownloadButton big />
                    <Button href="./get-started/" className="mobile-only" text="Get started" />
                    <div className="additional-options">
                        <Button iconSvg={gitHubIcon} outline text="GitHub" href="https://github.com/TriliumNext/Trilium/" openExternally />
                        <Button iconSvg={dockerIcon} outline text="Docker Hub" href="https://hub.docker.com/r/triliumnext/trilium" openExternally />
                    </div>
                </div>

            </div>

            <div className="screenshot-container">
                {screenshotUrl && <img class="screenshot" src={screenshotUrl} alt="Screenshot of the Trilium Notes desktop application" />}
            </div>
        </Section>
    )
}

function OrganizationBenefitsSection() {
    return (
        <>
            <Section className="benefits" title="Organization">
                <div className="benefits-container grid-3-cols">
                    <Card iconSvg={noteStructureIcon} title="Note structure" moreInfoUrl="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Notes/index.html">Notes can be arranged hierarchically. There's no need for folders, since each note can contain sub-notes. A single note can be added in multiple places in the hierarchy.</Card>
                    <Card iconSvg={attributesIcon} title="Note labels and relationships" moreInfoUrl="https://docs.triliumnotes.org/User Guide/User Guide/Advanced Usage/Attributes/index.html">Use <em>relations</em> between notes or add <em>labels</em> for easy categorization. Use promoted attributes to enter structured information which can be used in tables, boards.</Card>
                    <Card iconSvg={hoistingIcon} title="Workspaces and hoisting" moreInfoUrl="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Navigation/Note%20Hoisting.html">Easily separate your personal and work notes by grouping them under a workspace, which focuses your note tree to only show a specific set of notes.</Card>
                </div>
            </Section>
        </>
    );
}

function ProductivityBenefitsSection() {
    return (
        <>
            <Section className="benefits accented" title="Productivity and safety">
                <div className="benefits-container grid-3-cols">
                    <Card iconSvg={revisionsIcon} title="Note revisions" moreInfoUrl="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.html">Notes are periodically saved in the background and revisions can be used for review or to undo accidental changes. Revisions can also be created on-demand.</Card>
                    <Card iconSvg={syncIcon} title="Synchronization" moreInfoUrl="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Installation%20%26%20Setup/Synchronization.html">Use a self-hosted or cloud instance to easily synchronize your notes across multiple devices, and to access it from your mobile phone using a PWA.</Card>
                    <Card iconSvg={protectedNotesIcon} title="Protected notes" moreInfoUrl="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Notes/Protected%20Notes.html">Protect sensitive personal information by encrypting the notes and locking them behind a password-protected session.</Card>
                    <Card iconSvg={jumpToIcon} title="Quick search and commands" moreInfoUrl="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Navigation/Jump%20to.html">Jump quickly to notes or UI commands across the hierarchy by searching for their title, with fuzzy matching to account for typos or slight differences.</Card>
                    <Card iconSvg={searchIcon} title="Powerful search" moreInfoUrl="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Navigation/Search.html">Or search for text inside notes and narrow down the search by filtering by the parent note, or by depth.</Card>
                    <Card iconSvg={webClipperIcon} title="Web clipper" moreInfoUrl="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Installation%20%26%20Setup/Web%20Clipper.html">Grab web pages (or screenshots) and place them directly into Trilium using the web clipper browser extension.</Card>
                </div>
            </Section>
        </>
    );
}

function NoteTypesSection() {
    return (
        <Section className="note-types" title="Multiple ways to represent your information">
            <ListWithScreenshot horizontal items={[
                {
                    title: "Text notes",
                    imageUrl: "/type_text.webp",
                    iconSvg: textNoteIcon,
                    moreInfo: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Text/index.html",
                    description: "The notes are edited using a visual (WYSIWYG) editor, with support for tables, images, math expressions, code blocks with syntax highlighting. Quickly format the text using Markdown-like syntax or using slash commands."
                },
                {
                    title: "Code notes",
                    imageUrl: "/type_code.webp",
                    iconSvg: codeIcon,
                    moreInfo: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Code.html",
                    description: "Large samples of source code or scripts use a dedicated editor, with syntax highlighting for many programming languages and with various color themes."
                },
                {
                    title: "File notes",
                    imageUrl: "/type_file.webp",
                    iconSvg: fileIcon,
                    moreInfo: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/File.html",
                    description: "Embed multimedia files such as PDFs, images, videos with an in-application preview."
                },
                {
                    title: "Canvas",
                    imageUrl: "/type_canvas.webp",
                    iconSvg: canvasIcon,
                    moreInfo: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Canvas.html",
                    description: "Arrange shapes, images and text across an infinite canvas, using the same technology behind excalidraw.com. Ideal for diagrams, sketches and visual planning."
                },
                {
                    title: "Mermaid diagrams",
                    imageUrl: "/type_mermaid.webp",
                    iconSvg: mermaidIcon,
                    moreInfo: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Mermaid%20Diagrams/index.html",
                    description: "Create diagrams such as flowcharts, class & sequence diagrams, Gantt charts and many more, using the Mermaid syntax."
                },
                {
                    title: "Mindmap",
                    imageUrl: "/type_mindmap.webp",
                    iconSvg: mindmapIcon,
                    moreInfo: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Mind%20Map.html",
                    description: "Organize your thoughts visually or do a brainstorming session."
                }
            ]} />
            <p>
                and others:{" "}
                <Link href="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Note%20Map.html" openExternally>note map</Link>,{" "}
                <Link href="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Relation%20Map.html" openExternally>relation map</Link>,{" "}
                <Link href="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Saved%20Search.html" openExternally>saved searches</Link>,{" "}
                <Link href="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Render%20Note.html" openExternally>render note</Link>,{" "}
                <Link href="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Web%20View.html" openExternally>web views</Link>.
            </p>
        </Section>
    );
}

function ExtensibilityBenefitsSection() {
    return (
        <>
            <Section className="benefits accented" title="Sharing & extensibility">
                <div className="benefits-container grid-4-cols">
                    <Card iconSvg={importExportIcon} title="Import/export" moreInfoUrl="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Import%20%26%20Export/Markdown/index.html">Easily interact with other applications using Markdown, ENEX, OML formats.</Card>
                    <Card iconSvg={shareIcon} title="Share notes on the web" moreInfoUrl="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Advanced%20Usage/Sharing/Serving%20directly%20the%20content%20o.html">If you have a server, it can be used to share a subset of your notes with other people.</Card>
                    <Card iconSvg={codeIcon} title="Advanced scripting" moreInfoUrl="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Scripting/Custom%20Widgets/index.html">Build your own integrations within Trilium with custom widgets, or server-side logic.</Card>
                    <Card iconSvg={restApiIcon} title="REST API" moreInfoUrl="https://docs.triliumnotes.org/User%20Guide/User%20Guide/Advanced%20Usage/ETAPI%20%28REST%20API%29/index.html">Interact with Trilium programatically using its builtin REST API.</Card>
                </div>
            </Section>
        </>
    );
}

function CollectionsSection() {
    return (
        <Section className="collections" title="Collections">
            <ListWithScreenshot items={[
                {
                    title: "Calendar",
                    imageUrl: "/collection_calendar.webp",
                    iconSvg: calendarIcon,
                    moreInfo: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Collections/Calendar%20View.html",
                    description: "Organize your personal or professional events using a calendar, with support for all-day and multi-day events. See your events at a glance with the week, month and year views. Easy interaction to add or drag events."
                },
                {
                    title: "Table",
                    iconSvg: tableIcon,
                    imageUrl: "/collection_table.webp",
                    moreInfo: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Collections/Table%20View.html",
                    description: "Display and edit information about notes in a tabular structure, with various column types such as text, number, check boxes, date & time, links and colors and support for relations. Optionally, display the notes within a tree hierarchy inside the table." },
                {
                    title: "Board",
                    iconSvg: boardIcon,
                    imageUrl: "/collection_board.webp",
                    moreInfo: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Collections/Board%20View.html",
                    description: "Organize your tasks or project status into a Kanban board with an easy way to create new items and columns and simply changing their status by dragging across the board."
                },
                {
                    title: "Geomap",
                    iconSvg: geomapIcon,
                    imageUrl: "/collection_geomap.webp",
                    moreInfo: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Note%20Types/Collections/Geo%20Map%20View.html",
                    description: "Plan your vacations or mark your points of interest directly on a geographical map using customizable markers. Display recorded GPX tracks to track itineraries."
                }
            ]} />
        </Section>
    );
}

function ListWithScreenshot({ items, horizontal, cardExtra }: {
    items: { title: string, imageUrl: string, description: string, moreInfo: string, iconSvg?: string }[];
    horizontal?: boolean;
    cardExtra?: ComponentChildren;
}) {
    const [ selectedItem, setSelectedItem ] = useState(items[0]);

    return (
        <div className={`list-with-screenshot ${horizontal ? "horizontal" : ""}`}>
            <ul>
                {items.map(item => (
                    <li className={`${item === selectedItem ? "selected" : ""}`}>
                        <Card
                            title={item.title}
                            onMouseEnter={() => setSelectedItem(item)}
                            onClick={() => setSelectedItem(item)}
                            moreInfoUrl={item.moreInfo}
                            iconSvg={item.iconSvg}
                        >
                            {item.description}
                        </Card>
                    </li>
                ))}
            </ul>

            <div className="details">
                {selectedItem && (
                    <>
                        <img src={selectedItem.imageUrl} alt="Screenshot of the feature being selected" loading="lazy" />
                    </>
                )}
            </div>
        </div>
    )
}

function FaqSection() {
    return (
        <Section className="faq" title="Frequently Asked Questions">
            <div class="grid-2-cols">
                <FaqItem question="Is there a mobile application?">Currently there is no official mobile application. However, if you have a server instance you can access it using a web browser and even install it as a PWA. For Android, there is an unofficial application called TriliumDroid that even works offline (same as a desktop client).</FaqItem>
                <FaqItem question="Where is the data stored?">All your notes will be stored in an SQLite database in an application folder. The reasoning why Trilium uses a database instead of plain text files is both performance and some features would be much more difficult to implement such as clones (same note in multiple places in the tree). To find the application folder, simply go to the About window.</FaqItem>
                <FaqItem question="Do I need a server to use Trilium?">No, the server allows access via a web browser and manages the synchronization if you have multiple devices. To get started, it's enough to download the desktop application and start using it.</FaqItem>
                <FaqItem question="How well does the application scale with a large amount of notes?">Depending on usage, the application should be able to handle at least 100.000 notes without an issue. Do note that the sync process can sometimes fail if uploading many large files (&gt; 1 GB per file) since Trilium is meant more as a knowledge base application rather than a file store (like NextCloud, for example).</FaqItem>
                <FaqItem question="Can I share my database over a network drive?">No, it's generally not a good idea to share a SQLite database over a network drive. Although sometimes it might work, there are chances that the database will get corrupted due to imperfect file locks over a network.</FaqItem>
                <FaqItem question="How is my data protected?">By default, notes are not encrypted and can be read directly from the database. Once a note is marked as encrypted, the note is encrypted using AES-128-CBC.</FaqItem>
            </div>
        </Section>
    );
}

function FaqItem({ question, children }: { question: string; children: ComponentChildren }) {
    return (
        <Card title={question}>
            {children}
        </Card>
    )
}

function FinalCta() {
    return (
        <Section className="final-cta accented" title="Ready to get started with Trilium Notes?">
            <p>Build your personal knowledge base with powerful features and full privacy.</p>

            <div class="buttons">
                <Button href="./get-started/" text="Get started" />
            </div>
        </Section>
    )
}
