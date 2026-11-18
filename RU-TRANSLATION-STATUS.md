# Статус русского перевода Trilium (форк Nikitamce/Trilium)

Дата: 2026-11-18

## Что уже сделано

### 1. Механизм многоязычной загрузки демо-заметок

- Добавлен `apps/server/src/services/demo_archive.ts` — выбор архива `demo-<locale>.zip`
  с откатом на английский `demo.zip`.
- `packages/trilium-core/src/services/sql_init.ts` — `initDemoArchive` теперь принимает
  локаль выбранную при установке и передаёт её провайдеру архива.
- `apps/server/src/core_init.ts`, `apps/desktop/src/main.ts` — используют `readDemoArchive`.
- `apps/standalone/src/local-server-worker.ts` — загружает `demo-<locale>.zip` через fetch
  с откатом на английский архив.
- Добавлен готовый переведённый архив `apps/server/src/assets/db/demo-ru.zip`
  и его исходники в `apps/edit-docs/demo-ru/` (переведены заголовки, содержимое заметок
  и `navigation.html`; пути файлов оставлены английскими — импортёр Trilium берёт
  заголовки из `!!!meta.json`).

### 2. Механизм многоязычной встроенной справки (User Guide внутри приложения)

- `packages/trilium-core/src/services/in_app_help.ts` — активная локаль (`i18next.language`)
  передаётся провайдеру справки; добавлен параметр `locale` в `getHelpHiddenSubtreeData`,
  `getHelpContent` и `getHelpPageAssets`.
- `apps/server/src/in_app_help_provider.ts` — кэширование дерева и контента справки
  **по локали**; предпочитает `help_meta.<locale>.json` / `help_content.<locale>.json`,
  откат на английские файлы, когда перевода нет.
- `apps/standalone/src/lightweight/in_app_help_provider.ts` — загружает все языки,
  перечисленные в `help_locales.json`, с откатом на английский.
- `apps/edit-docs/src/docs_pipeline.ts` — новая опция конфигурации `helpLocales`:
  для каждого языка собираются `help_meta.<locale>.json` и `help_content.<locale>.json`
  из каталога перевода, плюс пишется индекс `help_locales.json`.
- `edit-docs-config.yaml` — добавлен русский язык справки:
  `docs/User Guide/ru` → `help_meta.ru.json` / `help_content.ru.json`.

### 3. Перевод руководства пользователя на русский

- Создано дерево `docs/User Guide/ru/` (полная копия структуры с теми же ID заметок
  и теми же именами файлов — ссылки и сборка справки продолжают работать).
- Переведено **126 из 291** markdown-файла (весь раздел AI, Advanced Usage,
  Basic Concepts and Features, Navigation, импорт/экспорт, Notes, Themes,
  UI Elements, Collections — вводная часть).

### 4. Автогенерируемые страницы (намеренно НЕ переведены)

Эти файлы перезаписываются при каждой сборке (`edit-docs` генерирует их из
OpenAPI/TypeDoc), перевод будет потерян:

- `Advanced Usage/Internal API/API Reference.md`
- `Advanced Usage/ETAPI (REST API)/API Reference.md`
- `Scripting/Script API/Backend API.md`
- `Scripting/Script API/Frontend API.md`
- `Scripting/Script API/Electron API.md`

Для их перевода нужен отдельный шаг в конвейере сборки (машинный перевод артефактов
после генерации), это вынесено в «Осталось сделать».

## Осталось сделать

1. **Перевести оставшиеся ~165 markdown-файлов** руководства — полный список
   в разделе ниже. Это в основном поддеревья `Collections/` (Calendar, Geo Map,
   Kanban, Table, Presentation…), `Note Types/` (Text, Code, Canvas, Markdown…),
   `Scripting/`, `Installation & Setup/`, `Troubleshooting/`, `Theme development/`,
   корневые `FAQ.md`, `Feature Highlights.md` и др.
2. **Перевести заголовки в `docs/User Guide/ru/!!!meta.json`** (`"title": ...`)
   — сейчас там английские названия заметок.
3. **Собрать артефакты справки**: выполнить `edit-docs`/build-docs, чтобы сгенерировать
   `apps/server/src/assets/help/help_meta.ru.json`, `help_content.ru.json` и
   `help_locales.json` из `docs/User Guide/ru` (нужны установленные зависимости
   монорепозитория, `pnpm install`).
4. **Прогнать тесты/сборку** (`packages/trilium-core` spec'и на `in_app_help` и
   `sql_init`, спеки standalone-провайдера) и поправить их при необходимости.
5. (Опционально, для полноты) Машинный перевод автогенерируемых API-справок
   на этапе сборки.

## Список оставшихся файлов для перевода

См. ниже — пути относительно `docs/User Guide/ru/`.

