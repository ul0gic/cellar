# Install and run Cellar

Cellar runs as one Docker container with one data folder on your own computer or home server. This guide covers installing it, putting it behind HTTPS, upgrading and rolling back, backups, and every setting, command and exit code.

## What you need

- Docker Engine 24 or later with Compose v2, on linux/amd64 or linux/arm64. Docker Desktop on macOS and Windows works.
- 1 GB of free disk.

## Install

```sh
mkdir -p ~/cellar/data && cd ~/cellar
curl -fsSLO https://github.com/ul0gic/cellar/releases/latest/download/compose.yaml
docker compose up -d
```

Then open `http://<this computer's address>:7380` in a browser and create the owner. The setup screen loads the recipe catalog in under a minute.

Create `data` yourself, as the first command does. If Docker creates it, the folder is owned by root and Cellar can't write to it.

To check that it started:

```sh
docker logs cellar
```

The last lines read:

```
{"time":"…","level":"info","msg":"Cellar 1.0.0 is ready on port 7380 at /"}
{"time":"…","level":"info","msg":"Cellar isn't set up yet. Open it in a browser on port 7380 to create the owner."}
```

To use a different port on the host, change the left side of the `ports` line in `compose.yaml`, for example `"8081:7380"`, and run `docker compose up -d` again.

### If your user isn't UID 1000

Cellar runs as UID 1000 inside the container. `id -u` prints your user id. If it isn't 1000, uncomment the `user:` line in `compose.yaml` and put your ids there:

```yaml
user: "1001:1001" # the output of: id -u, then id -g
```

If `docker logs cellar` shows "Cellar can't write to /data", this is the fix.

## Sign-in and the profile picker

The owner chooses **Require login** at setup and can change it later in Settings.

- On: everyone signs in with their name and password.
- Off: the app opens on a "Who's here?" picker and nobody needs a password.

With login off, anyone who can reach Cellar's address can pick a name and see and change everything. Leave it on if Cellar is reachable from outside your home network. Turning it on or off asks for the owner's password.

## HTTPS and a sub-path

Cellar serves plain HTTP. To serve it over HTTPS, put a reverse proxy in front of it and set these in `compose.yaml`:

```yaml
environment:
  CELLAR_TRUSTED_PROXIES: private
  CELLAR_BASE_PATH: /cellar # only when serving at a sub-path
```

- `CELLAR_TRUSTED_PROXIES` tells Cellar which addresses may set `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`. With it set, Cellar sees HTTPS and marks its sign-in cookie `Secure`. Use `private` or the proxy's address.
- `CELLAR_BASE_PATH` is needed only when Cellar is served at a path such as `https://home.example.com/cellar`. The proxy keeps the path prefix; it does not strip it.
- The proxy passes `Host` (or `X-Forwarded-Host`) through.

Without `CELLAR_TRUSTED_PROXIES`, everything still works, but the cookie has no `Secure` flag and Cellar sees the proxy's address as every client's.

Give Cellar its own host name (`bar.example.com`) when you can; it needs no `CELLAR_BASE_PATH` and no path rules.

### Nginx Proxy Manager

1. In `compose.yaml`, uncomment `environment:` and `CELLAR_TRUSTED_PROXIES: private`, then `docker compose up -d`.
2. In Nginx Proxy Manager, open Hosts, Proxy Hosts, Add Proxy Host:
   - Domain Names: `bar.example.com`
   - Scheme: `http`
   - Forward Hostname / IP: the server's LAN address, or `cellar` if Nginx Proxy Manager and Cellar share a Docker network (below)
   - Forward Port: `7380`
   - Block Common Exploits: on
3. On the SSL tab, request a new certificate, and turn on Force SSL and HTTP/2 Support. Save.

Nginx Proxy Manager passes `Host` and the forwarded headers, and its upload limit already allows a restore. No custom configuration is needed.

To reach Cellar as `cellar` instead of by address, put both on the same Docker network. Find Nginx Proxy Manager's network with `docker network ls`, then add to `compose.yaml`:

```yaml
services:
  cellar:
    networks: [ proxy ]
networks:
  proxy:
    external: true
    name: npm_default # the network Nginx Proxy Manager is on
```

