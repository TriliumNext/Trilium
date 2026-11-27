# Notification channels
A notification channel forwards important notifications outside Trilium, for example to a push service that shows them on your phone.

## Setting up a webhook

A webhook sends each notification to a web address. Many push services accept them, for example ntfy and Pushover.

1.  Go to <a class="reference-link" href="../UI%20Elements/Options.md">Options</a> → _Notifications_ and find the _Channels_ card. If you use a sync server, open Trilium on the server in a browser and set up the webhook there: only the server keeps the address of a webhook.
2.  Press <span class="tn-icon bx bx-plus"></span> _Add webhook..._ and enter a _Title_.
3.  Under _Body template_, press _ntfy_, _Pushover_ or _Generic JSON_ to start from a template, or leave it empty to send the notification as JSON. See _Writing a body template_ below.
4.  Under _Address_, enter the _URL_ of the service. Put access tokens and other credentials in _Headers_ or _Secret values_, never in the template: the template syncs to all your devices, while the address and its credentials stay where you enter them.
5.  Press _Save_ and enter your password, plus a code of your second factor if you use one.
6.  Turn on the switch of the new webhook. In the dialog, check the _Grace time_ and _Protected notes_ settings, and press _Enable_.
7.  Press <span class="tn-icon bx bx-paper-plane"></span> _Send test notification_ and check that the test arrives.

## What gets forwarded

*   Channels forward only high-priority notifications, such as Trilium's security notices.
*   A channel waits for its grace time first, 5 minutes by default. If you see or read the notification in Trilium during that time, it isn't forwarded. Set the grace time to zero to skip the wait, even for notifications you've already seen.
*   _Protected notes_ decides what a channel receives of a notification about a protected note: _Send nothing_ (the default) or _Send the public text_. The protected text and the note itself are never sent.
*   If sending fails, Trilium tries again later, and the channel shows the last error.

## Managing channels

The _Channels_ card shows each channel with its state and how many notifications it sent, skipped or failed to send.

*   To check that a webhook or a backend script channel works, press <span class="tn-icon bx bx-paper-plane"></span> _Send test notification_.
*   To change the settings of a channel, or the template and the address of a webhook, press <span class="tn-icon bx bx-edit"></span> _Edit_. When you replace the URL of a webhook, enter the credentials for the new address, such as its headers and secret values, and send a test.
*   To stop a channel, turn off its switch.
*   To delete a webhook, press <span class="tn-icon bx bx-trash"></span> _Delete_. To remove a script channel, delete its note or its `#notificationChannel` label.

If a channel stops forwarding on its own, for example because its script changed, Trilium raises a notification about it.

## After a restore or a move

After the database is restored from a backup, moved, or rolled back, Trilium pauses forwarding, so that it doesn't send old notifications again. Regular forwarding waits for your choice in the last step below, but test sends still work. To resume:

1.  Check your webhooks. A restore removes their addresses, and a move can leave them behind. If a webhook shows _No address is set._, press <span class="tn-icon bx bx-edit"></span> _Edit_ and enter its URL and credentials again.
2.  If a channel shows _Enable again..._, press it, review the channel and enable it again. Until then, the channel forwards nothing, even if a test succeeds. Press _Disable_ instead if you no longer need it.
3.  Press <span class="tn-icon bx bx-paper-plane"></span> _Send test notification_ to check each webhook.
4.  In the _Channels_ card, press _Send what is due_ to forward the notifications that waited, or _Skip what is due_ to drop them.

## Using a script as a channel

A script channel is a JavaScript note that forwards notifications in its own way.

*   To create one, create a <a class="reference-link" href="../../Note%20Types/Code.md">Code</a> note of the type _JavaScript (Trilium backend)_ or _JavaScript (Trilium frontend)_, and add the `#notificationChannel` [label](../../Advanced%20Usage/Attributes/Labels.md) to it. It appears in the _Channels_ card as _Found, not enabled_.
*   To enable it, turn on its switch. The dialog shows everything the channel will run, so you can check it before you press _Enable_.
*   If the script or the labels of its note change later, the channel stops and shows _Changed since it was enabled_. Press _Review..._ to see what changed and enable it again.
*   A backend script runs only where backend scripts are enabled (see <a class="reference-link" href="../../Scripting/Security.md">Security</a>). A frontend script forwards only while a Trilium window is open.

To write the script, see <a class="reference-link" href="../../Scripting/Notifications%20in%20scripts.md">Notifications in scripts</a>.

## Writing a body template

The body template is the JSON that the webhook sends. Placeholders in its text values are replaced by the fields of the notification:

| Placeholder | Replaced by |
| --- | --- |
| `{{title}}` | The title. |
| `{{description}}` | The description. |
| `{{category}}` | The category: `general`, `reminder` or `softwareUpdate`. |
| `{{attentionLevel}}` | The priority, `high`. |
| `{{raisedAt}}` | The time of the notification, in UTC. |
| `{{noteId}}` | The ID of the note the notification is about. |
| `{{key}}` | An ID that stays the same when a send is tried again, so the receiver can skip repeats. |
| `{{secret.name}}` | The secret value called `name`, such as `{{secret.token}}`. |

A placeholder works only inside a quoted text value, not in a key or in a number.

This template sends to ntfy. The topic is a secret value called `topic`, and the URL is `https://ntfy.sh/`, or the address of your own ntfy server:

```json
{
    "topic": "{{secret.topic}}",
    "title": "{{title}}",
    "message": "{{description}}",
    "priority": 4
}
```

## Sending to your local network

By default, a webhook only sends to public addresses, over HTTPS. To send to a service on your own network, such as an ntfy server on a NAS, turn on _Private networks_ under _Local network_. _This machine (loopback)_ allows a service on the same computer as Trilium. Plain HTTP works only for these local addresses.