# ETAPI Complete Guide
## ETAPI Guide

ETAPI (External Trilium API) is the REST API for integrating external applications with Trilium Notes. This guide walks you through authentication, common operations, and best practices for building integrations.

## Getting Started

ETAPI provides programmatic access to your notes, attributes, and attachments through a RESTful interface. The API is designed to be predictable and easy to use, with comprehensive error messages to help you debug issues quickly.

Base URL: `http://localhost:8080/etapi`

## Authentication

Before using the API, you need to authenticate your requests. There are three ways to authenticate with ETAPI.

### Token Authentication (Recommended)

First, generate an ETAPI token in Trilium by navigating to Options → ETAPI and clicking "Create new ETAPI token". Then include this token in your request headers:

```sh
curl -H "Authorization: your-token" http://localhost:8080/etapi/notes/root
```

In Python:

```python
import requests

headers = {'Authorization': 'your-token'}
response = requests.get('http://localhost:8080/etapi/notes/root', headers=headers)
```

### Basic Authentication

You can also use the token as a password with any username:

```sh
curl -u "user:your-token" http://localhost:8080/etapi/notes/root
```

### Password Authentication

For automated scripts, you can login with your Trilium password to receive a session token. This method is useful when you cannot store API tokens securely:

```python
# Login and get session token
response = requests.post('http://localhost:8080/etapi/auth/login', 
                        json={'password': 'your-password'})
token = response.json()['authToken']

# Use the session token
headers = {'Authorization': token}
```

## API Endpoints

### Notes

#### Create Note

**POST** `/etapi/create-note`

Creating a note requires just a parent note ID and title. The content and other properties are optional:

```json
{
  "parentNoteId": "root",
  "title": "My New Note",
  "type": "text",
  "content": "<p>Note content in HTML</p>"
}
```

The response includes both the created note and its branch (position in the tree):

```python
def create_note(parent_id, title, content=""):
    response = requests.post(
        "http://localhost:8080/etapi/create-note",
        headers={'Authorization': 'your-token'},
        json={
            "parentNoteId": parent_id,
            "title": title,
            "content": content
        }
    )
    return response.json()

# Create a simple note
note = create_note("root", "Meeting Notes")
print(f"Created: {note['note']['noteId']}")
```

#### Get Note by ID

**GET** `/etapi/notes/{noteId}`

**cURL Example:**

```sh
curl -X GET http://localhost:8080/etapi/notes/evnnmvHTCgIn \
  -H "Authorization: your-token"
```

**Response:**

```json
{
  "noteId": "evnnmvHTCgIn",
  "title": "My Note",
  "type": "text",
  "mime": "text/html",
  "isProtected": false,
  "attributes": [
    {
      "attributeId": "abc123",
      "noteId": "evnnmvHTCgIn",
      "type": "label",
      "name": "todo",
      "value": "",
      "position": 10,
      "isInheritable": false
    }
  ],
  "parentNoteIds": ["root"],
  "childNoteIds": ["child1", "child2"],
  "dateCreated": "2024-01-15 10:30:00.000+0100",
  "dateModified": "2024-01-15 14:20:00.000+0100",
  "utcDateCreated": "2024-01-15 09:30:00.000Z",
  "utcDateModified": "2024-01-15 13:20:00.000Z"
}
```

#### Update Note

**PATCH** `/etapi/notes/{noteId}`

**Request Body:**

```json
{
  "title": "Updated Title",
  "type": "text",
  "mime": "text/html"
}
```

**JavaScript Example:**

```javascript
async function updateNote(noteId, updates) {
    const response = await fetch(`http://localhost:8080/etapi/notes/${noteId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': 'your-token',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
    });
    
    if (!response.ok) {
        throw new Error(`Failed to update note: ${response.statusText}`);
    }
    
    return response.json();
}

// Usage
updateNote('evnnmvHTCgIn', { title: 'New Title' })
    .then(note => console.log('Updated note:', note))
    .catch(err => console.error('Error:', err));
```

#### Delete Note

**DELETE** `/etapi/notes/{noteId}`

```sh
curl -X DELETE http://localhost:8080/etapi/notes/evnnmvHTCgIn \
  -H "Authorization: your-token"
```

#### Get Note Content

**GET** `/etapi/notes/{noteId}/content`

Returns the content of a note.

```python
import requests

def get_note_content(note_id, token):
    url = f"http://localhost:8080/etapi/notes/{note_id}/content"
    headers = {'Authorization': token}
    
    response = requests.get(url, headers=headers)
    return response.text  # Returns HTML or text content

content = get_note_content('evnnmvHTCgIn', 'your-token')
print(content)
```

#### Update Note Content

**PUT** `/etapi/notes/{noteId}/content`

```python
def update_note_content(note_id, content, token):
    url = f"http://localhost:8080/etapi/notes/{note_id}/content"
    headers = {
        'Authorization': token,
        'Content-Type': 'text/plain'
    }
    
    response = requests.put(url, headers=headers, data=content)
    return response.status_code == 204

