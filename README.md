# Base Service

Owns each player's survival base, which starts as the FAF Cab: upgrades, barricades, facilities, storage capacity, decorations and Kiki (random rewards). Resources are spent through the Resource Service.

Part of the FAF zombie-survival game, Team 6. Stack: TypeScript, Node.js 20, Express, PostgreSQL 16.

## Prerequisites

Node.js 20+ and npm, Docker with Docker Compose v2 (for PostgreSQL or the full container stack). Nothing else: tests and the in-memory mode need no database.

## Port

The service listens on **3002** (`PORT`). Its PostgreSQL container is published on **5434** (`POSTGRES_PORT`).

## Environment variables

Copy `.env.example` to `.env` (`run.sh` does it for you). `.env` is gitignored, never commit it.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3002 | HTTP port |
| `STORAGE` | postgres | `postgres` or `memory` |
| `DATABASE_URL` | - | PostgreSQL connection string (required when `STORAGE=postgres`) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | - | Used by `docker-compose.yml` to create the DB |
| `POSTGRES_PORT` | 5434 | Host port of the DB container |
| `PLAYER_CLIENT` / `WORLD_CLIENT` | mock | `mock` (Lab 1) or `http` (Lab 2) |
| `RESOURCE_CLIENT` | mock | `http` calls our Resource Service, `mock` uses a fake with 1000 of everything |
| `PLAYER_SERVICE_URL` / `WORLD_SERVICE_URL` / `RESOURCE_SERVICE_URL` | localhost:3000 / 3003 / 3001 | Used when the client is `http` |
| `MOCK_PLAYERS` | player-1,player-2,player-3,player-4 | Players the mock Player Service knows |
| `KIKI_COOLDOWN_SECONDS` | 30 | Minimum time between two Kiki interactions |

## How to run

```bash
./run.sh            # install, build, start (starts the PostgreSQL container first when STORAGE=postgres)
./run.sh --memory   # same, but in-memory storage, no Docker needed
./run.sh --docker   # service + PostgreSQL both in Docker (docker compose up --build)
```

Check it: `curl http://localhost:3002/health`.

On startup the service creates its tables (`db/schema.sql`) and runs the seed (`db/seed.sql`), which only inserts data when the database is empty. You can also run it by hand with `npm run build && npm run seed`.

To use the real Resource Service instead of the mock, start it first on port 3001 and set `RESOURCE_CLIENT=http` in `.env`. In `./run.sh --docker` mode the container reaches it at `http://host.docker.internal:3001`.

## Docker

```bash
docker build -t <dockerhub-user>/base-service:1.0.0 .
docker push <dockerhub-user>/base-service:1.0.0

# run the public image on a clean machine (in-memory, no DB)
docker run --rm -p 3002:3002 -e STORAGE=memory <dockerhub-user>/base-service:1.0.0
```

The PostgreSQL data lives in the named volume `base_pgdata`, so it survives `docker compose down` (use `docker compose down -v` to wipe it).

## Tests

```bash
npm test                 # unit + API tests (in-memory, mocked Player/World/Resource)
npm run test:coverage    # fails under 80% coverage
TEST_DATABASE_URL=postgres://user:pass@localhost:5434/test_db npm test   # also runs the PostgreSQL integration test
```

## Project layout

```
src/
  domain/         types and game rules
  services/       business logic (validation, idempotency, mocks usage)
  repositories/   storage port + in-memory and PostgreSQL implementations
  clients/        Player / World / Resource clients: interface + Mock (Lab 1) + Http (Lab 2)
  http/           routes and request validation (zod)
db/               schema.sql, seed.sql
tests/
```

## Communication contract

### Base Service (port 3002)

Owns each player's survival base: it starts as the **FAF Cab** room and tracks level, storage capacity, barricades, facilities, decorations, Kiki and the boosters Kiki gave. World Service owns the campus geography; Base Service owns what players built inside it. Every paid action spends resources through Resource Service `POST /consume`.

**Idempotency.** Every paid or random action (upgrade, barricade, facility, storage, decoration, Kiki) requires an `actionId`. First call → `201`; retry with the same `actionId` → `200`, `"duplicate": true`, the **same** result (Kiki does not re-roll), nothing charged again. Base forwards `base:<actionId>` to Resource Service, so a crash between "resources spent" and "base saved" is repaired by simply retrying. The base row is locked (`SELECT ... FOR UPDATE`) for the whole action.

**Action response** (all paid/random actions):
```jsonc
{ "actionId": "uuid", "duplicate": false, "result": { "cost": [{ "resourceTypeId": "wood", "amount": 10 }], "...": "action specific" }, "base": Base }
```

**Base**
```jsonc
{
  "id": "base-player-1", "playerId": "player-1", "name": "FAF Cab", "roomId": "FAF_CAB",
  "level": 1, "storageCapacity": 100,
  "barricades":  [{ "id": "uuid", "roomId": "corridor-3", "level": 1, "durability": 50, "builtAt": "ISO-8601" }],
  "facilities":  [{ "type": "WORKBENCH | KITCHEN | STUDY_DESK | INFIRMARY | GENERATOR", "level": 1, "builtAt": "ISO-8601" }],
  "decorations": [{ "id": "uuid", "type": "POSTER | PLANT | RUG | LAMP | FAF_BANNER", "placedAt": "ISO-8601" }],
  "boosters":    [{ "id": "uuid", "type": "ENERGY_DRINK | STUDY_NOTES | LUCKY_PAW | GOLDEN_EXAM_TICKET", "obtainedAt": "ISO-8601" }],
  "kiki": { "mood": 50, "interactions": 0, "lastInteractionAt": null },
  "createdAt": "ISO-8601", "updatedAt": "ISO-8601"
}
```

