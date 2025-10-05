# Trilium Notes

[English](../README.md) | [Chinese](./README-ZH_CN.md) | [Russian](./README-ru.md) | [Japanese](./README-ja.md) | [Italian](./README-it.md) | [Spanish](./README-es.md)

Trilium Notes は、大規模な個人知識ベースの構築に焦点を当てた、階層型ノートアプリケーションです。概要は[スクリーンショット](https://triliumnext.github.io/Docs/Wiki/screenshot-tour)をご覧ください：

<a href="https://triliumnext.github.io/Docs/Wiki/screenshot-tour"><img src="./app.png" alt="Trilium Screenshot" width="1000"></a>

## 🎁 特徴

* ノートは、任意の深さのツリーに配置できます。単一のノートをツリー内の複数の場所に配置できます ([cloning](https://triliumnext.github.io/Docs/Wiki/cloning-notes) を参照)
* マークダウン[オートフォーマット](https://triliumnext.github.io/Docs/Wiki/text-notes#autoformat)による、表、画像、[数学](https://triliumnext.github.io/Docs/Wiki/text-notes#math-support)などの豊富な WYSIWYG ノート編集機能
* シンタックスハイライトを含む[ソースコード付きノート](https://triliumnext.github.io/Docs/Wiki/code-notes)の編集をサポート
* [ノート間のナビゲーション](https://triliumnext.github.io/Docs/Wiki/note-navigation)、全文検索、[ノートホイスト](https://triliumnext.github.io/Docs/Wiki/note-hoisting)が高速かつ簡単に行えます
* シームレスな[ノートのバージョン管理](https://triliumnext.github.io/Docs/Wiki/note-revisions)
* ノート[属性](https://triliumnext.github.io/Docs/Wiki/Attributes)は、ノート整理、クエリ、高度な[スクリプト](https://triliumnext.github.io/Docs/Wiki/scripts)に使用できます
* 自己ホスト型同期サーバーとの[同期](https://triliumnext.github.io/Docs/Wiki/synchronization)
  * [同期サーバーをホストするサードパーティ・サービス](https://trilium.cc/paid-hosting)があります
* 公開インターネットへのノートの[共有](https://triliumnext.github.io/Docs/Wiki/sharing)(公開)
* ノートごとの粒度を持つ強力な[ノート暗号化](https://triliumnext.github.io/Docs/Wiki/protected-notes)
* 組み込みの Excalidraw を使用した図のスケッチ (ノート タイプ"キャンバス")
* ノートとその関係を可視化するための[関係図](https://triliumnext.github.io/Docs/Wiki/relation-map)と[リンクマップ](https://triliumnext.github.io/Docs/Wiki/link-map)
* [スクリプティング](https://triliumnext.github.io/Docs/Wiki/scripts) - [高度なショーケース](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)を参照
* 自動化のための [REST API](https://triliumnext.github.io/Docs/Wiki/etapi)
* ユーザビリティとパフォーマンスの両方で 100 000 ノート以上に拡張可能
* スマートフォンとタブレット向けのタッチ最適化[モバイルフロントエンド](https://triliumnext.github.io/Docs/Wiki/mobile-frontend)
* [ナイトテーマ](https://triliumnext.github.io/Docs/Wiki/themes)
* [Evernote](https://triliumnext.github.io/Docs/Wiki/evernote-import) と [Markdown のインポートとエクスポート](https://triliumnext.github.io/Docs/Wiki/Markdown)
* Web コンテンツを簡単に保存するための [Web クリッパー](https://triliumnext.github.io/Docs/Wiki/web-clipper)

サードパーティのテーマ、スクリプト、プラグインなどは、 [awesome-trilium](https://github.com/Nriver/awesome-trilium) をチェックしてください。

## 🏗 ビルド

Trilium は、デスクトップアプリケーション（Linux、Windows）またはサーバー上でホストされるウェブアプリケーション（Linux）として提供されます。 Mac OS のデスクトップビルドも利用可能ですが、 [unsupported](https://triliumnext.github.io/Docs/Wiki/faq#mac-os-support) となっています。

* デスクトップで Trilium を使用したい場合は、 [latest release](https://github.com/TriliumNext/Trilium/releases/latest) からお使いのプラットフォームのバイナリリリースをダウンロードし、パッケージを解凍して ``trilium`` の実行ファイルを実行してください。
* サーバーに Trilium をインストールする場合は、[このページ](https://triliumnext.github.io/Docs/Wiki/server-installation)に従ってください。
  * 現在、対応（動作確認）しているブラウザは、最近の Chrome と Firefox のみです。

Trilium は Flatpak としても提供されます：

[<img width="240" src="https://flathub.org/assets/badges/flathub-badge-en.png">](https://flathub.org/apps/details/com.github.zadam.trilium)

## 📝 ドキュメント

[ドキュメントページの全リストはwikiをご覧ください。](https://triliumnext.github.io/Docs/)

また、[個人的な知識基盤のパターン](https://triliumnext.github.io/Docs/Wiki/patterns-of-personal-knowledge)を読むと、 Trilium の使い方のヒントを得ることができます。

## 💻 コントリビュート

または、ローカルにクローンして実行

```shell
npm install
npm run server:start
```

## 📢 シャウトアウト

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - 市場で最高の WYSIWYG エディター、非常にインタラクティブで聞き上手なチーム
* [FancyTree](https://github.com/mar10/fancytree) - 真の競争相手がいない、非常に機能豊富なツリーライブラリです。 Trilium Notes は、これなしでは成り立たないでしょう。
* [CodeMirror](https://github.com/codemirror/CodeMirror) - 膨大な数の言語をサポートするコードエディタ
* [jsPlumb](https://github.com/jsplumb/jsplumb) - 競合のないビジュアルコネクティビティライブラリです。[関係図](https://triliumnext.github.io/Docs/Wiki/relation-map)、[リンク図](https://triliumnext.github.io/Docs/Wiki/link-map)で使用。

## 🤝 サポート

GitHub スポンサー、[PayPal](https://paypal.me/za4am)もしくは Bitcoin (bitcoin:bc1qv3svjn40v89mnkre5vyvs2xw6y8phaltl385d2) にて Trilium をサポートすることができます。

## 🔑 ライセンス

このプログラムはフリーソフトウェアです：フリーソフトウェア財団が発行した GNU Affero General Public License のバージョン3、またはそれ以降のバージョンのいずれかに従って、再配布および/または改変することができます。
