# Deployment

One always-on Mac hosts the server. Each user's Mac runs ActivityWatch and the agent. All day boundaries use America/Chicago. Keep the server awake; a sleeping host cannot serve either user.

## 1. Prepare the server

Clone or copy the repository, select `reference/complete-implementation`, and run from its root. Edit `database/seed.sql` **before** initialization:

```bash
uv sync --extra agent
uv run --no-sync python scripts/init_db.py
uv run --no-sync uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The agent extra is needed only if this Mac also collects Screen Time. The examples install it on both Macs for simplicity. `--no-sync` avoids different processes repeatedly changing the shared environment's installed extras. Check http://127.0.0.1:8000/api/health and the homepage. The server must bind to loopback, not `0.0.0.0`.

## 2. Private Tailscale access

1. Install Tailscale on both Macs and join the intended tailnet.
2. Run `tailscale serve --bg 8000` on the server. If prompted, enable HTTPS/Serve in the tailnet using the URL it prints.
3. Record the resulting `https://<server-name>.<tailnet>.ts.net` origin.
4. Open that URL from the second Mac. Check `tailscale serve status` and `tailscale funnel status`; do not enable Funnel.
5. Restrict access to the intended users/devices using tailnet access rules.

Serve supplies HTTPS and resumes after restart when configured with `--bg`. See the [official Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve). Authentication remains an accepted app-level MVP limit: any permitted tailnet user can submit as either seeded user. Use the same HTTPS origin for everyday browsing because localhost has separate browser storage.

## 3. ActivityWatch on each Mac

1. Install the regular macOS release from [ActivityWatch](https://activitywatch.net/downloads/) and launch it.
2. Grant its requested Accessibility permission in System Settings > Privacy & Security > Accessibility. The bundled window watcher does not need Screen Recording or Full Disk Access; see the [official permissions FAQ](https://docs.activitywatch.net/en/latest/faq.html).
3. Open http://localhost:5600. Confirm matching `aw-watcher-window_<host>` and `aw-watcher-afk_<host>` buckets exist and the dashboard records activity/AFK changes. Keep the API local.
4. Enable ActivityWatch's start-at-login option. After upgrades, verify permissions and collection again.
5. Compare one day's agent result with the dashboard using the same Chicago date, window events filtered by not-AFK, and no browser-watcher overlay. The app reports ActivityWatch totals, not Apple's Screen Time totals.

Imported buckets can make discovery ambiguous. The agent prefers the current hostname's matching pair, otherwise requires exactly one matching pair. It never mixes window and AFK buckets from different hosts. Days before the required buckets existed are skipped. Missing intraday watcher periods cannot be reconstructed.

## 4. Run each agent

Use the appropriate device UUID printed by `init_db.py`; the two Macs must not share a UUID. Install dependencies before configuring launchd:

```bash
uv sync --extra agent
export AGENT_DEVICE_ID=15ba172f-e397-4155-8285-6757a75875f1
export AGENT_SERVER_URL=https://YOUR-SERVER.YOUR-TAILNET.ts.net
uv run --no-sync python -m agent.main --once
uv run --no-sync python -m agent.main
```

The second seeded device is `7145d42c-2b23-4dd3-aefc-7e81012db968`. URLs must be origins without a path or query. Default `AGENT_AW_URL` is `http://localhost:5600`; it uses HTTP to the local ActivityWatch API. `AGENT_TIMEZONE` must be America/Chicago. Positive settings: `AGENT_SYNC_INTERVAL=300`, `AGENT_LOOKBACK_DAYS=7`, `AGENT_HTTP_TIMEOUT=10`.

After an outage longer than the normal lookback:

```bash
uv run --no-sync python -m agent.main --once --backfill-days 30
```

Backfill only restores history ActivityWatch actually has. A failed collection uploads no value. Failed `--once` runs exit 1; successful cycles, including intentionally skipped pre-tracking dates, exit 0.

## 5. Login startup with launchd

Editable templates are in [deploy/launchd](../deploy/launchd/). Replace every `/ABS/PATH/promodoro_timer`, plus the agent's device UUID and server origin. Copy the appropriate templates to `~/Library/LaunchAgents/`: server and backup on the host, agent on each Mac. Templates invoke the existing `.venv` directly, so login does not need a shell PATH or package download.

```bash
plutil -lint ~/Library/LaunchAgents/com.focustracker.server.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.focustracker.server.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.focustracker.agent.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.focustracker.backup.plist
```

Only load jobs appropriate to that Mac. For an already loaded job, use `launchctl bootout "gui/$(id -u)/com.focustracker.server"` before bootstrapping its updated plist (substitute the agent/backup label as needed). Inspect logs at `/tmp/focustracker.*.log` and job state with `launchctl print "gui/$(id -u)/com.focustracker.server"`.

These are **login** agents, so they require user login after a restart. `KeepAlive` restarts server/agent failures; the backup runs daily at 03:00 local system time. ActivityWatch must start separately. Verify system time, sleep settings, permissions and Tailscale after reboot.

## 6. Backups and restore

```bash
uv run --no-sync python scripts/backup_db.py --verify
```

Creates a unique `data/backups/focus-<timestamp>-<random>.db` and retains the newest 14. An in-progress `.tmp` is renamed only after copying and requested verification succeed. Copy completed backups to another disk or machine regularly. Set `FOCUS_DB_PATH`, `FOCUS_BACKUP_DIR` and `FOCUS_BACKUP_KEEP` consistently in the server/backup environment when using custom paths.

To restore, stop the server and both uploading agents first. Preserve a copy of the current database/WAL/SHM files in case you need to undo the restore. Replace the stopped database with the chosen verified backup and remove its old WAL/SHM companions before restarting. For the default paths:

```bash
# All server/agent processes must be stopped before these commands.
cp data/backups/focus-YOUR-BACKUP.db data/focus.db
rm -f data/focus.db-wal data/focus.db-shm
```

Start the server, check health and historical counts, then resume agents. Agents may legitimately overwrite restored Screen totals with newer snapshots. See [testing.md](testing.md) for the acceptance checklist.
