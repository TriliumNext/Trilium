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

## ⬇️ التنزيل
- [النسخة الأخيرة](https://github.com/TriliumNext/Trilium/releases/latest) –
  نسخة مستقرة، محبذة لأكثر المستخدمين.
- [الإصدار الليلي](https://github.com/TriliumNext/Trilium/releases/tag/nightly)
  – إصدار تطوير غير مستقر، يتم تحديثه يوميًا بأحدث الميزات والإصلاحات.

## 📚 الوثائق

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
  أساسية](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [أنماط قاعدة المعرفة
  الشخصية](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 المميزات

* يمكن تنظيم الملاحظات في شجرة ذات عمق غير محدود. كما يمكن وضع الملاحظة الواحدة
  في أماكن متعددة داخل الشجرة (راجع
  [الاستنساخ](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* محرر ملاحظات WYSIWYG غني يتضمن على سبيل المثال الجداول والصور
  و[الرياضيات](https://docs.triliumnotes.org/user-guide/note-types/text) مع
  Markdown [تنسيق
  تلقائي](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
* دعم تحرير [ملاحظات التعليمات
  البرمجية](https://docs.triliumnotes.org/user-guide/note-types/code)، بما في
  ذلك تمييز بناء الجملة
* [التنقل بين
  الملاحظات](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation)
  سهل وسريع، مع دعم البحث في النص الكامل، و[رفع
  الملاحظات](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* نظام [إصدارات
  الملاحظات](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
  السلس
* يمكن استخدام
  [السمات](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  لتنظيم الملاحظات والاستعلام عنها و[البرمجة
  النصية](https://docs.triliumnotes.org/user-guide/scripts) المتقدمة
* واجهة المستخدم متوفرة باللغات الإنجليزية والألمانية والإسبانية والفرنسية
  والرومانية والصينية (المبسطة والتقليدية)
* تكامل مباشر مع [أنظمة الهوية المفتوحة OpenID وكلمات المرور المؤقتة
  TOTP](https://docs.triliumnotes.org/user-guide/setup/server/mfa) لتسجيل دخول
  أكثر أماناً
* [المزامنة](https://docs.triliumnotes.org/user-guide/setup/synchronization) مع
  خادم مزامنة مُستضاف ذاتيًا
  * توجد [خدمات خارجية لاستضافة خادم
    المزامنة](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [مشاركة](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  الملاحظات (نشرها) على شبكة الإنترنت العامة
* [تشفير
  الملاحظات](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  تشفير قوي مع إمكانية التحكم بكل ملاحظة على حدة
* رسم المخططات، بالاعتماد على إكسكاليدرا [Excalidraw](https://excalidraw.com/)
  (نوع الملاحظة "لوحة رسم")
* [خرائط
  العلاقات](https://docs.triliumnotes.org/user-guide/note-types/relation-map)
  و[خرائط الملاحظات
  والروابط](https://docs.triliumnotes.org/user-guide/note-types/note-map) لتصور
  الملاحظات وارتباطاتها بصرياً
* الخرائط الذهنية، بالاعتماد على مايند إليكسر [Mind
  Elixir](https://docs.mind-elixir.com/)
* "[الخرائط
  الجغرافية](https://docs.triliumnotes.org/user-guide/collections/geomap) مع
  دبابيس الموقع ومسارات GPX (GPX = تنسيق تبادل بيانات نظام تحديد المواقع
  العالمي)
* [البرمجة النصية](https://docs.triliumnotes.org/user-guide/scripts) - راجع
  [نماذج العرض
  المتقدمة](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [واجهة REST
  API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi) للأتمتة
* يتميز بسهولة الاستخدام والأداء العاليين، ويستوعب أكثر من 100,000 ملاحظة
* [واجهة جوال](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend)
  محسنة للمس، مخصصة للهواتف الذكية والأجهزة اللوحية
* [الوضع الداكن](https://docs.triliumnotes.org/user-guide/concepts/themes)
  المدمج، ودعم سمات المستخدم
* [إيفيرنوت
  (Evernote)](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  و[استيراد وتصدير ملفات
  Markdown](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [أداة قص الويب](https://docs.triliumnotes.org/user-guide/setup/web-clipper)
  لحفظ محتوى الويب بسهولة
* واجهة مستخدم قابلة للتخصيص (أزرار الشريط الجانبي، أدوات المستخدم المحددة، ...)
* [مؤشرات
  الأداء](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics)، مع
  لوحة تحكم Grafana.

✨ اطلع على الموارد/المجتمعات الخارجية التالية لمزيد من المعلومات المفيدة
المتعلقة بـ TriliumNext:

- للقوالب والبرامج النصية والإضافات الخارجية والمزيد
  [awesome-trillium](https://github.com/Nriver/awesome-trilium).
- للحصول على دروس تعليمية، وأدلة، وغير ذلك الكثير
  [TriliumRocks!](https://trilium.rocks/).

## ؟لماذا TriliumNext؟

قام مطور Trilium الأصلي ([Zadam](https://github.com/zadam)) مشكورًا بإهداء
مستودع Trilium إلى مشروع المجتمع الموجود على الرابط التالي:
https://github.com/TriliumNext

### ⬆️الانتقال من Zadam/Trilium؟

لا توجد خطوات انتقال خاصة للانتقال من نسخة zadam/Trilium إلى نسخة
TriliumNext/Trilium. ما عليك سوى تثبيت TriliumNext/Trilium كالمعتاد، وسيستخدم
قاعدة بياناتك الحالية.

الإصدارات حتى الإصدار
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) متوافقة
مع أحدث إصدار من zadam/trillium وهو [v0.63.7]{2]. أما الإصدارات اللاحقة من
TriliumNext/Trilium، فقد تم تحديث أرقام المزامنة الخاصة بها، مما يمنع الترقية
المباشرة.

## 💬 ناقش معنا

لا تترددوا في الانضمام إلى محادثاتنا الرسمية. يسعدنا أن نسمع عن الميزات أو
الاقتراحات أو المشاكل التي قد تواجهونها!

- [ماتريكس (Matrix)](https://matrix.to/#/#triliumnext:matrix.org) (للمناقشات
  المتزامنة.)
  - غرفة ماتريكس `العامة` مرتبطة أيضاً بـ
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join) (Extensible Messaging and
    Presence Protocol)
- [مناقشات GitHub](https://github.com/TriliumNext/Trilium/discussions)
  (للمناقشات غير المتزامنة.)
- [Github Issues](https://github.com/TriliumNext/Trilium/issues) (لتقديم تقارير
  الأخطاء وطلبات الميزات.)

## 🏗️ التثبيت

### ويندوز (Windows) / نظام تشغيل ماك (MacOS)

نزل الإصدار الثنائي (Binary) المناسب لمنصتك من [صفحة أحدث
الإصدارات](https://github.com/TriliumNext/Trilium/releases/latest)، ثم فك ضغط
الحزمة وشغّل ملف `trilium` التنفيذي.

### لينكس (Linux)

إذا كانت توزيعتك مدرجة في الجدول أدناه، فاستخدم الحزمة الخاصة بتوزيعتك.

[![حالة
الحزم](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

يمكنك أيضًا تنزيل الإصدار الثنائي لمنصتك من [صفحة أحدث
إصدار](https://github.com/TriliumNext/Trilium/releases/latest)، وفك ضغط الحزمة
وتشغيل الملف التنفيذي `trillium`.

يتم توفير TriliumNext أيضًا كـ Flatpak، ولكن لم يتم نشره بعد على FlatHub.

### متصفح (أي نظام تشغيل)

إذا كنت تستخدم تثبيت الخادم (انظر أدناه)، فيمكنك الوصول مباشرة إلى واجهة الويب
(وهي مطابقة تقريبًا لتطبيق سطح المكتب).

حالياً، يتم دعم أحدث إصدارات متصفحي Chrome و Firefox فقط (والتي تم اختبارها).

### الهاتف المحمول

لاستخدام TriliumNext على الأجهزة المحمولة، يمكنك استخدام المتصفح للوصول إلى
واجهة الجوال الخاصة بنسخة الخادم المثبتة (انظر أدناه).

راجع المشكلة رقم https://github.com/TriliumNext/Trilium/issues/4962 لمزيد من
المعلومات حول دعم إصدار الهاتف المحمول.

إذا كنت تفضل تطبيقًا أصليًا لنظام Android، يمكنك استخدام
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
أبلغ عن الأخطاء والميزات المفقودة في
[مستودعهم](https://github.com/FliegendeWurst/TriliumDroid). ملاحظة: يُفضل تعطيل
التحديثات التلقائية على تثبيت الخادم الخاص بك (انظر أدناه) عند استخدام
TriliumDroid، حيث يجب أن تتطابق نسخة المزامنة بين Trilium وTriliumDroid.

### خادم

لتثبيت TriliumNext على خادمك الخاص (بما في ذلك عبر Docker من
[Dockerhub](https://hub.docker.com/r/triliumnext/trilium)) اتبع [وثائق تثبيت
الخادم]{2].


## 💻 المساهمة

### الترجمات

إذا كنت متحدثًا أصليًا للغة، فساعدنا في ترجمة Trilium من خلال التوجه إلى [صفحة
الويب]{1].

إليك قائمة نسبة اكتمال اللغات المدعومة حتى الآن:

[![حالة
الترجمة](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### التعليمات البرمجية

قم بتنزيل المستودع، وقم بتثبيت التبعيات باستخدام `pnpm`، ثم قم بتشغيل الخادم
(المتاح على http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### التوثيق

قم بتنزيل المستودع، وقم بتثبيت التبعيات باستخدام `pnpm`، ثم قم بتشغيل البيئة
المطلوبة لتحرير الوثائق:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### بناء الملف التنفيذي
قم بتنزيل المستودع، وقم بتثبيت التبعيات باستخدام `pnpm`، ثم قم ببناء تطبيق سطح
المكتب لنظام التشغيل ويندوز (Windows):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

لمزيد من التفاصيل، راجع [وثائق
التطوير](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### وثائق المطورين

يرجى الاطلاع على [دليل
التوثيق](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
لمزيد من التفاصيل. إذا كانت لديكم أي استفسارات أخرى، فلا تترددوا في التواصل معنا
عبر الروابط الموضحة في قسم "ناقش معنا" أعلاه.

## 👏 شكر خاص

* لـ [zadam](https://github.com/zadam): للمفهوم الأصلي وتنفيذ التطبيق.
* لـ [سارة حسين (Sarah Hussein)](https://github.com/Sarah-Hussein): لتصميم
  أيقونة التطبيق.
* لـ [nriver](https://github.com/nriver): لعمله على تدويل التطبيق (دعم اللغات).
* لـ [Thomas Frei](https://github.com/thfrei): لعمله الأصلي على "اللوحة"
  (Canvas).
* لـ [antoniotejada](https://github.com/nriver): لأداة تمييز الصيغة البرمجية
  (Syntax highlight) الأصلية.
* لـ [Dosu](https://dosu.dev/): لتزويدنا بالردود الآلية على مشكلات ونقاشات
  GitHub.
* لـ [Tabler Icons](https://tabler.io/icons): لأيقونات شريط النظام.

لم يكن لـ Trilium أن يرى النور لولا التقنيات التي تقف خلفه:

* محرر [CKEditor 5](https://github.com/ckeditor/ckeditor5): - المحرر المرئي خلف
  الملاحظات النصية. نحن ممتنون لحصولنا على مجموعة من الميزات المدفوعة (Premium).
* محرر [CodeMirror](https://github.com/codemirror/CodeMirror): - محرر أكواد يدعم
  عدداً هائلاً من اللغات.
* برنامج [Excalidraw](https://github.com/excalidraw/excalidraw): - السبورة
  البيضاء اللانهائية المستخدمة في ملاحظات Canvas.
* برنامج [Mind Elixir](https://github.com/SSShooter/mind-elixir-core): - يوفر
  وظائف الخرائط الذهنية.
* برنامج [Leaflet](https://github.com/Leaflet/Leaflet): - لعرض الخرائط
  الجغرافية.
* مكتبة [Tabulator](https://github.com/olifolkerd/tabulator): - للجداول
  التفاعلية المستخدمة في المجموعات.
* مكتبة [FancyTree](https://github.com/mar10/fancytree): - مكتبة "شجرية" غنية
  بالميزات ولا يوجد لها منافس حقيقي.
* مكتبة [jsPlumb](https://github.com/jsplumb/jsplumb): - مكتبة للربط المرئي،
  تُستخدم في [خرائط
  العلاقات](https://docs.triliumnotes.org/user-guide/note-types/relation-map)
  و[خرائط
  الروابط](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 الدعم

تم بناء وصيانة برنامج Trilium بمئات الساعات من العمل. دعمكم يحافظ على كونه مفتوح
المصدر، ويحسن الميزات، ويغطي التكاليف مثل الاستضافة.

يرجى التفكير في دعم المطور الرئيسي ([eliandoran](https://github.com/eliandoran))
للتطبيق عبر:

- [رعاة GitHub](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [اشترِ لي قهوة](https://buymeacoffee.com/eliandoran)

## 🔑 الترخيص

جميع الحقوق محفوظة لـ zadam وإليان دوران ومساهمين آخرين، من عام 2017 إلى عام
2025

هذا البرنامج هو برنامج مجاني: يمكنك إعادة توزيعه و/أو تعديله بموجب شروط رخصة جنو
أفيرو (GNU Affero) العامة كما نشرتها مؤسسة البرمجيات الحرة، سواء الإصدار 3 من
الرخصة، أو (حسب اختيارك) أي إصدار لاحق.
