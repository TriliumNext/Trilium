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
![GitHub Downloads
(所有资产，所有历史版本)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![翻译状态](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

[英文](./README.md) | [简体中文](./docs/README-ZH_CN.md) |
[正体中文](./docs/README-ZH_TW.md) | [俄文](./docs/README-ru.md) |
[日文](./docs/README-ja.md) | [意大利文](./docs/README-it.md) |
[西班牙文](./docs/README-es.md)

Trilium Notes 是一款免费且开源、跨平台的阶层式笔记应用程序，专注于建立大型个人知识库。

想快速了解，请查看[screenshots](https://triliumnext.github.io/Docs/Wiki/screenshot-tour):

<a href="https://triliumnext.github.io/Docs/Wiki/screenshot-tour"><img src="./docs/app.png" alt="Trilium Screenshot" width="1000"></a>

## 📖 文件

**请访问我们完整的文档：[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

我们的文档有多种格式可供使用：
- **在线文档**：请访问我们完整的文档：[docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **In-App Help**: Press `F1` within Trilium to access the same documentation
  directly in the application
- **GitHub**: Navigate through the [User
  Guide](./docs/User%20Guide/User%20Guide/) in this repository

### Quick Links
- [Getting Started Guide](https://docs.triliumnotes.org/)
- [Installation
  Instructions](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation.md)
- [Docker
  Setup](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md)
- [Upgrading
  TriliumNext](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Upgrading%20TriliumNext.md)
- [Basic Concepts and
  Features](./docs/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Notes.md)
- [Patterns of Personal Knowledge
  Base](https://triliumnext.github.io/Docs/Wiki/patterns-of-personal-knowledge)

## 🎁 功能

* 笔记可组织成任意深度的树形结构。单一笔记可放在树中的多个位置（参见
  [笔记复制/克隆](https://triliumnext.github.io/Docs/Wiki/cloning-notes))
* 丰富的所见即所得（WYSIWYG）笔记编辑器，支持表格、图片与[数学公式](https://triliumnext.github.io/Docs/Wiki/text-notes)，并具备
  Markdown
  的[自动格式](https://triliumnext.github.io/Docs/Wiki/text-notes#autoformat)
* 支持编辑[程序代码笔记](https://triliumnext.github.io/Docs/Wiki/code-notes), ，包含语法高亮
* 快速、轻松地在笔记间[导航](https://triliumnext.github.io/Docs/Wiki/note-navigation)、全文搜索，以及[笔记聚焦（hoisting）](https://triliumnext.github.io/Docs/Wiki/note-hoisting)
* 无缝的[笔记版本管理](https://triliumnext.github.io/Docs/Wiki/note-revisions)
* 笔记[属性](https://triliumnext.github.io/Docs/Wiki/attributes)可用于笔记的组织、查询与高级[脚本](https://triliumnext.github.io/Docs/Wiki/scripts)
* 接口提供英文、德文、西班牙文、法文、罗马尼亚文与中文（简体与正体）
* 直接整合[OpenID 与
  TOTP](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/Multi-Factor%20Authentication.md)
  以实现更安全的登录
* 与自架的同步服务器进行[同步](https://triliumnext.github.io/Docs/Wiki/synchronization)
  * 另有[3rd party service for hosting synchronisation
    server](https://trilium.cc/paid-hosting)
* 将笔记[分享](https://triliumnext.github.io/Docs/Wiki/sharing)（公开发布）到互联网
* 以每则笔记为粒度的强大 [笔记加密](https://triliumnext.github.io/Docs/Wiki/protected-notes)
* 手绘/示意图：基于 [Excalidraw](https://excalidraw.com/) （笔记类型为「canvas」）
* 用于可视化笔记及其关系的[关系图](https://triliumnext.github.io/Docs/Wiki/relation-map)与[链接图](https://triliumnext.github.io/Docs/Wiki/link-map)
* 思维导图：基于[Mind Elixir](https://docs.mind-elixir.com/)
* 具有定位钉与 GPX 轨迹的[地图](./docs/User%20Guide/User%20Guide/Note%20Types/Geo%20Map.md)
* [脚本](https://triliumnext.github.io/Docs/Wiki/scripts) - 参见
  [高级展示](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)
* 用于自动化的 [REST API](https://triliumnext.github.io/Docs/Wiki/etapi)
* 在可用性与效能上均可良好扩展，支持超过 100,000 笔笔记
* 为手机与平板优化的[移动前端](https://triliumnext.github.io/Docs/Wiki/mobile-frontend)
* 内置[深色主题](https://triliumnext.github.io/Docs/Wiki/themes)
* [Evernote 导入](https://triliumnext.github.io/Docs/Wiki/evernote-import)与
  [Markdown 导入与导出](https://triliumnext.github.io/Docs/Wiki/markdown)
* 用于快速保存网页内容的 [Web Clipper](https://triliumnext.github.io/Docs/Wiki/web-clipper)
* 可自定义的 UI（侧边栏按钮、用户自定义小组件等）
* [度量指标（Metrics）](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics.md)，并附有
  [Grafana
  仪表板](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics/grafana-dashboard.json)

✨ 想要更多 TriliumNext 的主题、脚本、外挂与资源，亦可参考以下第三方资源／社群：

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) （第三方主题、脚本、外挂与更多）。
- [TriliumRocks!](https://trilium.rocks/) （教学、指南等等）。

## ⚠️ 为什么是 TriliumNext？

The original Trilium developer ([Zadam](https://github.com/zadam)) has
graciously given the Trilium repository to the community project which resides
at https://github.com/TriliumNext

### ⬆️ 从 Trilium 迁移？

从既有的 zadam/Trilium 例项迁移到 TriliumNext/Notes 不需要特别的迁移步骤。只要[照一般方式安装
TriliumNext/Notes](#-installation)(#-安装)，它就会直接使用你现有的数据库。

版本至多至 [v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) 与
zadam/trilium 最新版本
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7)兼容。之后的
TriliumNext 版本已提升同步版本号（与上述不再兼容）。

## 💬 与我们交流

欢迎加入官方社群。我们很乐意听到你对功能、建议或问题的想法！

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org)（同步讨论）
  - `General` Matrix 房间也桥接到 [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [GitHub
  Discussions](https://github.com/TriliumNext/Trilium/discussions)（异步讨论）。
- [GitHub Issues](https://github.com/TriliumNext/Trilium/issues)（回报错误与提出功能需求）。

## 🏗 安装

### Windows / macOS

从[最新释出页面](https://github.com/TriliumNext/Trilium/releases/latest)下载你平台的二进制文件，解压缩后执行
`trilium` 可执行文件。

### Linux

如果你的发行版如下表所列，请使用该发行版的套件。

[![Packaging
status](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

你也可以从[最新释出页面](https://github.com/TriliumNext/Trilium/releases/latest)下载对应平台的二进制文件，解压缩后执行
`trilium` 可执行文件。

TriliumNext 也提供 Flatpak，惟尚未发布到 FlatHub。

### 浏览器（任何操作系统）

若你有（如下所述的）服务器安装，便可直接存取网页界面（其与桌面应用几乎相同）。

目前仅支持（并实测）最新版的 Chrome 与 Firefox。

### 移动装置

若要在行动装置上使用 TriliumNext，你可以透过移动查看器存取服务器安装的移动版接口（见下）。

See issue https://github.com/TriliumNext/Trilium/issues/4962 for more
information on mobile app support.

如果你偏好原生 Android 应用，可使用
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid)。回报问题或缺少的功能，请至[其储存库](https://github.com/FliegendeWurst/TriliumDroid)。

### 服务器

若要在你自己的服务器上安装 TriliumNext（包括从 [Docker
Hub](https://hub.docker.com/r/triliumnext/trilium) 使用 Docker
部署），请遵循[服务器安装文件](https://triliumnext.github.io/Docs/Wiki/server-installation)。


## 💻 贡献

### 翻译

如果你是母语人士，欢迎前往我们的 [Weblate 页面](https://hosted.weblate.org/engage/trilium/)协助翻译
Trilium。

以下是目前的语言覆盖状态：

[![Translation
status](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### 程序代码

下载储存库，使用 `pnpm` 安装相依套件，接着启动服务器（于 http://localhost:8080 提供服务）：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### 文件

下载储存库，使用 `pnpm` 安装相依套件，接着启动编辑文件所需的环境：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### 建置桌面可执行文件
下载储存库，使用 `pnpm` 安装相依套件，然后为 Windows 建置桌面应用：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

更多细节请参见[开发文件](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide)。

### Developer Documentation

Please view the [documentation
guide](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
for details. If you have more questions, feel free to reach out via the links
described in the "Discuss with us" section above.

## 👏 鸣谢

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
* [CodeMirror](https://github.com/codemirror/CodeMirror) - code editor with
  support for huge amount of languages.
* [Excalidraw](https://github.com/excalidraw/excalidraw) - the infinite
  whiteboard used in Canvas notes.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - providing the
  mind map functionality.
* [Leaflet](https://github.com/Leaflet/Leaflet) - for rendering geographical
  maps.
* [Tabulator](https://github.com/olifolkerd/tabulator) - for the interactive
  table used in collections.
* [FancyTree](https://github.com/mar10/fancytree) - feature-rich tree library
  without real competition.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - visual connectivity library.
  Used in [relation
  maps](https://triliumnext.github.io/Docs/Wiki/relation-map.html) and [link
  maps](https://triliumnext.github.io/Docs/Wiki/note-map.html#link-map)

## 🤝 支持我们

Trilium is built and maintained with [hundreds of hours of
work](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Your
support keeps it open-source, improves features, and covers costs such as
hosting.

Consider supporting the main developer
([eliandoran](https://github.com/eliandoran)) of the application via:

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 授权条款

Copyright 2017–2025 zadam、Elian Doran 与其他贡献者

本程序系自由软件：你可以在自由软件基金会（Free Software Foundation）所发布的 GNU Affero 通用公众授权条款（GNU
AGPL）第 3 版或（由你选择）任何后续版本之条款下重新散布或修改本程序。
