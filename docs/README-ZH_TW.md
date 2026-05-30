<div align="center">
	<sup>Special thanks to:</sup><br />
	<a href="https://go.warp.dev/Trilium" target="_blank">		
		<img alt="Warp sponsorship" width="400" src="https://github.com/warpdotdev/brand-assets/blob/main/Github/Sponsor/Warp-Github-LG-03.png"><br />
		Warp, built for coding with multiple AI agents<br />
	</a>
  <sup>Available for macOS, Linux and Windows</sup>
</div>

<hr />

# Trilium Notes

![GitHub Sponsors](https://img.shields.io/github/sponsors/eliandoran)
![LiberaPay patrons](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Docker Pulls](https://img.shields.io/docker/pulls/triliumnext/trilium)
![GitHub Downloads (all assets, all
releases)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![Translation
status](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Arabic](./README-ar.md) | [Chinese (Simplified Han script)](./README-ZH_CN.md)
| [Chinese (Traditional Han script)](./README-ZH_TW.md) |
[Czech](./README-cs.md) | [English (United Kingdom)](./README-en_GB.md) |
[English](../README.md) | [French](./README-fr.md) | [German](./README-de.md) |
[Greek](./README-el.md) | [Irish](./README-ga.md) | [Italian](./README-it.md) |
[Japanese](./README-ja.md) | [Korean](./README-ko.md) | [Polish](./README-pl.md)
| [Romanian](./README-ro.md) | [Russian](./README-ru.md) |
[Spanish](./README-es.md) | [Ukrainian](./README-uk.md) |
[Uyghur](./README-ug.md)
<!-- translate:on -->

Trilium Notes 是一款免費且開源、跨平台的階層式筆記應用程式，專注於建立大型個人知識庫。

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ 下載
- [最新版本](https://github.com/TriliumNext/Trilium/releases/latest) –
  穩定版本，推薦給大多數使用者。
- [夜間構建](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  不穩定開發版本，每日更新最新功能與修復內容。

## 📚 文件

**可以在 [docs.triliumnotes.org](https://docs.triliumnotes.org/) 查看完整使用說明**

我們的使用說明包含多種格式：
- **線上文件**：可於 [docs.triliumnotes.org](https://docs.triliumnotes.org/) 查看完整使用說明
- **應用程式內說明**：在 Trilium 中按下 `F1` 即可直接於應用程式內存取相同文件
- **GitHub**：請參閱此儲存庫中的[使用說明](./User%20Guide/User%20Guide/)

### 快速連結
- [上手指南](https://docs.triliumnotes.org/)
- [安裝說明](https://docs.triliumnotes.org/user-guide/setup)
- [Docker
  設定](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [升級 TriliumNext](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [基礎觀念與功能](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [個人知識庫的模式](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 功能

* 筆記可組織成任意深度的樹狀結構。單一筆記可放在樹中的多個位置（參見[筆記克隆](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning)）
* 豐富的所見即所得（WYSIWYG）筆記編輯器，支援表格、圖片與[數學公式](https://docs.triliumnotes.org/user-guide/note-types/text)，並具備
  Markdown
  的[自動格式化](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
* 支援編輯[程式碼筆記](https://docs.triliumnotes.org/user-guide/note-types/code)，包含語法高亮
* 快速、輕鬆地在筆記間[導航](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation)、全文搜尋，以及[筆記聚焦（hoisting）](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* 無縫的[筆記版本管理](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* 筆記[屬性](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)可用於筆記的組織、查詢與進階[腳本](https://docs.triliumnotes.org/user-guide/scripts)
* 介面提供英文、德文、西班牙文、法文、羅馬尼亞文與中文（簡體與正體）
* 直接[整合 OpenID 與
  TOTP](https://docs.triliumnotes.org/user-guide/setup/server/mfa) 以實現更安全的登入
* 與自架的同步伺服器進行[同步](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  * 有[第三方服務可託管同步伺服器](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* 將筆記[分享](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)（公開發布）到網際網路
* 以每則筆記為粒度的強大[筆記加密](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
* 手繪/示意圖：基於 [Excalidraw](https://excalidraw.com/)（筆記類型為「canvas」）
* [關係圖](https://docs.triliumnotes.org/user-guide/note-types/relation-map) 與
  [筆記/連結圖](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  用於視覺化呈現筆記及其關聯性
* 心智圖：基於 [Mind Elixir](https://docs.mind-elixir.com/)
* 具有定位釘與 GPX
  軌跡的[地圖](https://docs.triliumnotes.org/user-guide/collections/geomap)
* [腳本](https://docs.triliumnotes.org/user-guide/scripts)——參見[進階展示](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* 用於自動化的 [REST
  API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi)
* 在可用性與效能上均可良好擴展，支援超過十萬筆筆記
* 為手機與平板最佳化的[行動前端](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend)
* 內建[深色主題](https://docs.triliumnotes.org/user-guide/concepts/themes)，並支援自訂主題
* [Evernote
  匯入](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)與
  [Markdown
  匯入與匯出](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* 用於快速保存網頁內容的 [Web
  Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper)
* 可自訂的 UI（側邊欄按鈕、使用者自訂小工具等）
* [Metrics](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics)，以及
  Grafana 儀表板。

✨ 想要更多 Trilium Notes 的主題、腳本、外掛與資源，亦可參考以下第三方資源 / 社群：

- [awesome-trilium](https://github.com/Nriver/awesome-trilium)（第三方主題、腳本、外掛與更多）。
- [TriliumRocks!](https://trilium.rocks/)（教學、指南等等）。

## ❓為什麼是 TriliumNext？

原始的 Trilium 開發者 ([Zadam](https://github.com/zadam)) 已慷慨地將 Trilium
儲存庫移交給社群專案，該專案現存放於 https://github.com/TriliumNext

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

[![打包狀態](https://repology.org/badge/vertical-allrepos/trilium.svg)](https://repology.org/project/trilium/versions)

您也可以從[最新釋出頁面](https://github.com/TriliumNext/Trilium/releases/latest)下載對應平台的二進位檔，解壓縮後執行
`trilium` 可執行檔。

TriliumNext 也提供 Flatpak，惟尚未發佈到 FlatHub。

### 瀏覽器（任何作業系統）

若您有（如下所述的）伺服器安裝，便可直接存取網頁介面（其與桌面應用幾乎相同）。

目前僅支援（並實測）最新版的 Chrome 與 Firefox。

### 行動裝置

若要在行動裝置上使用 TriliumNext，你可以透過行動瀏覽器存取伺服器安裝的行動版介面（見下）。

更多關於行動應用支援的資訊，請見議題：https://github.com/TriliumNext/Trilium/issues/4962。

若您偏好原生 Android 應用程式，可使用
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid)。請至
[其儲存庫](https://github.com/FliegendeWurst/TriliumDroid) 回報錯誤與功能缺失。注意：使用
TriliumDroid 時，建議停用伺服器安裝版本的自動更新功能（詳見下文），因 Trilium 與 TriliumDroid 間的同步版本必須保持一致。

### 伺服器

若要在您自己的伺服器上安裝 TriliumNext（包括從 [Docker
Hub](https://hub.docker.com/r/triliumnext/trilium) 使用 Docker
部署），請遵循[伺服器安裝文件](https://docs.triliumnotes.org/user-guide/setup/server)。


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

或者，如果您已安裝 Nix：
```shell
# 直接執行
nix run .#edit-docs

# 或安裝至您的設定檔
nix profile install .#edit-docs
trilium-edit-docs
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

請參閱[文件指南](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)。若有更多疑問，歡迎透過上方「與我們交流」章節所列連結與我們聯繫。

## 💖 贊助者

<table>
  <tr>
    <td align="center" width="25%">
      <a href="https://www.netperfect.fr">
        <img src="https://www.netperfect.fr/sites/default/files/Logo%20NetPerfect%20V4%20250px_0.png" width="64" alt="NetPerfect logo" /><br />
        <b>NetPerfect</b>
      </a>
      <br />EV certificate &amp; Windows CI
    </td>
    <td align="center" width="50%">
      <a href="https://ckeditor.com/ckeditor-5/features/">
        <img src="./logo-ck.svg" width="180" alt="CKEditor logo" /><br />
        <b>CKEditor</b>
      </a>
      <br />Premium editor features
    </td>
    <td align="center" width="25%">
      <a href="https://dosu.dev/">
        <img src="https://dosu.dev/hero-new/dosu-icon.svg" width="64" height="64" alt="Dosu logo" /><br />
        <b>Dosu</b>
      </a>
      <br />Automated GitHub support
    </td>
  </tr>
</table>

## 👏 鳴謝

* [zadam](https://github.com/zadam) 為本應用程式的原始概念與實作。
* [Sarah Hussein](https://github.com/Sarah-Hussein) 為應用程式設計圖示。
* [nriver](https://github.com/nriver) 對其在國際化方面的貢獻。
* [Thomas Frei](https://github.com/thfrei) 對 Canvas 原始作品的貢獻。
* [antoniotejada](https://github.com/nriver) 為原始語法高亮小工具的貢獻。
* [Tabler Icons](https://tabler.io/icons) 用於系統匣圖示。

若無其背後的技術支撐，Trilium 便無法開發完成：

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) —— 文字筆記背後所採用的視覺化編輯器。
* [CodeMirror](https://github.com/codemirror/CodeMirror) —— 支援大量語言的程式碼編輯器。
* [Excalidraw](https://github.com/excalidraw/excalidraw) —— 畫布筆記中使用的無限白板。
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) —— 提供心智圖功能。
* [Leaflet](https://github.com/Leaflet/Leaflet) —— 用於渲染地理地圖。
* [Tabulator](https://github.com/olifolkerd/tabulator) —— 用於集合中的互動式表格。
* [FancyTree](https://github.com/mar10/fancytree) —— 功能非常豐富的樹狀元件，無可匹敵。
* [jsPlumb](https://github.com/jsplumb/jsplumb) ——
  視覺連線函式庫。用於[關聯圖](https://docs.triliumnotes.org/user-guide/note-types/relation-map)與[連結圖](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 支援我們

Trilium
的開發與維護耗費了[數百小時的工作時間](https://github.com/TriliumNext/Trilium/graphs/commit-activity)。您的支持能確保其開源性質、提升功能品質，並支付伺服器託管等相關成本。

請考慮透過以下方式支持本應用程式的主要開發者 ([eliandoran](https://github.com/eliandoran))：

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 授權條款

Copyright 2017–2025 zadam、Elian Doran 與其他貢獻者

本程式係自由軟體：您可以在自由軟體基金會（Free Software Foundation）所發佈的 GNU Affero 通用公眾授權條款（GNU
AGPL）第 3 版或（由你選擇）任何後續版本之條款下重新散布或修改本程式。
