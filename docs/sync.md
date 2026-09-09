# Device Sync ("Sync Data")

Each device that serves this app (Shield, tablet, laptop) runs its own SHTTPS+
server against its own SQLite copy and its own `images/` tree. **Sync Data** moves
edits between them.

- **Push** — replay this device's queued edits onto another device.
- **Pull** — make this device match another device.

The webroot `data/firearms.db` is never touched — SHTTPS+ on Android serves from
its own private copy, so everything goes over the REST API (the same path the
Edit buttons use).

## How Push works

Every edit `js/db.js` makes (a row insert/update/delete on the five collection
tables, or an `images/…` file add/remove/reorder) is also appended to a local
`sync_outbox` table. Push:

1. Connects to the target, ensures its sync tables exist.
2. Writes a dated JSON snapshot of **the target** to `archive/database/firearms.<DDMMMYY>.json`.
3. Replays each unsynced outbox row in order through the target's API.
4. Records how far it got in the target's `sync_state` (so re-running Push is safe
   and only sends what's new).
5. Regenerates the target's `data/firearms.json` (the offline fallback).

If a change fails to apply, Push stops there and reports which one; fix it and
Sync again — the rest stay queued.

The three list tables (`load_data`, `range_notes`, `service_history`) use an
autoincrement integer PK that differs per device, so each row also gets a
`sync_uid`. The sync layer keys on that; the app's own edit code is unchanged.

## How Pull works

1. Warns if this device has unpushed changes (Pull would void them).
2. Snapshots **this device** to `archive/database/`.
3. Reconciles all five tables against the source: insert new, update changed,
   delete rows the source no longer has.
4. Brings gallery images for every item whose row changed or whose `images.json`
   differs from the source (loose files not in `images.json` are ignored).
5. Regenerates this device's `data/firearms.json` and reloads the app.

## config.json  (per device, in the web root)

```json
{
  "hostId": "tablet",
  "syncTargets": [
    { "name": "Shield (home)", "hostId": "shield", "base": "http://192.168.4.167:8080" }
  ],
  "archiveDir": "archive/database",
  "keepBackups": 30
}
```

- `hostId` — this device's identity. A target whose `hostId` matches is greyed
  out and labelled **"Editing Source"** (its edits are already live here). The
  Shield's own config should list the Shield as a target so its button self-disables.
- `syncTargets[].user` / `.pass` — optional; the panel prompts otherwise. Ticking
  "Remember on this device" writes them here in plain text.
- The panel can write this file back through the file API, so targets and
  credentials can be managed on a tablet with no text editor.

## One-time setup on a new device

1. Copy the app files (`scripts/deploy.ps1` does this; it seeds `config.json`
   only if the device has none, and creates `archive/database/`).
2. Edit that device's `config.json` — set `hostId` and the sync targets.
3. Load the app once. It creates `sync_outbox` / `sync_state` and adds the
   `sync_uid` columns automatically (no terminal needed). Or run
   `node scripts/migrate.js http://<device-ip>:8080 --user=NAME --pass=SECRET`.
4. In SHTTPS+ settings, enable **CORS** — cross-device API calls need it.
   ("Enable API to call custom SQL" and "…modify tables data" must already be on.)

## Restoring a snapshot

Snapshots in `archive/database/` are plain JSON row dumps — `{ _meta, items:[…],
transactions:[…], … }` — tracked in `index.json`, pruned to `keepBackups`. There
is no one-click restore yet; to roll a device back, replay a snapshot's row
arrays through `/api/db/*` (same shape `push-to-shttps.js` uses).
