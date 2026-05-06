.PHONY: test test-unit test-integration test-e2e test-e2e-browser test-e2e-macos test-e2e-live test-contracts test-architecture test-mcp-stability fixtures-seed packets-golden lint typecheck ci install

PNPM ?= pnpm

install:
	$(PNPM) install

test:
	$(PNPM) test

test-unit:
	$(PNPM) test:unit

test-integration:
	$(PNPM) test:integration

test-e2e:
	$(PNPM) test:e2e

test-e2e-browser:
	$(PNPM) test:e2e:browser

test-e2e-macos:
	$(PNPM) test:e2e:macos

test-e2e-live:
	$(PNPM) test:e2e:live

test-contracts:
	$(PNPM) test:contracts

test-architecture:
	$(PNPM) test:architecture

test-mcp-stability:
	$(PNPM) test:mcp-stability

fixtures-seed:
	$(PNPM) fixtures:seed

packets-golden:
	$(PNPM) packets:golden

lint:
	$(PNPM) lint

typecheck:
	$(PNPM) typecheck

ci:
	$(PNPM) run ci
