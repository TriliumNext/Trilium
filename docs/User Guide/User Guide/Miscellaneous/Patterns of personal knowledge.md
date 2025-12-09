# Patterns of personal knowledge
> [!NOTE]
> This article is a description of the original author of Trilium (zadam) in regards with his own knowledge base.

This page contains description of some of the patterns I use to organize information in my knowledge base. This is meant to give some inspiration of how one might create and structure their knowledge base in general and also specifically in Trilium Notes. It also gives some background and justification for some of the design decisions.

## Meta patterns

Just to be clear, meta patterns are "patterns of patterns", i.e. patterns appearing in other patterns.

### Hierarchical organization of information

Basic meta pattern is that I sort notes (units of information) into a hierarchy - I have some "top level" notes which represent coarse grained organization, these then split into sub-notes defining finer grained organization and so on. I consider this hierarchical (tree) organization very efficient for organization of large amounts of information. A lot of note taking software (such as Evernote) are frustratingly limited in this regard which limits scalability of the software to large amounts of notes.

#### Scalability

It's important to frame the following (meta) patterns with some idea of how large amount of data are we talking about.

My rule of thumb for estimation of size of personal knowledge base is that you can reasonably produce around 10 notes a day, which is 3650 in a year. I plan to use my knowledge base long term (with or without Trilium Notes), probably decades so you can easily get to number 100 000 or even more. Right now, my personal knowledge base has around 10 000 notes.

100 000 is a number to which most note taking software doesn't scale well (in both performance and UI). Yet I don't think it's really very much considering a lifetime of knowledge.

#### Lazy hierarchy

My approach to creating the hierarchy is being lazy - I don't create the structure first and then fill it with notes, instead I create single note for some specific topic and start using this one note. Once the content starts to grow, and I see how _some_ parts could be split out, I move them out into separate sub notes. As an example I have a book review for _The Fellowship of the Ring_:

*   Book reviews
    *   The Fellowship of the Ring

The note contains basic book info (author, publisher etc.), book highlights with the comments and then overall review. Now it turns out there's far too many book highlights and overall review is also rather long, so I want to change the structure to the following:

*   Book reviews
    *   The Fellowship of the Ring       _(still contains basic info)_
        *   Highlights
        *   Review

If I used standard text file stored in a filesystem I would soon run into an annoying problem that in order to split out the Highlights and Review into sub-notes I would also have to convert _The Fellowship of the Ring_ from text file into directory and split out all sections of the note into sub-notes. Instead, Trilium treats all notes as equal - both leaf notes and inner notes can have both text content which allows me to sub-structure only content which needs it.

### Sorting notes into multiple places in the hierarchy

