<div align="center">
	<sup>Special thanks to:</sup><br />
	<a href="https://go.warp.dev/Trilium" target="_blank">		
		<img alt="Warp sponsorship" width="400" src="https://github.com/warpdotdev/brand-assets/blob/main/Github/Sponsor/Warp-Github-LG-03.png"><br />
		Warp, built for coding with multiple AI agents<br />
	</a>
  <sup>Available for macOS, Linux and Windows</sup>
</div>

<hr />

# 트릴리움 노트

![GitHub Sponsors](https://img.shields.io/github/sponsors/eliandoran)
![LiberaPay patrons](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Docker Pulls](https://img.shields.io/docker/pulls/triliumnext/trilium)
![GitHub Downloads (all assets, all
releases)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Translation
status](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Chinese (Simplified Han script)](./README-ZH_CN.md) | [Chinese (Traditional Han
script)](./README-ZH_TW.md) | [English](../README.md) | [French](./README-fr.md)
| [German](./README-de.md) | [Greek](./README-el.md) | [Italian](./README-it.md)
| [Japanese](./README-ja.md) | [Romanian](./README-ro.md) |
[Spanish](./README-es.md)
<!-- translate:on -->

Trilium Notes는 대규모 개인 지식 기반 구축에 중점을 둔 무료 오픈 소스 크로스 플랫폼 계층적 메모 작성 애플리케이션입니다.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ 내려받기
- [최신 릴리스](https://github.com/TriliumNext/Trilium/releases/latest) – 안정된 버전으로
  대부분의 사용자에게 권장됩니다.
- [야간 빌드](https://github.com/TriliumNext/Trilium/releases/tag/nightly) – 불안정한 개발
  버전으로, 최신 기능과 수정 사항이 매일 업데이트됩니다.

## 📚 문서

**[docs.triliumnotes.org](https://docs.triliumnotes.org/)에서 전체 문서를 확인하세요**

문서는 다양한 형식으로 제공됩니다:
- **온라인 문서**: [docs.triliumnotes.org](https://docs.triliumnotes.org/)에서 모든 문서를
  보여줍니다
- **도움말**: 트릴리움 어플리케이션에서 `F1` 버튼을 눌러 같은 문서를 직접 볼 수 있습니다
- **GitHub**: 이 레포지토리의 [사용자 가이드](./User%20Guide/User%20Guide/)에서 확인할 수 있습니다

### 바로가기
- [시작하기 가이드](https://docs.triliumnotes.org/)
- [설치 방법](https://docs.triliumnotes.org/user-guide/setup)
- [도커
  설치](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [TriliumNext로 업그레이드](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [기본 개념 및 기능](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [개인 지식 베이스의
  패턴들](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 주요 기능

* 노트는 다양한 깊이의 트리로 배열될 수 있으며, 하나의 노트는 트리의 여러 위치에 둘 수 있음
  ([cloning](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning)
  참고)
* 마크다운
  [자동서식](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)과
  함께 테이블, 이미지, 그리고
  [수학](https://docs.triliumnotes.org/user-guide/note-types/text) 등의 기능을 포함한 다양한
  기능의 WYSIWYG 노트 편집기 제공
* 구문 강조를 포함한 [소스코드](https://docs.triliumnotes.org/user-guide/note-types/code) 편집
  기능
* 쉽고 빠르게 노트를 찾을 수 있는
  [내비게이션](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation),
  전체 텍스트 검색 및 [노트
  호이스팅](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* 원활한 [노트 버전
  관리](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* 노트의 [속성](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)은
  노트 조직화, 쿼리, 그리고 고급 기능인
  [스크립팅](https://docs.triliumnotes.org/user-guide/scripts)에 사용
* 영어, 독일어, 스페인어, 프랑스어, 루마니아어, 중국어 (간체, 번체) UI 제공
* 더욱 안전한 로그인을 위해 직접 [OpenID 및 TOTP
  통합](https://docs.triliumnotes.org/user-guide/setup/server/mfa)
* self-hosted 동기화 서버를 통한
  [동기화](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  * there are [3rd party services for hosting synchronisation
    server](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* 노트의 인터넷 [공유](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  (퍼블리싱) 기능
* 노트마다 세분화된 강력한 [노트
  암호화](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
* [Excalidraw](https://excalidraw.com/) 기반 스케치 다이어그램 (노트 타입 "캔버스")
* [Relation
  maps](https://docs.triliumnotes.org/user-guide/note-types/relation-map) and
  [note/link maps](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  for visualizing notes and their relations
* [Mind Elixir](https://docs.mind-elixir.com/) 기반 마인드맵
* [Geo maps](https://docs.triliumnotes.org/user-guide/collections/geomap) with
  location pins and GPX tracks
* [Scripting](https://docs.triliumnotes.org/user-guide/scripts) - see [Advanced
  showcases](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [REST API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi) for
  automation
* Scales well in both usability and performance upwards of 100 000 notes
* Touch optimized [mobile
  frontend](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend) for
  smartphones and tablets
* Built-in [dark
  theme](https://docs.triliumnotes.org/user-guide/concepts/themes), support for
  user themes
* [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  and [Markdown import &
  export](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper) for
  easy saving of web content
* Customizable UI (sidebar buttons, user-defined widgets, ...)
* [Metrics](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics),
  along with a Grafana Dashboard.

✨ Check out the following third-party resources/communities for more TriliumNext
related goodies:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) for 3rd party
  themes, scripts, plugins and more.
- [TriliumRocks!](https://trilium.rocks/) for tutorials, guides, and much more.

## ❓왜 TriliumNext일까?

The original Trilium developer ([Zadam](https://github.com/zadam)) has
graciously given the Trilium repository to the community project which resides
at https://github.com/TriliumNext

### ⬆️Migrating from Zadam/Trilium?

There are no special migration steps to migrate from a zadam/Trilium instance to
a TriliumNext/Trilium instance. Simply [install
TriliumNext/Trilium](#-installation) as usual and it will use your existing
database.

Versions up to and including
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) are
compatible with the latest zadam/trilium version of
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). Any later
versions of TriliumNext/Trilium have their sync versions incremented which
prevents direct migration.

## 💬 Discuss with us

Feel free to join our official conversations. We would love to hear what
features, suggestions, or issues you may have!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (For synchronous
  discussions.)
  - The `General` Matrix room is also bridged to
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [Github Discussions](https://github.com/TriliumNext/Trilium/discussions) (For
  asynchronous discussions.)
- [Github Issues](https://github.com/TriliumNext/Trilium/issues) (For bug
  reports and feature requests.)

## 🏗 Installation

### 윈도우 / 맥OS

Download the binary release for your platform from the [latest release
page](https://github.com/TriliumNext/Trilium/releases/latest), unzip the package
and run the `trilium` executable.

### Linux

If your distribution is listed in the table below, use your distribution's
package.

[![Packaging
status](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

You may also download the binary release for your platform from the [latest
release page](https://github.com/TriliumNext/Trilium/releases/latest), unzip the
package and run the `trilium` executable.

TriliumNext is also provided as a Flatpak, but not yet published on FlatHub.

### Browser (any OS)

If you use a server installation (see below), you can directly access the web
interface (which is almost identical to the desktop app).

Currently only the latest versions of Chrome & Firefox are supported (and
tested).

### 모바일

To use TriliumNext on a mobile device, you can use a mobile web browser to
access the mobile interface of a server installation (see below).

See issue https://github.com/TriliumNext/Trilium/issues/4962 for more
information on mobile app support.

If you prefer a native Android app, you can use
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Report bugs and missing features at [their
repository](https://github.com/FliegendeWurst/TriliumDroid). Note: It is best to
disable automatic updates on your server installation (see below) when using
TriliumDroid since the sync version must match between Trilium and TriliumDroid.

### 서버

To install TriliumNext on your own server (including via Docker from
[Dockerhub](https://hub.docker.com/r/triliumnext/trilium)) follow [the server
installation docs](https://docs.triliumnotes.org/user-guide/setup/server).


## 💻 Contribute

### Translations

If you are a native speaker, help us translate Trilium by heading over to our
[Weblate page](https://hosted.weblate.org/engage/trilium/).

Here's the language coverage we have so far:

[![Translation
status](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Code

Download the repository, install dependencies using `pnpm` and then run the
server (available at http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### Documentation

Download the repository, install dependencies using `pnpm` and then run the
environment required to edit the documentation:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### Building the Executable
Download the repository, install dependencies using `pnpm` and then build the
desktop app for Windows:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

자세한 내용은 [development
docs](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide)를
참고하세요.

### Developer Documentation

Please view the [documentation
guide](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
for details. If you have more questions, feel free to reach out via the links
described in the "Discuss with us" section above.

## 👏 Shoutouts

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
  maps](https://docs.triliumnotes.org/user-guide/note-types/relation-map) and
  [link
  maps](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 Support

Trilium is built and maintained with [hundreds of hours of
work](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Your
support keeps it open-source, improves features, and covers costs such as
hosting.

Consider supporting the main developer
([eliandoran](https://github.com/eliandoran)) of the application via:

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 License

Copyright 2017-2025 zadam, Elian Doran, and other contributors

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.
