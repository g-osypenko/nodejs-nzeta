.PHONY: all dev build start typecheck lint format check smoke test test-integration test-e2e coverage mutation

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
