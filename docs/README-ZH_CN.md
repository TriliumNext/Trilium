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

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Chinese (Simplified Han script)](./README-ZH_CN.md) | [Chinese (Traditional Han
script)](./README-ZH_TW.md) | [English](../README.md) | [French](./README-fr.md)
| [German](./README-de.md) | [Greek](./README-el.md) | [Italian](./README-it.md)
| [Japanese](./README-ja.md) | [Romanian](./README-ro.md) |
[Spanish](./README-es.md)
<!-- translate:on -->

Trilium Notes 是一款免费且开源、跨平台的阶层式笔记应用程序，专注于建立大型个人知识库。

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ 下载
- [最新版本](https://github.com/TriliumNext/Trilium/releases/latest) –
  稳定版本，推荐给大多数用户。
- [每日构建](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  不稳定开发版本，每日更新，包含最新功能与修复。

## 📖 文件

**请访问我们完整的文档：[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

我们的文档有多种格式可供使用：
- **在线文档**：请访问我们完整的文档：[docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **应用内帮助**：在 Trilium 中按下`F1`即可直接在应用程序内访问相同文档
- **GitHub**：浏览此存储库中的[用户指南](./User%20Guide/User%20Guide/)

### 快速链接
- [用户说明](https://docs.triliumnotes.org/)
- [安装说明](https://docs.triliumnotes.org/user-guide/setup)
- [Docker
  设置](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [升级 TriliumNext](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [基本概念与特性](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [个人知识库模式](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 功能

* 笔记可组织成任意深度的树形结构。单一笔记可放在树中的多个位置（参见
  [笔记复制/克隆](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* 丰富的所见即所得（WYSIWYG）笔记编辑器，支持表格、图片与[数学公式](https://docs.triliumnotes.org/user-guide/note-types/text)，并具备
  Markdown
  的[自动格式](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
* 支持编辑[程序代码笔记](https://docs.triliumnotes.org/user-guide/note-types/code),
  ，包含语法高亮
* 快速、轻松地在笔记间[导航](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation)、全文搜索，以及[笔记聚焦（hoisting）](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* 无缝的[笔记版本管理](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* 笔记[属性](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)可用于笔记的组织、查询与高级[脚本](https://docs.triliumnotes.org/user-guide/scripts)
* 接口提供英文、德文、西班牙文、法文、罗马尼亚文与中文（简体与正体）
* 直接整合[OpenID 与 TOTP](https://docs.triliumnotes.org/user-guide/setup/server/mfa)
  以实现更安全的登录
* 与自架的同步服务器进行[同步](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  * 有[第三方服务用于托管同步服务器](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* 将笔记[分享](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)（公开发布）到互联网
* 以每则笔记为粒度的强大
  [笔记加密](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
* 手绘/示意图：基于 [Excalidraw](https://excalidraw.com/) （笔记类型为「canvas」）
* 用于可视化笔记及其关系的[关系图](https://docs.triliumnotes.org/user-guide/note-types/relation-map)和[笔记/链接图](https://docs.triliumnotes.org/user-guide/note-types/note-map)
* 思维导图：基于[Mind Elixir](https://docs.mind-elixir.com/)
* 具有定位钉与 GPX
  轨迹的[地图](https://docs.triliumnotes.org/user-guide/collections/geomap)
* [脚本](https://docs.triliumnotes.org/user-guide/scripts) - 参见
  [高级展示](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* 用于自动化的 [REST
  API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi)
* 在可用性与效能上均可良好扩展，支持超过 100,000 笔笔记
* 为手机与平板优化的[移动前端](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend)
* 内置[深色主题](https://docs.triliumnotes.org/user-guide/concepts/themes)
* [Evernote
  导入](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)与
  [Markdown
  导入与导出](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* 用于快速保存网页内容的 [Web
  Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper)
* 可自定义的 UI（侧边栏按钮、用户自定义小组件等）
* [Metrics](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics)，以及
  Grafana 仪表板。

✨ 想要更多 TriliumNext 的主题、脚本、外挂与资源，亦可参考以下第三方资源／社群：

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) （第三方主题、脚本、外挂与更多）。
- [TriliumRocks!](https://trilium.rocks/) （教学、指南等等）。

## ⚠️ 为什么是 TriliumNext？

Trilium 的原始开发者（[Zadam](https://github.com/zadam)）已慷慨地将 Trilium
代码库移交至社区项目，该项目现托管于：https://github.com/TriliumNext

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

[![打包状态](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

你也可以从[最新释出页面](https://github.com/TriliumNext/Trilium/releases/latest)下载对应平台的二进制文件，解压缩后执行
`trilium` 可执行文件。

TriliumNext 也提供 Flatpak，惟尚未发布到 FlatHub。

### 浏览器（任何操作系统）

若你有（如下所述的）服务器安装，便可直接存取网页界面（其与桌面应用几乎相同）。

目前仅支持（并实测）最新版的 Chrome 与 Firefox。

### 移动装置

若要在行动装置上使用 TriliumNext，你可以透过移动查看器存取服务器安装的移动版接口（见下）。

有关移动应用支持的更多信息，请参阅问题 https://github.com/TriliumNext/Trilium/issues/4962。

如果你偏好原生 Android 应用，可使用
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid)。回报问题或缺少的功能，请至[其储存库](https://github.com/FliegendeWurst/TriliumDroid)。

### 服务器

若要在你自己的服务器上安装 TriliumNext（包括从 [Docker
Hub](https://hub.docker.com/r/triliumnext/trilium) 使用 Docker
部署），请遵循[服务器安装文件](https://docs.triliumnotes.org/user-guide/setup/server)。


## 💻 贡献

### 翻译

如果你是母语人士，欢迎前往我们的 [Weblate 页面](https://hosted.weblate.org/engage/trilium/)协助翻译
Trilium。

以下是目前的语言覆盖状态：

[![翻译状态](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

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

### 开发者文档

详情请参阅[文档指南](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)。如有更多疑问，欢迎通过上方“联系我们”部分提供的链接与我们沟通。

## 👏 鸣谢

* [zadam](https://github.com/zadam) 对于应用程序的原始概念设计与实现。
* [Sarah Hussein](https://github.com/Sarah-Hussein) 为应用程序设计图标。
* [nriver](https://github.com/nriver) 对其在国际化工作中的贡献。
* [Thomas Frei](https://github.com/thfrei) 因其在 Canvas 方面的原创工作。
* [antoniotejada](https://github.com/nriver) 原始语法高亮小部件的作者。
* [Dosu](https://dosu.dev/) 为我们提供 GitHub 问题和讨论的自动化回复。
* [Tabler Icons](https://tabler.io/icons) 用于系统托盘图标。

若没有支撑其背后的技术，Trilium 项目便无法实现：

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) ——
  文本笔记背后的可视化编辑器。我们非常感谢能获得这套高级功能的使用权限。
* [CodeMirror](https://github.com/codemirror/CodeMirror) —— 支持海量编程语言的代码编辑器。
* [Excalidraw](https://github.com/excalidraw/excalidraw) —— 画布笔记中使用的无限白板。
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) —— 提供思维导图功能。
* [Leaflet](https://github.com/Leaflet/Leaflet) —— 用于渲染地理地图。
* [Tabulator](https://github.com/olifolkerd/tabulator) —— 用于集合中的交互式表格。
* [FancyTree](https://github.com/mar10/fancytree) —— 功能丰富的树形控件库，无可匹敌。
* [jsPlumb](https://github.com/jsplumb/jsplumb) ——
  可视化连接库。用于[关系图](https://docs.triliumnotes.org/user-guide/note-types/relation-map)和[链接图](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 支持我们

Trilium
的开发与维护凝聚了[数百小时的工作](https://github.com/TriliumNext/Trilium/graphs/commit-activity)。你的支持将确保其开源性质，推动功能改进，并覆盖托管等相关成本。

请考虑通过以下方式支持该应用程序的主要开发者（[eliandoran](https://github.com/eliandoran)）：

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 授权条款

Copyright 2017–2025 zadam、Elian Doran 与其他贡献者

本程序系自由软件：你可以在自由软件基金会（Free Software Foundation）所发布的 GNU Affero 通用公众授权条款（GNU
AGPL）第 3 版或（由你选择）任何后续版本之条款下重新散布或修改本程序。
