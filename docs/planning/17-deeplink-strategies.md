# Deeplink Strategies

Goal: restore useful context fast without pretending every app has perfect scroll anchors.

MVP contract:

```text
provider ids + user-openable URL + browser quote/scroll fallback + restore confidence
```

Do not build custom DOM hacks first. Store stronger provider IDs when available, then let browser extension handle generic scroll/quote fallback.

## Confidence Tiers

High:

- Slack permalink.
- GitHub PR/issue/check/code permalink.
- Figma file URL with node id.
- Local file path + line/selection.

Medium:

- Notion page/block URL plus page/block ID when available.
- Google Docs URL plus bookmark/heading URL when available.
- Browser URL plus text quote and scroll position.

Low:

- App/window title only.
- Generic website URL with stale scroll.
- Canvas/virtualized app with no provider anchor.

## Slack

Store:

- `team_id`
- `channel_id`
- `message_ts`
- `thread_ts`
- permalink URL

Use Slack `chat.getPermalink` when API access exists.

Source: https://docs.slack.dev/reference/methods/chat.getPermalink/

## GitHub

Store:

- repo owner/name
- issue or PR number
- commit SHA
- check run ID when relevant
- file path and line range for code review
- permalink URL

Use GitHub permanent links for code snippets when file/line context matters.

Source: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-a-permanent-link-to-a-code-snippet

## Notion

Store:

- page URL
- page ID
- block ID if available
- title/path
- text quote fallback

Notion API has block IDs, but UI block-link restore can be imperfect. Treat Notion block links as medium confidence unless dogfood proves reliable.

Sources:

- https://developers.notion.com/guides/data-apis/working-with-page-content
- https://developers.notion.com/reference/block

## Google Docs

Store:

- doc URL
- bookmark URL or heading URL if available
- document title
- text quote fallback

Official durable anchors are bookmarks/links. Arbitrary paragraph scroll restore should use browser quote fallback.

Source: https://support.google.com/docs/answer/45893

## Figma

Store:

- file key
- node id
- page/frame name
- browser URL

Figma frame/object links are good context anchors. Canvas visual state may still need user verification.

Sources:

- https://help.figma.com/hc/en-us/articles/360045942953-Add-links-to-text
- https://developers.figma.com/docs/rest-api/file-endpoints/

## Linear

Linear is post-MVP for Jason. Keep only generic URL metadata if a Linear URL appears in an event.

Store:

- issue identifier
- issue URL
- comment URL if available
- project/team key

Issue/comment URL is enough for MVP.

## Browser Fallback

For every web resource, store:

- URL
- title
- scroll position
- text quote
- selector hint if available
- captured timestamp

If provider anchor fails, browser extension opens URL, scrolls near prior position, then highlights quote if found.

## Current Implementation

Current implementation:

- `app/orchestrator/src/context/deeplink_normalizers.ts` normalizes Slack, GitHub, Notion, Google Docs, Figma, and generic browser URLs.
- MCP poll mappers run resources through the normalizer and preserve existing top-level fields for compatibility.
- Provider IDs and confidence reasons live in `resource.details`.
- Mac queue context rows display restore confidence and `details.confidence_reason` when available.
- Restore created/done/failed/retried metrics are counted by provider, and `dogfood:review` groups provider success/failure from activity history.

Next, only when dogfood needs it:

1. Dogfood provider anchors against real Slack/GitHub/Notion/Google Docs/Figma pages.
