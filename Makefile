.PHONY: test test-unit test-integration test-e2e test-e2e-browser test-e2e-native-browser test-e2e-native-browser-real-orchestrator test-e2e-mac-browser-restore test-e2e-macos test-e2e-macos-launch test-e2e-macos-ui test-e2e-live test-e2e-live-boot test-e2e-live-full test-db-docker test-db-native dev-doctor dev-postgres dev-postgres-up dev-postgres-down dev-postgres-url dev-dogfood live-aerospace voice-listen-command voice-stt-smoke run-queue-app test-contracts test-architecture test-mcp-stability fixtures-seed packets-golden lint typecheck ci install

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

test-e2e-native-browser-real-orchestrator:
	$(PNPM) test:e2e:native-browser-real-orchestrator

test-e2e-mac-browser-restore:
	$(PNPM) test:e2e:mac-browser-restore

test-e2e-macos:
	$(PNPM) test:e2e:macos

test-e2e-macos-launch:
	$(PNPM) test:e2e:macos-launch

test-e2e-macos-ui:
	$(PNPM) test:e2e:macos-ui

test-e2e-live:
	$(PNPM) test:e2e:live

test-e2e-live-boot:
	$(PNPM) test:e2e:live:boot

test-e2e-live-full:
	$(PNPM) test:e2e:live:full

test-db-docker:
	$(PNPM) test:db:docker

test-db-native:
	$(PNPM) test:db:native

dev-doctor:
	$(PNPM) dev:doctor

dev-postgres:
	$(PNPM) dev:postgres

dev-postgres-up:
	$(PNPM) dev:postgres:up

dev-postgres-down:
	$(PNPM) dev:postgres:down

dev-postgres-url:
	$(PNPM) dev:postgres:url

dev-dogfood:
	$(PNPM) dev:dogfood

live-aerospace:
	$(PNPM) live:aerospace

voice-listen-command:
	$(PNPM) voice:listen-command

voice-stt-smoke:
	$(PNPM) voice:stt-smoke

run-queue-app:
	$(PNPM) run:queue-app

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
