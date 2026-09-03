# PICO + Sub2API

Sub2API runs as a separate gateway component: it has its own PostgreSQL,
Redis, administration console and Docker volumes. PICO never reads provider
credentials directly. It calls the gateway using a dedicated gateway token.

## Start the gateway

1. Copy `sub2api.env.example` to `.env.sub2api` and replace every placeholder
   password and secret with a unique random value. With the default
   `SUB2API_AUTO_SETUP=true`, an empty `SUB2API_ADMIN_PASSWORD` creates a
   one-time password in the Sub2API container logs. To choose the administrator
   credentials in the first-run web wizard instead, set
   `SUB2API_AUTO_SETUP=false` before the first start.
2. Start the optional profile:

   ```sh
   docker-compose --env-file infra/docker/.env.sub2api \
     -f infra/docker/docker-compose.yml \
     -f infra/docker/docker-compose.sub2api.yml \
     --profile sub2api up -d
   ```

3. If `SUB2API_AUTO_SETUP=false`, open `http://localhost:8081` to complete the
   administrator setup. Otherwise log in with the configured administrator
   email and password. Configure only provider API credentials and upstream
   connections you are authorized to operate.
4. Create one gateway client token for PICO. Copy the entries in
   `pico.sub2api-route.env.example` into the untracked `.env.sub2api` file and
   replace its token placeholder. Do this only after an authorized upstream is
   configured; until then PICO remains on its local development mock.
   Set `PICO_SUB2API_ADMIN_URL` in the same file to the URL that the
   administrator's browser can open (for example, `http://localhost:8081` in
   the template or `http://localhost:8181` for the alternate local port). Do
   not use the internal Docker hostname here.
5. Restart the PICO API and worker with that env file so their
   `NEW_API_BASE_URL` becomes `http://sub2api:8080`:

   ```sh
   docker-compose --env-file infra/docker/.env.sub2api \
     -f infra/docker/docker-compose.yml \
     -f infra/docker/docker-compose.sub2api.yml \
     --profile sub2api up -d api worker
   ```

After the restart, open the PICO admin console and use **模型管理 → 同步
Sub2API**. The action forces an immediate refresh from the gateway's model
list. Synchronized rows show the provider and remain unavailable until you
set a PICO customer price with **PICO 售价**; this price is independent of any
Sub2API upstream cost setting. Publishing a row only changes PICO's customer
catalog and never exposes or overwrites the provider credentials stored in
Sub2API.

An authenticated PICO super administrator can open the separate Sub2API
console from **设置 → 管理员后台 → Sub2API 管理后台**, or from the link at the bottom
of the PICO admin console. The link carries no password or gateway token; the
Sub2API login/session remains independent.

If the button reports that synchronization is disabled, check that the
container environment contains `NEW_API_MODEL_CATALOG_SYNC=true` (or
`PICO_NEW_API_MODEL_CATALOG_SYNC=true` in the compose env file), then recreate
the API container. The default is intentionally `false` so a development mock
does not replace its seeded models.

The Sub2API source is licensed under LGPL-3.0 and is kept as an independent
gateway component. Any changes made to that code must retain its license and
source-distribution obligations.