# Update with HTML content
html_content = "<h1>Updated Content</h1><p>New paragraph</p>"
success = update_note_content('evnnmvHTCgIn', html_content, 'your-token')
```

### Search

#### Search Notes

**GET** `/etapi/notes`

Search notes using Trilium's powerful search syntax. The search parameter accepts keywords, labels, and complex expressions.

```python
# Simple keyword search
results = requests.get(
    "http://localhost:8080/etapi/notes",
    headers={'Authorization': 'token'},
    params={'search': 'project management'}
).json()

# Search by label
results = requests.get(
    "http://localhost:8080/etapi/notes",
    params={'search': '#todo'}
).json()

# Complex search with sorting
results = requests.get(
    "http://localhost:8080/etapi/notes",
    params={
        'search': 'type:text #important',
        'orderBy': 'dateModified',
        'orderDirection': 'desc',
        'limit': 10
    }
).json()
```

Common search patterns:

*   Keywords: `project management`
*   Labels: `#todo`, `#priority=high`
*   Note type: `type:text`, `type:code`
*   Date ranges: `dateCreated>=2024-01-01`
*   Subtree search: Use `ancestorNoteId` parameter

### Attributes

Attributes are key-value metadata attached to notes. There are two types: labels (name-value pairs) and relations (links to other notes).

#### Create Attribute

**POST** `/etapi/attributes`

```python
# Add a simple label
requests.post(
    "http://localhost:8080/etapi/attributes",
    headers={'Authorization': 'token'},
    json={
        "noteId": "note123",
        "type": "label",
        "name": "todo"
    }
)

# Add label with value
requests.post(
    "http://localhost:8080/etapi/attributes",
    json={
        "noteId": "note123",
        "type": "label",
        "name": "priority",
        "value": "high"
    }
)
```

#### Update Attribute

**PATCH** `/etapi/attributes/{attributeId}`

You can only update the value and position of labels. Relations can only have their position updated.

```python
# Update attribute value
requests.patch(
    "http://localhost:8080/etapi/attributes/attr123",
    json={"value": "low"}
)
```

#### Delete Attribute

**DELETE** `/etapi/attributes/{attributeId}`

### Branches

Branches represent the position of notes in the tree structure. A note can appear in multiple locations through cloning.

#### Clone Note to Another Location

**POST** `/etapi/branches`

```python
# Clone a note to a new parent
requests.post(
    "http://localhost:8080/etapi/branches",
    headers={'Authorization': 'token'},
    json={
        "noteId": "note123",
        "parentNoteId": "newParent456"
    }
)
```

This creates a "clone" - the same note appearing in multiple places. Changes to the note content affect all locations.

#### Move Note Position

**PATCH** `/etapi/branches/{branchId}`

```python
# Change note position or prefix
requests.patch(
    "http://localhost:8080/etapi/branches/branch123",
    json={"notePosition": 5}
)
```

#### Remove Branch

**DELETE** `/etapi/branches/{branchId}`

Removes a note from one location. If it's the last location, the note itself is deleted.

### Attachments

#### Create Attachment

**POST** `/etapi/attachments`

```json
{
  "ownerId": "evnnmvHTCgIn",
  "role": "file",
  "mime": "application/pdf",
  "title": "document.pdf",
  "content": "base64-encoded-content",
  "position": 10
}
```

**Python Example with File Upload:**

```python
import base64

def upload_attachment(note_id, file_path, title=None):
    with open(file_path, 'rb') as f:
        content = base64.b64encode(f.read()).decode('utf-8')
    
    import mimetypes
    mime_type = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
    
    if title is None:
        import os
        title = os.path.basename(file_path)
    
    url = "http://localhost:8080/etapi/attachments"
    headers = {
        'Authorization': 'your-token',
        'Content-Type': 'application/json'
    }
    
    data = {
        "ownerId": note_id,
        "role": "file",
        "mime": mime_type,
        "title": title,
        "content": content
    }
    
    response = requests.post(url, headers=headers, json=data)
    return response.json()

# Upload a PDF
attachment = upload_attachment("evnnmvHTCgIn", "/path/to/document.pdf")
print(f"Attachment ID: {attachment['attachmentId']}")
```

#### Get Attachment Content

**GET** `/etapi/attachments/{attachmentId}/content`

```python
def download_attachment(attachment_id, output_path):
    url = f"http://localhost:8080/etapi/attachments/{attachment_id}/content"
    headers = {'Authorization': 'your-token'}
    
    response = requests.get(url, headers=headers)
    
    with open(output_path, 'wb') as f:
        f.write(response.content)
    
    return output_path

# Download attachment
download_attachment("attachId123", "/tmp/downloaded.pdf")
```

### Special Notes

#### Get Inbox Note

**GET** `/etapi/inbox/{date}`

Gets or creates an inbox note for the specified date.

```python
from datetime import date

def get_inbox_note(target_date=None):
    if target_date is None:
        target_date = date.today()
    
    date_str = target_date.strftime('%Y-%m-%d')
    url = f"http://localhost:8080/etapi/inbox/{date_str}"
    headers = {'Authorization': 'your-token'}
    
    response = requests.get(url, headers=headers)
    return response.json()

# Get today's inbox
inbox = get_inbox_note()
print(f"Inbox note ID: {inbox['noteId']}")
```

#### Calendar Notes

**Day Note:**

```python
def get_day_note(date_str):
    url = f"http://localhost:8080/etapi/calendar/days/{date_str}"
    headers = {'Authorization': 'your-token'}
    response = requests.get(url, headers=headers)
    return response.json()

day_note = get_day_note("2024-01-15")
```

