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
![GitHub Downloads (mọi tài nguyên, mọi bản phát
hành)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Tình trạng dịch
thuật](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Chinese (Simplified Han script)](./README-ZH_CN.md) | [Chinese (Traditional Han
script)](./README-ZH_TW.md) | [English](../README.md) | [French](./README-fr.md)
| [German](./README-de.md) | [Greek](./README-el.md) | [Italian](./README-it.md)
| [Japanese](./README-ja.md) | [Romanian](./README-ro.md) |
[Spanish](./README-es.md)
<!-- translate:on -->

Trilium Notes là một ứng dụng ghi chú phân cấp miễn phí, mã nguồn mở, đa nền
tảng tập trung vào việc xây dựng cơ sở tri thức cá nhân lớn.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ Tải xuống
- [Bản phát hành mới
  nhất](https://github.com/TriliumNext/Trilium/releases/latest) – phiên bản ổn
  định, được khuyên dùng cho hầu hết người dùng.
- [Bản dựng
  nightly](https://github.com/TriliumNext/Trilium/releases/tag/nightly) – phiên
  bản phát triển kém ổn định, được cập nhật hàng ngày với các tính năng mới nhất
  và sửa lỗi.

## 📚 Tài Liệu

**Truy cập tài liệu toàn diện của chúng tôi tại
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Tài liệu của chúng tôi có sẵn ở nhiều định dạng:
- **Tài liệu trực tuyến**: Xem tài liệu đầy đủ tại
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Trợ giúp trong ứng dụng**: Nhấn `F1` trong Trilium để truy cập tài liệu
  tương tự trực tiếp trong ứng dụng
- **Github**: Đi đến [Hướng dẫn sử dụng] trong kho lưu trữ này

### Liên Kết Nhanh
- [Hướng Dẫn Bắt Đầu](https://docs.triliumnotes.org/)
- [Hướng Dẫn Cài Đặt](https://docs.triliumnotes.org/user-guide/setup)
- [Thiết Lập
  Docker](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [Cập Nhật
  TriliumNext](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [Khái Niệm Và Chức Năng Cơ
  Bản](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [Các Mẫu Cơ Sở Tri Thức Cá
  Nhân](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 Chức Năng

* Các ghi chú có thể được sắp xếp thành cây có độ sâu bất kỳ. Một ghi chú có thể
  được đặt vào nhiều nơi trong cây (xem
  [cloning](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* Trình soạn thảo ghi chú WYSIWYG đầy đủ tính năng, hỗ trợ bảng, hình ảnh, và
  [toán học](https://docs.triliumnotes.org/user-guide/note-types/text); đồng
  thời [tự động định
  dạng](https://docs.triliumnotes.org/user-guide/note-types/text) sang markdown
* Hỗ trợ chỉnh sửa [ghi chú chứa mã
  nguồn](https://docs.triliumnotes.org/user-guide/note-types/code), kèm tô sáng
  cú pháp
* [Điều hướng giữa các ghi
  chú](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation)
  nhanh và dễ dàng, tìm kiếm toàn văn và [note
  hoisting](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* Quản lý [phiên bản ghi
  chú](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
  mượt mà
* [Các thuộc
  tính](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes) ghi
  chú có thể được dùng cho việc tổ chức, truy xuất và [viết
  script](https://docs.triliumnotes.org/user-guide/scripts) nâng cao
* Giao diện sẵn có cho Tiếng Anh, Tiếng Đức, Tiếng Tây Ban Nha, Tiếng Pháp,
  Tiếng Rumani, và Tiếng Trung (giản thể và phồn thể)
* [Tích hợp OpenID và
  TOTP](https://docs.triliumnotes.org/user-guide/setup/server/mfa) trực tiếp để
  đăng nhập bảo mật hơn
* [Đồng bộ hóa](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  với máy chủ đồng bộ tự triển khai
  * there are [3rd party services for hosting synchronisation
    server](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [Chia sẻ](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  (công bố) các ghi chú lên mạng Internet công cộng
* [Mã hóa ghi
  chú](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  mạnh mẽ với mức chi tiết đến từng ghi chú
* Phác thảo sơ đồ, dựa trên [Excalidraw](https://excalidraw.com/) (loại ghi chú
  "canvas")
* [Relation
  maps](https://docs.triliumnotes.org/user-guide/note-types/relation-map) and
  [note/link maps](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  for visualizing notes and their relations
* Sơ đồ tư duy, dựa trên [Mind Elixir](https://docs.mind-elixir.com/)
* [Bản đồ địa lý](https://docs.triliumnotes.org/user-guide/collections/geomap)
  với các chấm chỉ vị trí và các đường GPX
* [Viết script](https://docs.triliumnotes.org/user-guide/scripts) - xem [Mục
  trưng bày nâng
  cao](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [REST API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi) cho
  tự động hóa
* Mở rộng tốt về cả khả năng sử dụng và hiệu năng lên đến 100.000 ghi chú
* Tối ưu hóa cảm ứng [mobile
  frontend](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend) cho
  điện thoại thông minh và máy tính bảng
* Tích hợp sẵn [giao diện
  tối](https://docs.triliumnotes.org/user-guide/concepts/themes), hỗ trợ giao
  diện do người dùng tùy chỉnh
* Hỗ trợ nhập, xuất cho
  [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  và
  [Markdown](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper) để
  lưu trữ nội dung web dễ dàng
* Giao diện tùy biến (nút thanh bên, widget do người dùng tự tạo,...)
* [Metrics](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics),
  along with a Grafana Dashboard.

✨ Hãy xem thử các nguồn tài nguyên/cộng đồng bên thứ ba dưới đây để tìm thêm
nhiều tiện ích liên quan đến TriliumNext:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) cho các chủ đề,
  script, plugin và nhiều hơn nữa.
- [TriliumRocks!](https://trilium.rocks/) cho những hướng dẫn, và nhiều hơn.

## ❓Tại sao là TriliumNext?

Người phát triển ban đầu của Trilium ([Zadam](https://github.com/zadam)) đã hào
phóng tặng kho lưu trữ Trilium cho dự án cộng đồng, hiện đang đặt tại
https://github.com/TriliumNext

### ⬆️ Chuyển từ Zadam/Trilium?

Không cần những bước chuyển đặc biệt nào để chuyển từ zadam/Trilium sang
TriliumNext/Trilium. Đơn giản chỉ cần [cài đặt
TriliumNext/Trilium](#-installation) như thông thường và nó sẽ sử dụng cơ sở dữ
liệu sẵn có của bạn.

Các phiên bản trước và bao gồm
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) đều tương
thích với phiên bản mới nhất của zadam/trilium
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). Các phiên bản
sau đó của TriliumNext/Trilium đã tăng phiên bản đồng bộ, khiến việc chuyển sang
trực tiếp không còn khả thi.

## 💬 Thảo luận cùng chúng tôi

Hãy thoải mái tham gia các cuộc trò chuyện chính thức. Chúng tôi luôn muốn lắng
nghe các tính năng, đề xuất hoặc vấn đề mà bạn đưa ra!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (Cho những thảo luận
  đồng bộ thời gian thực.)
  - Phòng `General` trong Matrix cũng được kết nối tới
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [Github Discussions](https://github.com/TriliumNext/Trilium/discussions) (Cho
  những thảo luận không đồng bộ.)
- [Github Issues](https://github.com/TriliumNext/Trilium/issues) (Cho việc báo
  cáo lỗi và yêu cầu tính năng.)

## 🏗 Cài Đặt

### Windows / MacOS

Tải bản phát hành nhị phân cho nền tảng của bạn từ [trang phát hành mới
nhất](https://github.com/TriliumNext/Trilium/releases/latest), giải nén gói và
chạy tệp thực thi `trilium`.

### Linux

Nếu bản phân phối của bạn được liệt kê trong bảng dưới đấy, hãy dùng gói cài đặt
của nó.

[![Tình trạng đóng
gói](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

You may also download the binary release for your platform from the [latest
release page](https://github.com/TriliumNext/Trilium/releases/latest), unzip the
package and run the `trilium` executable.

TriliumNext is also provided as a Flatpak, but not yet published on FlatHub.

### Browser (any OS)

If you use a server installation (see below), you can directly access the web
interface (which is almost identical to the desktop app).

Currently only the latest versions of Chrome & Firefox are supported (and
tested).

### Mobile

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
