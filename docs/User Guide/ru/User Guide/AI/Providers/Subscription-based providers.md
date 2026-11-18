# Провайдеры по подписке
Некоторые облачные провайдеры предлагают подписку с фиксированной ежемесячной платой вместо оплаты за использование (в отличие от API-ключей).

Коротко: провайдеры по подписке работают либо через повторное использование имеющихся у вас CLI-инструментов (например, Claude Code, GitHub Copilot и OpenAI Codex через ACP), либо требуют ручной установки ACP-сервера (например, Google Antigravity). Поскольку они требуют установки чего-то на ваше устройство, эти провайдеры недоступны на мобильных устройствах (Android или iOS) и в автономном режиме.

См. также раздел <a class="reference-link" href="../Privacy.md">Конфиденциальность</a>, чтобы лучше понять, какие данные отправляются облачному провайдеру.

## Использование Flatpak

Версия Trilium в Flatpak (см. [Установка из Flathub](../../Installation%20%26%20Setup/Desktop%20Installation.md)) работает в песочнице, скрывающей программы, установленные на вашем компьютере, поэтому сама по себе не может найти Claude Code, GitHub Copilot CLI, Codex CLI или ACP-сервер Antigravity от Google. Trilium может запускать их за пределами песочницы после вашего разрешения:

1.  Установите CLI на компьютере и войдите в него, как описано ниже для каждого провайдера.
2.  Разрешите Trilium запускать программы вне песочницы, выполнив в терминале:

    ```sh
    flatpak override --user --talk-name=org.freedesktop.Flatpak org.triliumnotes.Trilium
    ```
3.  Перезапустите Trilium, затем откройте <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройки</a> → _AI / LLM_ и добавьте провайдера.

Затем Trilium ищет CLI в `PATH` вашего компьютера и в PATH вашей командной оболочки и запускает его через `flatpak-spawn --host`. Пока разрешение не выдано, добавление одного из этих провайдеров завершается ошибкой с сообщением, повторяющим эти шаги.

> [!WARNING]
> Это разрешение позволяет Trilium запускать любую программу на вашем компьютере вне песочницы — тот же доступ, что и у установки вне Flatpak. Чтобы его отозвать, выполните `flatpak override --user --no-talk-name=org.freedesktop.Flatpak org.triliumnotes.Trilium` и перезапустите Trilium.

Переменные окружения, указывающие Trilium путь к CLI (такие как `TRILIUM_CLAUDE_CODE_PATH`), называют файл внутри песочницы, поэтому с Flatpak не задавайте их и дайте Trilium найти CLI на вашем компьютере.

## <span class="tn-icon tn-brand tn-brand-claude"></span> Claude Code

Чтобы использовать подписку:

1.  Сначала Claude Code должен быть установлен на машине, запускающей Trilium. То есть при <a class="reference-link" href="../../Installation%20%26%20Setup/Desktop%20Installation.md">установке на компьютер</a> Claude должен быть установлен локально, а при <a class="reference-link" href="../../Installation%20%26%20Setup/Server%20Installation.md">установке на сервер</a>, доступном через браузер, Claude должен быть установлен на сервере.
2.  Claude Code должен быть уже аутентифицирован. Для этого один раз запустите `claude` в терминале, введите `/login` и следуйте инструкциям.
3.  Откройте <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройки</a> → _AI / LLM_ и добавьте провайдера Claude Code.

<details>
    <summary>Как Trilium находит ваш исполняемый файл Claude Code</summary>
    <p>В этом порядке:</p>
    <ul>
        <li>По переменной окружения <code>TRILIUM_CLAUDE_CODE_PATH</code>, указывающей на исполняемый файл Claude. Это позволяет при необходимости переопределить путь.</li>
        <li>По поиску <code>claude</code> в вашем PATH — работает в большинстве случаев.</li>
        <li>Запросив <code>PATH</code> у вашей командной оболочки, что позволяет установке на десктопе найти CLI, установленный через <code>nvm</code>, <code>fnm</code>, <code>asdf</code> или Homebrew, так как приложение, запущенное из GUI, не наследует окружение вашего терминала.</li>
    </ul>
</details>

После настройки провайдера вы получите те же возможности, что и с API-ключом (инструменты заметок, поиск в интернете, расширенное рассуждение, вложения изображений/PDF, потоковая передача).

> [!NOTE]
> Trilium намеренно использует ваш исполняемый файл Claude Code, чтобы не поставлять с собой клиент размером ~250 МБ, но это имеет цену: существует небольшой риск несовместимости версий, если локально установленная версия не совпадает с ожидаемой Trilium. Как правило, лучше держать и Claude Code, и Trilium обновлёнными до последних версий.

## <span class="tn-icon tn-brand tn-brand-github-copilot"></span> GitHub Copilot

> [!NOTE]
> Этот провайдер по подписке всё ещё в бете. Его безопасно использовать (не тратит дополнительные средства и соблюдает условия использования), но могут встречаться мелкие проблемы. Сообщайте о них через <a class="reference-link" href="../../Troubleshooting/Reporting%20issues.md">Сообщение о проблемах</a>.

