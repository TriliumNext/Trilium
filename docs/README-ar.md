<div align="center">
	<sup>Special thanks to:</sup><br />
	<a href="https://go.warp.dev/Trilium" target="_blank">		
		<img alt="Warp sponsorship" width="400" src="https://github.com/warpdotdev/brand-assets/blob/main/Github/Sponsor/Warp-Github-LG-03.png"><br />
		Warp, built for coding with multiple AI agents<br />
	</a>
  <sup>Available for macOS, Linux and Windows</sup>
</div>

<hr />

# ملاحظات تريليوم

![رعاة GitHub](https://img.shields.io/github/sponsors/eliandoran) ![داعمو
LiberaPay](https://img.shields.io/liberapay/patrons/ElianDoran)\
![عمليات سحب Docker](https://img.shields.io/docker/pulls/triliumnext/trilium)
![تنزيلات GitHub (جميع الأصول، جميع
الإصدارات)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![حالة
الترجمة](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Chinese (Simplified Han script)](./README-ZH_CN.md) | [Chinese (Traditional Han
script)](./README-ZH_TW.md) | [English](../README.md) | [French](./README-fr.md)
| [German](./README-de.md) | [Greek](./README-el.md) | [Italian](./README-it.md)
| [Japanese](./README-ja.md) | [Romanian](./README-ro.md) |
[Spanish](./README-es.md)
<!-- translate:on -->

تريليوم هو برنامج مجاني مفتوح المصدر، يمكن استخدامه في أكثر من جهاز بنفس الوقت،
مبني على كتابة الملاحظات بالتفرعات الشجرية مع التركيز على بناء قاعدة بيانات
معرفية ضخمة.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⬇️ تنزيل
- [النسخة الأخيرة](https://github.com/TriliumNext/Trilium/releases/latest) –
  نسخة مستقرة، محبذة لأكثر المستخدمين.
- [الإصدار الليلي](https://github.com/TriliumNext/Trilium/releases/tag/nightly)
  – إصدار تطوير غير مستقر، يتم تحديثه يوميًا بأحدث الميزات والإصلاحات.

## 📚توثيق

**يمكنكم الاطلاع على وثائقنا الشاملة على الرابط التالي:
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

يتوفر التوثيق لدينا بصيغ متعددة:
- **الوثائق الإلكترونية**: تصفح الوثائق الكاملة على
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **المساعدة داخل التطبيق**: اضغط على مفتاح `F1` داخل تطبيق Trilium للوصول إلى
  نفس الوثائق مباشرةً داخل التطبيق
- **GitHub**: تصفح [دليل المستخدم](./User%20Guide/User%20Guide/) في هذا المستودع

### روابط سريعة
- [دليل البدء السريع](https://docs.triliumnotes.org/)
- [تعليمات التثبيت](https://docs.triliumnotes.org/user-guide/setup)
- [اعداد
  Docker](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [ترقية تريليوم
  للملاحظات](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [مفاهيم ومميزات
  اساسية](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [أنماط قاعدة المعرفة
  الشخصية](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁الميزات

* يمكن ترتيب النوتات الموسيقية في شجرة ذات عمق غير محدود. ويمكن وضع نوتة واحدة
  في أماكن متعددة في الشجرة (انظر
  [الاستنساخ](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* محرر ملاحظات WYSIWYG غني يتضمن على سبيل المثال الجداول والصور
  و[الرياضيات](https://docs.triliumnotes.org/user-guide/note-types/text) مع
  تنسيق تلقائي لـ Markdown[2]
* دعم تحرير [الملاحظات التي تحتوي على شفرة
  المصدر](https://docs.triliumnotes.org/user-guide/note-types/code)، بما في ذلك
  تمييز بناء الجملة
* التنقل السريع والسهل بين الملاحظات
  (https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation)،
  والبحث في النص الكامل، ورفع الملاحظات
  (https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* سلس [ملاحظة حول إصدار
  النظام](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* يمكن استخدام
  [السمات](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  لتنظيم الملاحظات والاستعلام عنها و[البرمجة
  النصية](https://docs.triliumnotes.org/user-guide/scripts) المتقدمة
* UI available in English, German, Spanish, French, Romanian, and Chinese
  (simplified and traditional)
* Direct [OpenID and TOTP
  integration](https://docs.triliumnotes.org/user-guide/setup/server/mfa) for
  more secure login
* [Synchronization](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  with self-hosted sync server
  * there are [3rd party services for hosting synchronisation
    server](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [Sharing](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  (publishing) notes to public internet
* Strong [note
  encryption](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  with per-note granularity
* Sketching diagrams, based on [Excalidraw](https://excalidraw.com/) (note type
  "canvas")
* [Relation
  maps](https://docs.triliumnotes.org/user-guide/note-types/relation-map) and
  [note/link maps](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  for visualizing notes and their relations
* Mind maps, based on [Mind Elixir](https://docs.mind-elixir.com/)
* [Geo maps](https://docs.triliumnotes.org/user-guide/collections/geomap) with
  location pins and GPX tracks
* [Scripting](https://docs.triliumnotes.org/user-guide/scripts) - see [Advanced
  showcases](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [واجهة REST
  API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi) للأتمتة
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

## ❓لماذا تريليوم التالي؟

The original Trilium developer ([Zadam](https://github.com/zadam)) has
graciously given the Trilium repository to the community project which resides
at https://github.com/TriliumNext

### ⬆️ الهجرة من Zadam الى تريليوم؟

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

## 💬تحدث معنا

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

## 🏗️ تثبيت

### ويندوز / نظام تشغيل ماك

Download the binary release for your platform from the [latest release
page](https://github.com/TriliumNext/Trilium/releases/latest), unzip the package
and run the `trilium` executable.

### لينكس

If your distribution is listed in the table below, use your distribution's
package.

[![Packaging
status](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

You may also download the binary release for your platform from the [latest
release page](https://github.com/TriliumNext/Trilium/releases/latest), unzip the
package and run the `trilium` executable.

TriliumNext is also provided as a Flatpak, but not yet published on FlatHub.

### مستعرض( اي نظام تشغيل)

If you use a server installation (see below), you can directly access the web
interface (which is almost identical to the desktop app).

Currently only the latest versions of Chrome & Firefox are supported (and
tested).

### هاتف المحمول

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

### الخادم

To install TriliumNext on your own server (including via Docker from
[Dockerhub](https://hub.docker.com/r/triliumnext/trilium)) follow [the server
installation docs](https://docs.triliumnotes.org/user-guide/setup/server).


## 💻 المساهمة

### ترجمات

If you are a native speaker, help us translate Trilium by heading over to our
[Weblate page](https://hosted.weblate.org/engage/trilium/).

Here's the language coverage we have so far:

[![Translation
status](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### كود

Download the repository, install dependencies using `pnpm` and then run the
server (available at http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### التوثيق

Download the repository, install dependencies using `pnpm` and then run the
environment required to edit the documentation:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### بناء الملف التنفيذي
Download the repository, install dependencies using `pnpm` and then build the
desktop app for Windows:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

For more details, see the [development
docs](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### توثيق المطور

Please view the [documentation
guide](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
for details. If you have more questions, feel free to reach out via the links
described in the "Discuss with us" section above.

## 👏 اشادات

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

## 🤝 الدعم

Trilium is built and maintained with [hundreds of hours of
work](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Your
support keeps it open-source, improves features, and covers costs such as
hosting.

Consider supporting the main developer
([eliandoran](https://github.com/eliandoran)) of the application via:

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 الترخيص

Copyright 2017-2025 zadam, Elian Doran, and other contributors

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.