With a shared network you can also remove the `ports:` lines so Cellar is reachable only through the proxy.

### Caddy

Caddy, at its own host name:

```
bar.example.com {
  reverse_proxy cellar:7380
}
```

Caddy at a sub-path, with `CELLAR_BASE_PATH=/cellar`:

```
home.example.com {
  handle /cellar* {
    reverse_proxy cellar:7380
  }
}
```

### nginx and Traefik

nginx, with `CELLAR_BASE_PATH=/cellar`:

```nginx
location /cellar/ {
  proxy_pass http://cellar:7380;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 2g;
}
```

Traefik, with labels on the `cellar` service and `CELLAR_BASE_PATH=/cellar`:

```yaml
labels:
  traefik.enable: "true"
  traefik.http.routers.cellar.rule: Host(`home.example.com`) && PathPrefix(`/cellar`)
  traefik.http.routers.cellar.entrypoints: websecure
  traefik.http.routers.cellar.tls: "true"
  traefik.http.services.cellar.loadbalancer.server.port: "7380"
```

`cellar:7380` works when the proxy runs in the same Compose network as Cellar. Otherwise use the host's address and published port. `client_max_body_size 2g` lets a restore upload through nginx; a backup can be up to 2 GB.

If saving anything fails with "This request came from another site and was blocked", the proxy is changing the host name. Pass `Host` as shown, or add the proxy to `CELLAR_TRUSTED_PROXIES`.

## Menu on the TV

1. In Cellar, open a menu and choose **Make it live**.
2. Open the link it shows on the TV's browser, Fire TV Silk, a laptop on HDMI, or a phone. A phone or tablet can scan the menu's QR code instead.
3. To show it from an iPhone, iPad or Mac on an Apple TV, open the link there and AirPlay the screen.

Typing the link with a TV remote is slow. Open it once and bookmark it, or AirPlay it from a phone.

Over plain HTTP, browsers don't let a page keep the screen awake (the Screen Wake Lock API needs HTTPS). On plain HTTP:

- The TV may dim or sleep during the evening. Set the TV's screensaver or sleep timer for the event, or serve Cellar over HTTPS.
- The recipe screen can't keep a phone or tablet awake while you mix.
- Copy buttons (the menu link, an API token, a one-time password) can't write to the clipboard. Cellar shows the text selected in a field instead; copy it by hand.

After the event, choose **End menu** to turn the link off. The TV then says the menu isn't live. **Make a new link** replaces the link; the old one stops working.

## Upgrade

```sh
cd ~/cellar
docker compose pull && docker compose up -d
```

`compose.yaml` follows the major version (`ghcr.io/ul0gic/cellar:1`), so `pull` fetches the newest 1.x release.

When a release changes the database schema, Cellar copies the database to `data/cellar.pre-migration.db` before it migrates. The log shows:

```
{"level":"info","msg":"Upgrading the database from schema 1 to 2. Copy saved as /data/cellar.pre-migration.db.",…}
{"level":"info","msg":"Database upgraded in 0.8 s.",…}
```

The copy stays until the next upgrade that migrates, which replaces it.

### If the migration fails

The container exits with code 12 and the database is put back as it was. Docker restarts it and it fails the same way each time, with the same log line. Pin the previous version and start it:

1. In `compose.yaml`, change `image: ghcr.io/ul0gic/cellar:1` to the version you ran before, for example `image: ghcr.io/ul0gic/cellar:1.0.0`.
2. Run `docker compose up -d`.
3. Report the failure with the log line.

### Roll back after a successful upgrade

An older Cellar refuses a database a newer one has migrated (exit code 11). To go back, you return to the copy taken before the upgrade. **Everything changed in Cellar since the upgrade is lost.**

1. Stop Cellar:

   ```sh
   cd ~/cellar
   docker compose down
   ```
2. Move the upgraded database aside and put the copy back:

   ```sh
   mv data/cellar.db data/cellar.db.after-upgrade
   rm -f data/cellar.db-wal data/cellar.db-shm
   mv data/cellar.pre-migration.db data/cellar.db
   ```
