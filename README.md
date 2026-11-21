# Public IP — Cinnamon Applet

A lightweight Cinnamon panel applet that displays the current public IP address and its approximate country flag. It is designed to notice VPN/interface changes and refresh the displayed address automatically.

## Features

- Fetches the public IP from [l2.io](https://l2.io/) (`https://l2.io/ip.json`).
- Looks up the IP country and ISO country code through [ipwho.is](https://ipwho.is/), then renders the corresponding flag emoji.
- Listens for NetworkManager device-added/device-removed, active-connection and device-state changes when the NetworkManager GObject introspection bindings are available.
- Periodically checks `/sys/class/net` every 30 seconds as a fallback and safety net. This also notices interfaces created by VPN clients that do not integrate with NetworkManager.
- Provides a **Refresh now** action in the applet menu.
- Uses asynchronous `curl` subprocesses so network requests do not block Cinnamon's UI thread.

## Requirements

- Linux desktop running **Cinnamon**.
- `curl` available in `PATH`.
- Network access to `l2.io` and `ipwho.is`.
- NetworkManager GI bindings are optional; the periodic interface scan remains active without them.

## Installation

1. Install curl (Debian/Ubuntu/Linux Mint):

   ```bash
   sudo apt install curl
   ```

2. Copy the applet directory into Cinnamon's per-user applet directory:

   ```bash
   mkdir -p ~/.local/share/cinnamon/applets
   cp -a public-ip-cinnamon@mindwork64 ~/.local/share/cinnamon/applets/
   ```

3. Open **System Settings → Applets**, find **Public IP**, and add it to a panel.

The applet UUID is `public-ip-cinnamon@mindwork64`.

## How it works

The IP endpoint returns JSON containing the public address. l2.io does not provide country metadata in that response, so a second request to ipwho.is obtains the country name and ISO 3166-1 alpha-2 code. The code is converted to a Unicode regional-indicator flag.

NetworkManager signals trigger a debounced refresh after connection/device changes. Independently, a 30-second scan of `/sys/class/net` compares interface names and `operstate`; this is the fallback when NetworkManager monitoring is unavailable and a safety net for VPN interfaces not managed by NetworkManager.

## Privacy

The applet sends requests to l2.io to determine the public IP and to ipwho.is to look up that IP's country. These services will receive the requester's IP address. No account or API key is configured by this applet.

IP geolocation is approximate and may identify the VPN exit country rather than the user's physical location. Country lookup failure does not prevent the IP address from being displayed.

## Troubleshooting

- Confirm `curl` works: `curl -sS https://l2.io/ip.json`.
- If the country/flag is missing, check access to `https://ipwho.is/`.
- If NetworkManager event monitoring is unavailable, the applet still checks interfaces every 30 seconds.
- Cinnamon applet errors can be inspected in `~/.xsession-errors` or Looking Glass (`Alt`+`F2`, then `lg`).

## License

MIT. See [LICENSE](LICENSE).
