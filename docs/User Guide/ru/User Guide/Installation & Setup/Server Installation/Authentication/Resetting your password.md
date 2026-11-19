# Сброс пароля
> [!IMPORTANT]
> Если вы забыли свой пароль:
> 
> *   Защищённые заметки невозможно восстановить без пароля.
> *   Незащищённые заметки можно восстановить.

Существует два способа, и оба требуют доступа к устройству, на котором запущен ваш сервер.

### Через отключение аутентификации

1.  Ознакомьтесь с разделом <a class="reference-link" href="../Authentication.md">Аутентификация</a>, чтобы узнать, как отключить аутентификацию.
2.  Перезапустите сервер.
3.  Перейдите в <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройки</a> → _Пароль_ → _Сбросить пароль_.
4.  Снова включите аутентификацию, выполнив шаг (1) в обратном порядке.
5.  Перезапустите сервер.
6.  Войдите в систему с новым паролем.

### Через изменение базы данных

1.  Откройте файл [базы данных](../../../Advanced%20Usage/Database.md) в [каталоге данных](../../Data%20directory.md). Откройте файл `document.db` с помощью клиента SQLite (например, [DB Browser](https://sqlitebrowser.org/)).
2.  Выполните следующие запросы:
    
    ```
    UPDATE options SET value = '77/twC5O00cuQgNC63VK32qOKKYwj21ev3jZDXoytVU=' WHERE name = 'passwordVerificationSalt';
    UPDATE options SET value = '710BMasZCAgibzIc07X4P9Q4TeBd4ONnqJOho+pWcBM=' WHERE name = 'passwordDerivedKeySalt';
    UPDATE options SET value = 'Eb8af1/T57b89lCRuS97tPEl4CwxsAWAU7YNJ77oY+s=' WHERE name = 'passwordVerificationHash';
    UPDATE options SET value = 'QpC8XoiYYeqHPtHKRtbNxfTHsk+pEBqVBODYp0FkPBa22tlBBKBMigdLu5GNX8Uu' WHERE name = 'encryptedDataKey';
    ```
3.  После выполнения запросов сохраните/зафиксируйте изменения. **Это установит пароль** `**password**`**, что позволит вам снова войти в систему.**
4.  Перейдите в <a class="reference-link" href="../../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройки</a> → _Пароль_ → _Изменить пароль_ и замените небезопасный пароль.

## Работа с защищёнными заметками

При сбросе пароля защищённые заметки безвозвратно теряются, поскольку они зашифрованы вашим паролем и у Trilium нет способа их расшифровать.

Для ранее существовавших защищённых заметок (которые теперь невозможно восстановить) рекомендуется удалить их или экспортировать незащищённые заметки. Затем удалите `document.db` и начните с чистой базы.