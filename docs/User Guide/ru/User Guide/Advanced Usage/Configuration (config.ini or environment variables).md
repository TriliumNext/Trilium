# Конфигурация (config.ini или переменные окружения)
Trilium поддерживает конфигурацию через файл `config.ini` и переменные окружения. Этот документ представляет собой полный справочник всех опций конфигурации.

## Расположение файла конфигурации

Файл конфигурации не находится в одном каталоге с приложением. Вместо этого `config.ini` расположен в <a class="reference-link" href="../Installation%20%26%20Setup/Data%20directory.md">Каталоге данных</a>. Таким образом, файл конфигурации доступен только после запуска приложения и создания базы данных.

## Приоритет конфигурации

Значения конфигурации загружаются в следующем порядке приоритета (от высшего к низшему):

1.  **Переменные окружения** (проверяются первыми)
2.  **Значения файла config.ini**
3.  **Значения по умолчанию**

## Шаблоны имён переменных окружения

Trilium поддерживает несколько шаблонов имён переменных окружения для гибкости. Основной шаблон: `TRILIUM_[СЕКЦИЯ]_[КЛЮЧ]`

Где:

*   `СЕКЦИЯ` — имя секции INI в ВЕРХНЕМ РЕГИСТРЕ
*   `КЛЮЧ` — camelCase ключ конфигурации, преобразованный в ВЕРХНИЙ РЕГИСТР (например, `instanceName` → `INSTANCENAME`)

Дополнительно для распространённых настроек доступны более короткие псевдонимы (см. раздел «Альтернативные переменные» ниже).

## Справочник переменных окружения

=== "General"

    | Переменная окружения | Тип | По умолчанию | Описание |
    | --- | --- | --- | --- |
    | `TRILIUM_GENERAL_INSTANCENAME` | string | "" | Имя экземпляра для идентификации в API |
    | `TRILIUM_GENERAL_NOAUTHENTICATION` | boolean | false | Отключить аутентификацию (только сервер) |
    | `TRILIUM_GENERAL_NOBACKUP` | boolean | false | Отключить автоматические резервные копии |
    | `TRILIUM_GENERAL_NODESKTOPICON` | boolean | false | Отключить создание значка на рабочем столе |
    | `TRILIUM_GENERAL_READONLY` | boolean | false | Включить режим только для чтения |

=== "Network"

    | Переменная окружения | Тип | По умолчанию | Описание |
    | --- | --- | --- | --- |
    | `TRILIUM_NETWORK_HOST` | string | "0.0.0.0" | Адрес привязки сервера |
    | `TRILIUM_NETWORK_PORT` | string | "8080" | Порт сервера |
    | `TRILIUM_NETWORK_HTTPS` | boolean | false | Включить HTTPS |
    | `TRILIUM_NETWORK_CERTPATH` | string | "" | Путь к SSL-сертификату |
    | `TRILIUM_NETWORK_KEYPATH` | string | "" | Путь к SSL-ключу |
    | `TRILIUM_NETWORK_TRUSTEDREVERSEPROXY` | string | false | Адреса доверенного обратного прокси, см. [Доверенный прокси](../Installation%20%26%20Setup/Server%20Installation/2.%20Reverse%20proxy/Trusted%20proxy.md) |
    | `TRILIUM_NETWORK_CORSALLOWORIGIN` | string | "" | Разрешённые origins для CORS |
    | `TRILIUM_NETWORK_CORSALLOWMETHODS` | string | "" | Разрешённые методы для CORS |
    | `TRILIUM_NETWORK_CORSALLOWHEADERS` | string | "" | Разрешённые заголовки для CORS |
    | `TRILIUM_NETWORK_CORSRESOURCEPOLICY` | string | same-origin | Политика ресурсов CORS; допускает значения same-origin/same-site/cross-origin, иначе ошибка |

=== "Session"

    | Переменная окружения | Тип | По умолчанию | Описание |
    | --- | --- | --- | --- |
    | `TRILIUM_SESSION_COOKIEMAXAGE` | integer | 1814400 | Максимальный возраст сессионной cookie в секундах (21 день) |

=== "Sync"

    | Переменная окружения | Тип | По умолчанию | Описание |
    | --- | --- | --- | --- |
    | `TRILIUM_SYNC_SYNCSERVERHOST` | string | "" | URL хоста сервера синхронизации |
    | `TRILIUM_SYNC_SYNCSERVERTIMEOUT` | string | "120000" | Таймаут сервера синхронизации в миллисекундах |
    | `TRILIUM_SYNC_SYNCPROXY` | string | "" | URL прокси для синхронизации |

=== "MultiFactorAuthentication"

    См. <a class="reference-link" href="../Installation%20%26%20Setup/Server%20Installation/Signing%20in%20with%20OpenID%20Connect.md">Вход с OpenID Connect</a>.

=== "Logging"

    | Переменная окружения | Тип | По умолчанию | Описание |
    | --- | --- | --- | --- |
    | `TRILIUM_LOGGING_RETENTIONDAYS` | integer | 90 | Количество дней хранения файлов журнала |

=== "Development"

    | Переменная окружения | Тип | По умолчанию | Описание |
    | --- | --- | --- | --- |
    | `TRILIUM_MANUAL_DB_MIGRATION` | boolean | false | Если `true`, приложение не запустится, если ожидают автоматические миграции базы данных, которые изменят схему базы. |

