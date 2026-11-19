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
ru\User Guide\Meeting transcription.md
ru\User Guide\Quick Start.md
ru\User Guide\Scripting.md
ru\User Guide\Troubleshooting.md
ru\User Guide\Advanced Usage\ETAPI (REST API)\API Reference.md
ru\User Guide\Advanced Usage\Internal API\API Reference.md
ru\User Guide\Basic Concepts and Features\Notes\Protected Notes.md
ru\User Guide\Basic Concepts and Features\Notes\Restoring Deleted Notes.md
ru\User Guide\Basic Concepts and Features\Notes\Save status indicator.md
ru\User Guide\Basic Concepts and Features\UI Elements\Breadcrumb.md
ru\User Guide\Basic Concepts and Features\UI Elements\Content width.md
ru\User Guide\Installation & Setup\Downloaded resources.md
ru\User Guide\Installation & Setup\Synchronization.md
ru\User Guide\Installation & Setup\Upgrading TriliumNext.md
ru\User Guide\Installation & Setup\Web Clipper.md
ru\User Guide\Installation & Setup\Desktop Installation\Nix flake.md
ru\User Guide\Installation & Setup\Desktop Installation\System Requirements.md
ru\User Guide\Installation & Setup\Desktop Installation\Troubleshooting.md
ru\User Guide\Installation & Setup\Desktop Installation\Using the desktop application as a server.md
ru\User Guide\Installation & Setup\Server Installation\2. Reverse proxy.md
ru\User Guide\Installation & Setup\Server Installation\Authentication.md
ru\User Guide\Installation & Setup\Server Installation\HTTPS (TLS).md
ru\User Guide\Installation & Setup\Server Installation\Multi-factor authentication with TOTP.md
ru\User Guide\Installation & Setup\Server Installation\Nix flake.clone.md
ru\User Guide\Installation & Setup\Server Installation\Signing in with OpenID Connect.md
ru\User Guide\Installation & Setup\Server Installation\System Requirements.md
ru\User Guide\Installation & Setup\Server Installation\Third-party cloud hosting.md
ru\User Guide\Installation & Setup\Server Installation\1. Installing the server\Manually.md
ru\User Guide\Installation & Setup\Server Installation\1. Installing the server\Multiple server instances.md
ru\User Guide\Installation & Setup\Server Installation\1. Installing the server\On NixOS.md
ru\User Guide\Installation & Setup\Server Installation\1. Installing the server\Packaged version for Linux.md
ru\User Guide\Installation & Setup\Server Installation\1. Installing the server\Using Docker.md
ru\User Guide\Installation & Setup\Server Installation\1. Installing the server\Using Kubernetes.md
ru\User Guide\Installation & Setup\Server Installation\2. Reverse proxy\Apache using Docker.md
ru\User Guide\Installation & Setup\Server Installation\2. Reverse proxy\Nginx.md
ru\User Guide\Installation & Setup\Server Installation\2. Reverse proxy\Traefik.md
ru\User Guide\Installation & Setup\Server Installation\Authentication\Resetting your password.md
ru\User Guide\Installation & Setup\Server Installation\Signing in with OpenID Connect\Setting up with various providers.md
ru\User Guide\Miscellaneous\License.md
ru\User Guide\Miscellaneous\Patterns of personal knowledge.md
ru\User Guide\Miscellaneous\Privacy Policy.md
ru\User Guide\Note Types\File\Audio & Video.md
ru\User Guide\Note Types\File\Office documents.md
ru\User Guide\Note Types\File\PDFs.md
ru\User Guide\Note Types\Mermaid Diagrams\ELK layout.md
ru\User Guide\Note Types\Text\Anchors.md
ru\User Guide\Note Types\Text\Aside blocks.md
ru\User Guide\Note Types\Text\Automatic replacements.md
ru\User Guide\Note Types\Text\Block quotes & admonitions.md
ru\User Guide\Note Types\Text\Block references.md
ru\User Guide\Note Types\Text\Collapsible blocks.md
ru\User Guide\Note Types\Text\Collapsible headings.md
ru\User Guide\Note Types\Text\Content language & Right-to-left support.md
ru\User Guide\Note Types\Text\Content tabs.md
ru\User Guide\Note Types\Text\Cut to subnote.md
ru\User Guide\Note Types\Text\Developer-specific formatting.md
ru\User Guide\Note Types\Text\Footnotes.md
ru\User Guide\Note Types\Text\Format Painter.md
ru\User Guide\Note Types\Text\Formatting toolbar.md
ru\User Guide\Note Types\Text\General formatting.md
ru\User Guide\Note Types\Text\Highlights list.md
ru\User Guide\Note Types\Text\Images.md
ru\User Guide\Note Types\Text\In-editor AI assistant.md
ru\User Guide\Note Types\Text\Include Note.md
ru\User Guide\Note Types\Text\Insert buttons.md
ru\User Guide\Note Types\Text\Keyboard shortcuts.md
ru\User Guide\Note Types\Text\Link Previews.md
ru\User Guide\Note Types\Text\Links.md
ru\User Guide\Note Types\Text\Lists.md
ru\User Guide\Note Types\Text\Markdown-like formatting.md
ru\User Guide\Note Types\Text\Math Equations.md
ru\User Guide\Note Types\Text\Multicolumn layout.md
ru\User Guide\Note Types\Text\Other features.md
ru\User Guide\Note Types\Text\Premium features.md
ru\User Guide\Note Types\Text\Slash Commands.md
ru\User Guide\Note Types\Text\Sorting.md
ru\User Guide\Note Types\Text\Spell Check.md
ru\User Guide\Note Types\Text\Table of contents.md
ru\User Guide\Note Types\Text\Tables.md
ru\User Guide\Note Types\Text\Text Snippets.md
ru\User Guide\Note Types\Text\To-do Lists.md
ru\User Guide\Note Types\Text\Vim mode.md
ru\User Guide\Note Types\Text\Developer-specific formatting\Code blocks.md
ru\User Guide\Note Types\Text\Images\Image references.md
ru\User Guide\Note Types\Text\In-editor AI assistant\Custom AI quick actions.md
ru\User Guide\Note Types\Text\Insert buttons\Icons.md
ru\User Guide\Note Types\Text\Links\Backlinks.md
ru\User Guide\Note Types\Text\Links\External links.md
ru\User Guide\Note Types\Text\Links\Internal (reference) links.md
ru\User Guide\Note Types\Text\Vim mode\Vim beginner guide.md
ru\User Guide\Note Types\Text\Vim mode\Vim full reference.md
ru\User Guide\Scripting\Backend scripts.md
ru\User Guide\Scripting\Frontend Basics.md
ru\User Guide\Scripting\Logging.md
ru\User Guide\Scripting\Script API.md
ru\User Guide\Scripting\Security.md
ru\User Guide\Scripting\Backend scripts\Backend Events.md
ru\User Guide\Scripting\Backend scripts\Server-side imports.md
ru\User Guide\Scripting\Breaking changes\v0.102.0 Upgrade to jQuery 4.0.0.md
ru\User Guide\Scripting\Breaking changes\v0.103.0 Removal of axios.md
ru\User Guide\Scripting\Breaking changes\v0.103.0 `cheerio` is now deprecated.md
ru\User Guide\Scripting\Breaking changes\v0.104.0 Disabling the Node integration in Electron.md
ru\User Guide\Scripting\Breaking changes\v0.106.0 Removal of cheerio.md
ru\User Guide\Scripting\Breaking changes\v0.107.0 Removal of the old layout.md
ru\User Guide\Scripting\Common concepts\Script bundles.md
ru\User Guide\Scripting\Frontend Basics\Custom Widgets.md
ru\User Guide\Scripting\Frontend Basics\Frontend Events.md
ru\User Guide\Scripting\Frontend Basics\Launch Bar Widgets.md
ru\User Guide\Scripting\Frontend Basics\Preact.md
ru\User Guide\Scripting\Frontend Basics\Custom Widgets\CSS.md
ru\User Guide\Scripting\Frontend Basics\Custom Widgets\Note context aware widget.md
ru\User Guide\Scripting\Frontend Basics\Custom Widgets\Right pane widget.md
ru\User Guide\Scripting\Frontend Basics\Custom Widgets\Troubleshooting.md
ru\User Guide\Scripting\Frontend Basics\Custom Widgets\Widget Basics.md
ru\User Guide\Scripting\Frontend Basics\Custom Widgets\Word count widget.md
ru\User Guide\Scripting\Frontend Basics\Examples\Downloading responses from Google Forms.md
ru\User Guide\Scripting\Frontend Basics\Examples\New Task launcher button.md
ru\User Guide\Scripting\Frontend Basics\Examples\Using promoted attributes to configure scripts.md
ru\User Guide\Scripting\Frontend Basics\Launch Bar Widgets\Analog Watch.md
ru\User Guide\Scripting\Frontend Basics\Launch Bar Widgets\Note Title Widget.md
ru\User Guide\Scripting\Frontend Basics\Preact\Built-in components.md
ru\User Guide\Scripting\Frontend Basics\Preact\CSS.md
ru\User Guide\Scripting\Frontend Basics\Preact\Component libraries.md
ru\User Guide\Scripting\Frontend Basics\Preact\Hooks.md
ru\User Guide\Scripting\Script API\Backend API.md
ru\User Guide\Scripting\Script API\Day.js.md
ru\User Guide\Scripting\Script API\Electron API.md
ru\User Guide\Scripting\Script API\Frontend API.md
ru\User Guide\Theme development\Creating a custom theme.md
ru\User Guide\Theme development\Creating an icon pack.md
ru\User Guide\Theme development\Custom app-wide CSS.md
ru\User Guide\Theme development\Customize the Next theme.md
ru\User Guide\Theme development\Reference.md
ru\User Guide\Troubleshooting\Anonymized Database.md
ru\User Guide\Troubleshooting\Error logs.md
ru\User Guide\Troubleshooting\Refreshing the application.md
ru\User Guide\Troubleshooting\Reporting issues.md
ru\User Guide\Troubleshooting\Synchronization fails with 504 Gateway Timeout.md
ru\User Guide\Troubleshooting\Error logs\Backend (server) logs.md
ru\User Guide\Troubleshooting\Error logs\Frontend logs.md
```

(если список выше расходится с фактическим — актуальный перечень всегда можно получить
как `comm -23 <(find "docs/User Guide/ru" -name "*.md" | sort) <(sort список_готовых)`,
либо просто поискать по файлам с английским заголовком `# ` первой строкой.)