**Rules and costs** (also served by `GET /catalog`): upgrade from level L costs wood 10L, metal_scraps 5L, paper 2L, max level 5, +50 storage per level. Barricade costs wood 5 + metal_scraps 2, max `level + 1` barricades, reinforce from level L costs wood 3L + metal_scraps 2L, max barricade level 3 (durability 50 per level). Facilities: WORKBENCH (wood 8, metal 4), KITCHEN (wood 4, metal 3, food 5), STUDY_DESK (wood 5, paper 8), INFIRMARY (metal 2, paper 6, food 6, base level 2+), GENERATOR (wood 4, metal 12, base level 3+); upgrading from level L costs build cost × (L+1), max level 3. Storage +25 for wood 6 + metal 3, limit 100 + 100 × level. Decorations: POSTER (paper 2), PLANT (paper 1, food 1), RUG (wood 1, paper 3), LAMP (wood 1, metal 2), FAF_BANNER (paper 4), limit 3 + 2 × level. Kiki: PET is free (+5 mood), FEED costs food 2 (+20 mood), cooldown `KIKI_COOLDOWN_SECONDS`; reward weights NOTHING max(5, 40 − 20 if fed − mood/5), ENERGY_DRINK 25, STUDY_NOTES 20, LUCKY_PAW 10, GOLDEN_EXAM_TICKET 5.

| Method | Path | Request body | Response | Status codes |
|---|---|---|---|---|
| GET | `/health` | - | `{ "status": "ok", "service": "base-service" }` | 200 |
| GET | `/catalog` | - | costs, limits and reward table | 200 |
| GET | `/bases` | - | `Base[]` | 200 |
| POST | `/bases` | `{ "playerId": "player-4", "name"?: "FAF Cab" }` | `Base` (starts in FAF_CAB) | 201, 400, 404 (player), 409 (already has one) |
| GET | `/bases/:baseId` | - | `Base` | 200, 404 |
| PATCH | `/bases/:baseId` | `{ "name": "Bunker" }` | `Base` | 200, 400, 404 |
| DELETE | `/bases/:baseId` | - | empty | 204, 404 |
| GET | `/players/:playerId/base` | - | `Base` | 200, 404 |
| POST | `/bases/:baseId/upgrade` | `{ "actionId": "uuid" }` | Action response, `result: { cost, level, storageCapacity }` | 201, 200, 400, 404, 409, 422 (`MAX_LEVEL_REACHED`, `INSUFFICIENT_RESOURCES`), 503 |
| GET | `/bases/:baseId/barricades` | - | `Barricade[]` | 200, 404 |
| POST | `/bases/:baseId/barricades` | `{ "actionId": "uuid", "roomId": "corridor-3" }` | Action response, `result: { cost, barricade }` | 201, 200, 400, 404 (`ROOM_NOT_FOUND`), 409 (`ROOM_ALREADY_BARRICADED`), 422 (`BARRICADE_LIMIT_REACHED`, `INSUFFICIENT_RESOURCES`), 503 |
| POST | `/bases/:baseId/barricades/:barricadeId/reinforce` | `{ "actionId": "uuid" }` | Action response, `result: { cost, barricade }` | 201, 200, 400, 404, 409, 422, 503 |
| DELETE | `/bases/:baseId/barricades/:barricadeId` | - | `Base` | 200, 404 |
| GET | `/bases/:baseId/facilities` | - | `Facility[]` | 200, 404 |
| POST | `/bases/:baseId/facilities` | `{ "actionId": "uuid", "type": "WORKBENCH" }` | Action response, `result: { cost, facility }` | 201, 200, 400, 404, 409 (`FACILITY_EXISTS`), 422 (`BASE_LEVEL_TOO_LOW`, `INSUFFICIENT_RESOURCES`), 503 |
| POST | `/bases/:baseId/facilities/:type/upgrade` | `{ "actionId": "uuid" }` | Action response, `result: { cost, facility }` | 201, 200, 400, 404, 409, 422, 503 |
| GET | `/bases/:baseId/storage` | - | `{ "storageCapacity": 100, "level": 1 }` | 200, 404 |
| POST | `/bases/:baseId/storage/expand` | `{ "actionId": "uuid" }` | Action response, `result: { cost, storageCapacity, limit }` | 201, 200, 400, 404, 409, 422 (`STORAGE_LIMIT_REACHED`, `INSUFFICIENT_RESOURCES`), 503 |
| GET | `/bases/:baseId/decorations` | - | `Decoration[]` | 200, 404 |
| POST | `/bases/:baseId/decorations` | `{ "actionId": "uuid", "type": "FAF_BANNER" }` | Action response, `result: { cost, decoration }` | 201, 200, 400, 404, 409, 422 (`DECORATION_LIMIT_REACHED`, `INSUFFICIENT_RESOURCES`), 503 |
| DELETE | `/bases/:baseId/decorations/:decorationId` | - | `Base` | 200, 404 |
| GET | `/bases/:baseId/kiki` | - | `{ "kiki": KikiState, "boosters": Booster[] }` | 200, 404 |
| POST | `/bases/:baseId/kiki/interact` | `{ "actionId": "uuid", "action": "PET" \| "FEED" }` | Action response, `result: { cost, action, reward, booster, kiki }` | 201, 200, 400, 404, 409, 422, 429 (`KIKI_COOLDOWN`, `Retry-After` header), 503 |

`503 UPSTREAM_UNAVAILABLE` means Resource Service could not be reached; nothing was changed and the same `actionId` can be retried.

**Calls to other services** (behind interfaces, mocked in Lab 1): Player Service `GET /players/:id` (player exists), World Service `GET /rooms/:id` (room exists, for barricades), Resource Service `POST /consume` (real call when `RESOURCE_CLIENT=http`, mock otherwise).
