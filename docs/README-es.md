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

![Patrocinadores en GitHub](https://img.shields.io/github/sponsors/eliandoran)
![Patrocinadores en
LiberaPay](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Descargas en Docker](https://img.shields.io/docker/pulls/triliumnext/trilium)
![Descargas en GitHub (todos los recursos, todas las
versiones)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Estado de la
traducción](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

[Inglés](./README.md) | [Chino (simplificado)](./docs/README-ZH_CN.md) | [Chino
(tradicional)](./docs/README-ZH_TW.md) | [Ruso](./docs/README-ru.md) |
[Japonés](./docs/README-ja.md) | [Italiano](./docs/README-it.md) |
[Español](./docs/README-es.md)

Trilium Notes es una aplicación gratuita, de código abierto y multiplataforma
para notas jerárquicas, orientada a crear amplias bases de conocimiento
personal.

Ver [capturas de
pantalla](https://triliumnext.github.io/Docs/Wiki/screenshot-tour) para un
resumen rápido:

<a href="https://triliumnext.github.io/Docs/Wiki/screenshot-tour"><img src="./docs/app.png" alt="Trilium Screenshot" width="1000"></a>

## 📚 Documentación

**Accede a la documentación completa en
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

La documentación está disponible en varios formatos:
- **Documentación en línea**: Consulta la documentación completa en
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Ayuda en la aplicación**: Presiona `F1` dentro de Trilium para acceder a la
  misma documentación directamente en la aplicación
- **GitHub**: Navega por la [Guía del
  Usuario](./docs/User%20Guide/User%20Guide/) en este repositorio

### Enlaces rápidos
- [Guía de inicio](https://docs.triliumnotes.org/)
- [Instrucciones de
  instalación](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation.md)
- [Configuración de
  Docker](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md)
- [Actualización de
  TriliumNext](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Upgrading%20TriliumNext.md)
- [Conceptos básicos y
  funciones](./docs/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Notes.md)
- [Patrones para una base de conocimiento
  personal](https://triliumnext.github.io/Docs/Wiki/patterns-of-personal-knowledge)

## 🎁 Características

* Las notas se pueden organizar en un árbol de profundidad arbitraria. Una sola
  nota puede colocarse en varios lugares del árbol (ver
  [clonado](https://triliumnext.github.io/Docs/Wiki/cloning-notes))
* Editor de notas WYSIWYG completo, que incluye, por ejemplo, tablas, imágenes y
  [matemáticas](https://triliumnext.github.io/Docs/Wiki/text-notes) con
  [autoformato](https://triliumnext.github.io/Docs/Wiki/text-notes#autoformat)
  en Markdown
* Soporte para editar [notas con código
  fuente](https://triliumnext.github.io/Docs/Wiki/code-notes), incluyendo
  resaltado de sintaxis
* [Navegación entre
  notas](https://triliumnext.github.io/Docs/Wiki/note-navigation) rápida y
  sencilla, búsqueda de texto completo y [elevación de
  notas](https://triliumnext.github.io/Docs/Wiki/note-hoisting)
* Flujo continuo de [versionado de
  notas](https://triliumnext.github.io/Docs/Wiki/note-revisions)
* Los [atributos](https://triliumnext.github.io/Docs/Wiki/attributes) de las
  notas se pueden usar para organización, consultas y
  [scripting](https://triliumnext.github.io/Docs/Wiki/scripts) avanzado
* Interfaz disponible en inglés, alemán, español, francés, rumano y chino
  (simplificado y tradicional)
* Integración directa de [OpenID y
  TOTP](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/Multi-Factor%20Authentication.md)
  para un inicio de sesión más seguro
* [Sincronización](https://triliumnext.github.io/Docs/Wiki/synchronization) con
  servidor de sincronización autohospedado
  * existe un [servicio de terceros para alojar el servidor de
    sincronización](https://trilium.cc/paid-hosting)
* [Compartir](https://triliumnext.github.io/Docs/Wiki/sharing) (publicar) notas
  en Internet público
* Fuerte [cifrado de
  notas](https://triliumnext.github.io/Docs/Wiki/protected-notes) con
  granularidad por nota
* Esbozo de diagramas, basado en [Excalidraw](https://excalidraw.com/) (tipo de
  nota "lienzo")
* [Mapas de relaciones](https://triliumnext.github.io/Docs/Wiki/relation-map) y
  [mapas de enlaces](https://triliumnext.github.io/Docs/Wiki/link-map) para
  visualizar las notas y sus relaciones
* Mapas mentales, basados en [Mind Elixir](https://docs.mind-elixir.com/)
* [Mapas
  geográficos](./docs/User%20Guide/User%20Guide/Note%20Types/Geo%20Map.md) con
  marcadores de ubicación y rutas GPX
* [Scripting](https://triliumnext.github.io/Docs/Wiki/scripts) - ver [Casos de
  uso avanzados](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)
* [REST API](https://triliumnext.github.io/Docs/Wiki/etapi) para automatización
* Escala bien tanto en usabilidad como en rendimiento, incluso con más de
  100.000 notas
* [Interfaz móvil](https://triliumnext.github.io/Docs/Wiki/mobile-frontend)
  optimizada para pantallas táctiles, móviles y tabletas
* [Tema oscuro](https://triliumnext.github.io/Docs/Wiki/themes) integrado, con
  soporte para temas personalizados
* Importación y exportación de
  [Evernote](https://triliumnext.github.io/Docs/Wiki/evernote-import) y
  [Markdown](https://triliumnext.github.io/Docs/Wiki/markdown)
* [Web Clipper](https://triliumnext.github.io/Docs/Wiki/web-clipper) para
  guardar fácilmente contenido web
* Interfaz personalizable (botones de la barra lateral, widgets definidos por el
  usuario, …)
* [Métricas](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics.md),
  junto con un [Dashboard de
  Grafana](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics/grafana-dashboard.json)

✨ Consulta los siguientes recursos y comunidades de terceros para obtener más
contenido relacionado con TriliumNext:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) para acceder a
  temas, scripts, complementos y otros recursos de terceros.
- [TriliumRocks!](https://trilium.rocks/) para tutoriales, guías y mucho más.

## ❓¿Por qué TriliumNext?

El desarrollador original de Trilium ([Zadam](https://github.com/zadam)) ha
cedido amablemente el repositorio de Trilium al proyecto comunitario, disponible
en https://github.com/TriliumNext

### ⬆️ ¿Migrando desde Zadam/Trilium?

No se requieren pasos especiales para migrar de una instancia de Zadam/Trilium a
TriliumNext/Trilium. Simplemente [instala TriliumNext/Trilium](#-installation)
como de costumbre, y utilizará la base de datos existente.

Las versiones hasta
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4),
inclusive, son compatibles con la última versión de Zadam/Trilium
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). Las versiones
posteriores de TriliumNext/Trilium incrementan su versión de sincronización, lo
que impide migrar directamente.

## 💬 Únete a la conversación

Siéntete libre de unirte a nuestras conversaciones oficiales. ¡Nos interesa
mucho conocer tus funciones favoritas, sugerencias o posibles incidencias!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (Para discusiones
  síncronas.)
  - La sala `General` de Matrix también está enlazada con
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [Discusiones de GitHub](https://github.com/TriliumNext/Trilium/discussions)
  (para discusiones asincrónicas.)
- [Github Issues](https://github.com/TriliumNext/Trilium/issues) (para reportes
  de errores y solicitudes de funciones.)

## 🏗 Instalación

### Windows / macOS

Descarga la versión binaria para tu plataforma desde la [página de la última
versión](https://github.com/TriliumNext/Trilium/releases/latest), descomprime el
paquete y ejecuta el archivo `trilium`.

### Linux

Si tu distribución aparece en la siguiente tabla, utiliza el paquete
correspondiente a tu distribución.

[![Estado del
paquete](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

También puedes descargar la versión binaria para la plataforma correspondiente
desde la [página de la última
versión](https://github.com/TriliumNext/Trilium/releases/latest), descomprimir
el paquete y ejecutar el archivo `trilium`.

TriliumNext también está disponible como paquete Flatpak, aunque aún no se ha
publicado en FlatHub.

### Navegador (cualquier sistema operativo)

Si utilizas una instalación en servidor (ver más abajo), puedes acceder
directamente a la interfaz web (que es prácticamente idéntica a la aplicación de
escritorio).

Actualmente, solo se soportan (y han sido probadas) las últimas versiones de
Chrome y Firefox.

### Móvil

Para usar TriliumNext en un dispositivo móvil, puedes utilizar un navegador web
móvil para acceder a la interfaz móvil de una instalación en servidor (ver más
abajo).

Consulta el issue https://github.com/TriliumNext/Trilium/issues/4962 para más
información sobre el soporte de la aplicación móvil.

Si prefieres una aplicación nativa para Android, puedes usar
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Puedes reportar errores y funciones faltantes en [su
repositorio](https://github.com/FliegendeWurst/TriliumDroid). Nota: al usar
TriliumDroid, es recomendable desactivar las actualizaciones automáticas en la
instalación del servidor (ver más abajo), ya que la versión de sincronización
debe coincidir entre Trilium y TriliumDroid.

### Servidor

Para instalar TriliumNext en tu propio servidor (incluido mediante Docker desde
[Dockerhub](https://hub.docker.com/r/triliumnext/trilium)), sigue las
[instrucciones de instalación del
servidor](https://triliumnext.github.io/Docs/Wiki/server-installation).


## 💻 Contribuir

### Traducciones

Si eres hablante nativo, puedes ayudar a traducir Trilium visitando nuestra
[página de Weblate](https://hosted.weblate.org/engage/trilium/).

Cobertura de idiomas hasta el momento:

[![Estado de la
traducción](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Código

Descarga el repositorio, instala las dependencias usando `pnpm` y luego ejecuta
el servidor (disponible en http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### Documentación

Descarga el repositorio, instala las dependencias usando `pnpm` y luego ejecuta
el entorno necesario para editar la documentación:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### Compilación del ejecutable
Descarga el repositorio, instala las dependencias usando `pnpm` y luego compila
la aplicación de escritorio para Windows:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

Para más información, consulta la [documentación de
desarrollo](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### Documentación para desarrolladores

Consulta la [guía de
documentación](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
para más información. Si tienes más preguntas, siéntete libre de contactarnos a
través de los enlaces de la sección "Únete a la conversación" más arriba.

## 👏 Reconocimientos

* [Zadam](https://github.com/zadam) por la idea original y la implementación de
  la aplicación.
* [Sarah Hussein](https://github.com/Sarah-Hussein) por diseñar el icono de la
  aplicación.
* [nriver](https://github.com/nriver) por su trabajo en la internacionalización.
* [Thomas Frei](https://github.com/thfrei) por su trabajo original en el Canvas.
* [antoniotejada](https://github.com/nriver) por el widget original de resaltado
  de sintaxis.
* [Dosu](https://dosu.dev/) por ofrecernos las respuestas automáticas para los
  issues y discusiones de GitHub.
* [Tabler Icons](https://tabler.io/icons) por los iconos de la bandeja del
  sistema.

Trilium no sería posible sin las tecnologías que lo sustentan:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - el editor visual detrás
  de las notas de texto. Agradecemos que se nos haya ofrecido un conjunto de
  funciones premium.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - editor de código con
  soporte para numerosos lenguajes.
* [Excalidraw](https://github.com/excalidraw/excalidraw) - la pizarra infinita
  utilizada en las notas tipo Canvas.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - proporciona la
  funcionalidad de mapas mentales.
* [Leaflet](https://github.com/Leaflet/Leaflet) - para mostrar mapas
  geográficos.
* [Tabulator](https://github.com/olifolkerd/tabulator) - para la tabla
  interactiva utilizada en las colecciones.
* [FancyTree](https://github.com/mar10/fancytree) - biblioteca de árboles con
  muchas funcionalidades y sin competencia destacable.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - biblioteca de conectividad
  visual. Usada en [mapas de
  relaciones](https://triliumnext.github.io/Docs/Wiki/relation-map.html) y
  [mapas de
  enlaces](https://triliumnext.github.io/Docs/Wiki/note-map.html#link-map)

## 🤝 Soporte

Trilium se desarrolla y mantiene con [cientos de horas de
trabajo](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Tu
apoyo ayuda a mantenerlo de código abierto, mejorar sus funciones y cubrir
gastos como el alojamiento.

Considera apoyar al desarrollador principal
([eliandoran](https://github.com/eliandoran)) de la aplicación a través de:

- [Patrocinadores de GitHub](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Compra un café](https://buymeacoffee.com/eliandoran)

## 🔑 Licencia

Copyright 2017-2025 zadam, Elian Doran y otros colaboradores

Este programa es software libre: puede redistribuirse, modificarse o ambas
acciones bajo los términos de la Licencia Pública General Affero de GNU,
publicada por la Free Software Foundation, ya sea la versión 3 de la licencia o,
a elección del usuario, cualquier versión posterior.
