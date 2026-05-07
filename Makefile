.PHONY: test test-unit test-integration test-e2e test-e2e-browser test-e2e-native-browser test-e2e-macos test-e2e-live test-e2e-live-boot test-db-docker test-db-native dev-doctor dev-postgres live-aerospace voice-listen-command test-contracts test-architecture test-mcp-stability fixtures-seed packets-golden lint typecheck ci install

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

test-e2e-native-browser:
	$(PNPM) test:e2e:native-browser

test-e2e-macos:
	$(PNPM) test:e2e:macos

test-e2e-live:
	$(PNPM) test:e2e:live

test-e2e-live-boot:
	$(PNPM) test:e2e:live:boot

test-db-docker:
	$(PNPM) test:db:docker

test-db-native:
	$(PNPM) test:db:native

dev-doctor:
	$(PNPM) dev:doctor

dev-postgres:
	$(PNPM) dev:postgres

live-aerospace:
	$(PNPM) live:aerospace

voice-listen-command:
	$(PNPM) voice:listen-command

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