3. In `compose.yaml`, set `image:` to the previous version, for example `ghcr.io/ul0gic/cellar:1.0.0`.
4. Start it:

   ```sh
   docker compose up -d
   ```
5. `docker logs cellar` shows `Cellar 1.0.0 is ready`. Once you are happy, delete `data/cellar.db.after-upgrade`.

To undo the rollback, stop Cellar, move `data/cellar.db.after-upgrade` back to `data/cellar.db`, and set `image:` back to the newer version.

## Back up

As the owner, in Settings > Backup, or from the host:

```sh
docker exec cellar cellar backup
```

```
Backing up 702 recipes, 340 ingredients, 112 bottles, 96 notes and ratings, 4 people, 1,001 images...
Saved /data/backups/cellar-backup-20261108-213000.zip (63.4 MB) in 4 s.
```

On the host the file is `~/cellar/data/backups/cellar-backup-20261108-213000.zip`. The backup works while Cellar runs. With Cellar stopped, use `docker compose run --rm cellar backup` from `~/cellar`.

A nightly backup at 03:15 keeping two weeks, as a line in your host crontab (`crontab -e`):

```
15 3 * * * docker exec cellar cellar backup --keep 14 >/dev/null
```

`--keep 14` deletes the oldest `cellar-backup-*.zip` files in `data/backups/` beyond the newest 14. Without `--keep`, nothing is deleted.

Copy `data/backups/` somewhere off the machine. A backup on the same disk doesn't survive that disk.

## Restore

Restoring replaces everything in Cellar with the backup. Everyone signs in again afterwards, and the owner re-enters the AI key if one was set. A backup from a newer Cellar can't be restored into an older one.

From the browser: as the owner, in Settings > Backup.

From the host, with Cellar stopped:

1. Put the backup inside the data folder, for example in `~/cellar/data/backups/`.
2. Stop Cellar and run the restore in a one-off container:

   ```sh
   cd ~/cellar
   docker compose stop cellar
   docker compose run --rm cellar restore backups/cellar-backup-20261108-213000.zip
   ```

   ```
   Backup from Cellar 1.0.0 (schema 1), made 8 November 2026 21:30 UTC:
     663 recipes, 1,296 ingredients, 5,000 bottles, 20,000 notes and ratings, 8 people, 2,010 images.
   This replaces everything now in /data:
     702 recipes, 340 ingredients, 112 bottles, 96 notes and ratings, 4 people, 1,001 images.
   Type replace everything to continue: replace everything
   Restoring... done in 18 s.
   Restored. Start Cellar with: docker compose start cellar
   Everyone signs in again, and the owner re-enters the AI key if one was set.
   ```

   Typing anything other than `replace everything` changes nothing. In a script, add `--yes` to skip the prompt.
3. Start Cellar:

   ```sh
   docker compose start cellar
   ```

The file path is inside the data folder: relative to it (`backups/…`) or absolute (`/data/backups/…`). The command refuses while Cellar is running on the same data folder.

If a restore stops part way (power loss, a killed container), the next start finishes or undoes it and logs `A restore was interrupted. The data from before it was put back.` or `A restore was interrupted after its database step. It was finished.`

## Forgot the owner password

```sh
docker exec cellar cellar reset-owner-password
```

```
Owner: Dana
One-time password: k7mqx3ptr9hvd2wc
Sign in with it; Cellar will ask for a new password.
```

It works while Cellar runs and signs the owner out everywhere. The owner resets other members' passwords in Settings.

## Settings

All settings are optional environment variables, set under `environment:` in `compose.yaml`. Cellar reads them once at start; run `docker compose up -d` after a change. An invalid value stops the start with exit code 2 and a message naming the variable.