**Week Note:**

```python
def get_week_note(date_str):
    url = f"http://localhost:8080/etapi/calendar/weeks/{date_str}"
    headers = {'Authorization': 'your-token'}
    response = requests.get(url, headers=headers)
    return response.json()

week_note = get_week_note("2024-01-15")
```

**Month Note:**

```python
def get_month_note(month_str):
    url = f"http://localhost:8080/etapi/calendar/months/{month_str}"
    headers = {'Authorization': 'your-token'}
    response = requests.get(url, headers=headers)
    return response.json()

month_note = get_month_note("2024-01")
```

**Year Note:**

```python
def get_year_note(year):
    url = f"http://localhost:8080/etapi/calendar/years/{year}"
    headers = {'Authorization': 'your-token'}
    response = requests.get(url, headers=headers)
    return response.json()

year_note = get_year_note("2024")
```

### Import/Export

#### Export Note Subtree

**GET** `/etapi/notes/{noteId}/export`

Exports a note subtree as a ZIP file.

**Query Parameters:**

*   `format`: "html" (default) or "markdown"

```python
def export_subtree(note_id, output_file, format="html"):
    url = f"http://localhost:8080/etapi/notes/{note_id}/export"
    headers = {'Authorization': 'your-token'}
    params = {'format': format}
    
    response = requests.get(url, headers=headers, params=params)
    
    with open(output_file, 'wb') as f:
        f.write(response.content)
    
    return output_file

# Export entire database
export_subtree("root", "backup.zip")

# Export specific subtree as markdown
export_subtree("projectNoteId", "project.zip", format="markdown")
```

#### Import ZIP

**POST** `/etapi/notes/{noteId}/import`

Imports a ZIP file into a note.

```python
def import_zip(parent_note_id, zip_file_path):
    url = f"http://localhost:8080/etapi/notes/{parent_note_id}/import"
    headers = {'Authorization': 'your-token'}
    
    with open(zip_file_path, 'rb') as f:
        files = {'file': f}
        response = requests.post(url, headers=headers, files=files)
    
    return response.json()

# Import backup
imported = import_zip("root", "backup.zip")
print(f"Imported note ID: {imported['note']['noteId']}")
```

### Utility Endpoints

#### Create Note Revision

**POST** `/etapi/notes/{noteId}/revision`

Forces creation of a revision for the specified note.

```sh
curl -X POST http://localhost:8080/etapi/notes/evnnmvHTCgIn/revision \
  -H "Authorization: your-token"
```

#### Refresh Note Ordering

**POST** `/etapi/refresh-note-ordering/{parentNoteId}`

Updates note ordering in connected clients after changing positions.

```python
def reorder_children(parent_id, note_positions):
    """
    note_positions: dict of {noteId: position}
    """
    headers = {
        'Authorization': 'your-token',
        'Content-Type': 'application/json'
    }
    
    # Update each branch position
    for note_id, position in note_positions.items():
        # Get the branch ID first
        note = requests.get(
            f"http://localhost:8080/etapi/notes/{note_id}",
            headers=headers
        ).json()
        
        for branch_id in note['parentBranchIds']:
            branch = requests.get(
                f"http://localhost:8080/etapi/branches/{branch_id}",
                headers=headers
            ).json()
            
            if branch['parentNoteId'] == parent_id:
                # Update position
                requests.patch(
                    f"http://localhost:8080/etapi/branches/{branch_id}",
                    headers=headers,
                    json={'notePosition': position}
                )
    
    # Refresh ordering
    requests.post(
        f"http://localhost:8080/etapi/refresh-note-ordering/{parent_id}",
        headers=headers
    )

# Reorder notes
reorder_children("parentId", {
    "note1": 10,
    "note2": 20,
    "note3": 30
})
```

#### Get App Info

**GET** `/etapi/app-info`

Returns information about the Trilium instance.

```python
def get_app_info():
    url = "http://localhost:8080/etapi/app-info"
    headers = {'Authorization': 'your-token'}
    response = requests.get(url, headers=headers)
    return response.json()

info = get_app_info()
print(f"Trilium version: {info['appVersion']}")
print(f"Database version: {info['dbVersion']}")
print(f"Data directory: {info['dataDirectory']}")
```

#### Create Backup

**PUT** `/etapi/backup/{backupName}`

Creates a database backup.

```sh
curl -X PUT http://localhost:8080/etapi/backup/daily \
  -H "Authorization: your-token"
```

This creates a backup file named `backup-daily.db` in the data directory.

## Common Use Cases

### 1\. Daily Journal Entry