GitHub Copilot даёт доступ к моделям вашей подписки GitHub Copilot (Pro, Pro+, Business или Enterprise) без API-ключа. Использование расходует лимиты вашего плана Copilot.

1.  Установите GitHub Copilot CLI на машину, запускающую Trilium, например с помощью `npm install -g @github/copilot`. Как и с Claude Code, при <a class="reference-link" href="../../Installation%20%26%20Setup/Server%20Installation.md">установке на сервер</a> его нужно установить на сервере.
2.  Войдите, один раз выполнив `copilot login` в терминале. Если вы уже используете GitHub Copilot в другом редакторе на той же машине, этот вход будет использован повторно.
3.  Откройте <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройки</a> → _AI / LLM_ и добавьте провайдера GitHub Copilot.

<details>
    <summary>Как Trilium находит ваш исполняемый файл Copilot CLI</summary>
    <p>В этом порядке:</p>
    <ul>
        <li>По переменной окружения <code>TRILIUM_COPILOT_PATH</code>, указывающей на исполняемый файл Copilot.</li>
        <li>По поиску <code>copilot</code> в вашем PATH.</li>
        <li>Запросив <code>PATH</code> у вашей командной оболочки, так же как для Claude Code.</li>
    </ul>
</details>

### Известные ограничения

*   Агент может работать с вашими заметками только через инструменты заметок Trilium; его собственные файловые, командные и веб-инструменты заблокированы из соображений безопасности.
*   К диалогу можно прикреплять изображения, но не PDF. LLM по-прежнему сможет читать заметки и вложения в формате PDF через <a class="reference-link" href="../../Advanced%20Usage/Text%20Extraction%20(OCR).md">Извлечение текста (OCR)</a>, когда инструменты заметок включены.

## <span class="tn-icon tn-brand tn-brand-antigravity"></span> Google Antigravity

> [!NOTE]
> Этот провайдер по подписке всё ещё в бете. Его безопасно использовать (не тратит дополнительные средства и соблюдает условия использования), но могут встречаться мелкие проблемы. Сообщайте о них через <a class="reference-link" href="../../Troubleshooting/Reporting%20issues.md">Сообщение о проблемах</a>.

Google Antigravity даёт доступ к моделям Gemini с учётной записью Google (бесплатной, Google AI Pro или Google AI Ultra) без API-ключа. На момент написания для использования достаточно бесплатной учётной записи Google.

В отличие от Claude Code или GitHub Copilot, ACP-сервер Antigravity от Google не является частью CLI, поэтому его нужно установить вручную специально для Trilium. Размер загружаемого архива — около 112–334 МБ, распакованный размер — около 230 МБ–2 ГБ в зависимости от платформы.

=== "<span class="tn-icon bx bxl-windows"></span> Windows"

    1.  Загрузите ACP-сервер Antigravity от Google для вашей платформы. Ссылка показывается при добавлении провайдера в <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройках</a> → _AI / LLM_. Распакуйте его на устройстве, запускающем Trilium.
    2.  Сделайте его находимым для Trilium, выбрав один из вариантов:
        1.  добавить распакованную папку в PATH, или
        2.  задать переменную окружения `TRILIUM_ANTIGRAVITY_ACP_PATH`, указывающую на `agy_acp_server.exe`.
    3.  Откройте <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройки</a> → AI / LLM и добавьте провайдера <span class="tn-icon tn-brand tn-brand-antigravity"></span> _Google Antigravity_. При первой загрузке списка моделей в браузере на машине, запускающей Trilium, откроется страница входа Google; завершите вход там.

=== "<span class="tn-icon bx bxl-tux"></span> Linux и <span class="tn-icon bx bxl-apple"></span> macOS"

    1.  Загрузите ACP-сервер Antigravity от Google для вашей платформы. Ссылка показывается при добавлении провайдера в <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройках</a> → _AI / LLM_. Распакуйте его на устройстве, запускающем Trilium.
    2.  Сделайте его находимым для Trilium, выбрав один из вариантов:
        1.  добавить распакованную папку в PATH, или
        2.  задать переменную окружения `TRILIUM_ANTIGRAVITY_ACP_PATH`, указывающую на `agy_acp_server.par`.
    3.  Откройте <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройки</a> → AI / LLM и добавьте провайдера <span class="tn-icon tn-brand tn-brand-antigravity"></span> _Google Antigravity_. При первой загрузке списка моделей в браузере на машине, запускающей Trilium, откроется страница входа Google; завершите вход там.

=== "NixOS"

    1.  На NixOS пакет `antigravity-acp` уже доступен, но на момент написания — только в `nixos-unstable`. Проще всего опробовать его через `nix shell` с flakes:

        ```
        NIXPKGS_ALLOW_UNFREE=1 nix shell --impure github:nixos/nixpkgs/nixos-unstable#antigravity-acp
        trilium
        ```
    2.  Откройте <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройки</a> → AI / LLM и добавьте провайдера <span class="tn-icon tn-brand tn-brand-antigravity"></span> _Google Antigravity_. При первой загрузке списка моделей в браузере на машине, запускающей Trilium, откроется страница входа Google; завершите вход там.

