# CycleTLS loopback bridge

This executable is a minimal launcher for the CycleTLS WebSocket endpoint used
by the npm `cycletls` client. It accepts the decimal TCP port in `WS_PORT` and
listens with `tcp4` on `127.0.0.1` only. Requests must be origin-free WebSocket
GET upgrades to `/` from a loopback peer.

After acquiring the listener, the bridge writes exactly `READY:<port>` to
stdout. The owning IPC runtime consumes that line to prove process ownership
and discards all later stdout without forwarding it.

The bridge pins `github.com/Danny-Dasilva/CycleTLS/cycletls` v1.0.30. CycleTLS
is licensed under GPL-3.0; downstream distribution must comply with that
license. This directory contains the launcher source only. Go caches and source
trees are not application resources.

From the repository root, build the host-platform executable with:

```text
node scripts/build-cycletls-bridge.mjs
```

On Windows this produces `build/cycletls-bridge/index.exe`. The build script
uses `go build -trimpath`, `shell: false`, and a hidden child window. The app
should package only the resulting executable and the applicable license/source
materials, not the Go module cache.
