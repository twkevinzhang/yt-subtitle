# Provider provenance

Source: https://github.com/Brainicism/bgutil-ytdlp-pot-provider
Version: 2.0.2. Experiment checkout: `26475e9d3665b972c4aeb83b4dbaafcf64b88438`.
License: GPL-3.0-only; see LICENSE.

The local proven source's `server/src/session_manager.ts` additionally contains
the unst em / 2026-08 homepage challenge patch: fetch homepage, extract matching
ytcfg and ytAtN, install yt.config_.EVENT_ID in both globals, then execute BotGuard
and exchange its snapshot at Google's GenerateIT endpoint. This patch is retained.

Adaptations: remove CLI, Express, disk caches, proxies, visitor-data generation,
legacy att/get fallback, internal retries and logging of integrity/PO tokens.
Keep JSDOM construction, axios transport, USER_AGENT, request key and minter.
Add network size/time limits, trusted interpreter origins and explicit shutdown.
The source is bundled into the container only, not the browser extension.
Worker termination enforces a total 20-second deadline independently of VM timers.
