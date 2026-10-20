# React HMI template (TwinCAT ADS or Modbus TCP)

React + TypeScript screens in the browser, a small Node server that talks to the PLC.
Set `DRIVER` in `.env`: `ads` for Beckhoff TwinCAT, `modbus` for Modbus TCP PLCs (AutomationDirect CLICK,
Productivity and others). The screens are the same either way.

## Layout

```
plc/        PLC data types and the variable list the HMI uses (the tag list lives here)
server/     Node server: PLC <-> WebSocket bridge, logins
  src/drivers/    ads.ts (Beckhoff), modbus.ts (Modbus TCP), driver.ts (the interface both implement)
  modbus-tags.json  Modbus tag map (DRIVER=modbus only)
  .env        Per-machine settings (copy from .env.example)
  data/       users.json, created on first run (not in git, kept across deploys)
web/        React screens
  src/App.tsx          The screens (edit per project)
  src/components.tsx   SetpointEntry, AnalogReadout, Readout, CommandButton
  src/connection.tsx   Server connection: values, writes, login session, user list
  src/session.tsx      Account button and login dialog
  src/UsersScreen.tsx  User management (Admin)
  src/Numpad.tsx, PinPad.tsx, TextPad.tsx, Modal.tsx   On-screen keypads and dialogs
  src/roles.ts, types.ts   Roles, and the TypeScript mirror of ST_Analog
deploy/     Deploy scripts, systemd service, docker-compose.yml
Dockerfile  Builds one image with the frontend and server
```

## Start a new project (Beckhoff)

1. Create a repo from this template and clone it.
2. Add `ST_Analog` to the TwinCAT project, then declare HMI variables in `GVL_HMI` (see `plc/`).
   Mark writable ones with `{attribute 'hmi_write'}`. On a writable `ST_Analog`, the HMI can only
   write `fValue`; range and units stay PLC-owned.
3. Copy `server/.env.example` to `server/.env` and set the PLC address.
4. Build the screens in `web/src/App.tsx`, one line per item:

   | Component | PLC type | Use |
   |---|---|---|
   | `<SetpointEntry label tag />` | `ST_Analog` + `hmi_write` | Operator setpoint, opens the numpad |
   | `<AnalogReadout label tag />` | `ST_Analog` | Process value with units |
   | `<Readout label tag unit />` | any number | Counters and plain values |
   | `<CommandButton tag>` | `BOOL` + `hmi_write` | Momentary command, PLC clears it |

   Add `minRole="supervisor"` (or `maint`, `admin`) to limit who can use a control. The default is `operator`.

## Start a new project (Modbus TCP)

1. Create a repo from this template and clone it.
2. List the tags in `server/modbus-tags.json`: a name for each, its Modbus address, type, and whether
   the HMI may write it. Add `min`, `max` and `eu` to show a number as `ST_Analog` (setpoint or readout
   with units).
3. Copy `server/.env.example` to `server/.env`. Set `DRIVER=modbus` and `MODBUS_HOST`.
4. Build the screens in `web/src/App.tsx` using the names from the tag map.

| Address | Table | Types | HMI can write |
|---|---|---|---|
| `0xxxxx` | Coil | BOOL | with `"writable": true` |
| `1xxxxx` | Discrete input | BOOL | no |
| `3xxxxx` | Input register | INT, UINT, DINT, UDINT, REAL | no |
| `4xxxxx` | Holding register | INT, UINT, DINT, UDINT, REAL | with `"writable": true` |

Addresses are 1-based, as shown in most PLC software (`400001` is the first holding register), and written
as strings. 32-bit types use two registers; `MODBUS_WORD_ORDER=low-first` matches AutomationDirect PLCs.

Differences from Beckhoff:
- The tag list comes from the JSON map, not the PLC. Edit it and redeploy when tags change.
- `min`, `max` and `eu` live in the map, not the PLC.
- Values are polled every `MODBUS_POLL_MS` (default 250 ms). Neighboring addresses are read in one request.
- The PLC program still has to clamp setpoints and clear momentary command bits, same as on Beckhoff.
- The server starts even if the PLC is off and keeps retrying. A bad tag map stops it at startup with a
  message naming the bad entry. An address the PLC rejects is logged once and the rest keep working.

## PLC connection loss

If the PLC drops (either driver), screens show "PLC disconnected", grey out the last known values,
disable controls, and the server refuses writes. Everything recovers on its own when the PLC is back.

## Users and roles

Roles, lowest to highest: Operator, Supervisor, Maintenance, Admin. Each role can do everything below it.

- **Operator auto-login** (`AUTO_LOGIN_OPERATOR=true`, the default): screens open with Operator rights and no login.
  Tapping a locked control opens the login dialog. With `false`, nothing can be changed until someone logs in.
- **Logging in:** tap the account button, pick your name, enter your PIN (4 to 8 digits).
  5 wrong PINs lock that user out for 60 seconds.
- **Timeout:** a login drops back to the default after `LOGIN_TIMEOUT_MIN` idle minutes (default 10).
- **Managing users:** an Admin logs in, taps their name, then Manage users. There must always be at least one Admin.
- **First run:** the server creates a user "Admin" with a random PIN and prints it in the log
  (`journalctl -u hmi` or `docker logs hmi`). Log in and change it.
- **Lost the Admin PIN:** stop the server, delete `data/users.json`, and start it again. A new Admin and PIN
  are created. This removes all users.

Which role a control needs is set on the screens with `minRole`. The server requires a login (or Operator
auto-login) for any write and Admin for user changes, but doesn't check per-control roles itself.

The server reads the tag list from the PLC at startup, and again after every download or online change.

## Develop on your laptop

```
cd server && npm i && npm start       # needs an ADS route to the PLC
cd web && npm i && npm run dev        # open the URL Vite prints
```

## One-time IPC setup

```
sudo apt install nodejs npm rsync
sudo mkdir -p /opt/hmi && sudo chown $USER /opt/hmi
```

Run `deploy/deploy.sh` once (next section), then on the IPC:

```
cp /opt/hmi/server/.env.example /opt/hmi/server/.env    # edit if needed
sudo cp /opt/hmi/deploy/hmi.service /etc/systemd/system/
sudo systemctl enable --now hmi
```

If a remote panel can't connect, open port 3000 in the IPC firewall.

## Deploy and update

From your laptop:

```
./deploy/deploy.sh user@192.168.1.50
```

It builds the frontend, copies everything to `/opt/hmi`, installs packages and restarts the service.

## Check the service

```
systemctl status hmi
journalctl -u hmi -f        # live logs
```

## Deploy with Docker (alternative to systemd)

Needs Docker on your laptop (Docker Desktop includes the ARM cross-build support) and on the IPC. On Windows, run the script from WSL or Git Bash.

One-time IPC setup:

```
sudo mkdir -p /opt/hmi && sudo chown $USER /opt/hmi
sudo usermod -aG docker $USER      # log out and back in afterwards
```

Deploy from your laptop:

```
./deploy/deploy-docker.sh user@192.168.1.50                 # CX9240 (ARM)
./deploy/deploy-docker.sh user@192.168.1.50 linux/amd64     # x86 IPC
```

On the first deploy, `.env` is created from the example. Edit `/opt/hmi/.env` on the IPC if the defaults don't fit, then run `docker compose up -d` in `/opt/hmi`.

Check the container:

```
docker ps
docker logs -f hmi
```