```python
from datetime import date
import requests

class TriliumJournal:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {'Authorization': token}
    
    def create_journal_entry(self, content, tags=[]):
        # Get today's day note
        today = date.today().strftime('%Y-%m-%d')
        day_note_url = f"{self.base_url}/calendar/days/{today}"
        day_note = requests.get(day_note_url, headers=self.headers).json()
        
        # Create entry
        entry_data = {
            "parentNoteId": day_note['noteId'],
            "title": f"Entry - {date.today().strftime('%H:%M')}",
            "type": "text",
            "content": content
        }
        
        response = requests.post(
            f"{self.base_url}/create-note",
            headers={**self.headers, 'Content-Type': 'application/json'},
            json=entry_data
        )
        
        entry = response.json()
        
        # Add tags
        for tag in tags:
            self.add_tag(entry['note']['noteId'], tag)
        
        return entry
    
    def add_tag(self, note_id, tag_name):
        attr_data = {
            "noteId": note_id,
            "type": "label",
            "name": tag_name,
            "value": ""
        }
        
        requests.post(
            f"{self.base_url}/attributes",
            headers={**self.headers, 'Content-Type': 'application/json'},
            json=attr_data
        )

# Usage
journal = TriliumJournal("http://localhost:8080/etapi", "your-token")
entry = journal.create_journal_entry(
    "<p>Today's meeting went well. Key decisions:</p><ul><li>Item 1</li></ul>",
    tags=["meeting", "important"]
)
```

### 2\. Task Management System

```python
class TriliumTaskManager:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {'Authorization': token}
        self.task_parent_id = self.get_or_create_task_root()
    
    def get_or_create_task_root(self):
        # Search for existing task root
        search_url = f"{self.base_url}/notes"
        params = {'search': '#taskRoot'}
        response = requests.get(search_url, headers=self.headers, params=params)
        results = response.json()['results']
        
        if results:
            return results[0]['noteId']
        
        # Create task root
        data = {
            "parentNoteId": "root",
            "title": "Tasks",
            "type": "text",
            "content": "<p>Task Management System</p>"
        }
        
        response = requests.post(
            f"{self.base_url}/create-note",
            headers={**self.headers, 'Content-Type': 'application/json'},
            json=data
        )
        
        note_id = response.json()['note']['noteId']
        
        # Add taskRoot label
        self.add_label(note_id, "taskRoot")
        return note_id
    
    def create_task(self, title, description, priority="medium", due_date=None):
        data = {
            "parentNoteId": self.task_parent_id,
            "title": title,
            "type": "text",
            "content": f"<p>{description}</p>"
        }
        
        response = requests.post(
            f"{self.base_url}/create-note",
            headers={**self.headers, 'Content-Type': 'application/json'},
            json=data
        )
        
        task = response.json()
        task_id = task['note']['noteId']
        
        # Add task attributes
        self.add_label(task_id, "task")
        self.add_label(task_id, "todoStatus", "todo")
        self.add_label(task_id, "priority", priority)
        
        if due_date:
            self.add_label(task_id, "dueDate", due_date)
        
        return task
    
    def get_tasks(self, status=None):
        if status:
            search = f"#task #todoStatus={status}"
        else:
            search = "#task"
        
        params = {
            'search': search,
            'ancestorNoteId': self.task_parent_id
        }
        
        response = requests.get(
            f"{self.base_url}/notes",
            headers=self.headers,
            params=params
        )
        
        return response.json()['results']
    
    def complete_task(self, task_id):
        # Find the todoStatus attribute
        note = requests.get(
            f"{self.base_url}/notes/{task_id}",
            headers=self.headers
        ).json()
        
        for attr in note['attributes']:
            if attr['name'] == 'todoStatus':
                # Update status
                requests.patch(
                    f"{self.base_url}/attributes/{attr['attributeId']}",
                    headers={**self.headers, 'Content-Type': 'application/json'},
                    json={'value': 'done'}
                )
                break
    
    def add_label(self, note_id, name, value=""):
        data = {
            "noteId": note_id,
            "type": "label",
            "name": name,
            "value": value
        }
        
        requests.post(
            f"{self.base_url}/attributes",
            headers={**self.headers, 'Content-Type': 'application/json'},
            json=data
        )

# Usage
tasks = TriliumTaskManager("http://localhost:8080/etapi", "your-token")

# Create tasks
task1 = tasks.create_task(
    "Review API documentation",
    "Check for completeness and accuracy",
    priority="high",
    due_date="2024-01-20"
)

task2 = tasks.create_task(
    "Update client library",
    "Add new ETAPI endpoints",
    priority="medium"
)

# List pending tasks
pending = tasks.get_tasks(status="todo")
for task in pending:
    print(f"- {task['title']}")

# Complete a task
tasks.complete_task(task1['note']['noteId'])
```

### 3\. Knowledge Base Builder

