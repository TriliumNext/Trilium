# Search-Examples-and-Use-Cases
## Search Examples and Use Cases

This guide provides practical examples of how to use Trilium's search capabilities for common organizational patterns and workflows.

## Personal Knowledge Management

### Research and Learning

Track your learning progress and find related materials:

```
#topic=javascript #status=learning
```

Find all JavaScript materials you're currently learning.

```
#course #completed=false note.dateCreated >= MONTH-1
```

Find courses started in the last month that aren't completed.

```
#book #topic *=* programming #rating >= 4
```

Find highly-rated programming books.

```
#paper ~author.title *=* "Andrew Ng" #field=machine-learning
```

Find machine learning papers by Andrew Ng.

### Meeting and Event Management

Organize meetings, notes, and follow-ups:

```
#meeting note.dateCreated >= TODAY-7 #attendee *=* smith
```

Find this week's meetings with Smith.

```
#meeting #actionItems #status!=completed
```

Find meetings with outstanding action items.

```
#event #date >= TODAY #date <= TODAY+30
```

Find upcoming events in the next 30 days.

```
#meeting #project=alpha note.dateCreated >= MONTH
```

Find this month's meetings about project alpha.

### Note Organization and Cleanup

Maintain and organize your note structure:

```
note.childrenCount = 0 note.parentCount = 1 note.contentSize < 50 note.dateModified < TODAY-180
```

Find small, isolated notes not modified in 6 months (cleanup candidates).

```
note.attributeCount = 0 note.type=text note.contentSize > 1000
```

Find large text notes without any labels (might need categorization).

```
#draft note.dateCreated < TODAY-30
```

Find old draft notes that might need attention.

```
note.parentCount > 3 note.type=text
```

Find notes that are heavily cloned (might indicate important content).

## Project Management

### Task Tracking

Manage tasks and project progress:

```
#task #priority=high #status!=completed #assignee=me
```

Find your high-priority incomplete tasks.

```
#task #dueDate <= TODAY+3 #dueDate >= TODAY #status!=completed
```

Find tasks due in the next 3 days.

```
#project=website #task #status=blocked
```

Find blocked tasks in the website project.

```
#task #estimatedHours > 0 #actualHours > 0 orderBy note.dateModified desc
```

Find tasks with time tracking data, sorted by recent updates.

### Project Oversight

Monitor project health and progress:

```
#project #status=active note.children.labels.status = blocked
```

Find active projects with blocked tasks.

```
#project #startDate <= TODAY-90 #status!=completed
```

Find projects that started over 90 days ago but aren't completed.

```
#milestone #targetDate <= TODAY #status!=achieved
```

Find overdue milestones.

```
#project orderBy note.childrenCount desc limit 10
```

Find the 10 largest projects by number of sub-notes.

### Resource Planning

Track resources and dependencies:

```
#resource #type=person #availability < 50
```

Find people with low availability.

```
#dependency #status=pending #project=mobile-app
```

Find pending dependencies for the mobile app project.

```
#budget #project #spent > #allocated
```

Find projects over budget.

## Content Creation and Writing

### Writing Projects

Manage articles, books, and documentation:

```
#article #status=draft #wordCount >= 1000
```

Find substantial draft articles.

```
#chapter #book=novel #status=outline
```

Find novel chapters still in outline stage.

```
#blog-post #published=false #topic=technology
```

Find unpublished technology blog posts.

```
#documentation #lastReviewed < TODAY-90 #product=api
```

Find API documentation not reviewed in 90 days.

### Editorial Workflow

Track editing and publication status:

```
#article #editor=jane #status=review
```

Find articles assigned to Jane for review.

```
#manuscript #submissionDate >= TODAY-30 #status=pending
```

Find manuscripts submitted in the last 30 days still pending.

```
#publication #acceptanceDate >= YEAR #status=accepted
```

Find accepted publications this year.

### Content Research

Organize research materials and sources:

```
#source #reliability >= 8 #topic *=* climate
```

Find reliable sources about climate topics.

```
#quote #author *=* Einstein #verified=true
```

Find verified Einstein quotes.

```
#citation #used=false #relevance=high
```

Find high-relevance citations not yet used.

## Business and Professional Use

### Client Management

Track client relationships and projects:

```
#client=acme #project #status=active
```

Find active projects for ACME client.

```
#meeting #client #date >= MONTH #followUp=required
```

Find client meetings this month requiring follow-up.

```
#contract #renewalDate <= TODAY+60 #renewalDate >= TODAY
```

Find contracts expiring in the next 60 days.

```
#invoice #status=unpaid #dueDate < TODAY
```

Find overdue unpaid invoices.

### Process Documentation

Maintain procedures and workflows:

```
#procedure #department=engineering #lastUpdated < TODAY-365
```

Find engineering procedures not updated in a year.

```
#workflow #status=active #automation=possible
```

Find active workflows that could be automated.

