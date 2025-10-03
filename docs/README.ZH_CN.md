# Trilium Notes

![GitHub Sponsors](https://img.shields.io/github/sponsors/eliandoran) ![LiberaPay patrons](https://img.shields.io/liberapay/patrons/ElianDoran)  
![Docker Pulls](https://img.shields.io/docker/pulls/triliumnext/notes)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/triliumnext/notes/total)  
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp) [![Translation status](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

[英文](../README.md) | [简体中文](./README-ZH_CN.md) | [正体中文](./README-ZH_TW.md) | [俄文](./README.ru.md) | [日文](./README.ja.md) | [意大利文](./README.it.md) | [西班牙文](./README.es.md)

Trilium Notes 是一款免费且开源、跨平台的阶层式笔记应用程序，专注于建立大型个人知识库。

想快速了解，请查看[屏幕截图](https://triliumnext.github.io/Docs/Wiki/screenshot-tour)：

<a href="https://triliumnext.github.io/Docs/Wiki/screenshot-tour"><img src="./app.png" alt="Trilium Screenshot" width="1000"></a>

## 🎁 功能

* 笔记可组织成任意深度的树形结构。单一笔记可放在树中的多个位置（参见[笔记复制/克隆](https://triliumnext.github.io/Docs/Wiki/cloning-notes)）。
* 丰富的所见即所得（WYSIWYG）笔记编辑器，支持表格、图片与[数学公式](https://triliumnext.github.io/Docs/Wiki/text-notes)，并具备 Markdown 的[自动格式](https://triliumnext.github.io/Docs/Wiki/text-notes#autoformat)。
* 支持编辑[程序代码笔记](https://triliumnext.github.io/Docs/Wiki/code-notes)，包含语法高亮。 
* 快速、轻松地在笔记间[导航](https://triliumnext.github.io/Docs/Wiki/note-navigation)、全文搜索，以及[笔记聚焦（hoisting）](https://triliumnext.github.io/Docs/Wiki/note-hoisting)。
* 无缝的[笔记版本管理](https://triliumnext.github.io/Docs/Wiki/note-revisions)。
* 笔记[属性](https://triliumnext.github.io/Docs/Wiki/attributes)可用于笔记的组织、查询与高级[脚本](https://triliumnext.github.io/Docs/Wiki/scripts)。
* 接口提供英文、德文、西班牙文、法文、罗马尼亚文与中文（简体与正体）。
* 直接整合 [OpenID 与 TOTP](./User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/Multi-Factor%20Authentication.md) 以实现更安全的登录。
* 与自架的同步服务器进行[同步](https://triliumnext.github.io/Docs/Wiki/synchronization)  
  * 另有[第三方同步服务器托管服务](https://trilium.cc/paid-hosting)。
* 将笔记[分享](https://triliumnext.github.io/Docs/Wiki/sharing)（公开发布）到互联网。
* 以每则笔记为粒度的强大[笔记加密](https://triliumnext.github.io/Docs/Wiki/protected-notes)。
* 手绘/示意图：基于 [Excalidraw](https://excalidraw.com/)（笔记类型为「canvas」）。
* 用于可视化笔记及其关系的[关系图](https://triliumnext.github.io/Docs/Wiki/relation-map)与[链接图](https://triliumnext.github.io/Docs/Wiki/link-map)。
* 思维导图：基于 [Mind Elixir](https://docs.mind-elixir.com/)。
* 具有定位钉与 GPX 轨迹的[地图](./User%20Guide/User%20Guide/Note%20Types/Geo%20Map.md)。
* [脚本](https://triliumnext.github.io/Docs/Wiki/scripts)——参见[高级展示](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)。
* 用于自动化的 [REST API](https://triliumnext.github.io/Docs/Wiki/etapi)。
* 在可用性与效能上均可良好扩展，支持超过 100,000 笔笔记。
* 为手机与平板优化的[移动前端](https://triliumnext.github.io/Docs/Wiki/mobile-frontend)。
* 内置[深色主题](https://triliumnext.github.io/Docs/Wiki/themes)，并支持用户主题。
* [Evernote 导入](https://triliumnext.github.io/Docs/Wiki/evernote-import)与 [Markdown 导入与导出](https://triliumnext.github.io/Docs/Wiki/markdown)。
* 用于快速保存网页内容的 [Web Clipper](https://triliumnext.github.io/Docs/Wiki/web-clipper)。
* 可自定义的 UI（侧边栏按钮、用户自定义小组件等）。
* [度量指标（Metrics）](./User%20Guide/User%20Guide/Advanced%20Usage/Metrics.md)，并附有 [Grafana 仪表板](./User%20Guide/User%20Guide/Advanced%20Usage/Metrics/grafana-dashboard.json)。

✨ 想要更多 TriliumNext 的主题、脚本、外挂与资源，亦可参考以下第三方资源／社群：

- [awesome-trilium](https://github.com/Nriver/awesome-trilium)（第三方主题、脚本、外挂与更多）。
- [TriliumRocks!](https://trilium.rocks/)（教学、指南等等）。

## ⚠️ 为什么是 TriliumNext？

[原本的 Trilium 项目目前处于维护模式](https://github.com/zadam/trilium/issues/4620)。

### 从 Trilium 迁移？

从既有的 zadam/Trilium 例项迁移到 TriliumNext/Notes 不需要特别的迁移步骤。只要[照一般方式安装 TriliumNext/Notes](#-安装)，它就会直接使用你现有的数据库。

版本至多至 [v0.90.4](https://github.com/TriliumNext/Notes/releases/tag/v0.90.4) 与 zadam/trilium 最新版本 [v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7) 兼容。之后的 TriliumNext 版本已提升同步版本号（与上述不再兼容）。

## 📖 文件

我们目前正将文件搬移至应用程序内（在 Trilium 中按 `F1`）。在完成前，文件中可能会有缺漏。如果你想在 GitHub 上查看，也可以直接查看[使用说明](./User%20Guide/User%20Guide/)。

以下提供一些快速连结，方便你导览文件：
- [服务器安装](./User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation.md)
  - [Docker 安装](./User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md)
- [升级 TriliumNext](./User%20Guide/User%20Guide/Installation%20%26%20Setup/Upgrading%20TriliumNext.md)
- [基本概念与功能－笔记](./User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Notes.md)
- [个人知识库的模式](https://triliumnext.github.io/Docs/Wiki/patterns-of-personal-knowledge)

在我们完成重新整理文件架构之前，你也可以[查看旧版文件](https://triliumnext.github.io/Docs)。

## 💬 与我们交流

欢迎加入官方社群。我们很乐意听到你对功能、建议或问题的想法！

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org)（同步讨论）  
  - `General` Matrix 房间也桥接到 [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [GitHub Discussions](https://github.com/TriliumNext/Notes/discussions)（异步讨论）。
- [GitHub Issues](https://github.com/TriliumNext/Notes/issues)（回报错误与提出功能需求）。

## 🏗 安装

### Windows / macOS

从[最新释出页面](https://github.com/TriliumNext/Trilium/releases/latest)下载你平台的二进制文件，解压缩后执行 `trilium` 可执行文件。

### Linux

如果你的发行版如下表所列，请使用该发行版的套件。

[![Packaging status](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

你也可以从[最新释出页面](https://github.com/TriliumNext/Trilium/releases/latest)下载对应平台的二进制文件，解压缩后执行 `trilium` 可执行文件。

TriliumNext 也提供 Flatpak，惟尚未发布到 FlatHub。

### 查看器（任何操作系统）

若你有（如下所述的）服务器安装，便可直接存取网页界面（其与桌面应用几乎相同）。

目前仅支持（并实测）最新版的 Chrome 与 Firefox。

### 移动装置

若要在行动装置上使用 TriliumNext，你可以透过移动查看器存取服务器安装的移动版接口（见下）。

如果你偏好原生 Android 应用，可使用 [TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid)。回报问题或缺少的功能，请至[其储存库](https://github.com/FliegendeWurst/TriliumDroid)。

更多关于移动应用支持的信息，请见议题：https://github.com/TriliumNext/Notes/issues/72。

### 服务器

若要在你自己的服务器上安装 TriliumNext（包括从 [Docker Hub](https://hub.docker.com/r/triliumnext/trilium) 使用 Docker 部署），请遵循[服务器安装文件](https://triliumnext.github.io/Docs/Wiki/server-installation)。

## 💻 贡献

### 翻译

如果你是母语人士，欢迎前往我们的 [Weblate 页面](https://hosted.weblate.org/engage/trilium/)协助翻译 Trilium。

以下是目前的语言覆盖状态：

[![Translation status](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

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
pnpm run edit-docs:edit-docs
```

### 建置桌面可执行文件

下载储存库，使用 `pnpm` 安装相依套件，然后为 Windows 建置桌面应用：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm --filter=desktop electron-forge:make --arch=x64 --platform=win32
```

更多细节请参见[开发文件](https://github.com/TriliumNext/Notes/blob/develop/docs/Developer%20Guide/Developer%20Guide/Building%20and%20deployment/Running%20a%20development%20build.md)。

### 开发者文件

请参阅[环境设定指南](./Developer%20Guide/Developer%20Guide/Environment%20Setup.md)。若有更多疑问，欢迎透过上方「与我们交流」章节所列连结与我们联系。

## 👏 鸣谢

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) —— 业界最佳的所见即所得编辑器，团队互动积极。
* [FancyTree](https://github.com/mar10/fancytree) —— 功能非常丰富的树状元件，几乎没有对手。没有它，Trilium Notes 将不会是今天的样子。
* [CodeMirror](https://github.com/codemirror/CodeMirror) —— 支持大量语言的程序代码编辑器。
* [jsPlumb](https://github.com/jsplumb/jsplumb) —— 无可匹敌的视觉联机函式库。用于[关系图](https://triliumnext.github.io/Docs/Wiki/relation-map.html)与[连结图](https://triliumnext.github.io/Docs/Wiki/note-map.html#link-map)。

## 🤝 支持我们

目前尚无法直接赞助 TriliumNext 组织。不过你可以：
- 透过赞助我们的开发者来支持 TriliumNext 的持续开发：[eliandoran](https://github.com/sponsors/eliandoran)（完整清单请见 [repository insights]([developers]([url](https://github.com/TriliumNext/Notes/graphs/contributors)))）
- 透过 [PayPal](https://paypal.me/za4am) 或比特币（bitcoin:bc1qv3svjn40v89mnkre5vyvs2xw6y8phaltl385d2）向原始的 Trilium 开发者（[zadam](https://github.com/sponsors/zadam)）表达支持。

## 🔑 授权条款

Copyright 2017–2025 zadam、Elian Doran 与其他贡献者。

本程序系自由软件：你可以在自由软件基金会（Free Software Foundation）所发布的 GNU Affero 通用公众授权条款（GNU AGPL）第 3 版或（由你选择）任何后续版本之条款下重新散布或修改本程序。
