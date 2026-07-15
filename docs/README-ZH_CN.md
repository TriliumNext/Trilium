# Trilium Notes

![GitHub 赞助者](https://img.shields.io/github/sponsors/eliandoran) ![LiberaPay
赞助者](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Docker 拉取次数](https://img.shields.io/docker/pulls/triliumnext/trilium) ![GitHub
下载量
(所有资源，所有版本)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![翻译状态](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Arabic](./README-ar.md) | [Chinese (Simplified Han script)](./README-ZH_CN.md)
| [Chinese (Traditional Han script)](./README-ZH_TW.md) |
[Czech](./README-cs.md) | [English (United Kingdom)](./README-en_GB.md) |
[English](../README.md) | [French](./README-fr.md) | [German](./README-de.md) |
[Greek](./README-el.md) | [Indonesian](./README-id.md) | [Irish](./README-ga.md)
| [Italian](./README-it.md) | [Japanese](./README-ja.md) |
[Korean](./README-ko.md) | [Polish](./README-pl.md) | [Romanian](./README-ro.md)
| [Russian](./README-ru.md) | [Spanish](./README-es.md) |
[Ukrainian](./README-uk.md) | [Urdu](./README-ur.md) | [Uyghur](./README-ug.md)
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

* 笔记可以排列成任意深度的树形结构。单个笔记可以放置在树中的多个位置（参见[克隆](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning)）
* 所见即所得的富文本笔记编辑器，支持表格、图片和[数学公式](https://docs.triliumnotes.org/user-guide/note-types/text)，并配有
  Markdown
  [自动格式化](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
* 支持编辑[包含源代码的笔记](https://docs.triliumnotes.org/user-guide/note-types/code),
  ，包含语法高亮
* 快速便捷的[笔记间导航](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation)、全文搜索，以及[笔记聚焦](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* 无缝的[笔记版本管理](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* 笔记[属性](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)可用于笔记的组织、查询与高级[脚本](https://docs.triliumnotes.org/user-guide/scripts)
* 界面支持英语、德语、西班牙语、法语、罗马尼亚语以及中文（简体和繁体）
* 直接[集成OpenID 与 TOTP](https://docs.triliumnotes.org/user-guide/setup/server/mfa)
  以实现更安全的登录
* 与自托管的同步服务器进行[同步](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  * 有[用于托管同步服务器的第三方服务](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [分享](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)（发布）笔记到公共互联网
* 强大的[笔记加密](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)，支持以单篇笔记为粒度进行设置
* 绘制图表，基于 [Excalidraw](https://excalidraw.com/) （笔记类型为“画布”）
* 用于可视化笔记及其关系的[关系图](https://docs.triliumnotes.org/user-guide/note-types/relation-map)和[笔记/链接图](https://docs.triliumnotes.org/user-guide/note-types/note-map)
* 基于 [Mind Elixir](https://docs.mind-elixir.com/) 的思维导图
* 带有位置标记和 GPX
  轨迹的[地理地图](https://docs.triliumnotes.org/user-guide/collections/geomap)
* [脚本编写](https://docs.triliumnotes.org/user-guide/scripts) -
  参见[高级展示](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* 用于自动化的 [REST
  API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi)
* 即使笔记数量超过 10 万条，在易用性和性能方面仍能良好扩展
* 为智能手机和平板电脑触控优化的[移动前端](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend)
* 内置[暗色主题](https://docs.triliumnotes.org/user-guide/concepts/themes)，支持用户主题
* [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  导入以及 [Markdown
  导入与导出](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* 用于快速保存网页内容的 [Web
  Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper)
* 可自定义的 UI（侧边栏按钮、用户自定义小组件等）
* [Metrics](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics)，以及
  Grafana 仪表板。

✨ 查看以下第三方资源/社区，获取更多与 TriliumNext 相关的实用内容：

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) 提供第三方主题、脚本、插件等资源。
- [TriliumRocks!](https://trilium.rocks/) 提供教程、指南以及更多内容。

## ❓为什么选择TriliumNext？

Trilium 的原开发者（[Zadam](https://github.com/zadam)）已慷慨地将 Trilium
仓库移交至社区项目，该项目现托管于：https://github.com/TriliumNext

### ⬆️从 Zadam/Trilium 迁移？

从 zadam/Trilium 实例迁移到 TriliumNext/Trilium 实例无需任何特殊步骤。只需像往常一样[安装
TriliumNext/Trilium](#-installation)，它便会沿用你现有的数据库。

直至 [v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4)
版本（含）均与最新的 zadam/trilium 版本
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7) 兼容。此后任何更新的
TriliumNext/Trilium 版本都已递增了同步版本号，因此无法直接迁移。

## 💬 与我们讨论

欢迎加入我们的官方社群。我们非常期待听到您的功能建议、改进意见或遇到的问题！

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org)（用于同步交流。）
  - `General` Matrix 房间也桥接到 [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [GitHub
  Discussions](https://github.com/TriliumNext/Trilium/discussions)（用于异步讨论。）
- [GitHub Issues](https://github.com/TriliumNext/Trilium/issues)（用于报告错误和提出功能请求。）

## 🏗 安装

### Windows / MacOS

从[最新发布页面](https://github.com/TriliumNext/Trilium/releases/latest)下载适合你平台的二进制发行版，解压后运行`trilium`可执行文件即可。

### Linux

如果你的发行版在以下表格中列出，请使用该发行版的软件包。

[![打包状态](https://repology.org/badge/vertical-allrepos/trilium.svg)](https://repology.org/project/trilium/versions)

你也可以从[最新发布页面](https://github.com/TriliumNext/Trilium/releases/latest)下载适合你平台的二进制发行版，解压后运行`trilium`可执行文件即可。

TriliumNext 也提供了 Flatpak 格式，但尚未在 FlatHub 上发布。

### 浏览器（任意操作系统）

如果你使用的是服务器安装（见下文），可以直接访问网页界面，它几乎与桌面应用一模一样。

目前仅支持（并经过测试）最新版本的 Chrome 和 Firefox。

### 移动端

要在移动设备上使用 TriliumNext，你可以通过移动网页浏览器访问服务器安装版本的移动界面（见下文）。

更多关于移动应用支持的信息，请参阅 https://github.com/TriliumNext/Trilium/issues/4962。

#### TriliumDroid

如果你更喜欢原生 Android 应用，可以使用
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid)。遇到
bug 或功能缺失，请到[它的代码仓库](https://github.com/FliegendeWurst/TriliumDroid)反馈。注意：在使用
TriliumDroid 时，最好关闭服务器端安装的自动更新（见下文），因为 Trilium 与 TriliumDroid 的同步版本必须保持一致。

#### Pocket Trilium

如果你想要一个功能齐全的原生 Android 应用，不妨看看 [Pocket
Trilium](https://github.com/Nriver/pocket-trilium)。它能在手机上运行一个完整的 Trilium
实例，支持完全离线使用，还能与你的服务器同步。

#### Trinote

如果你想要一个原生 iOS 应用，你可以使用
[Trinote](https://apps.apple.com/us/app/trinote/id6761228249)，这是一个开源的客户端，用于连接你自托管的Trilium/TriliumNext服务器。它支持浏览和整理笔记树、在服务器上搜索笔记、阅读和编辑所有笔记类型（文本、代码、思维导图、电子表格、地理地图、画布等），并且可以离线保存和编辑笔记。如果你有兴趣参与贡献，这里是[仓库链接](https://github.com/StephenArg/Trinote)；如果你想讨论反馈或建议，这里是[Discord](https://discord.com/invite/ghjJG56EUS)。

### 服务器

如要在你自己的服务器上安装 TriliumNext（包括通过
[Dockerhub](https://hub.docker.com/r/triliumnext/trilium) 使用
Docker），请参照[服务器安装文档](https://docs.triliumnotes.org/user-guide/setup/server)。


## 💻 贡献

### 翻译

如果你是母语者，欢迎前往我们的 [Weblate 页面](https://hosted.weblate.org/engage/trilium/)协助翻译
Trilium。

以下是我们目前涵盖的语言范围：

[![翻译状态](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### 程序代码

下载仓库，使用 `pnpm` 安装依赖，然后运行服务器（可在 http://localhost:8080 访问）：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### 文件

下载仓库，使用 `pnpm` 安装依赖，然后运行编辑文档所需的环境：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

或者，如果你已安装 Nix：
```shell
# 直接运行 
nix run .#edit-docs

# 或安装到你的配置文件中 
nix profile install .#edit-docs
trilium-edit-docs
```


### 构建可执行文件
下载仓库，使用 `pnpm` 安装依赖，然后构建 Windows 桌面应用：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

更多详情，请参见[开发文档](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide)。

### 开发者文档

请查看[文档指南](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)了解详情。如有更多问题，欢迎通过上方"与我们讨论"部分中描述的链接联系我们。

## 💖 赞助者

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

## 👏 鸣谢

* [zadam](https://github.com/zadam) 负责该应用的原始概念与实现。
* [Sarah Hussein](https://github.com/Sarah-Hussein) 为应用程序设计图标。
* [nriver](https://github.com/nriver) 对其在国际化工作中的贡献。
* [Thomas Frei](https://github.com/thfrei) 因其在 Canvas 方面的原创工作。
* [antoniotejada](https://github.com/nriver) 原始语法高亮小部件的作者。
* [Tabler Icons](https://tabler.io/icons) 用于系统托盘图标。

Trilium 的诞生离不开其背后的技术支持：

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - 文本笔记背后的可视化编辑器。
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
的开发与维护凝聚了[数百小时的工作](https://github.com/TriliumNext/Trilium/graphs/commit-activity)。你的支持将帮助它保持开源，推动功能改进，并覆盖托管等相关成本。

请考虑通过以下方式支持该应用程序的主要开发者（[eliandoran](https://github.com/eliandoran)）：

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 授权条款

Copyright 2017–2025 zadam、Elian Doran 与其他贡献者

本程序系自由软件：您可以根据自由软件基金会（Free Software Foundation）所发布的 GNU Affero 通用公众授权条款（GNU
AGPL）的条款，即许可证第3版，或（由你选择）任何后续版本之条款下重新分发或修改本程序。