```text
User Guide/Collections/Calendar.md
User Guide/Collections/Dashboard.md
User Guide/Collections/Geo Map.md
User Guide/Collections/Geo Map/Drawing shapes.md
User Guide/Collections/Geo Map/Image maps.md
User Guide/Collections/Grid View.md
User Guide/Collections/Kanban Board.md
User Guide/Collections/List View.md
User Guide/Collections/Presentation.md
User Guide/Collections/Table.md
User Guide/FAQ.md
User Guide/Feature Highlights.md
User Guide/Installation & Setup/Backup.md
User Guide/Installation & Setup/Data directory.md
User Guide/Installation & Setup/Desktop Installation.md
User Guide/Installation & Setup/Desktop Installation/Network Access.md
User Guide/Installation & Setup/Desktop Installation/Nix flake.md
User Guide/Installation & Setup/Desktop Installation/System Requirements.md
User Guide/Installation & Setup/Desktop Installation/Tray icon & automatic startup.md
User Guide/Installation & Setup/Desktop Installation/Troubleshooting.md
User Guide/Installation & Setup/Desktop Installation/Using the desktop application as a server.md
User Guide/Installation & Setup/Downloaded resources.md
User Guide/Installation & Setup/Mobile Frontend.md
User Guide/Installation & Setup/Server Installation.md
User Guide/Installation & Setup/Server Installation/1. Installing the server/Manually.md
User Guide/Installation & Setup/Server Installation/1. Installing the server/Multiple server instances.md
User Guide/Installation & Setup/Server Installation/1. Installing the server/On NixOS.md
User Guide/Installation & Setup/Server Installation/1. Installing the server/Packaged version for Linux.md
User Guide/Installation & Setup/Server Installation/1. Installing the server/Using Docker.md
User Guide/Installation & Setup/Server Installation/1. Installing the server/Using Kubernetes.md
User Guide/Installation & Setup/Server Installation/2. Reverse proxy.md
User Guide/Installation & Setup/Server Installation/2. Reverse proxy/Apache using Docker.md
User Guide/Installation & Setup/Server Installation/2. Reverse proxy/Nginx.md
User Guide/Installation & Setup/Server Installation/2. Reverse proxy/Traefik.md
User Guide/Installation & Setup/Server Installation/2. Reverse proxy/Trusted proxy.md
User Guide/Installation & Setup/Server Installation/Authentication.md
User Guide/Installation & Setup/Server Installation/Authentication/Resetting your password.md
User Guide/Installation & Setup/Server Installation/HTTPS (TLS).md
User Guide/Installation & Setup/Server Installation/Multi-factor authentication with TOTP.md
User Guide/Installation & Setup/Server Installation/Nix flake.clone.md
User Guide/Installation & Setup/Server Installation/Signing in with OpenID Connect.md
User Guide/Installation & Setup/Server Installation/Signing in with OpenID Connect/Setting up with various providers.md
User Guide/Installation & Setup/Server Installation/System Requirements.md
User Guide/Installation & Setup/Server Installation/Third-party cloud hosting.md
User Guide/Installation & Setup/Synchronization.md
User Guide/Installation & Setup/Upgrading TriliumNext.md
User Guide/Installation & Setup/Web Clipper.md
User Guide/Meeting transcription.md
User Guide/Miscellaneous/License.md
User Guide/Miscellaneous/Patterns of personal knowledge.md
User Guide/Miscellaneous/Privacy Policy.md
User Guide/Note Types.md
User Guide/Note Types/Canvas.md
User Guide/Note Types/Code.md
User Guide/Note Types/Converting between note types.md
User Guide/Note Types/File.md
User Guide/Note Types/File/Audio & Video.md
User Guide/Note Types/File/Office documents.md
User Guide/Note Types/File/PDFs.md
User Guide/Note Types/Markdown.md
User Guide/Note Types/Mermaid Diagrams.md
User Guide/Note Types/Mermaid Diagrams/ELK layout.md
User Guide/Note Types/Mind Map.md
User Guide/Note Types/Note Map.md
User Guide/Note Types/Relation Map.md
User Guide/Note Types/Render Note.md
User Guide/Note Types/Saved Search.md
User Guide/Note Types/Spreadsheets.md
User Guide/Note Types/Text.md
User Guide/Note Types/Text/Anchors.md
User Guide/Note Types/Text/Aside blocks.md
User Guide/Note Types/Text/Automatic replacements.md
User Guide/Note Types/Text/Block quotes & admonitions.md
User Guide/Note Types/Text/Block references.md
User Guide/Note Types/Text/Collapsible blocks.md
User Guide/Note Types/Text/Collapsible headings.md
User Guide/Note Types/Text/Content language & Right-to-left support.md
User Guide/Note Types/Text/Content tabs.md
User Guide/Note Types/Text/Cut to subnote.md
User Guide/Note Types/Text/Developer-specific formatting.md
User Guide/Note Types/Text/Developer-specific formatting/Code blocks.md
User Guide/Note Types/Text/Footnotes.md
User Guide/Note Types/Text/Format Painter.md
User Guide/Note Types/Text/Formatting toolbar.md
User Guide/Note Types/Text/General formatting.md
User Guide/Note Types/Text/Highlights list.md
User Guide/Note Types/Text/Images.md
User Guide/Note Types/Text/Images/Image references.md
User Guide/Note Types/Text/In-editor AI assistant.md
User Guide/Note Types/Text/In-editor AI assistant/Custom AI quick actions.md
User Guide/Note Types/Text/Include Note.md
User Guide/Note Types/Text/Insert buttons.md
User Guide/Note Types/Text/Insert buttons/Icons.md
User Guide/Note Types/Text/Keyboard shortcuts.md
User Guide/Note Types/Text/Link Previews.md
User Guide/Note Types/Text/Links.md
User Guide/Note Types/Text/Links/Backlinks.md
User Guide/Note Types/Text/Links/External links.md
User Guide/Note Types/Text/Links/Internal (reference) links.md
User Guide/Note Types/Text/Lists.md
User Guide/Note Types/Text/Markdown-like formatting.md
User Guide/Note Types/Text/Math Equations.md
User Guide/Note Types/Text/Multicolumn layout.md
User Guide/Note Types/Text/Other features.md
User Guide/Note Types/Text/Premium features.md
User Guide/Note Types/Text/Slash Commands.md
User Guide/Note Types/Text/Sorting.md
User Guide/Note Types/Text/Spell Check.md
User Guide/Note Types/Text/Table of contents.md
User Guide/Note Types/Text/Tables.md
User Guide/Note Types/Text/Text Snippets.md
User Guide/Note Types/Text/To-do Lists.md
User Guide/Note Types/Text/Vim mode.md
User Guide/Note Types/Text/Vim mode/Vim beginner guide.md
User Guide/Note Types/Text/Vim mode/Vim full reference.md
User Guide/Note Types/Web View.md
User Guide/Quick Start.md
User Guide/Scripting.md
User Guide/Scripting/Backend scripts.md
User Guide/Scripting/Backend scripts/Backend Events.md
User Guide/Scripting/Backend scripts/Server-side imports.md
User Guide/Scripting/Breaking changes/v0.102.0 Upgrade to jQuery 4.0.0.md
User Guide/Scripting/Breaking changes/v0.103.0 Removal of axios.md
User Guide/Scripting/Breaking changes/v0.103.0 `cheerio` is now deprecated.md
User Guide/Scripting/Breaking changes/v0.104.0 Disabling the Node integration in Electron.md
User Guide/Scripting/Breaking changes/v0.106.0 Removal of cheerio.md
User Guide/Scripting/Breaking changes/v0.107.0 Removal of the old layout.md
User Guide/Scripting/Common concepts/Script bundles.md
User Guide/Scripting/Frontend Basics.md
User Guide/Scripting/Frontend Basics/Custom Widgets.md
User Guide/Scripting/Frontend Basics/Custom Widgets/CSS.md
User Guide/Scripting/Frontend Basics/Custom Widgets/Note context aware widget.md
User Guide/Scripting/Frontend Basics/Custom Widgets/Right pane widget.md
User Guide/Scripting/Frontend Basics/Custom Widgets/Troubleshooting.md
User Guide/Scripting/Frontend Basics/Custom Widgets/Widget Basics.md
User Guide/Scripting/Frontend Basics/Custom Widgets/Word count widget.md
User Guide/Scripting/Frontend Basics/Examples/Downloading responses from Google Forms.md
User Guide/Scripting/Frontend Basics/Examples/New Task launcher button.md
User Guide/Scripting/Frontend Basics/Examples/Using promoted attributes to configure scripts.md
User Guide/Scripting/Frontend Basics/Frontend Events.md
User Guide/Scripting/Frontend Basics/Launch Bar Widgets.md
User Guide/Scripting/Frontend Basics/Launch Bar Widgets/Analog Watch.md
User Guide/Scripting/Frontend Basics/Launch Bar Widgets/Note Title Widget.md
User Guide/Scripting/Frontend Basics/Preact.md
User Guide/Scripting/Frontend Basics/Preact/Built-in components.md
User Guide/Scripting/Frontend Basics/Preact/CSS.md
User Guide/Scripting/Frontend Basics/Preact/Component libraries.md
User Guide/Scripting/Frontend Basics/Preact/Hooks.md
User Guide/Scripting/Logging.md
User Guide/Scripting/Script API.md
User Guide/Scripting/Script API/Day.js.md
User Guide/Scripting/Security.md
User Guide/Theme development/Creating a custom theme.md
User Guide/Theme development/Creating an icon pack.md
User Guide/Theme development/Custom app-wide CSS.md
User Guide/Theme development/Customize the Next theme.md
User Guide/Theme development/Reference.md
User Guide/Troubleshooting.md
User Guide/Troubleshooting/Anonymized Database.md
User Guide/Troubleshooting/Error logs.md
User Guide/Troubleshooting/Error logs/Backend (server) logs.md
User Guide/Troubleshooting/Error logs/Frontend logs.md
User Guide/Troubleshooting/Refreshing the application.md
User Guide/Troubleshooting/Reporting issues.md
User Guide/Troubleshooting/Synchronization fails with 504 Gateway Timeout.md
```

(если список выше расходится с фактическим — актуальный перечень всегда можно получить
как `comm -23 <(find "docs/User Guide/ru" -name "*.md" | sort) <(sort список_готовых)`,
либо просто поискать по файлам с английским заголовком `# ` первой строкой.)
