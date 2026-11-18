# Теги
Функциональность _Тегов_ OneNote импортируется в Trilium как <a class="reference-link" href="../../../../Note%20Types/Text/Insert%20buttons/Icons.md">Значки</a> из набора значков по умолчанию или как эмодзи (если подходящей замены нет).

> [!IMPORTANT]
> Пользовательские теги не поддерживаются Graph API OneNote, поэтому Trilium не может их импортировать.

### Декоративные теги

Они остаются отформатированными как абзацы, со значком перед текстом. Абзац может нести несколько тегов одновременно, в этом случае их значки накладываются друг на друга.

| Тег OneNote | `data-tag` | Импортируется как | Поисковое имя |
| --- | --- | --- | --- |
| Important | `important` | <span class="tn-icon bx bx-star"></span> | `star` |
| Critical | `critical` | <span class="tn-icon bx bx-error-circle"></span> | `error-circle` |
| Question | `question` | <span class="tn-icon bx bx-help-circle"></span> | `help-circle` |
| Highlight | `highlight` | <span class="tn-icon bx bx-highlight"></span> | `highlight` |
| Definition | `remember-for-later` | <span class="tn-icon bx bx-pin"></span> | `pin` |
| Remember for later | `remember-for-later` | <span class="tn-icon bx bx-pin"></span> | `pin` |
| Remember for blog | `remember-for-blog` | <span class="tn-icon bx bx-edit"></span> | `edit` |
| Idea | `idea` | <span class="tn-icon bx bx-bulb"></span> | `bulb` |
| Password | `password` | <span class="tn-icon bx bx-key"></span> | `key` |
| Contact | `contact` | <span class="tn-icon bx bx-user"></span> | `user` |
| Address | `address` | <span class="tn-icon bx bx-home"></span> | `home` |
| Phone number | `phone-number` | <span class="tn-icon bx bx-phone"></span> | `phone` |
| Web site to visit | `web-site-to-visit` | <span class="tn-icon bx bx-globe"></span> | `globe` |
| Source for article | `source-for-article` | <span class="tn-icon bx bx-news"></span> | `news` |
| Send in email | `send-in-email` | <span class="tn-icon bx bx-envelope"></span> | `envelope` |
| Movie to see | `movie-to-see` | <span class="tn-icon bx bx-movie"></span> | `movie` |
| Book to read | `book-to-read` | <span class="tn-icon bx bx-book"></span> | `book` |
| Music to listen to | `music-to-listen-to` | <span class="tn-icon bx bx-music"></span> | `music` |
| Project A | `project-a` | 🅰️ | 🅰️ |
| Project B | `project-b` | 🅱️ | 🅱️ |

### Теги-флажки

Они становятся <a class="reference-link" href="../../../../Note%20Types/Text/To-do%20Lists.md">Списками дел</a> со значком внутри элемента с сохранённым состоянием отметки:

| Тег OneNote | `data-tag` | Импортируется как | Поисковое имя |
| --- | --- | --- | --- |
| To Do | `to-do` | _(нет)_ | — |
| To Do priority 1 | `to-do-priority-1` | 1️⃣ | 1️⃣ |
| To Do priority 2 | `to-do-priority-2` | 2️⃣ | 2️⃣ |
| Discuss with Person A | `discuss-with-person-a` | <span class="tn-icon bx bx-message-rounded"></span> | `message-rounded` |
| Discuss with Person B | `discuss-with-person-b` | <span class="tn-icon bx bx-message-rounded"></span> | `message-rounded` |
| Discuss with manager | `discuss-with-manager` | <span class="tn-icon bx bx-conversation"></span> | `conversation` |
| Schedule meeting | `schedule-meeting` | <span class="tn-icon bx bx-calendar"></span> | `calendar` |
| Call back | `call-back` | <span class="tn-icon bx bx-phone-call"></span> | `phone-call` |
| Client request | `client-request` | <span class="tn-icon bx bx-clipboard"></span> | `clipboard` |
