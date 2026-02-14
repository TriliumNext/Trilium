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
![Unduhan GitHub (semua aset, semua
rilis)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Status
terjemahan](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Chinese (Simplified Han script)](./README-ZH_CN.md) | [Chinese (Traditional Han
script)](./README-ZH_TW.md) | [English](../README.md) | [French](./README-fr.md)
| [German](./README-de.md) | [Greek](./README-el.md) | [Italian](./README-it.md)
| [Japanese](./README-ja.md) | [Romanian](./README-ro.md) |
[Spanish](./README-es.md)
<!-- translate:on -->

Trilium Notes adalah aplikasi pencatatan hierarkis lintas platform yang gratis
dan sumber terbuka dengan fokus untuk mengembangkan pengetahuan pribadi yang
luas.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ Unduh
- [Rilis terbaru](https://github.com/TriliumNext/Trilium/releases/latest) –
  versi stabil, direkomendasikan.
- [Rilis nightly](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  versi pengembangan, tidak stabil, diperbarui setiap hari dengan fitur dan
  perbaikan terbaru.

## 📚 Dokumentasi

**Kunjungi dokumentasi lengkap kami di
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Dokumentasi kami tersedia dalam berbagai format:
- **Dokumentasi Online**: Telusuri dokumentasi lengkap di
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Bantuan Dalam Aplikasi**: Tekan `F1` di dalam Trilium untuk mengakses
  dokumentasi yang sama langsung di aplikasi
- **GitHub**: Navigasi melalui [Panduan Pengguna](./User%20Guide/User%20Guide/)
  di repositori ini

### Tautan Cepat
- [Panduan Memulai](https://docs.triliumnotes.org/)
- [Petunjuk Instalasi](https://docs.triliumnotes.org/user-guide/setup)
- [Pengaturan
  Docker](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [Pembaharuan
  TriliumNext](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [Konsep dan Fitur
  Dasar](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [Pola Basis Pengetahuan
  Pribadi](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 Fitur

* Catatan dapat disusun menjadi cabang pohon manapun. Satu catatan dapat disusun
  ke beberapa cabang di pohon
  (lihat[cloning](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* Catatan bentuk Rich WYSIWYG dengan tabel, gambar, dan
  [math](https://docs.triliumnotes.org/user-guide/note-types/text) dengan
  markdown
  [autoformat](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
* Dukungan untuk peng-editan [catatan dengan kode
  source](https://docs.triliumnotes.org/user-guide/note-types/code), termasuk
  penyorotan sintaks
* Cepat dan mudah [navigasi antar
  catatan](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation),
  pencarian dengan teks dan [area
  fokus](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* Mulus [versi
  catatan](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* Catatan
  [atribut](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  dapat digunakan untuk mengatur catatan, pencarian dan tingkat lanjut
  [pemrograman](https://docs.triliumnotes.org/user-guide/scripts)
* Antarmuka pengguna tersedia dalam bahasa Inggris, Jerman, Spanyol, Prancis,
  Rumania, dan Tionghoa (sederhana dan tradisional)
* Integrasi [OpenID dan TOTP
  langsung](https://docs.triliumnotes.org/user-guide/setup/server/mfa) untuk
  login yang lebih aman
* [Sinkronisasi](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  dengan server hostingan pribadi
  * ada [servis pihak ke-3 untuk server hostingan
    sinkronisasi](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [Bagikan](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  (publikasi) catatan ke publik (internet)
* Kuat [enkripsi
  catatan](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  dengan granularitas per catatan
* Membuat diagram, berdasarkan [Excalidraw](https://excalidraw.com/) (tipe
  catatan "kanvas")
* [Peta
  relasi](https://docs.triliumnotes.org/user-guide/note-types/relation-map) dan
  [peta
  catatan/link](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  untuk visualisasi relasi antar catatan
* Mind maps, berdasarkan [Mind Elixir](https://docs.mind-elixir.com/)
* [Peta geolokasi](https://docs.triliumnotes.org/user-guide/collections/geomap)
  dengan titik lokasi dan jalur GPX
* [Pengunaan skrip](https://docs.triliumnotes.org/user-guide/scripts) - lihat
  [Demo tingkat
  lanjut](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [REST API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi)
  untuk otomatisasi
* Performa dan Usabilitas tinggi, bahkan di atas 100 000 catatan
* Teroptimisasi untuk kontrol sentuh [frontend
  mobile](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend) untuk
  hp dan tablet
* [tema gelap](https://docs.triliumnotes.org/user-guide/concepts/themes) bawaan,
  dukungan untuk tema personal pengguna
* [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  dan [impor & ekspor
  markdown](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Penyemat Web](https://docs.triliumnotes.org/user-guide/setup/web-clipper)
  untuk memudahkan pencatatan konten web
* "UI yang dapat dikustomisasi (tombol sidebar, widget kustom, ...)"
* [Berbagai
  Metrik](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics) yang
  dipadukan dengan Dashboard Grafana.

✨ Cek lebih lanjut sumber daya/komunitas pihak ke-tiga untuk menikmati lebih
lanjut TriliumNext:

- [trilium-beken](https://github.com/Nriver/awesome-trilium) untuk banyak tema,
  skrip, plugin pihak ke-3 dan lain-lain.
- [TriliumJaya!](https://trilium.rocks/) untuk tutorial, panduan dan lainnya.

## ❓Mengapa TriliumNext?

Pengembang asli Trilium ([Zadam](https://github.com/zadam)) dengan murah hati
telah memberikan repositori Trilium kepada proyek komunitas yang berada di
https://github.com/TriliumNext

### ⬆️ Memindahkan dari Zadam/Trilium?

Tidak ada langkah migrasi khusus untuk bermigrasi dari zadam/Trilium ke
TriliumNext/Trilium. Cukup [instal TriliumNext/Trilium](#-installation) seperti
biasa dan akan menggunakan basis data yang sudah ada.

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
- [Diskusi Github](https://github.com/TriliumNext/Trilium/discussions) (Untuk
  diskusi asinkron.)
- [Github Issues](https://github.com/TriliumNext/Trilium/issues) (For bug
  reports and feature requests.)

## 🏗 Instalasi

### Windows / MacOS

Unduh rilis biner untuk platform Anda dari [halaman rilis
terbaru](https://github.com/TriliumNext/Trilium/releases/latest), ekstrak
package dan jalankan file executable `trilium`.

### Linux

Jika distribusi Anda tercantum dalam tabel di bawah ini, gunakan package dari
distribusi Anda tersebut.

[![Status
packaging](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

Anda juga dapat mengunduh rilis biner untuk platform Anda dari [halaman rilis
terbaru](https://github.com/TriliumNext/Trilium/releases/latest), ekstrak
package-nya dan jalankan file executable `trilium`.

TriliumNext juga tersedia sebagai Flatpak, namun belum dipublikasikan di
FlatHub.

### Browser (OS apapun)

Jika Anda menggunakan instalasi server (lihat di bawah), Anda dapat langsung
mengakses antarmuka web (yang hampir identik dengan aplikasi desktop).

Saat ini hanya Chrome & Firefox versi terbaru yang didukung (dan telah diuji).

### Ponsel

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

### Server

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

For more details, see the [development
docs](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

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

Trilium tidak akan ada tanpa teknologi-teknologi di balik berikut:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - editor visual dibalik
  catatan teks. Kami sangat berterima kasih diberikan fitur-fitur editor yang
  premium.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - editor kode dengan
  dukungan banyak bahasa pemrograman.
* [Excalidraw](https://github.com/excalidraw/excalidraw) - area catatan tanpa
  batas yang dipakai di catatan Kanvas.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - memberikan
  fungsionalitas peta pikiran(mind map).
* [Leaflet](https://github.com/Leaflet/Leaflet) - untuk render peta geografikal.
* [Tabulator](https://github.com/olifolkerd/tabulator) - untuk tabel interaktif
  yang dipakai di koleksi catatan.
* [FancyTree](https://github.com/mar10/fancytree) - library pohon yang kaya akan
  fitur tanpa ada saingan.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - library konektivitas visual.
  Dipakai di [peta
  relasi](https://docs.triliumnotes.org/user-guide/note-types/relation-map) and
  [peta
  hubungan](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 Dukungan

Trilium dibangun dan diperlihara oleh [banyak developer dan
waktu](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Dukungan
Anda yang membuat Trilium open-source, menambah dan mengembangkan fitur, juga
menutupi beban biaya hosting kami.

Berikan dukungan ke developer utama
([eliandoran](https://github.com/eliandoran)) melalui:

- [Sponsor-Sponsor GitHub](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 License

Copyright 2017-2025 zadam, Elian Doran, and other contributors

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.