```python
class KnowledgeBase:
    def __init__(self, base_url, token):
        self.base_url = base_url
        self.headers = {'Authorization': token}
    
    def create_article(self, category, title, content, tags=[]):
        # Find or create category
        category_id = self.get_or_create_category(category)
        
        # Create article
        data = {
            "parentNoteId": category_id,
            "title": title,
            "type": "text",
            "content": content
        }
        
        response = requests.post(
            f"{self.base_url}/create-note",
            headers={**self.headers, 'Content-Type': 'application/json'},
            json=data
        )
        
        article = response.json()
        article_id = article['note']['noteId']
        
        # Add tags
        for tag in tags:
            self.add_label(article_id, tag)
        
        # Add article label
        self.add_label(article_id, "article")
        
        return article
    
    def get_or_create_category(self, name):
        # Search for existing category
        params = {'search': f'#category #categoryName={name}'}
        response = requests.get(
            f"{self.base_url}/notes",
            headers=self.headers,
            params=params
        )
        
        results = response.json()['results']
        if results:
            return results[0]['noteId']
        
        # Create new category
        data = {
            "parentNoteId": "root",
            "title": name,
            "type": "text",
            "content": f"<h1>{name}</h1>"
        }
        
        response = requests.post(
            f"{self.base_url}/create-note",
            headers={**self.headers, 'Content-Type': 'application/json'},
            json=data
        )
        
        category_id = response.json()['note']['noteId']
        
        self.add_label(category_id, "category")
        self.add_label(category_id, "categoryName", name)
        
        return category_id
    
    def search_articles(self, query):
        params = {
            'search': f'#article {query}',
            'orderBy': 'relevancy'
        }
        
        response = requests.get(
            f"{self.base_url}/notes",
            headers=self.headers,
            params=params
        )
        
        return response.json()['results']
    
    def add_label(self, note_id, name, value=""):
        data = {
            "noteId": note_id,
            "type": "label",
            "name": name,
            "value": value
        }
        
        requests.post(
            f"{self.base_url}/attributes",
            headers={**self.headers, 'Content-Type': 'application/json'},
            json=data
        )

# Usage
kb = KnowledgeBase("http://localhost:8080/etapi", "your-token")

# Add articles
article = kb.create_article(
    category="Python",
    title="Working with REST APIs",
    content="""
    <h2>Introduction</h2>
    <p>REST APIs are fundamental to modern web development...</p>
    <h2>Best Practices</h2>
    <ul>
        <li>Use proper HTTP methods</li>
        <li>Handle errors gracefully</li>
        <li>Implement retry logic</li>
    </ul>
    """,
    tags=["api", "rest", "tutorial"]
)

# Search articles
results = kb.search_articles("REST API")
for article in results:
    print(f"Found: {article['title']}")
```

## Client Library Examples

### JavaScript/TypeScript Client

```typescript
class TriliumClient {
    private baseUrl: string;
    private token: string;
    
    constructor(baseUrl: string, token: string) {
        this.baseUrl = baseUrl;
        this.token = token;
    }
    
    private async request(
        endpoint: string, 
        options: RequestInit = {}
    ): Promise<any> {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Authorization': this.token,
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        const response = await fetch(url, {
            ...options,
            headers
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(`API Error: ${error.message}`);
        }
        
        if (response.status === 204) {
            return null;
        }
        
        return response.json();
    }
    
    async getNote(noteId: string) {
        return this.request(`/notes/${noteId}`);
    }
    
    async createNote(data: any) {
        return this.request('/create-note', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
    
    async updateNote(noteId: string, updates: any) {
        return this.request(`/notes/${noteId}`, {
            method: 'PATCH',
            body: JSON.stringify(updates)
        });
    }
    
    async deleteNote(noteId: string) {
        return this.request(`/notes/${noteId}`, {
            method: 'DELETE'
        });
    }
    
    async searchNotes(query: string, options: any = {}) {
        const params = new URLSearchParams({
            search: query,
            ...options
        });
        
        return this.request(`/notes?${params}`);
    }
    
    async addAttribute(noteId: string, type: string, name: string, value = '') {
        return this.request('/attributes', {
            method: 'POST',
            body: JSON.stringify({
                noteId,
                type,
                name,
                value
            })
        });
    }
}

// Usage
const client = new TriliumClient('http://localhost:8080/etapi', 'your-token');

// Create a note
const note = await client.createNote({
    parentNoteId: 'root',
    title: 'New Note',
    type: 'text',
    content: '<p>Content</p>'
});

// Search notes
const results = await client.searchNotes('#todo', {
    orderBy: 'dateModified',
    orderDirection: 'desc',
    limit: 10
});

// Add a label
await client.addAttribute(note.note.noteId, 'label', 'important');
```

### Python Client Class

