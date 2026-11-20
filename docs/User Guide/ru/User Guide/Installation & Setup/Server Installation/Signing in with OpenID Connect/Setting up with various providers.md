# Настройка с различными провайдерами
Эта страница содержит инструкции по настройке <a class="reference-link" href="../Signing%20in%20with%20OpenID%20Connect.md">входа с помощью OpenID Connect</a> для различных провайдеров, таких как Authelia, GitLab, Google.

> [!NOTE]
> Хотя справочник конфигурации актуален и верен, шаги по созданию приложения OAuth могут немного отличаться по мере того, как провайдеры обновляют свой интерфейс.

=== "Authelia"

    1.  Сгенерируйте секрет клиента:
        
        ```
        authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 72 --random.charset rfc3986
        
        ```
        
        Значение `Random Password` используется в Trilium, а `Digest` (строка `$pbkdf2-sha512$…`) — в Authelia.
    2.  Добавьте клиента в раздел `identity_providers.oidc.clients` файла `configuration.yml` Authelia, заменив `<server>` на URL вашего экземпляра Trilium:
        
        ```yaml
        identity_providers:
          oidc:
            clients:
              - client_id: 'trilium'
                client_name: 'Trilium'
                client_secret: '<Digest>'
                public: false
                authorization_policy: 'two_factor'
                redirect_uris:
                  - 'https://<server>/callback'
                scopes:
                  - 'openid'
                  - 'profile'
                  - 'email'
        ```
        
        В отличие от GitLab, `client_id` — это имя, которое вы выбираете сами, а не генерируемое провайдером.
    3.  Перезапустите Authelia.

    Отредактируйте `config.ini`, используя `Random Password` из шага 1:

    ```
    [MultiFactorAuthentication]
    oauthBaseUrl=https://<server>
    oauthClientId=<ClientId>
    oauthClientSecret=<RandomPassword>
    oauthIssuerBaseUrl=https://<server>
    oauthIssuerName=Authelia
    ```

    > [!IMPORTANT]
    > **Не** задавайте `oauthClientAuthMethod` для Authelia. По умолчанию для конфиденциальных клиентов используется `client_secret_basic`, а любой другой метод отклоняется с ошибкой `invalid_client`, и Trilium уже использует этот метод по умолчанию. Это противоположно случаю с GitLab ниже.

