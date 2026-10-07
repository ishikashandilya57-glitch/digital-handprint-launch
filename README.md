# Digital Handprint Launch

A synchronized four-device inauguration experience built with Express, Socket.IO, and vanilla HTML/CSS/JavaScript.

## Start the app

Requirements: Node.js 18 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000` on the server computer. The server listens on all network interfaces by default.

## Connect all four devices

1. Connect the computer, three tablets, and projector/display device to the same Wi-Fi network.
2. Find the computer's local IP address:
   - macOS: **System Settings → Wi-Fi → Details**, or run `ipconfig getifaddr en0`
   - Windows: run `ipconfig` and find the Wi-Fi adapter's IPv4 address
3. On every device, open `http://YOUR_LOCAL_IP:3000` (for example, `http://192.168.1.25:3000`).
4. Choose Guest 1, Guest 2, Guest 3, Guest 4, or Main Display. The role is retained for refreshes in that browser tab.
5. Ensure the host computer's firewall permits incoming connections to Node.js/port 3000.

For devices on different networks, expose port 3000 through a trusted tunnel such as ngrok:

```bash
ngrok http 3000
```

Open the HTTPS forwarding URL ngrok provides on all four devices. For a public deployment, use a host that supports a continuously running Node.js process and WebSockets.

## Ceremony operation

- Each guest touches the scanner. Feedback appears immediately and verification completes in under a second.
- When all four handprints are verified, the server sends one timestamped countdown timeline to every screen.
- On the Main Display, press **Ctrl+Shift+R** to reset all devices for rehearsal.
- Alternatively, visit `http://SERVER:3000/reset` or send `POST /reset`.

The reset route is intentionally simple for a controlled ceremony network. Protect or remove it before exposing this app broadly on the public internet.

## Verification

Run:

```bash
npm test
```

The automated tests cover early release and retry, simultaneous guest readiness with identical countdown/reveal timestamps on all four clients, and guest disconnect status without loss of ready state.

Before the live event, do one full rehearsal on the actual Wi-Fi and hardware. Disable tablet sleep/auto-lock, keep all devices powered, use landscape orientation for the projector, and avoid switching browser tabs during the countdown.
