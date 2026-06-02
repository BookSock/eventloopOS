# Lab Mac Recovery

Use this when the remote Mac Studio disappears after reboot and `pnpm product:quick` fails on connectivity.

## Local Recovery Steps

1. Log into the lab user account at the Mac.
2. Open Tailscale and confirm it is connected to the expected tailnet.
3. Open System Settings > General > Sharing.
4. Confirm Remote Login is enabled and administrators are allowed.
5. Confirm Screen Sharing or Remote Management is enabled and administrators can control the screen.
6. Confirm automatic login is enabled for the lab user.
7. Confirm sleep is disabled for the lab profile.

Then run the local bootstrap from the repo on the lab Mac. It installs/loads
self-heal first, then runs local recovery checks:

```sh
LAB_CONTROLLER_TAILSCALE_IP=100.76.35.66 pnpm lab:local-bootstrap
pnpm setup:status
```

The bootstrap refuses to run when the local Tailscale IP matches
`LAB_CONTROLLER_TAILSCALE_IP`, so accidentally pasting this on the controller
Mac will not install the lab self-heal LaunchAgent there. If you are truly on
the lab Mac and need to override that guard, set
`LAB_LOCAL_BOOTSTRAP_ALLOW_CONTROLLER=1`.

If you need to inspect the recovery checks separately:

```sh
LAB_CONTROLLER_TAILSCALE_IP=100.76.35.66 pnpm lab:local-recovery
```

The bootstrap installs the self-heal LaunchAgent so the lab retries this
recovery path whenever the user session starts. You can inspect it directly:

```sh
pnpm lab:self-heal -- status
```

The self-heal agent runs as the lab user. It opens Tailscale and AeroSpace,
keeps the Mac awake with `caffeinate`, writes a heartbeat with Tailscale, SSH,
VNC, controller ping, and process checks, runs `pnpm lab:local-recovery`, and
writes artifacts under:

```sh
artifacts/lab-runs/<timestamp>-self-heal/manifest.json
artifacts/lab-runs/<timestamp>-self-heal/heartbeat.json
```

Each local bootstrap also writes a short operator handoff:

```sh
artifacts/lab-runs/<timestamp>-local-bootstrap/OPERATOR.md
```

Use that file as the one-screen record of lab-side fixes, optional warnings,
and controller commands to run next. It is easier to read over VNC or paste into
the main controller thread than the full JSON manifest.

The handoff contract has a fake self-test:

```sh
pnpm lab:local-bootstrap:self-test
```

It cannot grant macOS privacy permissions, enable Remote Login, enable Screen
Sharing, configure auto-login, or sign into Tailscale. Those remain explicit
manual setup steps.

When SSH is working from the controller Mac, install or check the agent remotely:

```sh
LAB_CONTROLLER_TAILSCALE_IP=100.76.35.66 pnpm lab:self-heal:remote -- install
pnpm lab:self-heal:remote -- status
```

The command writes:

```sh
artifacts/lab-runs/<timestamp>-local-recovery-check/manifest.json
```

The manifest includes local listener checks and self tailnet checks for SSH
port 22 and VNC port 5900. When `LAB_CONTROLLER_TAILSCALE_IP` is set, it also
runs a Tailscale-layer ping to the controller peer. That catches cases where
Remote Login or Screen Sharing is enabled locally but not reachable on the
Tailscale interface or where ACL/routing is wrong.

Fix every required failure in that manifest. The recovery/baseline checks now
require the self-heal LaunchAgent to be installed and loaded, because reboot
recovery is not considered reliable without it.

Then from the controller Mac run:

```sh
pnpm lab:wait-online:quick
pnpm lab:wait-online:long
pnpm setup:lab-status
```

Only after `product:quick` passes should you run:

```sh
pnpm product:lab-ready
pnpm product:dogfood
```

Only after `product:lab-ready` proves the dogfood stack is up should
`product:dogfood` spend time on a real Codex queue scenario. Only after
`product:dogfood` passes should you retry reboot proof:

```sh
LAB_MAC_REBOOT=1 LAB_MAC_REBOOT_REQUIRE_SUDO=1 LAB_MAC_LOGIN_PASSWORD='<lab-password>' bin/lab-mac-reboot-proof
```

Release readiness uses strict sudo reboot mode. Do not rely on GUI restart
fallback for release proof; if the password is missing or invalid, the proof
should fail before rebooting so the lab is not stranded offline.

## Current Known Outage

Latest reboot proof failed because SSH went down and did not come back within 420 seconds:

```sh
artifacts/lab-runs/20260601-220403-reboot-proof/manifest.json
```

Latest fast gate preserves the connectivity failure:

```sh
artifacts/product-readiness/20260602T073643Z-53517-lab-quick/manifest.json
artifacts/product-readiness/20260602T073643Z-53517-lab-quick/failed-lab-connectivity-status/manifest.json
```

Latest repair text points the in-person operator at:

```sh
LAB_CONTROLLER_TAILSCALE_IP=100.76.35.66 pnpm lab:local-bootstrap
```