While organizing the notes into the hierarchy, you very quickly run into a dilemma - your note seem to belong to two places in the hierarchy equally. As an example - you want to make a note about [bash](https://en.wikipedia.org/wiki/Bash_\(Unix_shell\)) - does it belong to "OS / Linux" or "Programming / Scripting languages"? This is actually a false dichotomy forced down by the limits of the basic tree hierarchy - the answer is _of course it belongs to both_. This is the reason why Trilium doesn't use standard tree structure (which requires every note to have exactly one parent), but an extension which allows every note to have several parents, thus effectively allowing it to appear in multiple places in the hierarchy. For lack of better term I call this "cloning". The main problem with this term is that it suggests that each clone must have an original, but here all clones are completely equal - effectively there's no original.

In tech lingo, it might be better to describe it as a [hard link](https://en.wikipedia.org/wiki/Hard_link) with an important difference that it is possible to hard link (clone) a directory (inner note).

### Protected notes

I have Trilium Notes opened non-stop. Sometimes I forget to lock my computer when going to the bathroom. Sometimes I let a friend or family member to use my computer for a minute without supervision. They might click on (running) Trilium and inadvertently see a note I really don't want anybody to see (personal diary, credentials). To cover this, Trilium has a concept of "[protected notes](https://github.com/zadam/trilium/wiki/Protected-notes)" - protected note is encrypted and on top of that requires the user to enter the password every 5 minutes which guarantees that such note can be in a readable state only for small amount of time. Working with ordinary (not protected) notes don't require password so you're not bothered by extra security when it's not needed.

### Archiving notes

Notes can lose relevancy with time - let's say I switch jobs - all the notes specific to the former employer immediately lose most of its import. This doesn't mean I want to delete these notes though - typically I just want them to somehow deprioritize - in Trilium I would do that by assigning an [inherited](https://github.com/zadam/trilium/wiki/Attribute-inheritance) [label](https://github.com/zadam/trilium/wiki/Attributes) `archived` to the company root note. The main effect of this label is that all the notes from this sub-tree are filtered out from search results (fast search via note autocomplete is my main [navigation approach](https://github.com/zadam/trilium/wiki/Note-navigation)). Apart from this, I also typically move such outdated notes to some less prominent place in the hierarchy.

I use archivation also for notes which are not very relevant from their creation - an example might be automatically imported reddit comments.

Sometimes there's no clear _category_ split between relevant and non-relevant notes, in that case I just create "_OLD_" note with `archived` label and move all irrelevant notes there. So my credentials note might look something like this:

*   Credentials
    *   Personal
        *   OLD       _(contains a bunch of notes with credentials for services I don't use anymore)_
        *   Gmail
        *   Github
        *   ...

## Patterns

### Day note

Every day has its note which contains or references everything related to the given day. Structure looks like this:

*   2018
    *   11 - November
        *   26 - Monday
        *   27 - Tuesday
            *   subnote 1

Day note serves as a workspace and note inbox at the same time - it's the default location to create a note when I don't have time to think about proper placement. At the end of the day I typically review my day note and clone the notes into suitable locations in the hierarchy.

Trilium has this pattern partly built-in - Trilium understands and can create this Year / Month / Day structure semi-automatically (on API call). There's also global keyboard shortcut `CTRL-ALT-P` which will create new note in the day note.

What notes do I keep under this day note?

*   TODO list for given day (this can be automated - see <a class="reference-link" href="../Advanced%20Usage/Advanced%20Showcases/Task%20Manager.md">Task Manager</a>)
*   Personal diary
*   [clones](../Basic%20Concepts%20and%20Features/Notes/Cloning%20Notes.md) of notes I created during this day (which kind of represents what I've been working on).
*   I often clone notes (or sub-trees) of e.g. projects I'm working on at given day so they are at hand
*   I have some [scripts](../Scripting.md) which allow me to track certain daily metrics (like weight). These are saved into one daily "data note" (actually JSON [code note](../Note%20Types/Code.md)).
    *   I have other scripts which then help me to visualize these data (see a <a class="reference-link" href="../Advanced%20Usage/Advanced%20Showcases/Weight%20Tracker.md">Weight Tracker</a> example)
    *   I have a script which automatically imports all my comments from reddit into the day note.
        *   People are sometimes wondering why. The answer is that I usually put some effort and thought into a comment and that's why I feel it's worth preserving, especially if it can be done automatically.

For most notes, this day note placement is _secondary_ and their primary location is somewhere else (e.g. for a book review I've been working on it's _Book / Reviews_, not the day note). So for this pattern to work, ability to [clone](../Basic%20Concepts%20and%20Features/Notes/Cloning%20Notes.md) notes into multiple places is pretty fundamental.

### Projects

_Project_ is pretty self-explanatory, for me specifically it also means being long term (years) - an example of a project might be Trilium Notes or university studies. Given their longevity, projects can be large and deep, but their structure is very domain specific, and I don't see any common patterns. What's pretty clear is they are often widely interconnected with other parts of the knowledge base - e.g. university credentials are cloned from "Credentials / University" top level notes and Trilium related blog posts are in "Blog / \[Name of the blog\] / Trilium".

_Epics_ are the same thing as projects, but differ in scope - they are typically several months long and as such are usually placed into a year note (e.g. _2018 / Epics_). Epics are often of work nature (also cloned into work note) and personal (e.g. currently I have large epic for moving to a different city).

I don't have a term for short term projects (typically several days long), but continuing the scrum analogy I might call them _story_. These are often placed directly into day notes and manually moved from one day to another (or place into a month note, e.g. _2018 / 11 - November_).

### Credentials

I keep all my credentials in the knowledge base, they are sorted into categories - work related, project related, personal per country etc. These notes are of course [protected](../Basic%20Concepts%20and%20Features/Notes/Protected%20Notes.md) and are often cloned into other places (e.g. project credentials are cloned into the project itself). This is a pretty important advantage compared to traditional tools like KeePass - all the relevant information is centralized into one place without compromising security.

### People profiles

This might seem creepy to some, but I keep a profile on most people. It contains pretty standard things like date of birth, contacts, address, but also current and previous employments, their hobbies and worldviews and sometimes even important (IM/mail/meatspace) conversations. Just about everything I find notable. It helps to refresh some basic info before meeting people, especially if you haven't been in touch in a while. It gets pretty awkward to ask for the tenth time where do they work for example, because you keep forgetting it.

Naturally I have a lot of (extended) family members, friends, acquaintances etc. so I need some way to sort them. My main method is to sort them by social circle (work, high school, sports club etc.), sometimes also by their town of residence. Family _circle_ is still too large so the further organization is by _clan_ (as in "Smiths"). Some people are members of several such circles, so they are just cloned into multiple places.

For family specifically it's pretty useful to create [relation map](../Note%20Types/Relation%20Map.md) to visualize relationships:

<figure class="image"><img style="aspect-ratio:941/758;" src="Patterns of personal knowl.png" width="941" height="758"></figure>

<a class="reference-link" href="#root/lQcnSv5DMSe1">[missing note]</a>

### Books

Of course, I keep standard "To read" list. I also keep a record on the books I've read - typically one book has one subtree where the root has some basic info like author, page count, publication date, date started, date finished (in the form of <a class="reference-link" href="../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a>). I also write a (private) review and keep list of highlights from Kindle, optionally with some commentary, these are usually stored in sub notes (unless they are pretty short).

To keep the list of books manageable, I sort them per year (of reading them), this also gives me some basic overview of "reading performance" for given year. I plan to create a [script](../Scripting.md) which would show some timeline chart visualizing book attributes `dateStarted` - `dateFinished` to have nicer view of my reading sprints and trends.

Some specific authors also have their own note which contains cloned book reviews, links to interviews and other related resources.

I have similar system for movies and TV shows, but not as sophisticated.

### Personal diary

This is a place to reflect on events, experiences, new findings etc. This can help you get deeper understanding of your inner self, clarify your thinking and make better decisions as a result.

I sort personal diary notes directly under _day note_ (explained above), but it can be cloned also to e.g. "trip note" (if the diary note is about given trip) or to person's profile (if the person plays a role in the diary note). All my diary notes are [protected](../Basic%20Concepts%20and%20Features/Notes/Protected%20Notes.md) since they are usually pretty sensitive.

### Documents

I keep all my personal documents (ID, passport, education certificates ...) scanned in the knowledge base. They are [synchronized](../Installation%20%26%20Setup/Synchronization.md) across every PC which provides decent backup and makes them available everywhere.

Advantage compared to e.g. keeping them in Dropbox or Google Drive is that they are not stored on some 3rd party server and they can be encrypted ([protected](../Basic%20Concepts%20and%20Features/Notes/Protected%20Notes.md)).

### Inventory

Inventory contains documents and other relevant importation for my important belongings - e.g. for car you can keep the registration card, maintenance record, related costs etc. I also keep inventory for some items personally important to me - mainly computers, phones, cameras and similar electronics. This can be practical at times but also provides sentimental value.

### Topic knowledge base

This where I store hard "knowledge" - summarized topics and findings from different domains. Topics can range from traditional sciences - physics, history, economy to philosophy, mental models, apps (notes about specific apps I use) etc. Of course this is very subjective - given what I do, my Physics sub-tree is pretty sparse compared to my Programming subtree.

### Work knowledge base

I usually keep top level note for the company I currently work at (past jobs are moved elsewhere). I track basic organization of the company (divisions, business units), who is who ([relation maps](../Note%20Types/Relation%20Map.md)) are again useful for visualization), projects I work at etc.

There's a number of credentials to various company services I need to use. Companies usually have a bunch of complex processes and tools. I record meeting minutes, link to the company wiki (which is usually difficult to find relevant info). In general there's a lot of company specific information I need to know or need have them at hand in a nice structure I can understand. Often it's just copy pasting and reshuffling of existing information into something more understandable for me.

From my experience, keeping this makes me more productive and even more importantly dramatically reduces frustration and stress.

## Conclusion

I could probably go on with more patterns (e.g. study notes, travelling), but I think you get the idea. Whatever is important in your life, it probably makes sense to document and track it.