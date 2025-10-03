# Trilium Notes

![GitHub Sponsors](https://img.shields.io/github/sponsors/eliandoran) ![LiberaPay patrons](https://img.shields.io/liberapay/patrons/ElianDoran)  
![Docker Pulls](https://img.shields.io/docker/pulls/triliumnext/notes)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/triliumnext/notes/total)  
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp) [![Translation status](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

[英文](../README.md) | [簡體中文](./README-ZH_CN.md) | [正體中文](./README-ZH_TW.md) | [俄文](./README.ru.md) | [日文](./README.ja.md) | [義大利文](./README.it.md) | [西班牙文](./README.es.md)

Trilium Notes 是一款免費且開源、跨平台的階層式筆記應用程式，專注於建立大型個人知識庫。

想快速了解，請查看[螢幕截圖](https://triliumnext.github.io/Docs/Wiki/screenshot-tour)：

<a href="https://triliumnext.github.io/Docs/Wiki/screenshot-tour"><img src="./app.png" alt="Trilium Screenshot" width="1000"></a>

## 🎁 功能

* 筆記可組織成任意深度的樹狀結構。單一筆記可放在樹中的多個位置（參見[筆記複製/克隆](https://triliumnext.github.io/Docs/Wiki/cloning-notes)）。
* 豐富的所見即所得（WYSIWYG）筆記編輯器，支援表格、圖片與[數學公式](https://triliumnext.github.io/Docs/Wiki/text-notes)，並具備 Markdown 的[自動格式化](https://triliumnext.github.io/Docs/Wiki/text-notes#autoformat)。
* 支援編輯[程式碼筆記](https://triliumnext.github.io/Docs/Wiki/code-notes)，包含語法高亮。 
* 快速、輕鬆地在筆記間[導航](https://triliumnext.github.io/Docs/Wiki/note-navigation)、全文搜尋，以及[筆記聚焦（hoisting）](https://triliumnext.github.io/Docs/Wiki/note-hoisting)。
* 無縫的[筆記版本管理](https://triliumnext.github.io/Docs/Wiki/note-revisions)。
* 筆記[屬性](https://triliumnext.github.io/Docs/Wiki/attributes)可用於筆記的組織、查詢與進階[腳本](https://triliumnext.github.io/Docs/Wiki/scripts)。
* 介面提供英文、德文、西班牙文、法文、羅馬尼亞文與中文（簡體與正體）。
* 直接整合 [OpenID 與 TOTP](./User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/Multi-Factor%20Authentication.md) 以實現更安全的登入。
* 與自架的同步伺服器進行[同步](https://triliumnext.github.io/Docs/Wiki/synchronization)  
  * 另有[第三方同步伺服器託管服務](https://trilium.cc/paid-hosting)。
* 將筆記[分享](https://triliumnext.github.io/Docs/Wiki/sharing)（公開發布）到網際網路。
* 以每則筆記為粒度的強大[筆記加密](https://triliumnext.github.io/Docs/Wiki/protected-notes)。
* 手繪/示意圖：基於 [Excalidraw](https://excalidraw.com/)（筆記類型為「canvas」）。
* 用於視覺化筆記及其關係的[關聯圖](https://triliumnext.github.io/Docs/Wiki/relation-map)與[連結圖](https://triliumnext.github.io/Docs/Wiki/link-map)。
* 心智圖：基於 [Mind Elixir](https://docs.mind-elixir.com/)。
* 具有定位釘與 GPX 軌跡的[地圖](./User%20Guide/User%20Guide/Note%20Types/Geo%20Map.md)。
* [腳本](https://triliumnext.github.io/Docs/Wiki/scripts)——參見[進階展示](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)。
* 用於自動化的 [REST API](https://triliumnext.github.io/Docs/Wiki/etapi)。
* 在可用性與效能上均可良好擴展，支援超過 100,000 筆筆記。
* 為手機與平板最佳化的[行動前端](https://triliumnext.github.io/Docs/Wiki/mobile-frontend)。
* 內建[深色主題](https://triliumnext.github.io/Docs/Wiki/themes)，並支援使用者主題。
* [Evernote 匯入](https://triliumnext.github.io/Docs/Wiki/evernote-import)與 [Markdown 匯入與匯出](https://triliumnext.github.io/Docs/Wiki/markdown)。
* 用於快速保存網頁內容的 [Web Clipper](https://triliumnext.github.io/Docs/Wiki/web-clipper)。
* 可自訂的 UI（側邊欄按鈕、使用者自訂小工具等）。
* [度量指標（Metrics）](./User%20Guide/User%20Guide/Advanced%20Usage/Metrics.md)，並附有 [Grafana 儀表板](./User%20Guide/User%20Guide/Advanced%20Usage/Metrics/grafana-dashboard.json)。

✨ 想要更多 TriliumNext 的主題、腳本、外掛與資源，亦可參考以下第三方資源／社群：

- [awesome-trilium](https://github.com/Nriver/awesome-trilium)（第三方主題、腳本、外掛與更多）。
- [TriliumRocks!](https://trilium.rocks/)（教學、指南等等）。

## ⚠️ 為什麼是 TriliumNext？

[原本的 Trilium 專案目前處於維護模式](https://github.com/zadam/trilium/issues/4620)。

### 從 Trilium 遷移？

從既有的 zadam/Trilium 例項遷移到 TriliumNext/Notes 不需要特別的遷移步驟。只要[照一般方式安裝 TriliumNext/Notes](#-安裝)，它就會直接使用你現有的資料庫。

版本至多至 [v0.90.4](https://github.com/TriliumNext/Notes/releases/tag/v0.90.4) 與 zadam/trilium 最新版本 [v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7) 相容。之後的 TriliumNext 版本已提升同步版本號（與上述不再相容）。

## 📖 文件

我們目前正將文件搬移至應用程式內（在 Trilium 中按 `F1`）。在完成前，文件中可能會有缺漏。如果你想在 GitHub 上瀏覽，也可以直接查看[使用說明](./User%20Guide/User%20Guide/)。

以下提供一些快速連結，方便你導覽文件：
- [伺服器安裝](./User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation.md)
  - [Docker 安裝](./User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md)
- [升級 TriliumNext](./User%20Guide/User%20Guide/Installation%20%26%20Setup/Upgrading%20TriliumNext.md)
- [基本概念與功能－筆記](./User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Notes.md)
- [個人知識庫的模式](https://triliumnext.github.io/Docs/Wiki/patterns-of-personal-knowledge)

在我們完成重新整理文件架構之前，你也可以[瀏覽舊版文件](https://triliumnext.github.io/Docs)。

## 💬 與我們交流

歡迎加入官方社群。我們很樂意聽到你對功能、建議或問題的想法！

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org)（同步討論）  
  - `General` Matrix 房間也橋接到 [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [GitHub Discussions](https://github.com/TriliumNext/Notes/discussions)（非同步討論）。
- [GitHub Issues](https://github.com/TriliumNext/Notes/issues)（回報錯誤與提出功能需求）。

## 🏗 安裝

### Windows / macOS

從[最新釋出頁面](https://github.com/TriliumNext/Trilium/releases/latest)下載你平台的二進位檔，解壓縮後執行 `trilium` 可執行檔。

### Linux

如果你的發行版如下表所列，請使用該發行版的套件。

[![Packaging status](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

你也可以從[最新釋出頁面](https://github.com/TriliumNext/Trilium/releases/latest)下載對應平台的二進位檔，解壓縮後執行 `trilium` 可執行檔。

TriliumNext 也提供 Flatpak，惟尚未發佈到 FlatHub。

### 瀏覽器（任何作業系統）

若你有（如下所述的）伺服器安裝，便可直接存取網頁介面（其與桌面應用幾乎相同）。

目前僅支援（並實測）最新版的 Chrome 與 Firefox。

### 行動裝置

若要在行動裝置上使用 TriliumNext，你可以透過行動瀏覽器存取伺服器安裝的行動版介面（見下）。

如果你偏好原生 Android 應用，可使用 [TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid)。回報問題或缺少的功能，請至[其儲存庫](https://github.com/FliegendeWurst/TriliumDroid)。

更多關於行動應用支援的資訊，請見議題：https://github.com/TriliumNext/Notes/issues/72。

### 伺服器

若要在你自己的伺服器上安裝 TriliumNext（包括從 [Docker Hub](https://hub.docker.com/r/triliumnext/trilium) 使用 Docker 部署），請遵循[伺服器安裝文件](https://triliumnext.github.io/Docs/Wiki/server-installation)。

## 💻 貢獻

### 翻譯

如果你是母語人士，歡迎前往我們的 [Weblate 頁面](https://hosted.weblate.org/engage/trilium/)協助翻譯 Trilium。

以下是目前的語言覆蓋狀態：

[![Translation status](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

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
pnpm --filter=desktop electron-forge:make --arch=x64 --platform=win32
```

更多細節請參見[開發文件](https://github.com/TriliumNext/Notes/blob/develop/docs/Developer%20Guide/Developer%20Guide/Building%20and%20deployment/Running%20a%20development%20build.md)。

### 開發者文件

請參閱[環境設定指南](./Developer%20Guide/Developer%20Guide/Environment%20Setup.md)。若有更多疑問，歡迎透過上方「與我們交流」章節所列連結與我們聯繫。

## 👏 鳴謝

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) —— 業界最佳的所見即所得編輯器，團隊互動積極。
* [FancyTree](https://github.com/mar10/fancytree) —— 功能非常豐富的樹狀元件，幾乎沒有對手。沒有它，Trilium Notes 將不會是今天的樣子。
* [CodeMirror](https://github.com/codemirror/CodeMirror) —— 支援大量語言的程式碼編輯器。
* [jsPlumb](https://github.com/jsplumb/jsplumb) —— 無可匹敵的視覺連線函式庫。用於[關聯圖](https://triliumnext.github.io/Docs/Wiki/relation-map.html)與[連結圖](https://triliumnext.github.io/Docs/Wiki/note-map.html#link-map)。

## 🤝 支援我們

目前尚無法直接贊助 TriliumNext 組織。不過你可以：
- 透過贊助我們的開發者來支持 TriliumNext 的持續開發：[eliandoran](https://github.com/sponsors/eliandoran)（完整清單請見 [repository insights]([developers]([url](https://github.com/TriliumNext/Notes/graphs/contributors)))）
- 透過 [PayPal](https://paypal.me/za4am) 或比特幣（bitcoin:bc1qv3svjn40v89mnkre5vyvs2xw6y8phaltl385d2）向原始的 Trilium 開發者（[zadam](https://github.com/sponsors/zadam)）表達支持。

## 🔑 授權條款

Copyright 2017–2025 zadam、Elian Doran 與其他貢獻者。

本程式係自由軟體：你可以在自由軟體基金會（Free Software Foundation）所發佈的 GNU Affero 通用公眾授權條款（GNU AGPL）第 3 版或（由你選擇）任何後續版本之條款下重新散布或修改本程式。