=== "<span class="tn-icon bx bxl-gitlab"></span> GitLab"

    1.  Перейдите в настройки пользователя на [gitlab.com](https://gitlab.com/-/user_settings/applications) или на вашем собственном сервере GitLab.
    2.  Нажмите _Add new application_.
    3.  Укажите название (например, Trilium).
    4.  Установите _Redirect URI_ в значение `https://<server>/callback`.
    5.  Убедитесь, что флажок _Confidential_ установлен, а _Device authorization grant_ снят.
    6.  В разделе scopes отметьте _openid_, _profile_ и _email_ (обычно они находятся ближе к концу списка).
    7.  Сохраните приложение и скопируйте _Application ID_ и _Secret_.

    Отредактируйте `config.ini` следующим образом, заменив `<ApplicationId>` и `<Secret>` на значения из последнего шага, а `<server>` — на URL вашего экземпляра Trilium:

    ```
    [MultiFactorAuthentication]
    oauthBaseUrl=https://<server>
    oauthClientId=<ApplicationId>
    oauthClientSecret=<Secret>
    oauthIssuerBaseUrl=https://gitlab.com
    oauthIssuerName=GitLab
    oauthClientAuthMethod=client_secret_post

    ```

    > [!IMPORTANT]
    > Если вы используете самостоятельно размещённый экземпляр GitLab, обязательно обновите `oauthIssuerBaseUrl` и сохраните строку `oauthClientAuthMethod` выше.
    > 
    > Конечная точка токенов GitLab не декодирует учётные данные, переданные через HTTP Basic, поэтому без `oauthClientAuthMethod` вход завершится с ошибкой `server responded with a challenge in the WWW-Authenticate HTTP Header`. Trilium применяет это автоматически для `gitlab.com`, но для собственного URL провайдера определить это автоматически невозможно.

=== "Kanidm"

    1.  Создайте клиента, добавьте URL перенаправления и назначьте области (scopes), заменив `<server>` на URL вашего экземпляра Trilium, а `<group>` — на существующую группу Kanidm, участники которой могут входить в систему:
        
        ```
        kanidm system oauth2 create trilium "Trilium" "https://<server>"
        kanidm system oauth2 add-redirect-url trilium "https://<server>/callback"
        kanidm system oauth2 update-scope-map trilium <group> openid profile email
        ```
        
        Область `openid` обязательна; без неё Kanidm считает клиента обычным OAuth 2.0.
    2.  Просмотрите секрет клиента:
        
        ```
        kanidm system oauth2 show-basic-secret trilium
        ```

    Отредактируйте `config.ini` следующим образом, заменив `<idm>` на URL вашего экземпляра Kanidm, а `<BasicSecret>` — на значение из шага 2:

    ```
    [MultiFactorAuthentication]
    oauthBaseUrl=https://<server>
    oauthClientId=trilium
    oauthClientSecret=<BasicSecret>
    oauthIssuerBaseUrl=https://<idm>/oauth2/openid/trilium
    oauthIssuerName=Kanidm
    ```

    Имя клиента, выбранное на шаге 1, является одновременно и ID клиента, и последним сегментом пути в URL издателя (issuer URL), поэтому они должны совпадать.

    > [!IMPORTANT]
    > Kanidm подписывает ID-токены с помощью ES256, а не RS256. Начиная с версии v0.105.0 Trilium определяет это автоматически у провайдера, поэтому дополнительная настройка не требуется. **Не** выполняйте `kanidm system oauth2 warning-enable-legacy-crypto` — это понижает клиента до RS256 и полностью отключает ES256. В более старых версиях Trilium вход завершается с ошибкой `unexpected JWT alg`.

=== "Pocket ID"

    > [!IMPORTANT]
    > Pocket ID работает без паролей — для входа требуется ключ доступа (passkey). Зарегистрируйте его и убедитесь, что вы можете войти в сам Pocket ID _до_ переключения Trilium на OpenID Connect, иначе вы рискуете потерять возможность аутентификации с обеих сторон.

    1.  Войдите в Pocket ID как администратор и перейдите в _OIDC Clients_ → _Add OIDC Client_.
    2.  Укажите название (например, Trilium).
    3.  Установите _Callback URLs_ в значение `https://<server>/callback`, заменив `<server>` на URL вашего экземпляра Trilium.
    4.  Сохраните настройки, затем скопируйте _Client ID_, _Client Secret_ и _OIDC Discovery URL_.

    Отредактируйте `config.ini` следующим образом, используя значения из шага 4:

    ```
    [MultiFactorAuthentication]
    oauthBaseUrl=https://<server>
    oauthClientId=<ClientID>
    oauthClientSecret=<ClientSecret>
    oauthIssuerBaseUrl=<OIDCDiscoveryURL>
    oauthIssuerName=Pocket ID
    ```

    > [!NOTE]
    > Pocket ID предоставляет _OIDC Discovery URL_, заканчивающийся на `/.well-known/openid-configuration`. В версии v0.105.0 и новее его можно вставить как есть. В более ранних версиях удалите этот суффикс и используйте только часть до него.

    > [!IMPORTANT]
    > При первом запуске Pocket ID генерирует ключ подписи RS256, который работает без дополнительной настройки. Если вы выполните ротацию на Ed25519 (`pocket-id key-rotate --alg EdDSA --crv Ed25519`), ID-токены будут подписываться с помощью EdDSA. Trilium определяет это автоматически начиная с v0.105.0; более старые версии завершаются с ошибкой `unexpected JWT alg received, expected RS256, got: EdDSA`.

=== "<span style="--tn-color:#e64d4d;color:#e64d4d;"><span class="tn-icon bx bx-x"></span> GitHub</span>"

    GitHub нельзя использовать в качестве провайдера удостоверений, так как он поддерживает только обычный OAuth 2.0, а не OpenID Connect, и вход завершится с ошибкой `OAUTH_RESPONSE_IS_NOT_CONFORM`.

=== "<span class="tn-icon bx bxl-google"></span> Google"

    1.  Перейдите на панель [Google Cloud's Clients](https://console.cloud.google.com/auth/clients) и выберите _Create client_.
    2.  В поле _Application type_ выберите _Web application_.
    3.  В разделе _Authorized redirect URIs_ укажите `https://<server>/callback`.
    4.  Нажмите _Create_ и скопируйте _Client ID_ и _Client secret_.

    Отредактируйте `config.ini` следующим образом, заменив `<ClientID>` и `<ClientSecret>` на значения из последнего шага, а `<server>` — на URL вашего экземпляра Trilium:

    ```
    [MultiFactorAuthentication]
    oauthBaseUrl=https://<server>
    oauthClientId=<ClientID>
    oauthClientSecret=<ClientSecret>
    ```