> [!NOTE]
> Для работы с Google Antigravity Trilium нужен `curl`. Он поставляется с Windows 10 и новее, macOS и большинством дистрибутивов Linux.

### Известные ограничения

*   Агент может работать с вашими заметками только через инструменты заметок Trilium; его собственные файловые и командные инструменты заблокированы из соображений безопасности.
*   ACP-сервер Antigravity требует аутентификации по ссылке входа. Ссылку входа нужно открыть на том же устройстве, поэтому может быть невозможно настроить провайдера при использовании веб-версии Docker-установки. <a class="reference-link" href="../../Installation%20%26%20Setup/Desktop%20Installation.md">Установка на компьютер</a> должна работать нормально.
*   К диалогу можно прикреплять изображения, но не PDF. LLM по-прежнему сможет читать заметки и вложения в формате PDF через <a class="reference-link" href="../../Advanced%20Usage/Text%20Extraction%20(OCR).md">Извлечение текста (OCR)</a>, когда инструменты заметок включены.
*   Результаты вызовов инструментов (например, чтение заметки, запись атрибутов) не отображаются как следует, потому что ACP-сервер их не предоставляет.

## <span class="tn-icon tn-brand tn-brand-codex"></span> OpenAI Codex

> [!NOTE]
> Этот провайдер по подписке всё ещё в бете. Его безопасно использовать (не тратит дополнительные средства и соблюдает условия использования), но могут встречаться мелкие проблемы. Сообщайте о них через <a class="reference-link" href="../../Troubleshooting/Reporting%20issues.md">Сообщение о проблемах</a>.

OpenAI Codex даёт доступ к моделям Codex вашего плана ChatGPT (Free, Go, Plus, Pro или Business) без API-ключа. На момент написания для использования достаточно бесплатной учётной записи ChatGPT. Использование расходует лимиты Codex вашего плана, которые на бесплатном плане невелики.

=== "<span class="tn-icon bx bxl-windows"></span><span class="tn-icon bx bxl-tux"></span><span class="tn-icon bx bxl-apple"></span> Большинство платформ"

    1.  Установите Codex CLI на машину, запускающую Trilium, например с помощью `npm install -g @openai/codex`. Как и с Claude Code, при <a class="reference-link" href="../../Installation%20%26%20Setup/Server%20Installation.md">установке на сервер</a> его нужно установить на сервере. ACP-адаптер, подключающийся к нему, поставляется с Trilium, поэтому больше ничего не нужно.
    2.  Откройте <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройки</a> → _AI / LLM_ и добавьте провайдера <span class="tn-icon tn-brand tn-brand-codex"></span> _OpenAI Codex_. При первой загрузке списка моделей в браузере на машине, запускающей Trilium, откроется страница входа ChatGPT; завершите вход там.

=== "NixOS"

    1.  На NixOS Codex доступен как пакет `codex` в nixpkgs. Стабильный канал может отставать от релизов Codex, поэтому более новую версию можно взять из `nixos-unstable`:

        ```sh
        nix shell github:nixos/nixpkgs/nixos-unstable#codex
        trilium
        ```
    2.  Откройте <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройки</a> → _AI / LLM_ и добавьте провайдера <span class="tn-icon tn-brand tn-brand-codex"></span> _OpenAI Codex_. При первой загрузке списка моделей в браузере на машине, запускающей Trilium, откроется страница входа ChatGPT; завершите вход там.

Trilium хранит собственный вход и настройки Codex, отдельно от любого CLI Codex, который вы используете в терминале, поэтому существующий `codex login` не используется повторно.

<details>
    <summary>Как Trilium находит ваш исполняемый файл Codex CLI</summary>
    <p>В этом порядке:</p>
    <ul>
        <li>По переменной окружения <code>TRILIUM_CODEX_PATH</code>, указывающей на исполняемый файл Codex.</li>
        <li>По поиску <code>codex</code> в вашем PATH.</li>
        <li>Запросив <code>PATH</code> у вашей командной оболочки, так же как для Claude Code.</li>
    </ul>
</details>

> [!NOTE]
> Для работы с OpenAI Codex Trilium нужен `curl`, так же как для Google Antigravity: через него Trilium проверяет каждый вызов инструмента, который делает Codex. Он поставляется с Windows 10 и новее, macOS и большинством дистрибутивов Linux.

### Известные ограничения

*   Агент может работать с вашими заметками только через инструменты заметок Trilium и искать в интернете, когда чат это разрешает; его собственные файловые, командные и другие инструменты заблокированы из соображений безопасности.
*   Вход в ChatGPT открывается в браузере на устройстве, запускающем Trilium, поэтому может быть невозможно настроить провайдера при использовании веб-версии Docker-установки. <a class="reference-link" href="../../Installation%20%26%20Setup/Desktop%20Installation.md">Установка на компьютер</a> должна работать нормально.
*   К диалогу можно прикреплять изображения и SVG, но не PDF. LLM по-прежнему сможет читать заметки и вложения в формате PDF через <a class="reference-link" href="../../Advanced%20Usage/Text%20Extraction%20(OCR).md">Извлечение текста (OCR)</a>, когда инструменты заметок включены.
