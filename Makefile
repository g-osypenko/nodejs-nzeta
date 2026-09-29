.PHONY: all dev build start typecheck lint format check smoke

all: check build smoke

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
