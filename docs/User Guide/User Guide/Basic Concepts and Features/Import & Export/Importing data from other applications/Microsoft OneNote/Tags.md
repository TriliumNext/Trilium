# Tags
OneNote's _Tags_ functionality is imported in Trilium as <a class="reference-link" href="../../../../Note%20Types/Text/Insert%20buttons/Icons.md">Icons</a> using the default icon pack or emojis (if there is no suitable replacement).

> [!IMPORTANT]
> Custom tags are not supported by OneNote's Graph API so Trilium cannot import them.

### Decorative tags

These remain formatted as paragraphs, with the glyph prepended to the text. A paragraph can carry several tags at once, in which case their glyphs stack.

| OneNote tag | `data-tag` | Imported as | Searchable as |
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

### Check box tags

These become <a class="reference-link" href="../../../../Note%20Types/Text/To-do%20Lists.md">To-do Lists</a>, with the glyph inside the item with the tick state preserved:

| OneNote tag | `data-tag` | Imported as | Searchable as |
| --- | --- | --- | --- |
| To Do | `to-do` | _(none)_ | — |
| To Do priority 1 | `to-do-priority-1` | 1️⃣ | 1️⃣ |
| To Do priority 2 | `to-do-priority-2` | 2️⃣ | 2️⃣ |
| Discuss with Person A | `discuss-with-person-a` | <span class="tn-icon bx bx-message-rounded"></span> | `message-rounded` |
| Discuss with Person B | `discuss-with-person-b` | <span class="tn-icon bx bx-message-rounded"></span> | `message-rounded` |
| Discuss with manager | `discuss-with-manager` | <span class="tn-icon bx bx-conversation"></span> | `conversation` |
| Schedule meeting | `schedule-meeting` | <span class="tn-icon bx bx-calendar"></span> | `calendar` |
| Call back | `call-back` | <span class="tn-icon bx bx-phone-call"></span> | `phone-call` |
| Client request | `client-request` | <span class="tn-icon bx bx-clipboard"></span> | `clipboard` |