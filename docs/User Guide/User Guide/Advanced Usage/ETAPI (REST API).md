# ETAPI (REST API)
> [!TIP]
> For a quick start, consult the <a class="reference-link" href="ETAPI%20(REST%20API)/API%20Reference.dat">API Reference</a>.

ETAPI is Trilium's public/external REST API. It is available since Trilium v0.50.

## API clients

As an alternative to calling the API directly, there are client libraries to simplify this

*   [trilium-py](https://github.com/Nriver/trilium-py), you can use Python to communicate with Trilium.

## Obtaining a token

All operations with the REST API have to be authenticated using a token. You can get this token either from Options -> ETAPI or programmatically using the `/auth/login` REST call (see the [spec](https://github.com/TriliumNext/Trilium/blob/master/src/etapi/etapi.openapi.yaml)).

## Authentication

### Via the `Authorization` header

```
GET https://myserver.com/etapi/app-info
Authorization: ETAPITOKEN
```

where `ETAPITOKEN` is the token obtained in the previous step.

For compatibility with various tools, it's also possible to specify the value of the `Authorization` header in the format `Bearer ETAPITOKEN` (since 0.93.0).

### Basic authentication

Since v0.56 you can also use basic auth format:

```
GET https://myserver.com/etapi/app-info
Authorization: Basic BATOKEN
```

*   Where `BATOKEN = BASE64(username + ':' + password)` - this is a standard Basic Auth serialization
*   Where `username` is "etapi"
*   And `password` is the generated ETAPI token described above.

Basic Auth is meant to be used with tools which support only basic auth.

## Interaction using Bash scripts

It is possible to write simple Bash scripts to interact with Trilium. As an example, here's how to obtain the HTML content of a note:

```
#!/usr/bin/env bash

# Configuration
TOKEN=z1vA4fkGxjOR_ZXLrZeqHEFOv65yV3882iFCRtNIK9k9iWrHliITNSLQ=
SERVER=http://localhost:8080

# Download a note by ID
NOTE_ID="i6ra4ZshJhgN"
curl "$SERVER/etapi/notes/$NOTE_ID/content" -H "Authorization: $TOKEN" 
```

Make sure to replace the values of:

*   `TOKEN` with your ETAPI token.
*   `SERVER` with the correct protocol, host name and port to your Trilium instance.
*   `NOTE_ID` with an existing note ID to download.

As another example, to obtain a .zip export of a note and place it in a directory called `out`, simply replace the last statement in the script with:

```
curl -H "Authorization: $TOKEN" \
	-X GET "$SERVER/etapi/notes/$NOTE_ID/export" \
    --output "out/$NOTE_ID.zip"
```

## Uploading binary content

A JSON request body can only carry text, so the `content` field of `POST /etapi/attachments` stores exactly the string it receives. To upload an image, a PDF or any other binary file, send the raw bytes to the content endpoint with the `application/octet-stream` content type. The same applies to the content of a note (`PUT /etapi/notes/{noteId}/content`).

To attach a file to a note, create the attachment without content, then upload the file to it:

```
ATTACHMENT_ID=$(curl -s -X POST "$SERVER/etapi/attachments" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"ownerId\": \"$NOTE_ID\", \"role\": \"file\", \"mime\": \"application/pdf\", \"title\": \"report.pdf\", \"position\": 10}" \
    | jq -r .attachmentId)

curl -X PUT "$SERVER/etapi/attachments/$ATTACHMENT_ID/content" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary @report.pdf
```

Use `--data-binary` rather than `-d`, which strips line breaks from the file. For an image, set `role` to `image` and `mime` to the image's type, such as `image/png`.