```
#checklist #process=onboarding #role=developer
```

Find onboarding checklists for developers.

### Compliance and Auditing

Track compliance requirements and audits:

```
#compliance #standard=sox #nextReview <= TODAY+30
```

Find SOX compliance items due for review soon.

```
#audit #finding #severity=high #status!=resolved
```

Find unresolved high-severity audit findings.

```
#policy #department=hr #effectiveDate >= YEAR
```

Find HR policies that became effective this year.

## Academic and Educational Use

### Course Management

Organize courses and educational content:

```
#course #semester=fall-2024 #assignment #dueDate >= TODAY
```

Find upcoming assignments for fall 2024 courses.

```
#lecture #course=physics #topic *=* quantum
```

Find physics lectures about quantum topics.

```
#student #grade < 70 #course=mathematics
```

Find students struggling in mathematics.

```
#syllabus #course #lastUpdated < TODAY-180
```

Find syllabi not updated in 6 months.

### Research Management

Track research projects and publications:

```
#experiment #status=running #endDate <= TODAY+7
```

Find experiments ending in the next week.

```
#dataset #size > 1000000 #cleaned=true #public=false
```

Find large, cleaned, private datasets.

```
#hypothesis #tested=false #priority=high
```

Find high-priority untested hypotheses.

```
#collaboration #institution *=* stanford #status=active
```

Find active collaborations with Stanford.

### Grant and Funding

Manage funding applications and requirements:

```
#grant #deadline <= TODAY+30 #deadline >= TODAY #status=in-progress
```

Find grant applications due in the next 30 days.

```
#funding #amount >= 100000 #status=awarded #startDate >= YEAR
```

Find large grants awarded this year.

```
#report #funding #dueDate <= TODAY+14 #status!=submitted
```

Find funding reports due in 2 weeks.

## Technical Documentation

### Code and Development

Track code-related notes and documentation:

```
#bug #severity=critical #status!=fixed #product=webapp
```

Find critical unfixed bugs in the web app.

```
#feature #version=2.0 #status=implemented #tested=false
```

Find version 2.0 features that are implemented but not tested.

```
#api #endpoint #deprecated=true #removalDate <= TODAY+90
```

Find deprecated API endpoints scheduled for removal soon.

```
#architecture #component=database #lastReviewed < TODAY-180
```

Find database architecture documentation not reviewed in 6 months.

### System Administration

Manage infrastructure and operations:

```
#server #status=maintenance #scheduledDate >= TODAY #scheduledDate <= TODAY+7
```

Find servers scheduled for maintenance this week.

```
#backup #status=failed #date >= TODAY-7
```

Find backup failures in the last week.

```
#security #vulnerability #severity=high #patched=false
```

Find unpatched high-severity vulnerabilities.

```
#monitoring #alert #frequency > 10 #period=week
```

Find alerts triggering more than 10 times per week.

## Data Analysis and Reporting

### Performance Tracking

Monitor metrics and KPIs:

```
#metric #kpi=true #trend=declining #period=month
```

Find declining monthly KPIs.

```
#report #frequency=weekly #lastGenerated < TODAY-10
```

Find weekly reports that haven't been generated in 10 days.

```
#dashboard #stakeholder=executive #lastUpdated < TODAY-7
```

Find executive dashboards not updated this week.

### Trend Analysis

Track patterns and changes over time:

```
#data #source=sales #period=quarter #analyzed=false
```

Find unanalyzed quarterly sales data.

```
#trend #direction=up #significance=high #period=month
```

Find significant positive monthly trends.

```
#forecast #accuracy < 80 #model=linear #period=quarter
```

Find inaccurate quarterly linear forecasts.

## Search Strategy Tips

### Building Effective Queries

1.  **Start Specific**: Begin with the most selective criteria
2.  **Add Gradually**: Build complexity incrementally
3.  **Test Components**: Verify each part of complex queries
4.  **Use Shortcuts**: Leverage `#` and `~` shortcuts for efficiency

### Performance Optimization

1.  **Use Fast Search**: For large databases, enable fast search when content isn't needed
2.  **Limit Results**: Add limits to prevent overwhelming result sets
3.  **Order Strategically**: Put the most useful results first
4.  **Cache Common Queries**: Save frequently used searches

### Maintenance Patterns

Regular queries for note maintenance:

```
# Weekly cleanup check
note.attributeCount = 0 note.type=text note.contentSize < 100 note.dateModified < TODAY-30

# Monthly project review  
#project #status=active note.dateModified < TODAY-30

# Quarterly archive review
note.isArchived=false note.dateModified < TODAY-90 note.childrenCount = 0
```

## Next Steps

*   [Saved Searches](Saved-Searches.md) - Convert these examples into reusable saved searches
*   [Technical Search Details](Technical-Search-Details.md) - Understanding performance and implementation
*   [Search Fundamentals](Search-Fundamentals.md) - Review basic concepts and syntax