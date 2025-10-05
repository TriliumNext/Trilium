# Trilium Notes

[English](../README.md) | [Chinese](./README-ZH_CN.md) | [Russian](./README-ru.md) | [Japanese](./README-ja.md) | [Italian](./README-it.md) | [Spanish](./README-es.md)

Trilium Notes es una aplicación de toma de notas jerárquicas multi-plataforma y de código libre con un enfoque en la construcción de grandes bases de conocimiento personal.

Vea estas [capturas de pantalla](https://triliumnext.github.io/Docs/Wiki/screenshot-tour) para un vistazo rápido:

<a href="https://triliumnext.github.io/Docs/Wiki/screenshot-tour"><img src="./app.png" alt="Trilium Screenshot" width="1000"></a>

## ⚠️ ¿Por qué usar TriliumNext?

[El proyecto Trilium original está en modo de mantenimiento](https://github.com/zadam/trilium/issues/4620)

### ¿Cómo migrar desde Trilium?

No hay pasos de migración especiales para migrar de una instancia de zadam/Trilium a una instancia de TriliumNext/Trilium. Simplemente actualice su instancia de Trilium a la última versión e [instale TriliumNext/Trilium como de costumbre](#-Instalación)

## 💬 Discuta con nosotros

Siéntase libre de unirse a nuestras conversaciones oficiales. ¡Nos encantaría escuchar de las características, sugerencias o problemas que pueda tener!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (Para discusiones síncronas)
  - La sala `General` es replicada a [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [Discusiones de GitHub](https://github.com/TriliumNext/Trilium/discussions) (Para discusiones asíncronas)
- [Wiki](https://triliumnext.github.io/Docs/) (Para preguntas frecuentes y guías de usuario)

## 🎁 Características

- Las notas pueden ser acomodadas en un árbol de profundidad arbitraria. Una sola nota puede ser colocada en múltiples lugares del árbol (vea [clonar](https://triliumnext.github.io/Docs/Wiki/cloning-notes)
- Edición de notas WYSIWYG enriquecida que incluye, por ejemplo, tablas, imágenes y [matemáticas](https://triliumnext.github.io/Docs/Wiki/text-notes) con [autoformato](https://triliumnext.github.io/Docs/Wiki/text-notes#autoformat) markdown
- Soporte para editar [notas con código fuente](https://triliumnext.github.io/Docs/Wiki/code-notes), incluyendo resaltado de sintaxis
- Rápida y sencilla [navegación entre notas](https://triliumnext.github.io/Docs/Wiki/note-navigation), búsqueda de texto completo y [elevación de notas](https://triliumnext.github.io/Docs/Wiki/note-hoisting)
- [Versionado de notas](https://triliumnext.github.io/Docs/Wiki/note-revisions) sutil
- Los [atributos](https://triliumnext.github.io/Docs/Wiki/attributes) de las notas pueden utilizarse para organización, realizar consultas y [scripts](https://triliumnext.github.io/Docs/Wiki/scripts) avanzados
- [Sincronización](https://triliumnext.github.io/Docs/Wiki/synchronization) con servidor de sincronización propio
  - existe un [servicio de terceros para alojar el servidor de sincronización](https://trilium.cc/paid-hosting)
- [Compartir](https://triliumnext.github.io/Docs/Wiki/sharing) (publicar) notas al Internet público
- Fuerte [encriptación de notas](https://triliumnext.github.io/Docs/Wiki/protected-notes) con granularidad para cada nota
- Esbozo de diagramas con Excalidraw incorporado (tipo de nota «canvas»)
- [Mapas de relaciones](<https://triliumnext.github.io/Docs/Wiki/relation-map>) y [mapas de enlaces](https://triliumnext.github.io/Docs/Wiki/link-map) para visualizar las notas y sus relaciones
- [Scripting](https://triliumnext.github.io/Docs/Wiki/scripts) - vea [casos de uso avanzados](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)
- [REST API](https://triliumnext.github.io/Docs/Wiki/etapi) para automatización
- Escala bien tanto en uso como en rendimiento a partir de 100,000 notas
- [Interfaz móvil](https://triliumnext.github.io/Docs/Wiki/mobile-frontend) optimizada para teléfonos inteligentes y tabletas
- [Tema nocturno](https://triliumnext.github.io/Docs/Wiki/themes)
- Importación y exportación de [Evernote](https://triliumnext.github.io/Docs/Wiki/evernote-import) y [Markdown](https://triliumnext.github.io/Docs/Wiki/markdown)
- [Web Clipper](https://triliumnext.github.io/Docs/Wiki/web-clipper) para guardar fácilmente contenido web

✨ Consulte los/las siguientes recursos/comunidades de terceros para obtener más información sobre complementos para TriliumNext:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) para temas, scripts, plugins y más de terceros.
- [TriliumRocks!](https://trilium.rocks/) para tutoriales, guías y mucho más.

## 🏗 Instalación

### Escritorio

Para usar TriliumNext en su máquina de escritorio (Linux, MacOS y Windows) tiene algunas opciones:

- Descargue la versión binaria para su plataforma desde la [página de lanzamientos](https://github.com/TriliumNext/Trilium/releases/latest), descomprima el paquete y ejecute el ejecutable `trilium`.
- Acceda a TriliumNext a través de la interfaz web de una instalación de servidor (ver más abajo)
  - Actualmente solo las últimas versiones de Chrome y Firefox son compatibles (y están probadas).
- (Próximamente) TriliumNext también se proporcionará como un Flatpak

### Móvil

Para usar TriliumNext en un dispositivo móvil:

- Utilice un navegador web móvil para acceder a la interfaz móvil de una instalación de servidor (ver más abajo)
- El uso de una aplicación móvil aún no está soportado ([vea aquí](https://github.com/TriliumNext/Trilium/issues/72)) para seguir las mejoras móviles.

### Servidor

Para instalar TriliumNext en su servidor (incluyendo vía Docker desde [Dockerhub](https://hub.docker.com/r/triliumnext/trilium)) siga la [documentación de instalación de servidor](https://triliumnext.github.io/Docs/Wiki/server-installation).

## 📝 Documentación

[Vea la Wiki para la lista completa de páginas de documentación.](https://triliumnext.github.io/Docs)

También puede leer [Patrones para una base de conocimiento personal](https://triliumnext.github.io/Docs/Wiki/patterns-of-personal-knowledge) para obtener un poco de inspiración de como podría usar TriliumNext.

## 💻 Contribuir

Clone localmente y ejecute

```shell
npm install
npm run server:start
```

## 👏 Reconocimientos

- [CKEditor 5](https://github.com/ckeditor/ckeditor5) - el mejor editor WYSIWYG en el mercado, equipo muy interactivo y atento
- [FancyTree](https://github.com/mar10/fancytree) - biblioteca de árbol muy rica en funciones sin competencia real. Trilium Notes no sería lo mismo sin esta.
- [CodeMirror](https://github.com/codemirror/CodeMirror) - editor de código con soporte para una gran cantidad de lenguajes
- [jsPlumb](https://github.com/jsplumb/jsplumb) - biblioteca de conectividad visual sin competencia. Usado en [mapas de relación](https://triliumnext.github.io/Docs/Wiki/Relation-map) y [mapas de enlace](https://triliumnext.github.io/Docs/Wiki/Link-map)

## 🤝 Soporte

Puede apoyar al desarrollador original de Trilium usando GitHub Sponsors, [PayPal](https://paypal.me/za4am) o Bitcoin (bitcoin:bc1qv3svjn40v89mnkre5vyvs2xw6y8phaltl385d2).
Apoyo para la organización TriliumNext será posible en un futuro próximo.

## 🔑 Licencia

Este programa es software libre: puede redistribuirlo y/o modificarlo bajo los términos de la Licencia Pública General de Affero GNU publicada por la Free Software Foundation, ya sea la versión 3 de la Licencia, o (a su elección) cualquier versión posterior.