```python
import requests
from typing import Optional, Dict, List, Any
from datetime import datetime
import json

class TriliumETAPI:
    """Python client for Trilium ETAPI"""
    
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': token,
            'Content-Type': 'application/json'
        })
    
    def _request(self, method: str, endpoint: str, **kwargs) -> Any:
        """Make API request with error handling"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            response = self.session.request(method, url, **kwargs)
            response.raise_for_status()
            
            if response.status_code == 204:
                return None
            
            return response.json() if response.content else None
            
        except requests.exceptions.HTTPError as e:
            if response.text:
                try:
                    error = response.json()
                    raise Exception(f"API Error {error.get('code')}: {error.get('message')}")
                except json.JSONDecodeError:
                    raise Exception(f"HTTP {response.status_code}: {response.text}")
            raise e
    
    # Note operations
    def create_note(
        self,
        parent_note_id: str,
        title: str,
        content: str,
        note_type: str = "text",
        **kwargs
    ) -> Dict:
        """Create a new note"""
        data = {
            "parentNoteId": parent_note_id,
            "title": title,
            "type": note_type,
            "content": content,
            **kwargs
        }
        return self._request('POST', '/create-note', json=data)
    
    def get_note(self, note_id: str) -> Dict:
        """Get note by ID"""
        return self._request('GET', f'/notes/{note_id}')
    
    def update_note(self, note_id: str, updates: Dict) -> Dict:
        """Update note properties"""
        return self._request('PATCH', f'/notes/{note_id}', json=updates)
    
    def delete_note(self, note_id: str) -> None:
        """Delete a note"""
        self._request('DELETE', f'/notes/{note_id}')
    
    def get_note_content(self, note_id: str) -> str:
        """Get note content"""
        response = self.session.get(f"{self.base_url}/notes/{note_id}/content")
        response.raise_for_status()
        return response.text
    
    def update_note_content(self, note_id: str, content: str) -> None:
        """Update note content"""
        headers = {'Content-Type': 'text/plain'}
        self.session.put(
            f"{self.base_url}/notes/{note_id}/content",
            data=content,
            headers=headers
        ).raise_for_status()
    
    # Search
    def search_notes(
        self,
        query: str,
        fast_search: bool = False,
        include_archived: bool = False,
        ancestor_note_id: Optional[str] = None,
        order_by: Optional[str] = None,
        order_direction: str = "asc",
        limit: Optional[int] = None
    ) -> List[Dict]:
        """Search for notes"""
        params = {
            'search': query,
            'fastSearch': fast_search,
            'includeArchivedNotes': include_archived
        }
        
        if ancestor_note_id:
            params['ancestorNoteId'] = ancestor_note_id
        if order_by:
            params['orderBy'] = order_by
            params['orderDirection'] = order_direction
        if limit:
            params['limit'] = limit
        
        result = self._request('GET', '/notes', params=params)
        return result.get('results', [])
    
    # Attributes
    def add_label(
        self,
        note_id: str,
        name: str,
        value: str = "",
        inheritable: bool = False
    ) -> Dict:
        """Add a label to a note"""
        data = {
            "noteId": note_id,
            "type": "label",
            "name": name,
            "value": value,
            "isInheritable": inheritable
        }
        return self._request('POST', '/attributes', json=data)
    
    def add_relation(
        self,
        note_id: str,
        name: str,
        target_note_id: str,
        inheritable: bool = False
    ) -> Dict:
        """Add a relation to a note"""
        data = {
            "noteId": note_id,
            "type": "relation",
            "name": name,
            "value": target_note_id,
            "isInheritable": inheritable
        }
        return self._request('POST', '/attributes', json=data)
    
    def update_attribute(self, attribute_id: str, updates: Dict) -> Dict:
        """Update an attribute"""
        return self._request('PATCH', f'/attributes/{attribute_id}', json=updates)
    
    def delete_attribute(self, attribute_id: str) -> None:
        """Delete an attribute"""
        self._request('DELETE', f'/attributes/{attribute_id}')
    
    # Branches
    def clone_note(
        self,
        note_id: str,
        parent_note_id: str,
        prefix: str = ""
    ) -> Dict:
        """Clone a note to another location"""
        data = {
            "noteId": note_id,
            "parentNoteId": parent_note_id,
            "prefix": prefix
        }
        return self._request('POST', '/branches', json=data)
    
    def move_note(
        self,
        note_id: str,
        new_parent_id: str
    ) -> None:
        """Move a note to a new parent"""
        # Get current branches
        note = self.get_note(note_id)
        
        # Delete old branches
        for branch_id in note['parentBranchIds']:
            self._request('DELETE', f'/branches/{branch_id}')
        
        # Create new branch
        self.clone_note(note_id, new_parent_id)
    
    # Special notes
    def get_inbox(self, date: Optional[datetime] = None) -> Dict:
        """Get inbox note for a date"""
        if date is None:
            date = datetime.now()
        date_str = date.strftime('%Y-%m-%d')
        return self._request('GET', f'/inbox/{date_str}')
    
    def get_day_note(self, date: Optional[datetime] = None) -> Dict:
        """Get day note for a date"""
        if date is None:
            date = datetime.now()
        date_str = date.strftime('%Y-%m-%d')
        return self._request('GET', f'/calendar/days/{date_str}')
    
    # Utility
    def get_app_info(self) -> Dict:
        """Get application information"""
        return self._request('GET', '/app-info')
    
    def create_backup(self, name: str) -> None:
        """Create a backup"""
        self._request('PUT', f'/backup/{name}')
    
    def export_subtree(
        self,
        note_id: str,
        format: str = "html"
    ) -> bytes:
        """Export note subtree as ZIP"""
        params = {'format': format}
        response = self.session.get(
            f"{self.base_url}/notes/{note_id}/export",
            params=params
        )
        response.raise_for_status()
        return response.content

# Example usage
if __name__ == "__main__":
    # Initialize client
    api = TriliumETAPI("http://localhost:8080/etapi", "your-token")
    
    # Create a note
    note = api.create_note(
        parent_note_id="root",
        title="API Test Note",
        content="<p>Created via Python client</p>"
    )
    print(f"Created note: {note['note']['noteId']}")
    
    # Add labels
    api.add_label(note['note']['noteId'], "test")
    api.add_label(note['note']['noteId'], "priority", "high")
    
    # Search
    results = api.search_notes("#test", limit=10)
    for result in results:
        print(f"Found: {result['title']}")
    
    # Export backup
    backup_data = api.export_subtree("root")
    with open("backup.zip", "wb") as f:
        f.write(backup_data)
```

## Rate Limiting and Best Practices

### Rate Limiting

ETAPI implements rate limiting for authentication endpoints:

*   **Login endpoint**: Maximum 10 requests per IP per hour
*   **Other endpoints**: No specific rate limits, but excessive requests may be throttled

### Best Practices

#### 1\. Connection Pooling

Reuse HTTP connections for better performance:

```python
import requests
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

session = requests.Session()
retry = Retry(
    total=3,
    backoff_factor=0.3,
    status_forcelist=[500, 502, 503, 504]
)
adapter = HTTPAdapter(max_retries=retry)
session.mount('http://', adapter)
session.mount('https://', adapter)
```

#### 2\. Batch Operations

When possible, batch multiple operations:

```python
def batch_create_notes(notes_data):
    """Create multiple notes efficiently"""
    created_notes = []
    
    for data in notes_data:
        note = api.create_note(**data)
        created_notes.append(note)
        
        # Add small delay to avoid overwhelming server
        time.sleep(0.1)
    
    return created_notes
```

#### 3\. Error Handling

Implement robust error handling:

```python
import time
from typing import Callable, Any

def retry_on_error(
    func: Callable,
    max_retries: int = 3,
    backoff_factor: float = 1.0
) -> Any:
    """Retry function with exponential backoff"""
    for attempt in range(max_retries):
        try:
            return func()
        except requests.exceptions.RequestException as e:
            if attempt == max_retries - 1:
                raise
            
            wait_time = backoff_factor * (2 ** attempt)
            print(f"Request failed, retrying in {wait_time}s...")
            time.sleep(wait_time)

# Usage
note = retry_on_error(
    lambda: api.create_note("root", "Title", "Content")
)
```

#### 4\. Caching

Cache frequently accessed data:

```python
from functools import lru_cache
from datetime import datetime, timedelta

class CachedTriliumClient(TriliumETAPI):
    def __init__(self, base_url: str, token: str):
        super().__init__(base_url, token)
        self._cache = {}
        self._cache_times = {}
    
    def get_note_cached(self, note_id: str, max_age: int = 300):
        """Get note with caching (max_age in seconds)"""
        cache_key = f"note:{note_id}"
        
        if cache_key in self._cache:
            cache_time = self._cache_times[cache_key]
            if datetime.now() - cache_time < timedelta(seconds=max_age):
                return self._cache[cache_key]
        
        note = self.get_note(note_id)
        self._cache[cache_key] = note
        self._cache_times[cache_key] = datetime.now()
        
        return note
```

#### 5\. Pagination for Large Results

Handle large result sets with pagination:

```python
def search_all_notes(api: TriliumETAPI, query: str, batch_size: int = 100):
    """Search with pagination for large result sets"""
    all_results = []
    offset = 0
    
    while True:
        results = api.search_notes(
            query,
            limit=batch_size,
            order_by="dateCreated"
        )
        
        if not results:
            break
        
        all_results.extend(results)
        
        if len(results) < batch_size:
            break
        
        # Use the last note's date as reference for next batch
        last_date = results[-1]['dateCreated']
        query_with_date = f"{query} dateCreated>{last_date}"
        
    return all_results
```

## Migration from Internal API

### Key Differences

| Aspect | Internal API | ETAPI |
| --- | --- | --- |
| **Purpose** | Trilium client communication | External integrations |
| **Authentication** | Session-based | Token-based |
| **Stability** | May change between versions | Stable interface |
| **CSRF Protection** | Required | Not required |
| **WebSocket** | Supported | Not available |
| **Documentation** | Limited | Comprehensive |

### Migration Steps

1.  **Replace Authentication**
    
    ```python
    # Old (Internal API)
    session = requests.Session()
    session.post('/api/login', data={'password': 'pass'})
    
    # New (ETAPI)
    headers = {'Authorization': 'etapi-token'}
    ```
2.  **Update Endpoints**
    
    ```python
    # Old
    /api/notes/getNoteById/noteId
    
    # New
    /etapi/notes/noteId
    ```
3.  **Adjust Request/Response Format**
    
    ```python
    # Old (may vary)
    response = session.post('/api/notes/new', json={
        'parentNoteId': 'root',
        'title': 'Title'
    })
    
    # New (standardized)
    response = requests.post('/etapi/create-note', 
        headers=headers,
        json={
            'parentNoteId': 'root',
            'title': 'Title',
            'type': 'text',
            'content': ''
        }
    )
    ```

## Error Handling

### Common Error Codes

| Status | Code | Description | Resolution |
| --- | --- | --- | --- |
| 400 | BAD\_REQUEST | Invalid request format | Check request body and parameters |
| 401 | UNAUTHORIZED | Invalid or missing token | Verify authentication token |
| 404 | NOTE\_NOT\_FOUND | Note doesn't exist | Check note ID |
| 404 | BRANCH\_NOT\_FOUND | Branch doesn't exist | Verify branch ID |
| 400 | NOTE\_IS\_PROTECTED | Cannot modify protected note | Unlock protected session first |
| 429 | TOO\_MANY\_REQUESTS | Rate limit exceeded | Wait before retrying |
| 500 | INTERNAL\_ERROR | Server error | Report issue, check logs |

### Error Response Format

```json
{
  "status": 400,
  "code": "VALIDATION_ERROR",
  "message": "Note title cannot be empty"
}
```

### Handling Errors in Code

