# Deployment (Labs 7 and 8)

One always-on Mac runs the server. Both users reach it through Tailscale Serve. Each user's Mac runs ActivityWatch and the agent.

## Server

```bash
git clone <repo> && cd focus-tracker
uv sync
uv run python scripts/init_db.py        # prints the device UUIDs
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The server binds to loopback only. Do not use `--host 0.0.0.0`.

## Tailscale

1. Install Tailscale on the server and both users' Macs, and sign in to the same tailnet.
2. On the server: `tailscale serve --bg 8000`.
3. Open `https://<server-name>.<tailnet>.ts.net` from either Mac, on any network.
4. Do **not** run `tailscale funnel`. Check `tailscale serve status` and `tailscale funnel status`.
5. In the Tailscale admin console, keep the tailnet limited to the two users (share/ACLs).

HTTPS also gives the browser a secure context, which `crypto.randomUUID()` needs.

## Auto start on the server (launchd)

`~/Library/LaunchAgents/com.focustracker.server.plist` (replace the paths and `uv` location, see `which uv`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.focustracker.server</string>
  <key>WorkingDirectory</key><string>/Users/YOU/focus-tracker</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/uv</string><string>run</string><string>uvicorn</string>
    <string>app.main:app</string><string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>8000</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/focustracker.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/focustracker.err.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.focustracker.server.plist
```

## Agent on each user's Mac

```bash
uv sync --extra agent
export AGENT_DEVICE_ID=<this Mac's device UUID>
export AGENT_SERVER_URL=https://<server-name>.<tailnet>.ts.net
uv run --extra agent python -m agent.main
```

Run it as a login item with a launchd plist like the one above (`com.focustracker.agent`, same shape, with the two `AGENT_*` variables under `EnvironmentVariables`). Set ActivityWatch to start at login.
All agent settings are listed in `agent/config.py`.

After a long outage: `python -m agent.main --once --backfill-days 30`.

## Backups

```bash
uv run python scripts/backup_db.py --verify
```

Writes `data/backups/focus-YYYYmmdd-HHMMSS.db` and keeps the newest 14. Schedule it daily with launchd (`StartCalendarInterval`) or cron, and copy `data/backups/` to another disk or machine regularly.

### Restore

```bash
# stop the server first (launchctl unload ...)
rm -f data/focus.db-wal data/focus.db-shm
cp data/backups/focus-<timestamp>.db data/focus.db
# start the server
```

Then check that Focus sessions and Screen Time rows match what you expect.

## Verification checklist

- [ ] `curl https://<server>.ts.net/api/health` works from a Mac on another Wi-Fi.
- [ ] Port 8000 is not reachable from the LAN (`curl http://<lan-ip>:8000` fails).
- [ ] `tailscale funnel status` reports nothing exposed.
- [ ] ActivityWatch API (`:5600`) is not reachable from another machine.
- [ ] After a reboot: server, ActivityWatch and agent all come back, and data is still there.
- [ ] `git status` shows no `.db` files or `data/` directory.