| Variable                 | Default                                                                         | What it does                                                                                          | Valid values                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `CELLAR_BASE_PATH`       | `/`                                                                             | Path prefix Cellar is served under, for a reverse proxy at a sub-path                                 | Starts with `/`; letters, digits, `-`, `_`, `.`, `/`. A trailing `/` is dropped                                                            |
| `CELLAR_TRUSTED_PROXIES` | empty (trust none)                                                              | Addresses whose `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` headers Cellar believes | Comma list of IPv4 or IPv6 addresses and CIDR ranges, or `private` (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7, 127.0.0.0/8, ::1) |
| `CELLAR_PORT`            | `7380`                                                                          | Port inside the container. Change it only with host networking; otherwise change `ports`              | 1 to 65535                                                                                                                                 |
| `CELLAR_LOG_LEVEL`       | `info`                                                                          | Log detail                                                                                            | `error`, `warn`, `info`, `debug`                                                                                                           |
| `CELLAR_CATALOG_URL`     | `https://github.com/ul0gic/cellar/releases/download/catalog/catalog-index.json` | Where "check for catalog updates" looks                                                               | An `https://` address                                                                                                                      |

The messages for an invalid value:

```
CELLAR_BASE_PATH must start with / and contain only letters, digits, - _ . and /. Got: cellar
CELLAR_TRUSTED_PROXIES has an entry that isn't an address or range: 172.16.0.0/33
CELLAR_PORT must be a number from 1 to 65535. Got: http
CELLAR_LOG_LEVEL must be one of error, warn, info, debug. Got: verbose
CELLAR_CATALOG_URL must be an https:// address. Got: http://example.com/index.json
```