```python
class ETAPIError(Exception):
    def __init__(self, status, code, message):
        self.status = status
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")

def handle_api_response(response):
    if response.status_code >= 400:
        try:
            error = response.json()
            raise ETAPIError(
                error.get('status'),
                error.get('code'),
                error.get('message')
            )
        except json.JSONDecodeError:
            raise ETAPIError(
                response.status_code,
                'UNKNOWN_ERROR',
                response.text
            )
    
    return response.json() if response.content else None

# Usage
try:
    response = requests.get(
        'http://localhost:8080/etapi/notes/invalid',
        headers={'Authorization': 'token'}
    )
    note = handle_api_response(response)
except ETAPIError as e:
    if e.code == 'NOTE_NOT_FOUND':
        print("Note doesn't exist")
    else:
        print(f"API Error: {e.message}")
```

## Performance Considerations

### 1\. Minimize API Calls

```python
# Bad: Multiple calls
note = api.get_note(note_id)
for child_id in note['childNoteIds']:
    child = api.get_note(child_id)  # N+1 problem
    process(child)

# Good: Batch processing
note = api.get_note(note_id)
children = api.search_notes(
    f"note.parents.noteId={note_id}",
    limit=1000
)
for child in children:
    process(child)
```

### 2\. Use Appropriate Search Depth

```python
# Limit search depth for better performance
results = api.search_notes(
    "keyword",
    ancestor_note_id="root",
    ancestor_depth="lt3"  # Only search 3 levels deep
)
```

### 3\. Content Compression

Enable gzip compression for large responses:

```python
session = requests.Session()
session.headers.update({
    'Authorization': 'token',
    'Accept-Encoding': 'gzip, deflate'
})
```

### 4\. Async Operations

Use async requests for parallel operations:

```python
import asyncio
import aiohttp

class AsyncTriliumClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url
        self.headers = {'Authorization': token}
    
    async def get_note(self, session, note_id):
        url = f"{self.base_url}/notes/{note_id}"
        async with session.get(url, headers=self.headers) as response:
            return await response.json()
    
    async def get_multiple_notes(self, note_ids):
        async with aiohttp.ClientSession() as session:
            tasks = [self.get_note(session, nid) for nid in note_ids]
            return await asyncio.gather(*tasks)

# Usage
client = AsyncTriliumClient("http://localhost:8080/etapi", "token")
notes = asyncio.run(client.get_multiple_notes(['id1', 'id2', 'id3']))
```

### 5\. Database Optimization

For bulk operations, consider:

*   Creating notes in batches
*   Using transactions (via backup/restore)
*   Indexing frequently searched attributes

## Security Considerations

### Token Management

*   Store tokens securely (environment variables, key vaults)
*   Rotate tokens regularly
*   Use separate tokens for different applications
*   Never commit tokens to version control

```python
import os
from dotenv import load_dotenv

load_dotenv()

# Load token from environment
TOKEN = os.getenv('TRILIUM_ETAPI_TOKEN')
if not TOKEN:
    raise ValueError("TRILIUM_ETAPI_TOKEN not set")

api = TriliumETAPI("http://localhost:8080/etapi", TOKEN)
```

### HTTPS Usage

Always use HTTPS in production:

```python
# Development
dev_api = TriliumETAPI("http://localhost:8080/etapi", token)

# Production
prod_api = TriliumETAPI("https://notes.example.com/etapi", token)
```

### Input Validation

Sanitize user input before sending to API:

```python
import html
import re

def sanitize_html(content: str) -> str:
    """Basic HTML sanitization"""
    # Remove script tags
    content = re.sub(r'<script[^>]*>.*?</script>', '', content, flags=re.DOTALL)
    # Remove on* attributes
    content = re.sub(r'\s*on\w+\s*=\s*["\'][^"\']*["\']', '', content)
    return content

def create_safe_note(title: str, content: str):
    safe_title = html.escape(title)
    safe_content = sanitize_html(content)
    
    return api.create_note(
        parent_note_id="root",
        title=safe_title,
        content=safe_content
    )
```

## Troubleshooting

### Connection Issues

```python
# Test connection
def test_connection(base_url, token):
    try:
        api = TriliumETAPI(base_url, token)
        info = api.get_app_info()
        print(f"Connected to Trilium {info['appVersion']}")
        return True
    except Exception as e:
        print(f"Connection failed: {e}")
        return False

# Debug mode
import logging
logging.basicConfig(level=logging.DEBUG)
```

### Common Issues and Solutions

| Issue | Cause | Solution |
| --- | --- | --- |
| 401 Unauthorized | Invalid token | Regenerate token in Trilium Options |
| Connection refused | Server not running | Start Trilium server |
| CORS errors | Cross-origin requests | Configure CORS in Trilium settings |
| Timeout errors | Large operations | Increase timeout, use async |
| 404 Not Found | Wrong endpoint | Check ETAPI prefix in URL |
| Protected note error | Note is encrypted | Enter protected session first |

## Additional Resources

*   [Trilium GitHub Repository](https://github.com/TriliumNext/Trilium)
*   [OpenAPI Specification](#root/euAWtBArCWdw)
*   [Trilium Search Documentation](https://triliumnext.github.io/Docs/Wiki/search.html)
*   [Community Forum](https://github.com/TriliumNext/Trilium/discussions)