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
![GitHub ダウンロード
(全アセット、全リリース)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![翻訳状況](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Chinese (Simplified Han script)](./README-ZH_CN.md) | [Chinese (Traditional Han
script)](./README-ZH_TW.md) | [English](../README.md) | [French](./README-fr.md)
| [German](./README-de.md) | [Greek](./README-el.md) | [Italian](./README-it.md)
| [Japanese](./README-ja.md) | [Romanian](./README-ro.md) |
[Spanish](./README-es.md)
<!-- translate:on -->

Trilium Notes
は、大規模な個人知識ベースの構築に重点を置いた、無料かつオープンソースのクロスプラットフォームの階層型ノート作成アプリケーションです。

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ ダウンロード
- [最新リリース](https://github.com/TriliumNext/Trilium/releases/latest) –
  安定バージョン。ほとんどのユーザーに推奨されます。
- [ナイトリービルド](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  不安定な開発バージョン。最新の機能と修正が毎日更新されます。

## 📚 ドキュメント

**包括的なドキュメントは [docs.triliumnotes.org](https://docs.triliumnotes.org/) でご覧ください**

当社のドキュメントは複数の形式でご利用いただけます:
- **オンラインドキュメント**: [docs.triliumnotes.org](https://docs.triliumnotes.org/)
  で完全なドキュメントを参照してください
- **アプリ内ヘルプ**: Trilium内で `F1` キーを押すと、アプリケーション内で同じドキュメントに直接アクセスできます
- **GitHub**: このリポジトリの [ユーザーガイド](./User%20Guide/User%20Guide/) を参照してください

### クイックリンク
- [スタートガイド](https://docs.triliumnotes.org/)
- [インストール手順](https://docs.triliumnotes.org/user-guide/setup)
- [Docker
  のセットアップ](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [TriliumNext
  のアップグレード](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [基本概念と機能](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [個人ナレッジベースのパターン](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 機能

* ノートは任意の深さのツリーに配置できます。1つのノートをツリー内の複数の場所に配置できます（[クローン](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning)を参照）
* 豊富な WYSIWYG ノートエディター 例:
  表、画像、[数式](https://docs.triliumnotes.org/user-guide/note-types/text) とマークダウン
  [自動フォーマット](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
  など
* 構文ハイライト表示を含む
  [ソースコード付きノート](https://docs.triliumnotes.org/user-guide/note-types/code)
  の編集をサポート
* [ノート間のナビゲーション](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation)、全文検索、[ノートのホイスト](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
  が高速かつ簡単に行えます
* シームレスな
  [ノートのバージョン管理](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* ノート[属性](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  は、ノートの整理、クエリ、高度な [スクリプト](https://docs.triliumnotes.org/user-guide/scripts)
  に使用できます
* UI は英語、ドイツ語、スペイン語、フランス語、ルーマニア語、中国語（簡体字および繁体字）でご利用いただけます
* より安全なログインのための直接的な
  [OpenIDとTOTPの統合](https://docs.triliumnotes.org/user-guide/setup/server/mfa)
* セルフホスト同期サーバーとの
  [同期](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  * [同期サーバーをホストするためのサードパーティサービス](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)があります
* インターネット上でノートの
  [共有](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)（公開）
* ノートごとに調整可能で強力な
  [ノート暗号化](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
* [Excalidraw](https://excalidraw.com/) をベースにした図のスケッチ（ノートタイプ「キャンバス」）
* ノートとその関係を視覚化するための[リレーションマップ](https://docs.triliumnotes.org/user-guide/note-types/relation-map)と[ノート/リンクマップ](https://docs.triliumnotes.org/user-guide/note-types/note-map)
* [Mind Elixir](https://docs.mind-elixir.com/) をベースとしたマインドマップ
* 位置ピンと GPX トラック付きの
  [ジオマップ](https://docs.triliumnotes.org/user-guide/collections/geomap)
* [スクリプト](https://docs.triliumnotes.org/user-guide/scripts) -
  [高度なショーケース](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
  を参照
* 自動化のための [REST
  API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi)
* 10万件以上のノートでも、使いやすさとパフォーマンスの両面に優れた拡張性を実現
* スマートフォンとタブレット向けにタッチ操作に最適化された
  [モバイルフロントエンド](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend)
* 組み込みの
  [ダークテーマ](https://docs.triliumnotes.org/user-guide/concepts/themes)、ユーザーテーマのサポート
* [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  と [Markdown
  のインポートとエクスポート](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper) で
  web コンテンツを簡単に保存
* カスタマイズ可能な UI (サイドバー ボタン、ユーザー定義のウィジェットなど)
* [Metrics](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics) と
  Grafana ダッシュボード。

✨ TriliumNext 関連のその他の情報については、次のサードパーティのリソース/コミュニティをご覧ください:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium)
  サードパーティのテーマ、スクリプト、プラグインなど。
- [TriliumRocks!](https://trilium.rocks/) ではチュートリアルやガイドなど、その他多数。

## ❓なぜTriliumNext なのか？

オリジナルの Trilium 開発者 ([Zadam](https://github.com/zadam))
は、https://github.com/TriliumNext にあるコミュニティプロジェクトに Trilium リポジトリを快く提供してくれました

### ⬆️Zadam/Trilium から移行しますか?

zadam/Trilium インスタンスから TriliumNext/Trilium インスタンスへの移行には特別な手順はありません。通常通り
[TriliumNext/Triliumをインストール](#-installation) するだけで、既存のデータベースが使用されます。

[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4)
までのバージョンは、最新の zadam/trilium バージョン
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7)
と互換性があります。それ以降のバージョンの TriliumNext/Trilium では同期バージョンがインクリメントされるため、直接移行することはできません。

## 💬 私たちと議論しましょう

ぜひ公式の会話にご参加ください。機能に関するご意見、ご提案、問題など、ぜひお聞かせください！

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) （同期ディスカッション用）
  - `General`マトリックスルームも [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
    にブリッジされています
- [Github Discussions](https://github.com/TriliumNext/Trilium/discussions)
  (非同期ディスカッション用)
- [Github Issues](https://github.com/TriliumNext/Trilium/issues)
  (バグレポートや機能リクエスト用)

## 🏗 インストール

### Windows / MacOS

[最新リリース ページ](https://github.com/TriliumNext/Trilium/releases/latest)
からプラットフォーム用のバイナリ リリースをダウンロードし、パッケージを解凍して `trilium` 実行可能ファイルを実行します。

### Linux

ディストリビューションが以下の表に記載されている場合は、ディストリビューションのパッケージを使用してください。

[![Packaging
status](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

[最新リリース ページ](https://github.com/TriliumNext/Trilium/releases/latest)
からプラットフォーム用のバイナリ リリースをダウンロードし、パッケージを解凍して `trilium` 実行可能ファイルを実行することもできます。

TriliumNext は Flatpak としても提供されていますが、FlatHub ではまだ公開されていません。

### ブラウザ（どのOSでも）

サーバーインストール (下記参照) を使用する場合は、web インターフェイス (デスクトップアプリとほぼ同じ) に直接アクセスできます。

現在、Chrome と Firefox の最新バージョンのみがサポート (およびテスト) されています。

### モバイル

モバイルデバイスで TriliumNext を使用するには、モバイル web
ブラウザーを使用して、サーバーインストールのモバイルインターフェイスにアクセスできます (以下を参照)。

モバイルアプリのサポートの詳細については、issue https://github.com/TriliumNext/Trilium/issues/4962
を参照してください。

ネイティブAndroidアプリをご希望の場合は、[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid)
をご利用いただけます。バグや不足している機能は [リポジトリ](https://github.com/FliegendeWurst/TriliumDroid)
でご報告ください。注：TriliumDroidを使用する場合は、TriliumとTriliumDroidの同期バージョンが一致している必要があるため、サーバーインストールで自動更新を無効にすることをお勧めします（下記参照）。

### サーバー

独自のサーバーに TriliumNext をインストールするには
([Dockerhub](https://hub.docker.com/r/triliumnext/trilium) から Docker
経由でも含む)、[サーバーのインストール
ドキュメント](https://docs.triliumnotes.org/user-guide/setup/server) に従ってください。


## 💻 貢献する

### 翻訳

ネイティブスピーカーの方は、[Weblate ページ](https://hosted.weblate.org/engage/trilium/)
にアクセスして、Trilium の翻訳にご協力ください。

これまでにカバーされている言語は次のとおりです:

[![翻訳状況](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### コード

リポジトリをダウンロードし、`pnpm` を使用して依存関係をインストールしてから、サーバーを実行します (http://localhost:8080
で利用可能):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### ドキュメント

リポジトリをダウンロードし、`pnpm` を使用して依存関係をインストールし、ドキュメントを編集するために必要な環境を実行します:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### 実行ファイルの構築
リポジトリをダウンロードし、`pnpm` を使用して依存関係をインストールし、Windows 用のデスクトップアプリをビルドします:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

詳細については、[開発ドキュメント](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide)
を参照してください。

### 開発者向けドキュメント

詳細については、[ドキュメントガイド](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
をご覧ください。ご質問がございましたら、上記の「私たちと議論しましょう」セクションに記載されているリンクからお気軽にお問い合わせください。

## 👏 シャウトアウト

* [zadam](https://github.com/zadam) アプリケーションのオリジナルのコンセプトと実装に対して感謝します。
* [Sarah Hussein](https://github.com/Sarah-Hussein) アプリケーションアイコンをデザイン。
* [nriver](https://github.com/nriver) 国際化への取り組み。
* [Thomas Frei](https://github.com/thfrei) Canvasへのオリジナルな取り組み。
* [antoniotejada](https://github.com/nriver) オリジナルの構文ハイライトウィジェット。
* [Dosu](https://dosu.dev/) GitHub の問題やディスカッションに対する自動応答を提供してくれました。
* [Tabler Icons](https://tabler.io/icons) システムトレイアイコン。

Trilium は、その基盤となる技術なしには実現できませんでした:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) -
  テキストノートを補完するビジュアルエディター。プレミアム機能を提供していただき、感謝いたします。
* [CodeMirror](https://github.com/codemirror/CodeMirror) -
  膨大な数の言語をサポートするコードエディター。
* [Excalidraw](https://github.com/excalidraw/excalidraw) - Canvas
  ノートで使用される無限のホワイトボード。
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) -
  マインドマップ機能を提供します。
* [Leaflet](https://github.com/Leaflet/Leaflet) - 地理マップをレンダリングします。
* Tabulator](https://github.com/olifolkerd/tabulator) -
  コレクションで使用されるインタラクティブなテーブル。
* [FancyTree](https://github.com/mar10/fancytree) - 他に類を見ない機能豊富なツリーライブラリ。
* [jsPlumb](https://github.com/jsplumb/jsplumb) -
  視覚的な接続ライブラリ。[リレーションマップ](https://docs.triliumnotes.org/user-guide/note-types/relation-map)
  と
  [リンクマップ](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)
  で使用されます

## 🤝 サポート

Triliumは
[数百時間もの作業](https://github.com/TriliumNext/Trilium/graphs/commit-activity)
によって構築・維持されています。皆様のご支援により、オープンソースとしての維持、機能の向上、ホスティングなどの費用を賄うことができます。

次の方法で、アプリケーションの主な開発者 ([eliandoran](https://github.com/eliandoran))
をサポートすることを検討してください:

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 ライセンス

著作権 2017-2025 zadam、Elian Doran、その他寄稿者

このプログラムはフリーソフトウェアです: フリーソフトウェア財団(Software Foundation) が発行する GNU Affero
一般公衆利用許諾書(GNU Affero General Public License) のバージョン 3、または (選択により)
それ以降のバージョンの規約に従って、このプログラムを再配布および/または改変することができます。
