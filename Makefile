.PHONY: all dev build start typecheck lint format check smoke test test-integration test-e2e coverage mutation migrate seed docker docker-run ci load load-sweep perf-down profile explain lighthouse

all: check build test smoke

dev:
	npm run dev

build:
	npm run build

start:
	npm start

typecheck:
	npm run typecheck

lint:
	npm run lint

format:
	npm run format:write

check:
	npm run lint
	npm run format:check
	npm run typecheck

smoke:
	npm run smoke

# Lab 3 — test levels (spec.md §6). Integration and e2e need Docker (Testcontainers).
test:
	npm test

test-integration:
	npm run test:integration

test-e2e:
	npm run test:e2e

coverage:
	npm run test:coverage

mutation:
	npm run test:mutation

# Lab 4 — CI/CD (spec.md §8). `make ci` = the same checks as the required CI jobs (needs Docker).
migrate:
	npm run db:migrate

seed:
	npm run db:seed

SHA := $(shell git rev-parse HEAD)

docker:
	docker build --build-arg GIT_COMMIT=$(SHA) -t nodejs-nzeta:$(SHA) -t nodejs-nzeta:local .

docker-run:
	docker run --rm -p 127.0.0.1:3999:3000 -e DATA_SOURCE=memory -e WEBHOOK_SECRET=local-docker-secret-01 -e ADMIN_EMAIL=admin@lch.local -e ADMIN_PASSWORD=local-admin-password nodejs-nzeta:local

ci: check build smoke coverage test-e2e docker

# Lab 5 — performance (spec.md §9). Stand: perf/compose.yml (needs Docker); reports → docs/perf/.
# `make load LABEL=after` → docs/perf/load-after.md (the committed baseline is LABEL=baseline).
LABEL ?= run
load:
	npm run perf:load -- --label=$(LABEL)

load-sweep:
	npm run perf:load -- --label=$(LABEL)-sweep --sweep="handshake:200,400,800,1200,1600;login:10,20,40,80" --repeats=1

profile:
	npm run perf:profile -- --label=$(LABEL) --scenarios=handshake:800,login:30,storm:400

explain:
	npm run perf:explain -- --label=$(LABEL)

lighthouse:
	npm run perf:lighthouse -- --label=$(LABEL)

perf-down:
	npm run perf:down