Four more variables exist for development only; see [Development only](#development-only).

## What Cellar connects to

Nothing, unless someone in the household asks it to:

- The owner checks for catalog updates, or turns on the scheduled check: `CELLAR_CATALOG_URL`.
- The owner saves an AI key and someone uses an AI action: the AI provider's API.
- Someone imports a recipe from a web address: that address.

Cellar refuses to contact addresses on your own network (private, loopback and link-local addresses) for any of these.

## Data folder

Everything Cellar keeps is in `~/cellar/data`, mounted at `/data` in the container. Cellar creates what it needs inside it on first start.

```
data/
├── cellar.db                  the database, with SQLite's cellar.db-wal and cellar.db-shm beside it
├── cellar.pre-migration.db    the copy from the last upgrade that migrated
├── media/u/                   images people uploaded
├── catalog/                   catalog images
├── backups/                   written by the backup command; pruned only with --keep
├── tmp/                       staging for uploads, imports, downloads and restores; entries older than 1 hour are removed at start
└── run/server.json            written every 10 s while Cellar runs, removed on a clean stop
```

Don't copy `cellar.db` while Cellar is running; take a backup instead.

## Logs

```sh
docker logs cellar
```

One JSON object per line: startup steps, one line per request, and errors. Passwords, tokens, keys, cookies and request bodies are never written. A menu link appears as `/m/[token]`.

To see more detail, set `CELLAR_LOG_LEVEL: debug`.

## Commands

Run inside the container with `docker exec cellar cellar <command>`, or with Cellar stopped, `docker compose run --rm cellar <command>` from `~/cellar`. `cellar help <command>` prints a command's arguments and exit codes.

```
cellar serve                                  Start the server (the image runs this by default).
cellar healthcheck                            Check that the running server answers (used by the image health check).
cellar reset-owner-password                   Give the owner a one-time password and end the owner's sessions.
cellar backup [--output <path>] [--keep <n>]  Write a backup zip, whether or not the server is running.
cellar restore <file> [--yes]                 Replace everything in /data with a backup (stop the server first).
cellar version                                Print the Cellar and Node versions.
cellar help [<command>]                       List the commands, or explain one.
```

`cellar version` prints, for example, `Cellar 1.0.0 (node 26.13.0)`.

`backup --output <path>` writes the zip to a path inside `/data` instead of `data/backups/`; `--keep <n>` takes 1 to 1000.

## Exit codes

Every command exits 2 for an unknown command or option, or wrong arguments: `Unknown command 'restor'. Run 'cellar help' for the list.`

### `cellar serve`

`docker ps -a` shows the code as `Exited (n)`; `docker logs cellar` shows the message.

| Code | Meaning                                                 | Fix                                                                                   |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 0    | Stopped by a signal, cleanly                            |                                                                                       |
| 1    | Unexpected failure                                      | The log has the cause; report it with the log                                         |
| 2    | Invalid setting                                         | Correct the variable the message names                                                |
| 10   | Data folder missing or not writable                     | See [If your user isn't UID 1000](#if-your-user-isnt-uid-1000) and the messages below |
| 11   | The database is from a newer Cellar                     | Use the newer image, or [roll back](#roll-back-after-a-successful-upgrade)            |
| 12   | Migration failed; the database was put back as it was   | [Pin the previous version](#if-the-migration-fails)                                   |
| 13   | Migration failed and the copy couldn't be put back      | Rename the copy by hand, then start the previous version (below)                      |
| 14   | Port in use or can't listen                             | Free the port inside the container, or set `CELLAR_PORT`                              |
| 15   | The database file isn't a SQLite database or is damaged | [Restore](#restore) a backup, or move the file away to start fresh                    |

### `cellar healthcheck`

| Code | Meaning                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| 0    | The server answered 200 at `/healthcheck` within 4 s                                          |
| 1    | It didn't, or a setting is invalid; stderr says why: `Cellar isn't answering on port 7380: …` |

### `cellar reset-owner-password`

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| 0    | Done                                                                    |
| 1    | Couldn't reset the password                                             |
| 2    | Invalid setting                                                         |
| 11   | The database is from a newer Cellar                                     |
| 15   | `/data/cellar.db` doesn't exist, isn't a Cellar database, or is damaged |
| 30   | Cellar isn't set up yet, so there's no owner                            |

### `cellar backup`

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| 0    | Done                                                                    |
| 1    | Backup failed; no file was written                                      |
| 2    | `--keep` isn't a number from 1 to 1000, or a setting is invalid         |
| 11   | The database is from a newer Cellar                                     |
| 15   | `/data/cellar.db` doesn't exist, isn't a Cellar database, or is damaged |
| 40   | `--output` isn't a path inside `/data`                                  |
| 41   | Not enough free disk space                                              |

### `cellar restore`

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| 0    | Restored, or the prompt was declined                                 |
| 1    | Restore failed                                                       |
| 2    | Wrong arguments, no terminal and no `--yes`, or a setting is invalid |
| 11   | The current database is from a newer Cellar                          |
| 15   | The current `/data/cellar.db` isn't a SQLite database or is damaged  |
| 20   | The file isn't a usable Cellar backup; nothing was changed           |
| 21   | The backup is from a newer Cellar                                    |
| 22   | Cellar is running on this data folder                                |
| 23   | The restore failed and the previous data was put back                |
| 24   | No such file inside `/data`                                          |
| 41   | Not enough free disk space                                           |

### `cellar version` and `cellar help`

`version` always exits 0. `help` exits 0, or 2 for an unknown command.

## Troubleshooting

Each message below is what `docker logs cellar` or the command prints, with its fix.

**`/data isn't a mounted folder. Your data will be lost when this container is removed. Mount a folder at /data (see compose.yaml).`**
A warning; Cellar still starts. Add the `volumes:` line from `compose.yaml` (`- ./data:/data`) and run `docker compose up -d`.

**`Cellar can't write to /data (it doesn't exist). Create the data folder yourself before starting, or mount a folder there (see compose.yaml).`** (exit 10)
Run `mkdir -p ~/cellar/data` and check the `volumes:` line.

**`Cellar can't write to /data (it is owned by UID 0 and Cellar runs as UID 1000). Create the data folder yourself before starting, or set user: in compose.yaml to the folder owner's id. See "If your user isn't UID 1000" in the install guide.`** (exit 10)
Docker created `data` as root, or your user isn't UID 1000. Either recreate the folder as yourself (`docker compose down`, `sudo chown "$(id -u):$(id -g)" ~/cellar/data`) or follow [If your user isn't UID 1000](#if-your-user-isnt-uid-1000).

**`Cellar can't prepare its data folder: …`** (exit 10)
Something inside `data/` can't be created or written. Check the host disk and the folder's owner.

**`/data/cellar.db isn't a SQLite database or is damaged. Restore a backup (cellar restore) or move the file away to start fresh.`** (exit 15)
[Restore](#restore) from the host with `docker compose run --rm cellar restore …`, or move `data/cellar.db` aside to start with an empty Cellar.

**`Cellar can't read /data/tmp/restore-in-progress.json (…). Restore from a backup with "cellar restore".`** (exit 15)
An interrupted restore left a damaged marker. Restore from a backup with the command.

**`This database is from a newer Cellar (schema 3). This is Cellar 1.1.0 (schema 2). Start a newer Cellar, or roll back as the install guide describes.`** (exit 11)
Set `image:` back to the newer version, or [roll back](#roll-back-after-a-successful-upgrade).

**`The database upgrade from schema 1 to 2 failed: …. The database was put back as it was. Start the previous Cellar version and report this with the log.`** (exit 12)
[Pin the previous version](#if-the-migration-fails).

**`The database upgrade failed and the copy couldn't be put back: …. Your data is in /data/cellar.pre-migration.db. Rename it to cellar.db and start the previous Cellar version.`** (exit 13)
With Cellar stopped (`docker compose down`): `mv data/cellar.db data/cellar.db.failed`, `rm -f data/cellar.db-wal data/cellar.db-shm`, `mv data/cellar.pre-migration.db data/cellar.db`, set `image:` to the previous version, `docker compose up -d`.

**`Port 7380 is already in use inside the container. Set CELLAR_PORT or free the port.`** (exit 14)
With the default `compose.yaml` nothing else runs in the container, so this happens with host networking (`network_mode: host`). Set `CELLAR_PORT` to a free port.

**`The disk is full; writes are failing.`**
Free space on the host disk. Cellar keeps running and answers saves with an error until there is room.

**`The database stayed locked for 5 s.`**
A request waited too long for the database, usually during a long backup or restore on slow storage. Try again.

**`Scheduled catalog check failed.`**
The monthly catalog check couldn't reach `CELLAR_CATALOG_URL`. It tries again on its next run.

**`Not enough free disk space to restore: needs …, … free.`** or **`Not enough free disk space for the backup snapshot.`**
Free space on the host disk, then try again.

**`A restore was interrupted. The data from before it was put back.`**
Run the restore again.

**`This request came from another site and was blocked.`** (in the browser)
See [HTTPS and a sub-path](#https-and-a-sub-path).

**`Request failed`**
An unexpected error in one request. Report it with the log line; its `reqId` matches the `requestId` the browser received.

## Uninstall

```sh
cd ~/cellar
docker compose down
```

Then delete `~/cellar`. The `data` folder holds everything; back it up first if you want to keep it.

## Development only

These variables exist so Cellar can run outside its container during development. `compose.yaml` doesn't set them, and none belongs on a real install.

| Variable                     | Default                           | What it does                                                                                                                                                                     |
| ---------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CELLAR_DATA_DIR`            | `/data`                           | The data folder. The folder must already exist; `pnpm dev` uses `.rig/dev-data`                                                                                                  |
| `CELLAR_SHIPPED_CATALOG_DIR` | `/app/catalog` (set in the image) | The folder holding the catalog release the image ships. It must hold exactly one `cellar-catalog-*` folder; `node catalog/bin/cellar-catalog.ts build --out <folder>` writes one |
| `CELLAR_OUTBOUND_ALLOW`      | empty                             | Comma list of host names Cellar may contact even when they resolve to a private address                                                                                          |
| `CELLAR_AI_BASE_URL`         | the AI provider's own address     | Replaces the address AI requests go to; must be `https://`                                                                                                                       |

**Never set `CELLAR_OUTBOUND_ALLOW` or `CELLAR_AI_BASE_URL` on a real install.** `CELLAR_OUTBOUND_ALLOW` reopens your home network to URL import: a recipe link can make Cellar fetch from machines on your LAN. `CELLAR_AI_BASE_URL` sends the owner's AI key and every AI request to whatever address it names. Cellar logs a warning at start when either is set:

```
CELLAR_OUTBOUND_ALLOW is set (development only): Cellar will contact private addresses for recipes.rig.test.
CELLAR_AI_BASE_URL is set (development only): AI requests go to https://ai.rig.test.
```
