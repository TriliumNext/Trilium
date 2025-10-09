# Trilium Notes

![GitHub Sponsors](https://img.shields.io/github/sponsors/eliandoran)
![LiberaPay patrons](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Docker Pulls](https://img.shields.io/docker/pulls/triliumnext/trilium)
![GitHub Downloads (all assets, all
releases)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Translation
status](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

[英文](./README.md) | [簡體中文](./docs/README-ZH_CN.md) |
[正體中文](./docs/README-ZH_TW.md) | [俄文](./docs/README-ru.md) |
[日文](./docs/README-ja.md) | [義大利文](./docs/README-it.md) |
[西班牙文](./docs/README-es.md)

Trilium Notes 是一款免費且開源、跨平台的階層式筆記應用程式，專注於建立大型個人知識庫。

想快速了解，請查看[螢幕截圖](https://triliumnext.github.io/Docs/Wiki/screenshot-tour)：

<a href="https://triliumnext.github.io/Docs/Wiki/screenshot-tour"><img src="./docs/app.png" alt="Trilium Screenshot" width="1000"></a>

## 📚 文件

**可以在 [docs.triliumnotes.org](https://docs.triliumnotes.org/) 查看完整使用說明**

我們的使用說明包含多種格式：
- **線上文件**：可於 [docs.triliumnotes.org](https://docs.triliumnotes.org/) 查看完整使用說明
- **In-App Help**: Press `F1` within Trilium to access the same documentation
  directly in the application
- **GitHub**: Navigate through the [User
  Guide](./docs/User%20Guide/User%20Guide/) in this repository

### 快速連結
- [上手指南](https://docs.triliumnotes.org/)
- [安裝說明](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation.md)
- [Docker
  設定](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md)
- [升級
  TriliumNext](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Upgrading%20TriliumNext.md)
- [基礎觀念與功能](./docs/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Notes.md)
- [Patterns of Personal Knowledge
  Base](https://triliumnext.github.io/Docs/Wiki/patterns-of-personal-knowledge)

## 🎁 功能

* 筆記可組織成任意深度的樹狀結構。單一筆記可放在樹中的多個位置（參見[筆記克隆](https://triliumnext.github.io/Docs/Wiki/cloning-notes)）
* 豐富的所見即所得（WYSIWYG）筆記編輯器，支援表格、圖片與[數學公式](https://triliumnext.github.io/Docs/Wiki/text-notes)，並具備
  Markdown
  的[自動格式化](https://triliumnext.github.io/Docs/Wiki/text-notes#autoformat)
* 支援編輯[程式碼筆記](https://triliumnext.github.io/Docs/Wiki/code-notes)，包含語法高亮
* 快速、輕鬆地在筆記間[導航](https://triliumnext.github.io/Docs/Wiki/note-navigation)、全文搜尋，以及[筆記聚焦（hoisting）](https://triliumnext.github.io/Docs/Wiki/note-hoisting)
* 無縫的[筆記版本管理](https://triliumnext.github.io/Docs/Wiki/note-revisions)
* 筆記[屬性](https://triliumnext.github.io/Docs/Wiki/attributes)可用於筆記的組織、查詢與進階[腳本](https://triliumnext.github.io/Docs/Wiki/scripts)
* 介面提供英文、德文、西班牙文、法文、羅馬尼亞文與中文（簡體與正體）
* 直接[整合 OpenID 與
  TOTP](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/Multi-Factor%20Authentication.md)
  以實現更安全的登入
* 與自架的同步伺服器進行[同步](https://triliumnext.github.io/Docs/Wiki/synchronization)
  * 另有[第三方同步伺服器託管服務](https://trilium.cc/paid-hosting)
* 將筆記[分享](https://triliumnext.github.io/Docs/Wiki/sharing)（公開發布）到網際網路
* 以每則筆記為粒度的強大[筆記加密](https://triliumnext.github.io/Docs/Wiki/protected-notes)
* 手繪/示意圖：基於 [Excalidraw](https://excalidraw.com/)（筆記類型為「canvas」）
* 用於視覺化筆記及其關係的[關聯圖](https://triliumnext.github.io/Docs/Wiki/relation-map)與[連結圖](https://triliumnext.github.io/Docs/Wiki/link-map)
* 心智圖：基於 [Mind Elixir](https://docs.mind-elixir.com/)
* 具有定位釘與 GPX 軌跡的[地圖](./docs/User%20Guide/User%20Guide/Note%20Types/Geo%20Map.md)
* [腳本](https://triliumnext.github.io/Docs/Wiki/scripts)——參見[進階展示](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)
* 用於自動化的 [REST API](https://triliumnext.github.io/Docs/Wiki/etapi)
* 在可用性與效能上均可良好擴展，支援超過十萬筆筆記
* 為手機與平板最佳化的[行動前端](https://triliumnext.github.io/Docs/Wiki/mobile-frontend)
* 內建[深色主題](https://triliumnext.github.io/Docs/Wiki/themes)，並支援自訂主題
* [Evernote 匯入](https://triliumnext.github.io/Docs/Wiki/evernote-import)與
  [Markdown 匯入與匯出](https://triliumnext.github.io/Docs/Wiki/markdown)
* 用於快速保存網頁內容的 [Web Clipper](https://triliumnext.github.io/Docs/Wiki/web-clipper)
* 可自訂的 UI（側邊欄按鈕、使用者自訂小工具等）
* [度量指標（Metrics）](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics.md)，並附有
  [Grafana
  儀表板](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics/grafana-dashboard.json)

✨ 想要更多 Trilium Notes 的主題、腳本、外掛與資源，亦可參考以下第三方資源 / 社群：

- [awesome-trilium](https://github.com/Nriver/awesome-trilium)（第三方主題、腳本、外掛與更多）。
- [TriliumRocks!](https://trilium.rocks/)（教學、指南等等）。

## ❓為什麼是 TriliumNext？

The original Trilium developer ([Zadam](https://github.com/zadam)) has
graciously given the Trilium repository to the community project which resides
at https://github.com/TriliumNext

### ⬆️從 Zadam/Trilium 遷移？

從既有的 zadam/Trilium 例項遷移到 TriliumNext/Notes 不需要特別的遷移步驟。只要照一般方式[安裝
TriliumNext/Notes](#-installation)，它就會直接使用你現有的資料庫。

版本最高至 [v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) 與
zadam/trilium 最新版本
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7) 相容。之後的
TriliumNext 版本已提升同步版本號（與上述不再相容）。

## 💬 與我們交流

歡迎加入官方社群。我們很樂意聽到你對功能、建議或問題的想法！

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org)（同步討論）
  - `General` Matrix 房間也橋接到 [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [GitHub
  Discussions](https://github.com/TriliumNext/Trilium/discussions)（非同步討論。）
- [GitHub Issues](https://github.com/TriliumNext/Trilium/issues)（回報錯誤與提出功能需求。）

## 🏗 安裝

### Windows / MacOS

從[最新釋出頁面](https://github.com/TriliumNext/Trilium/releases/latest)下載您平台的二進位檔，解壓縮後執行
`trilium` 可執行檔。

### Linux

如果您的發行版如下表所列，請使用該發行版的套件。

[![打包狀態](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

您也可以從[最新釋出頁面](https://github.com/TriliumNext/Trilium/releases/latest)下載對應平台的二進位檔，解壓縮後執行
`trilium` 可執行檔。

TriliumNext 也提供 Flatpak，惟尚未發佈到 FlatHub。

### 瀏覽器（任何作業系統）

若您有（如下所述的）伺服器安裝，便可直接存取網頁介面（其與桌面應用幾乎相同）。

目前僅支援（並實測）最新版的 Chrome 與 Firefox。

### 行動裝置

若要在行動裝置上使用 TriliumNext，你可以透過行動瀏覽器存取伺服器安裝的行動版介面（見下）。

更多關於行動應用支援的資訊，請見議題：https://github.com/TriliumNext/Trilium/issues/4962。

If you prefer a native Android app, you can use
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Report bugs and missing features at [their
repository](https://github.com/FliegendeWurst/TriliumDroid). Note: It is best to
disable automatic updates on your server installation (see below) when using
TriliumDroid since the sync version must match between Trilium and TriliumDroid.

### 伺服器

若要在您自己的伺服器上安裝 TriliumNext（包括從 [Docker
Hub](https://hub.docker.com/r/triliumnext/trilium) 使用 Docker
部署），請遵循[伺服器安裝文件](https://triliumnext.github.io/Docs/Wiki/server-installation)。


## 💻 貢獻

### 翻譯

如果您是母語人士，歡迎前往我們的 [Weblate 頁面](https://hosted.weblate.org/engage/trilium/)協助翻譯
Trilium。

以下是目前的語言覆蓋狀態：

[![翻譯狀態](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### 程式碼

下載儲存庫，使用 `pnpm` 安裝相依套件，接著啟動伺服器（將於 http://localhost:8080 提供服務）：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### 文件

下載儲存庫，使用 `pnpm` 安裝相依套件，接著啟動編輯文件所需的環境：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### 建置桌面可執行檔
下載儲存庫，使用 `pnpm` 安裝相依套件，然後為 Windows 建置桌面應用：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

更多細節請參見[開發者文件](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide)。

### 開發者文件

請參閱[環境設定指南](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)。若有更多疑問，歡迎透過上方「與我們交流」章節所列連結與我們聯繫。

## 👏 鳴謝

* [zadam](https://github.com/zadam) for the original concept and implementation
  of the application.
* [Sarah Hussein](https://github.com/Sarah-Hussein) for designing the
  application icon.
* [nriver](https://github.com/nriver) for his work on internationalization.
* [Thomas Frei](https://github.com/thfrei) for his original work on the Canvas.
* [antoniotejada](https://github.com/nriver) for the original syntax highlight
  widget.
* [Dosu](https://dosu.dev/) for providing us with the automated responses to
  GitHub issues and discussions.
* [Tabler Icons](https://tabler.io/icons) for the system tray icons.

Trilium would not be possible without the technologies behind it:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - the visual editor behind
  text notes. We are grateful for being offered a set of the premium features.
* [CodeMirror](https://github.com/codemirror/CodeMirror) —— 支援大量語言的程式碼編輯器。
* [Excalidraw](https://github.com/excalidraw/excalidraw) - the infinite
  whiteboard used in Canvas notes.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - providing the
  mind map functionality.
* [Leaflet](https://github.com/Leaflet/Leaflet) - for rendering geographical
  maps.
* [Tabulator](https://github.com/olifolkerd/tabulator) - for the interactive
  table used in collections.
* [FancyTree](https://github.com/mar10/fancytree) —— 功能非常豐富的樹狀元件，幾乎沒有對手。
* [jsPlumb](https://github.com/jsplumb/jsplumb) ——
  視覺連線函式庫。用於[關聯圖](https://triliumnext.github.io/Docs/Wiki/relation-map.html)與[連結圖](https://triliumnext.github.io/Docs/Wiki/note-map.html#link-map)

## 🤝 支援我們

Trilium is built and maintained with [hundreds of hours of
work](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Your
support keeps it open-source, improves features, and covers costs such as
hosting.

Consider supporting the main developer
([eliandoran](https://github.com/eliandoran)) of the application via:

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 授權條款

Copyright 2017–2025 zadam、Elian Doran 與其他貢獻者

本程式係自由軟體：您可以在自由軟體基金會（Free Software Foundation）所發佈的 GNU Affero 通用公眾授權條款（GNU
AGPL）第 3 版或（由你選擇）任何後續版本之條款下重新散布或修改本程式。
