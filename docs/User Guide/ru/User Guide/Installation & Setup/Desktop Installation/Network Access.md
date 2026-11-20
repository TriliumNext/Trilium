# Сетевой доступ
До v0.104.0 [десктопное приложение](../Desktop%20Installation.md) также открывало сетевой порт, чтобы предлагать доступ к <a class="reference-link" href="../../Advanced%20Usage/ETAPI%20(REST%20API).md">ETAPI (REST API)</a> или даже использовать его как веб-сервер (см. <a class="reference-link" href="Using%20the%20desktop%20application%20as%20a%20server.md">Использование десктопного приложения как сервера</a>).

Чтобы уменьшить поверхность атак, Trilium теперь включает эти сервисы только для локального устройства (например, `localhost`) вместо их раздачи через локальную сеть.

Чтобы лучше понять, что затронуто, обратитесь к следующей таблице:

| Возможность | Сетевой доступ ВЫКЛ | Сетевой доступ ВКЛ |
| --- | --- | --- |
| <a class="reference-link" href="../Web%20Clipper.md">Web Clipper</a> | 🔒️ только `localhost` (по-прежнему доступно расширению браузера на том же устройстве) | 🌐 `localhost` + локальная сеть |
| <a class="reference-link" href="../../Advanced%20Usage/ETAPI%20(REST%20API).md">ETAPI (REST API)</a> | 🔒️ только `localhost` | 🌐 `localhost` + локальная сеть |
| [LLM MCP](../../AI.md) (только если включено в настройках) | 🔒️ только `localhost` (требуется аутентификация) | 🌐 `localhost` + локальная сеть (требуется аутентификация) |
| [Веб-приложение](Using%20the%20desktop%20application%20as%20a%20server.md) | ❌️ полностью отключено (403), можно использовать только десктопное приложение. | 🌐 `localhost` + локальная сеть |
| <a class="reference-link" href="../../Advanced%20Usage/Sharing.md">Публикация</a> заметок | ❌️ полностью отключено (403); если вы используете <a class="reference-link" href="../Synchronization.md">Синхронизацию</a>, это всё равно будет работать как часть [сервера](../Server%20Installation.md). | 🌐 `localhost` + локальная сеть |
