# NAV Bridge — permanent, always-on tunnel

The dashboard reads NAV (SQL Server) through a small proxy on this laptop, exposed
to Railway via ngrok. Historically this broke constantly because ngrok was started
by hand with a **random URL that changed on every restart**, and nothing restarted
it after sleep/reboot. When it died, Railway hit a dead tunnel and the dashboard
showed EGP 0 / crashed.

This folder makes it permanent:

- **Stable URL** — uses your ngrok *static domain* (one free per account), so
  Railway's `NAV_PROXY_URL` is set **once** and never touched again.
- **Always on** — two macOS `launchd` services auto-start on login and auto-restart
  on crash/sleep/wake:
  - `com.lesouverain.navproxy`  → `node nav-proxy.js` on `:4001`
  - `com.lesouverain.navtunnel` → `ngrok http --url=https://<domain> 4001`

## One-time setup

1. Get your free static domain: https://dashboard.ngrok.com/domains → **+ Create Domain**
   → copy it (looks like `something.ngrok-free.app`).
2. Install the services:
   ```sh
   ./nav-bridge/install.sh your-domain.ngrok-free.app
   ```
3. Point Railway at the stable URL (once):
   ```sh
   railway variables --set NAV_PROXY_URL=https://your-domain.ngrok-free.app
   ```

That's it. Reboots and sleep no longer take NAV offline.

## Operations

```sh
# Are the services running?
launchctl list | grep lesouverain

# Live logs
tail -f nav-bridge/navproxy.log
tail -f nav-bridge/navtunnel.log

# Is everything healthy end-to-end? (no auth needed)
curl -s https://retail-intelligence-production.up.railway.app/api/health | python3 -m json.tool

# Restart everything
./nav-bridge/uninstall.sh && ./nav-bridge/install.sh your-domain.ngrok-free.app
```

`/api/health` reports per-source status (`nav` / `postgres` / `shopify`). If `nav`
is `offline`, check `navtunnel.log` (tunnel) then `navproxy.log` (DB connection).

## The real long-term fix

This still depends on the laptop being on and on the NAV network. The permanent
infra fix is to have IT **whitelist Railway's static egress IPs** on the NAV SQL
Server firewall — then set `NAV_DB_*` directly on Railway, delete `NAV_PROXY_URL`,
and retire this bridge entirely (`navdb.ts` already falls back to direct mode).
