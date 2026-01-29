<div align="center">
	<sup>特别感谢：</sup><br />
	<a href="https://go.warp.dev/Trilium" target="_blank">		
		<img alt="Warp sponsorship" width="400" src="https://github.com/warpdotdev/brand-assets/blob/main/Github/Sponsor/Warp-Github-LG-03.png"><br />
		Warp，为多 AI 智能体编程而生<br />
	</a>
  <sup>适用于 macOS、Linux 和 Windows</sup>
</div>

<hr />

# Trilium Notes

![GitHub Sponsors](https://img.shields.io/github/sponsors/eliandoran) ![LiberaPay patrons](https://img.shields.io/liberapay/patrons/ElianDoran)  
![Docker Pulls](https://img.shields.io/docker/pulls/triliumnext/trilium)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/triliumnext/trilium/total)  
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp) [![Translation status](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Chinese (Simplified Han script)](./docs/README-ZH_CN.md) | [Chinese (Traditional Han script)](./docs/README-ZH_TW.md) | [English](./docs/README.md) | [French](./docs/README-fr.md) | [German](./docs/README-de.md) | [Greek](./docs/README-el.md) | [Italian](./docs/README-it.md) | [Japanese](./docs/README-ja.md) | [Romanian](./docs/README-ro.md) | [Spanish](./docs/README-es.md)
<!-- translate:on -->

Trilium Notes 是一款免费、开源、跨平台的分层笔记应用，专注于构建大型个人知识库，并内置 AI 助手能力。

<img src="./docs/app.png" alt="Trilium Screenshot" width="1000">

## 🤖 AI 与 MiniMax 支持

- 内置 AI 助手，支持 MiniMax（Anthropic 兼容接口）。
- 支持工具调用：搜索、创建、更新、移动、总结笔记。
- 可在设置中配置模型与密钥，按需启用 AI 能力。

## ⏬ 下载

- [最新版本](https://github.com/TriliumNext/Trilium/releases/latest) – 稳定版，推荐大多数用户使用。
- [Nightly 构建](https://github.com/TriliumNext/Trilium/releases/tag/nightly) – 不稳定开发版，每日更新最新功能与修复。

## 📚 文档

**访问完整文档：[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

文档提供多种形式：
- **在线文档**：浏览 [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **应用内帮助**：在 Trilium 中按 `F1`
- **GitHub**：查看仓库内的 [用户指南](./docs/User%20Guide/User%20Guide/)

### 快速链接
- [快速开始](https://docs.triliumnotes.org/)
- [安装说明](https://docs.triliumnotes.org/user-guide/setup)
- [Docker 安装](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [升级 TriliumNext](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [基础概念与特性](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [个人知识库的组织方式](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 功能

* 笔记可组织为任意深度的树结构，单个笔记可在树中多处出现（参见 [cloning](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning)）
* 富文本 WYSIWYG 编辑器，支持表格、图片、[数学公式](https://docs.triliumnotes.org/user-guide/note-types/text)，并带有 Markdown [自动格式化](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
* 支持编辑 [代码笔记](https://docs.triliumnotes.org/user-guide/note-types/code)，包含语法高亮
* 快速 [笔记导航](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation)、全文检索与 [笔记提升](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* 无缝的 [笔记版本管理](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* 通过 [属性](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes) 实现组织、查询与高级 [脚本](https://docs.triliumnotes.org/user-guide/scripts)
* UI 提供英文、德文、西班牙文、法文、罗马尼亚文与中文（简体/繁体）
* 内置 [OpenID 与 TOTP](https://docs.triliumnotes.org/user-guide/setup/server/mfa) 以提升登录安全性
* 与自托管同步服务器进行 [同步](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  * 提供 [第三方托管服务](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* 通过 [共享/发布](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing) 将笔记公开到互联网
* 强大的 [笔记加密](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)，支持单笔记粒度
* 基于 [Excalidraw](https://excalidraw.com/) 的草图绘制（笔记类型 "canvas"）
* [关系图](https://docs.triliumnotes.org/user-guide/note-types/relation-map) 与 [笔记/链接图](https://docs.triliumnotes.org/user-guide/note-types/note-map) 可视化
* 基于 [Mind Elixir](https://docs.mind-elixir.com/) 的思维导图
* [地理地图](https://docs.triliumnotes.org/user-guide/collections/geomap) 支持位置标记与 GPX 轨迹
* [脚本能力](https://docs.triliumnotes.org/user-guide/scripts) – 参见 [高级示例](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [REST API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi) 便于自动化
* 轻松支持 100,000+ 规模的笔记与良好性能
* 适配触控的 [移动端界面](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend)
* 内置 [深色主题](https://docs.triliumnotes.org/user-guide/concepts/themes) 并支持用户主题
* 支持 [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote) 与 [Markdown 导入/导出](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper) 便于保存网页内容
* UI 可自定义（侧边栏按钮、用户自定义小组件等）
* [Metrics](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics) 指标与 Grafana Dashboard

✨ 更多 TriliumNext 社区资源：

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) – 主题、脚本、插件等合集
- [TriliumRocks!](https://trilium.rocks/) – 教程、指南等

## ❓为什么选择 TriliumNext？

原作者 [Zadam](https://github.com/zadam) 已将 Trilium 仓库交由社区维护，项目位于 https://github.com/TriliumNext

### ⬆️ 从 Zadam/Trilium 迁移？

从 zadam/Trilium 迁移到 TriliumNext/Trilium 不需要额外步骤，按常规 [安装 TriliumNext/Trilium](#-安装) 即可继续使用原数据库。

v0.90.4 及以前版本与 zadam/trilium 的 v0.63.7 兼容；此后的 TriliumNext/Trilium 已提升同步版本号，因此无法直接迁移。

## 💬 交流与支持

欢迎加入官方社区讨论：

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org)（同步交流）
  - `General` Matrix 房间同样桥接到 [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [GitHub Discussions](https://github.com/TriliumNext/Trilium/discussions)（异步交流）
- [GitHub Issues](https://github.com/TriliumNext/Trilium/issues)（问题反馈与需求）

## 🏗 安装

### Windows / MacOS

从 [最新版本](https://github.com/TriliumNext/Trilium/releases/latest) 下载对应平台的二进制包，解压后运行 `trilium` 可执行文件。

### Linux

如果你的发行版在下表中，请使用发行版提供的包。

[![Packaging status](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

你也可以从 [最新版本](https://github.com/TriliumNext/Trilium/releases/latest) 下载二进制包，解压后运行 `trilium`。

TriliumNext 也提供 Flatpak，但尚未发布到 Flathub。

### 浏览器（任何 OS）

如果你使用服务器部署（见下文），可直接访问 Web 界面（几乎与桌面版一致）。

目前仅支持并测试最新版本的 Chrome 与 Firefox。

### 移动端

你可以通过移动浏览器访问服务器的移动端界面（见下文）来使用 TriliumNext。

移动端原生 App 讨论见：https://github.com/TriliumNext/Trilium/issues/4962

如需 Android 原生客户端，可使用 [TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid)。
相关 bug 或缺失功能请在其仓库反馈：[TriliumDroid repository](https://github.com/FliegendeWurst/TriliumDroid)。
注意：使用 TriliumDroid 时建议关闭服务器的自动更新（见下文），以保持同步版本一致。

### 服务器

在服务器上安装 TriliumNext（含 Docker）请参考：[服务器安装文档](https://docs.triliumnotes.org/user-guide/setup/server)

## 💻 贡献

### 翻译

如果你是母语使用者，欢迎加入 [Weblate](https://hosted.weblate.org/engage/trilium/) 翻译 Trilium。

当前语言覆盖：

[![Translation status](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### 代码

克隆仓库并安装依赖，然后运行服务端（默认 http://localhost:8080）：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### 文档

克隆仓库并安装依赖，然后启动文档编辑环境：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

如果你安装了 Nix：
```shell
# 直接运行
nix run .#edit-docs

# 或安装到 profile
nix profile install .#edit-docs
trilium-edit-docs
```

### 构建可执行文件

克隆仓库并安装依赖，然后构建 Windows 桌面包：
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

更多详情请参考 [开发文档](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide)。

### 开发文档

请查看 [文档指南](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)。如有问题，欢迎通过上文的交流渠道联系我们。

## 👏 致谢

* [zadam](https://github.com/zadam) – 原始概念与实现
* [Sarah Hussein](https://github.com/Sarah-Hussein) – 应用图标设计
* [nriver](https://github.com/nriver) – 国际化贡献
* [Thomas Frei](https://github.com/thfrei) – Canvas 初始实现
* [antoniotejada](https://github.com/antoniotejada) – 语法高亮小组件初始实现
