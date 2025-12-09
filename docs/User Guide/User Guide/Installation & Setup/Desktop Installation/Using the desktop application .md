# Using the desktop application as a server
Sometimes, setting up a [dedicated server installation](../Server%20Installation.md) is not feasible. The desktop application ships with a fully functional server instance by default.

You can access this web interface locally by navigating to [http://localhost:37840/login](http://localhost:37840/login).

> [!NOTE]
> The server embedded in the desktop application will only run as long as the desktop application itself is running. So closing the application will also close the server. To overcome this, you can try hiding the application in the system tray.

## Mobile interface

By default, this will display the desktop user interface, even on mobile. To switch to the mobile version, simply go to the <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a> and select “Switch to the mobile version”.

## Allowing the port externally on Windows with Windows Defender Firewall

First, find out the IP of your desktop server by running `ipconfig` in your local terminal. Then try accessing `http://<ip>:37840/login` on another device. If it doesn't work, then most likely the port is blocked by your operating system's firewall.

If you use Windows Defender Firewall:

1.  Go to Windows's start menu and look for “Windows Defender Firewall with Advanced Security”.
2.  Go to “Inbound Rules” on the left tree, and select “New Rule” in the “Actions” sidebar on the right.
3.  Select “Port” and press “Next”.
4.  Type in `37840` in the “Specific local ports” section and then press “Next”.
5.  Leave “Allow the connection” checked and press “Next”.
6.  Configure the networks to apply to (check all if unsure) and then press “Next”.
7.  Add an appropriate name to the rule (e.g. “Trilium Notes”) and press “Finish”.