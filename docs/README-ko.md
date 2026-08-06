# Trilium Notes

![GitHub 스폰서](https://img.shields.io/github/sponsors/eliandoran) ![LiberaPay
후원자](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Docker 풀 횟수](https://img.shields.io/docker/pulls/triliumnext/trilium) ![GitHub
다운로드(모든 파일, 모든
릴리스)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![번역
상태](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

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

Trilium Notes는 대규모 개인 지식 기반 구축에 중점을 둔 무료 오픈 소스 크로스 플랫폼 계층형 노트 작성 애플리케이션입니다.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ 다운로드
- [최신 릴리스](https://github.com/TriliumNext/Trilium/releases/latest) – 대부분의 사용자에게
  권장되는 안정 버전입니다.
- [나이틀리 빌드](https://github.com/TriliumNext/Trilium/releases/tag/nightly) – 최신
  기능과 수정 사항이 매일 반영되는 불안정한 개발 버전입니다.

## 📚 문서

**[docs.triliumnotes.org](https://docs.triliumnotes.org/)에서 전체 문서를 확인하세요**

문서는 다양한 형식으로 제공됩니다:
- **온라인 문서**: [docs.triliumnotes.org](https://docs.triliumnotes.org/)에서 전체 문서를
  확인할 수 있습니다
- **앱 내 도움말**: Trilium에서 `F1` 키를 누르면 애플리케이션 내에서 동일한 문서에 바로 접근할 수 있습니다
- **GitHub**: 이 저장소의 [사용자 가이드](./User%20Guide/User%20Guide/)를 살펴보세요

### 바로가기
- [시작하기 가이드](https://docs.triliumnotes.org/)
- [설치 방법](https://docs.triliumnotes.org/user-guide/setup)
- [Docker
  설정](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [TriliumNext로 업그레이드](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [기본 개념 및 기능](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [개인 지식 기반 활용
  패턴](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 주요 기능

* 노트를 원하는 깊이의 트리로 구성할 수 있으며 하나의 노트를 트리의 여러 위치에 배치할 수
  있음([복제](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning) 참고)
* 표, 이미지, [수학](https://docs.triliumnotes.org/user-guide/note-types/text),
  Markdown [자동
  서식](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
  등을 지원하는 풍부한 WYSIWYG 노트 편집기
* 구문 강조를 포함한 [소스 코드
  노트](https://docs.triliumnotes.org/user-guide/note-types/code) 편집 지원
* [노트 간 빠르고 편리한
  탐색](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation),
  전체 텍스트 검색 및 [노트 루트
  보기](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* 원활한 [노트 버전
  관리](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* 노트 [속성](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)을
  활용한 노트 구성, 검색 및 고급 [스크립팅](https://docs.triliumnotes.org/user-guide/scripts)
* 영어, 독일어, 스페인어, 프랑스어, 루마니아어, 중국어 간체 및 번체 UI 지원
* 더 안전한 로그인을 위한 [OpenID 및 TOTP 직접
  연동](https://docs.triliumnotes.org/user-guide/setup/server/mfa)
* 자체 호스팅 동기화 서버를 통한
  [동기화](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  * [동기화 서버 호스팅을 제공하는 서드 파티
    서비스](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)도
    이용 가능
* 노트를 공개 인터넷에
  [공유](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)(게시)
* 노트별로 적용할 수 있는 강력한 [노트
  암호화](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
* [Excalidraw](https://excalidraw.com/) 기반 다이어그램 스케치(‘캔버스’ 노트 유형)
* 노트와 관계를 시각화하는 [관계
  지도](https://docs.triliumnotes.org/user-guide/note-types/relation-map) 및 [노트/링크
  지도](https://docs.triliumnotes.org/user-guide/note-types/note-map)
* [Mind Elixir](https://docs.mind-elixir.com/) 기반 마인드맵
* 위치 핀과 GPX 트랙을 지원하는 [지리
  지도](https://docs.triliumnotes.org/user-guide/collections/geomap)
* [스크립팅](https://docs.triliumnotes.org/user-guide/scripts) - [고급 활용
  사례](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
  참고
* 자동화를 위한 [REST
  API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi)
* 10만 개가 넘는 노트에서도 뛰어난 사용성과 성능 확장성
* 스마트폰 및 태블릿용 터치 조작에 최적화된 [모바일
  프런트엔드](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend)
* 기본 제공 [다크 테마](https://docs.triliumnotes.org/user-guide/concepts/themes) 및 사용자
  테마 지원
* [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  및 [Markdown 가져오기 및
  내보내기](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* 웹 콘텐츠를 간편하게 저장하는 [웹
  클리퍼](https://docs.triliumnotes.org/user-guide/setup/web-clipper)
* 사용자 지정 가능한 UI(사이드바 버튼, 사용자 지정 위젯 등)
* [메트릭](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics)과
  Grafana 대시보드를 함께 제공합니다.

✨ TriliumNext와 관련된 더 많은 자료는 다음 서드 파티 리소스와 커뮤니티에서 확인하세요:

- 서드파티 테마, 스크립트, 플러그인 등은
  [awesome-trilium](https://github.com/Nriver/awesome-trilium)에서 확인할 수 있습니다.
- 튜토리얼, 가이드 등은 [TriliumRocks!](https://trilium.rocks/)에서 확인할 수 있습니다.

## ❓왜 TriliumNext인가요?

Trilium의 최초 개발자([Zadam](https://github.com/zadam))가 Trilium 저장소를 커뮤니티 프로젝트에 기꺼이
이전했습니다. 현재 저장소: https://github.com/TriliumNext

### ⬆️ Zadam/Trilium에서 이전하시나요?

zadam/Trilium 인스턴스에서 TriliumNext/Trilium 인스턴스로 마이그레이션하는 데 특별한 절차는 없습니다. 평소처럼
[TriliumNext/Trilium](#-installation)을 설치하면 기존 데이터베이스를 사용하게 됩니다.

[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) 이하 버전은
zadam/trilium의 마지막 버전
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7)과 호환됩니다. 이후
TriliumNext/Trilium 버전에서는 동기화 버전이 올라가므로 직접 이전할 수 없습니다.

## 💬 커뮤니티와 소통하기

공식 커뮤니티 대화에 자유롭게 참여해 주세요. 원하는 기능, 제안 또는 문제에 관한 의견을 기다립니다!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (동기식 토론용)
  - `General` Matrix 방은 [XMPP](xmpp:discuss@trilium.thisgreat.party?join)와도 연동되어
    있습니다
- [GitHub Discussions](https://github.com/TriliumNext/Trilium/discussions)(비동기
  토론)
- [GitHub Issues](https://github.com/TriliumNext/Trilium/issues)(버그 신고 및 기능 요청)

## 🏗 설치

### Windows / macOS

[최신 릴리스 페이지](https://github.com/TriliumNext/Trilium/releases/latest)에서 플랫폼에 해당하는
바이너리 릴리스를 다운로드한 뒤, 패키지의 압축을 풀고 `trilium` 실행 파일을 실행하세요.

### Linux

사용 중인 배포판이 아래 표에 있다면 해당 배포판용 패키지를 사용하세요.

[![패키징
상태](https://repology.org/badge/vertical-allrepos/trilium.svg)](https://repology.org/project/trilium/versions)

[최신 릴리스 페이지](https://github.com/TriliumNext/Trilium/releases/latest)에서 플랫폼용 바이너리
릴리스를 다운로드한 다음 패키지의 압축을 풀고 `trilium` 실행 파일을 실행할 수도 있습니다.

TriliumNext는 Flatpak으로도 제공되지만, 아직 FlatHub에는 게시되지 않았습니다.

### 브라우저(모든 운영 체제)

서버 설치를 사용하면(아래 참조) 데스크톱 앱과 거의 동일한 웹 인터페이스에 바로 접속할 수 있습니다.

현재는 최신 버전의 Chrome과 Firefox만 지원하고 테스트합니다.

### 모바일

모바일 기기에서 TriliumNext를 사용하려면, 모바일 웹 브라우저를 사용하여 서버 설치의 모바일 인터페이스에 접속하면 됩니다(아래 참조).

모바일 앱 지원에 대한 자세한 내용은 https://github.com/TriliumNext/Trilium/issues/4962 이슈를
참조하세요.

#### TriliumDroid

네이티브 Android 앱을 선호한다면
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid)를
사용할 수 있습니다. 버그와 누락된 기능은 [해당
저장소](https://github.com/FliegendeWurst/TriliumDroid)에 신고해 주세요. 참고: Trilium과
TriliumDroid의 동기화 버전이 일치해야 하므로 TriliumDroid를 사용할 때는 서버 설치의 자동 업데이트를 비활성화하는 것이
좋습니다(아래 참조).

#### Pocket Trilium

모든 기능을 갖춘 네이티브 Android 앱이 필요하다면 [Pocket
Trilium](https://github.com/Nriver/pocket-trilium)을 확인해 보세요. 휴대전화에서 완전한 Trilium
인스턴스를 실행하고, 모든 기능을 오프라인으로 사용할 수 있으며, 서버와 동기화할 수도 있습니다.

#### Trinote

네이티브 iOS 앱이 필요하다면 자체 호스팅 Trilium / TriliumNext 서버용 오픈 소스 클라이언트인
[Trinote](https://apps.apple.com/us/app/trinote/id6761228249)를 사용할 수 있습니다. 노트
트리를 탐색하고 구성하며, 서버에서 노트를 검색하고, 모든 노트 유형(텍스트, 코드, 마인드맵, 스프레드시트, 지리 지도, 캔버스 등)을 읽고
편집할 수 있습니다. 오프라인에서도 노트를 열고 편집할 수 있습니다. 기여하려면
[저장소](https://github.com/StephenArg/Trinote)를 확인하고, 의견이나 제안을 논의하려면
[Discord](https://discord.com/invite/ghjJG56EUS) 서버를 이용하세요.

### 서버

[Docker Hub](https://hub.docker.com/r/triliumnext/trilium)의 Docker를 포함하여 자체 서버에
TriliumNext를 설치하려면 [서버 설치
문서](https://docs.triliumnotes.org/user-guide/setup/server)를 따르세요.


## 💻 기여하기

### 번역

한국어 사용자라면 [Weblate 페이지](https://hosted.weblate.org/engage/trilium/)에서 Trilium
번역에 참여해 주세요.

현재까지 지원되는 언어는 다음과 같습니다:

[![번역
상태](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### 코드

저장소를 다운로드하고 `pnpm`으로 종속성을 설치한 다음 서버를 실행합니다(http://localhost:8080 에서 이용 가능):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### 문서

저장소를 다운로드하고 `pnpm`을 사용하여 종속성을 설치한 다음 문서 편집에 필요한 환경을 실행하세요.
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

또는 Nix가 설치되어 있다면 다음 명령을 사용하세요:
```shell
# Run directly
nix run .#edit-docs

# Or install to your profile
nix profile install .#edit-docs
trilium-edit-docs
```


### 실행 파일 빌드
저장소를 다운로드하고 `pnpm`을 사용하여 종속성을 설치한 다음 Windows용 데스크톱 앱을 빌드하세요.
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

자세한 내용은 [개발
문서](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide)를
확인하세요.

### 개발자 문서

자세한 내용은 [문서
안내서](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)를
확인하세요. 질문이 더 있다면 위의 ‘커뮤니티와 소통하기’ 섹션에 있는 링크를 통해 문의해 주세요.

## 💖 후원자

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

## 👏 감사의 말

* [zadam](https://github.com/zadam)은 애플리케이션의 최초 개념과 구현에 기여했습니다.
* [Sarah Hussein](https://github.com/Sarah-Hussein)은 애플리케이션 아이콘을 디자인했습니다.
* [nriver](https://github.com/nriver)는 국제화 작업에 기여했습니다.
* [Thomas Frei](https://github.com/thfrei)는 캔버스의 초기 구현에 기여했습니다.
* [antoniotejada](https://github.com/nriver)는 최초의 구문 강조 위젯을 만들었습니다.
* [Tabler Icons](https://tabler.io/icons)는 시스템 트레이 아이콘을 제공합니다.

Trilium은 다음 기반 기술이 있었기에 만들어질 수 있었습니다:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - 텍스트 노트용 시각적 편집기입니다.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - 수많은 언어를 지원하는 코드
  편집기입니다.
* [Excalidraw](https://github.com/excalidraw/excalidraw) - Canvas 노트에서 사용되는 무한
  화이트보드입니다.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - 마인드맵 기능을 제공합니다.
* [Leaflet](https://github.com/Leaflet/Leaflet) - 지리 지도를 렌더링합니다.
* [Tabulator](https://github.com/olifolkerd/tabulator) - 컬렉션에서 사용하는 대화형 표입니다.
* [FancyTree](https://github.com/mar10/fancytree) - 독보적으로 기능이 풍부한 트리 라이브러리입니다.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - 시각적 연결 라이브러리입니다. [관계
  맵](https://docs.triliumnotes.org/user-guide/note-types/relation-map)과 [링크
  맵](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)에
  사용됩니다

## 🤝 후원

Trilium은 [수백 시간에 걸친
작업](https://github.com/TriliumNext/Trilium/graphs/commit-activity)으로 개발되고 유지
관리됩니다. 후원금은 Trilium을 오픈 소스로 유지하고 기능을 개선하며 호스팅 등의 비용을 충당하는 데 사용됩니다.

애플리케이션의 주 개발자([eliandoran](https://github.com/eliandoran))를 다음 방법으로 후원해 주세요:

- [GitHub 스폰서](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 라이선스

Copyright 2017-2025 zadam, Elian Doran 및 기타 기여자

이 프로그램은 자유 소프트웨어입니다. Free Software Foundation에서 공표한 GNU Affero General Public
License 버전 3 또는 (선택에 따라) 그 이후 버전의 조건에 따라 이 프로그램을 재배포하거나 수정할 수 있습니다.