<details>
    <summary>Альтернативные переменные окружения</summary>
    <p>Следующие альтернативные имена переменных окружения также поддерживаются и работают так же, как их более длинные аналоги.</p>
    <div class="trilium-tabs"><section class="trilium-tab"><p class="trilium-tab-title">Network CORS</p><div class="trilium-tab-panel"><ul><li><code>TRILIUM_NETWORK_CORS_ALLOW_ORIGIN</code> (альтернатива <code>TRILIUM_NETWORK_CORSALLOWORIGIN</code>)</li><li><code>TRILIUM_NETWORK_CORS_ALLOW_METHODS</code> (альтернатива <code>TRILIUM_NETWORK_CORSALLOWMETHODS</code>)</li><li><code>TRILIUM_NETWORK_CORS_ALLOW_HEADERS</code> (альтернатива <code>TRILIUM_NETWORK_CORSALLOWHEADERS</code>)</li><li><code>TRILIUM_NETWORK_CORS_RESOURCE_POLICY</code> (альтернатива <code>TRILIUM_NETWORK_CORSRESOURCEPOLICY</code>)</li></ul></div></section><section class="trilium-tab"><p class="trilium-tab-title">Sync</p><div class="trilium-tab-panel"><ul><li><code>TRILIUM_SYNC_SERVER_HOST</code> (альтернатива <code>TRILIUM_SYNC_SYNCSERVERHOST</code>)</li><li><code>TRILIUM_SYNC_SERVER_TIMEOUT</code> (альтернатива <code>TRILIUM_SYNC_SYNCSERVERTIMEOUT</code>)</li><li><code>TRILIUM_SYNC_SERVER_PROXY</code> (альтернатива <code>TRILIUM_SYNC_SYNCPROXY</code>)</li></ul></div></section><section class="trilium-tab"><p class="trilium-tab-title">OAuth/MFA</p><div class="trilium-tab-panel"><ul><li><code>TRILIUM_OAUTH_BASE_URL</code> (альтернатива <code>TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHBASEURL</code>)</li><li><code>TRILIUM_OAUTH_CLIENT_ID</code> (альтернатива <code>TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTID</code>)</li><li><code>TRILIUM_OAUTH_CLIENT_SECRET</code> (альтернатива <code>TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHCLIENTSECRET</code>)</li><li><code>TRILIUM_OAUTH_ISSUER_BASE_URL</code> (альтернатива <code>TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERBASEURL</code>)</li><li><code>TRILIUM_OAUTH_ISSUER_NAME</code> (альтернатива <code>TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERNAME</code>)</li><li><code>TRILIUM_OAUTH_ISSUER_ICON</code> (альтернатива <code>TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHISSUERICON</code>)</li><li><code>TRILIUM_OAUTH_HTTP_TIMEOUT</code> (альтернатива <code>TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHHTTPTIMEOUT</code>)</li><li><code>TRILIUM_OAUTH_SCOPE</code> (альтернатива <code>TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHSCOPE</code>)</li></ul></div></section><section class="trilium-tab"><p class="trilium-tab-title">Logging</p><div class="trilium-tab-panel"><ul><li><code>TRILIUM_LOGGING_RETENTION_DAYS</code> (альтернатива <code>TRILIUM_LOGGING_RETENTIONDAYS</code>)</li></ul></div></section></div>
</details>

## Булевы значения

Булевы переменные окружения принимают следующие значения:

*   **Истина**: `"true"`, `"1"`, `1`
*   **Ложь**: `"false"`, `"0"`, `0`
*   Любое другое значение по умолчанию считается `false`

## Использование переменных окружения

Оба шаблона имён полностью поддерживаются и могут использоваться взаимозаменяемо:

*   Длинный формат следует шаблону «секция/ключ» для согласованности со структурой INI-файла
*   Более короткие альтернативы дают удобство для распространённых настроек
*   Можно использовать любой формат — оба равнозначны

## Примеры

=== "<span class="tn-icon bx bxl-docker"></span> Docker Compose"

    ```yaml
    services:
      trilium:
        image: triliumnext/trilium
        environment:
          # Полный формат
          TRILIUM_GENERAL_INSTANCENAME: "My Trilium Instance"
          TRILIUM_NETWORK_PORT: "8080"
          TRILIUM_NETWORK_CORSALLOWORIGIN: "https://myapp.com"
          TRILIUM_SYNC_SYNCSERVERHOST: "https://sync.example.com"
          TRILIUM_MULTIFACTORAUTHENTICATION_OAUTHBASEURL: "https://auth.example.com"

          # Или более короткие альтернативы (равнозначны)
          # TRILIUM_NETWORK_CORS_ALLOW_ORIGIN: "https://myapp.com"
          # TRILIUM_SYNC_SERVER_HOST: "https://sync.example.com"
          # TRILIUM_OAUTH_BASE_URL: "https://auth.example.com"
    ```

=== "<span class="tn-icon bx bxl-tux"></span> Оболочка Linux"

    ```
    # Любой из форматов
    export TRILIUM_GENERAL_NOAUTHENTICATION=false
    export TRILIUM_NETWORK_HTTPS=true
    export TRILIUM_NETWORK_CERTPATH=/path/to/cert.pem
    export TRILIUM_NETWORK_KEYPATH=/path/to/key.pem
    export TRILIUM_LOGGING_RETENTIONDAYS=30

    # Запуск Trilium
    npm start
    ```

## Справочник config.ini

Полный список опций конфигурации и их формат INI-файла смотрите в файле [config-sample.ini](https://github.com/TriliumNext/Trilium/blob/main/apps/server/src/assets/config-sample.ini) в репозитории Trilium.
