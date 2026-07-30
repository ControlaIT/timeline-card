# Timeline Card

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-orange?style=flat&logo=homeassistantcommunitystore&logoSize=auto)](https://my.home-assistant.io/redirect/hacs_repository/?owner=ControlaIT&repository=timeline-card&category=plugin)
[![HACS Validate](https://github.com/ControlaIT/timeline-card/actions/workflows/validate.yaml/badge.svg)](https://github.com/ControlaIT/timeline-card/actions/workflows/validate.yaml)

<p align="center">
  <img
    src="https://raw.githubusercontent.com/ControlaIT/timeline-card/main/docs/logo.png"
    alt="Timeline Card Logo"
    width="140"
    style="margin-bottom: 12px;"
  />
</p>

<p align="center">
  <strong>Timeline Card for Home Assistant</strong><br>
  <em>Real-time event history with WebSocket updates & beautiful timeline UI</em>
</p>

<p align="center">
  <img
    src="https://raw.githubusercontent.com/ControlaIT/timeline-card/main/docs/card-preview.png"
    alt="Timeline Card Screenshot"
    style="width: 400px; border-radius: 18px;"
  />
  <img
    src="https://raw.githubusercontent.com/ControlaIT/timeline-card/main/docs/card-preview-2.png"
    alt="Timeline Card Screenshot"
    style="width: 400px; border-radius: 18px;"
  />  
</p>

> This is a fork of [weedpump/timeline-card](https://github.com/weedpump/timeline-card)
> maintained by [Controlá](https://github.com/ControlaIT). It keeps the original
> card's name (`custom:timeline-card`) and drops in as a replacement, so it
> cannot be installed alongside the original. All credit for the card goes to
> [@weedpump](https://github.com/weedpump) and its contributors; changes made
> here are listed in [CHANGELOG.md](CHANGELOG.md).

---

## Table of Contents

1. [Features](#features)
2. [Installation](#installation)
   1. [HACS (Recommended)](#hacs-recommended)
   2. [Manual Installation](#manual-installation)
3. [Configuration](#configuration)
   1. [Basic Example](#basic-example)
   2. [Card Options](#card-options)
   3. [Overflow handling](#overflow-handling)
   4. [Event width](#event-width)
   5. [Mirrored sides](#mirrored-sides)
   6. [Auto-Refresh](#auto-refresh)
   7. [Live Events (WebSocket)](#live-events-websocket)
   8. [Restart noise](#restart-noise)
4. [Per-Entity Configuration](#per-entity-configuration)
   1. [Example](#entity-example)
   2. [Entity Options](#entity-options)
5. [Examples](#examples)
   1. [Presence Timeline](#presence-timeline)
   2. [Door Monitoring](#door-monitoring)
   3. [Timeline Card as Popup (browser_mod)](#timeline-card-as-popup-browser_mod)
6. [Locales](#locales)
7. [License](#license)

---

<a id="features"></a>

## ✨ Features

- Alternating center layout plus optional left/right single-sided modes
- Configurable history range (in hours)
- Global limit for the number of events shown
- Overflow handling: collapse extra entries or use a scrollable container
- Per-entity configuration (name, icons, colors, status labels, filters)
- Fully configurable via the Home Assistant UI editor
- Compact layout option to reduce vertical space
- Localized relative time (e.g. "5 minutes ago") or absolute datetime
- Locale-based state translation with per-entity overrides
- Optional auto-refresh interval (in seconds)
- Live updates via WebSocket - timeline updates instantly without page refresh
- Works with any entity that appears in Home Assistant history

---

<a id="installation"></a>

## 🛠 Installation

<a id="hacs-recommended"></a>

### HACS (Recommended)

<details>
  <summary>click to show installation instructions</summary>
<br>This fork is <strong>not</strong> part of the default HACS store — add it as a
custom repository.

To add it, click this link:

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=ControlaIT&repository=timeline-card&category=plugin)

Or manually:

1. Open the HACS panel in HA → ⋮ (top right) → **Custom repositories**.
2. Repository: `https://github.com/ControlaIT/timeline-card`, Type: **Dashboard**.
3. Add it, then search for **Timeline Card** and click download.

Follow the instructions provided to complete the installation.

</details>

<a id="manual-installation"></a>

### Manual Installation

<details>
  <summary>click to show installation instructions</summary>
<br>

1. Download `timeline-card.js` from the latest GitHub release.
2. Place the file in your Home Assistant `www` directory:

```
/config/www/timeline-card/timeline-card.js
```

3. Add the resource to your dashboard configuration:

```yaml
resources:
  - url: /local/timeline-card/timeline-card.js
    type: module
```

Or via the UI:
**Settings > Dashboards > ... > Resources > Add resource**

</details>

---

<a id="configuration"></a>

## ⚙️ Configuration

<a id="basic-example"></a>

### Basic Example

```yaml
type: custom:timeline-card
title: Door & Presence
hours: 12
limit: 8
relative_time: true
show_states: true
allow_multiline: true
entities:
  - entity: binary_sensor.frontdoor_contact
  - entity: person.tobi
```

<a id="card-options"></a>

### Card Options

| Option                     | Type    | Required | Default    | Description                                                                                                                                                                                                         |
| -------------------------- | ------- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entities`                 | list    | yes      | -          | List of entities or entity config objects                                                                                                                                                                           |
| `hours`                    | number  | yes      | -          | Number of hours of history to fetch                                                                                                                                                                                 |
| `limit`                    | number  | yes      | -          | Max number of events displayed                                                                                                                                                                                      |
| `visible_events`           | number  | no       | -          | Only show the first N events; hide the rest behind a toggle                                                                                                                                                         |
| `overflow`                 | string  | no       | collapse   | `collapse` (Show more/less) or `scroll` (scrollable container)                                                                                                                                                      |
| `max_height`               | string  | no       | -          | Constrain card height (e.g. `220px`, `16rem`); useful with `overflow: scroll`                                                                                                                                       |
| `event_width`              | number  | no       | -          | Fixed width for every event card, so rows don't each size to their own entity name. A bare number is px; a string with a unit (`14rem`, `50%`) is used as authored. See [Event width](#event-width).                |
| `mirror_sides`             | boolean | no       | false      | Mirror the cards sitting left of the line — icon on the inner edge, text ranged towards the line — instead of laying every card out left-to-right. See [Mirrored sides](#mirrored-sides).                           |
| `title`                    | string  | no       | ""         | Card title                                                                                                                                                                                                          |
| `relative_time`            | boolean | no       | false      | Use relative ("5 minutes ago") time                                                                                                                                                                                 |
| `show_date`                | boolean | no       | true       | Include the date in absolute timestamps; set `false` to show time only                                                                                                                                              |
| `group_by_day`             | boolean | no       | false      | Split the timeline into one independent segment per calendar day, each with its own header ("Today", "Yesterday", or the weekday) and its own line — instead of one continuous line across the whole history window |
| `show_names`               | boolean | no       | true       | Show entity names                                                                                                                                                                                                   |
| `show_states`              | boolean | no       | true       | Show entity states                                                                                                                                                                                                  |
| `show_icons`               | boolean | no       | true       | Show entity icons                                                                                                                                                                                                   |
| `language`                 | string  | no       | auto       | Language code (default `en-US`; supports `cs`, `en-US`, `en-GB`, `de`, `fr`, `it`, `nl`, `pl`, `pt-BR`, `ru`, `sv`)                                                                                                 |
| `refresh_interval`         | number  | no       | -          | Auto-refresh interval in seconds (background refresh)                                                                                                                                                               |
| `allow_multiline`          | boolean | no       | false      | Enables automatic multiline wrapping for long names/states                                                                                                                                                          |
| `force_multiline`          | boolean | no       | false      | Always place the state on a new line below the name                                                                                                                                                                 |
| `card_layout`              | string  | no       | center     | Layout mode: `center` (alternating), `left` (timeline left, cards right), `right` (timeline right, cards left)                                                                                                      |
| `compact_layout`           | boolean | no       | false      | Overlaps alternating rows to reduce vertical height (only with `card_layout: center`)                                                                                                                               |
| `card_background`          | string  | no       | -          | Card background color (supports hex/rgb/rgba)                                                                                                                                                                       |
| `name_color`               | string  | no       | -          | Global name color (overridden by entity)                                                                                                                                                                            |
| `state_color`              | string  | no       | -          | Global state color (overridden by entity)                                                                                                                                                                           |
| `timeline_color_start`     | string  | no       | -          | Timeline gradient start color (hex/rgb/rgba)                                                                                                                                                                        |
| `timeline_color_end`       | string  | no       | -          | Timeline gradient end color (hex/rgb/rgba)                                                                                                                                                                          |
| `dot_color`                | string  | no       | -          | Timeline dot color (hex/rgb/rgba)                                                                                                                                                                                   |
| `collapse_duplicates`      | boolean | no       | false      | Removes consecutive events with the same state across all entities.                                                                                                                                                 |
| `collapse_duplicates_keep` | string  | no       | `earliest` | Which event to keep when collapsing duplicates: `earliest` (start of the run) or `latest` (end of the run).                                                                                                         |
| `ignore_unavailable`       | boolean | no       | true       | Hides `unavailable`/`unknown` events, the restart artifacts they leave behind, and rows that only repeat an entity's previous value. See [Restart noise](#restart-noise).                                           |

```yaml
type: custom:timeline-card
relative_time: false
show_date: false
entities:
  - entity: light.living_room
```

<a id="overflow-handling"></a>

### Overflow handling

Use `visible_events` when you want to fetch more history than you can show in the available space. With the default `overflow: collapse`, extra entries are hidden behind a **Show more/less** toggle. If you prefer a scroll container, set `overflow: scroll` and add a `max_height`.

```yaml
type: custom:timeline-card
hours: 12
limit: 10 # total items fetched
visible_events: 3 # initially shown
overflow: collapse # or "scroll"
# max_height: 220px  # recommended when using overflow: scroll
entities:
  - entity: binary_sensor.frontdoor_contact
  - entity: person.tobi
```

<a id="event-width"></a>

### Event width

By default each event card is only as wide as its own content, so a timeline
mixing `binary_sensor.frontdoor_contact` with `person.tobi` renders a ragged
column of different-sized boxes. `event_width` gives them all the same width:

```yaml
type: custom:timeline-card
hours: 12
limit: 8
event_width: 220 # px; or "14rem", "50%"
entities:
  - entity: binary_sensor.frontdoor_contact
  - entity: person.tobi
```

A bare number is treated as px. A string with a unit is used as authored, so
`14rem` or `min(320px, 90%)` work too.

The width is a target, not a floor: where the card is too narrow to fit it, boxes
are capped at the space available — equally on every row, so they stay aligned.
Names that don't fit are still truncated with an ellipsis, and `allow_multiline` /
`force_multiline` still control wrapping within the box.

This works in all three `card_layout` modes, but how much room there is to work
with differs. In the default `center` layout each box lives in its own half of
the card, minus the gap to the centre line, so the usable width is roughly
`47% - 45px` — around 220px in a 560px-wide card. If the boxes come out narrower
than you asked for, that ceiling is why; `card_layout: left` or `right` puts the
line on one side and gives the boxes nearly the full card width.

<a id="mirrored-sides"></a>

### Mirrored sides

Every card is laid out left-to-right — icon, then text — whichever side of the
line it sits on. In the alternating `center` layout that makes the left-hand
column look detached from the line, and `event_width` makes it obvious: with a
fixed width, the content of a left-hand card is stranded at its far edge.

`mirror_sides: true` flips the cards left of the line into a mirror image of the
ones on the right — icon on the inner edge, text ranged towards the line:

```yaml
type: custom:timeline-card
hours: 12
limit: 8
event_width: 220
mirror_sides: true
entities:
  - entity: binary_sensor.frontdoor_contact
  - entity: person.tobi
```

```
   Front door  🚪  |  🙋  Tobi
        closed     |      home
```

The name still reads before the state — only the alignment flips, not the reading
order. Works with `allow_multiline` and `force_multiline`.

In `card_layout: right`, where every card sits left of the line, this mirrors all
of them. In `card_layout: left` there is nothing on that side, so it does nothing.

<a id="auto-refresh"></a>

### Auto-Refresh

You can enable an optional background refresh interval.  
The card will periodically re-fetch history data without reloading the UI.

```yaml
type: custom:timeline-card
hours: 6
limit: 8
refresh_interval: 30 # refresh every 30 seconds
entities:
  - entity: sensor.energy_usage
```

The refresh runs silently in the background and only updates the timeline if new events appear.

<a id="live-events-websocket"></a>

### Live Events (WebSocket)

The card listens to Home Assistant `state_changed` events via WebSockets.  
Any change of the configured entities is added to the timeline immediately - without refreshing the page.

**No configuration is required.**  
Live updates work automatically as soon as the card is loaded.

Features:

- Real-time updates for all configured entities
- Same formatting as history events (icons, colors, labels, localization)
- No full dashboard reload - only the timeline content is updated

---

<a id="restart-noise"></a>

### Restart noise

When Home Assistant restarts, every entity is re-added to the state machine and
re-announces the value it already had. Left alone, that paints the timeline with
a burst of events for things that never actually changed.

`collapse_duplicates` cannot remove this. A restart looks like:

```
off (10:00)  →  unavailable (12:00)  →  off (12:01)
```

Those are three _different_ consecutive states, so the duplicate collapser — which
only compresses consecutive runs of one value — never sees two adjacent `off`
entries to collapse.

A restart doesn't always leave that `unavailable` behind, either. On a clean
shutdown, an entity that doesn't publish availability records nothing at all, so
the history just gains a second identical row:

```
closed (09:00)  →  closed (12:00)
```

`ignore_unavailable` (on by default) handles both shapes. It drops
`unavailable`/`unknown` entries, drops a value that comes back unchanged on the
other side of such a gap, and drops any row that merely repeats the previous
value of the same entity. Both examples above collapse to a single event at the
original time. A value that genuinely changed while the entity was away is kept.

This mirrors Home Assistant's own logbook, which keeps a state row only when it
has a previous state _and_ differs from it. On live WebSocket events the card
applies that rule literally — an event with no `old_state`, or whose state
matches `old_state`, is never shown, since it reflects an entity appearing or an
attribute-only change rather than a real transition. The `history` API exposes no
`old_state`, so there the card applies the half it can check: a repeat of the
previous value is not a state change, whatever wrote it.

This is deliberately _not_ what `collapse_duplicates` does. That option is a
display preference about runs of real events, and it decides which end of a run
to keep — which is why it stays opt-in, and why turning it on is not a fix for
restart noise. Where a repeated value is concerned they overlap: with
`collapse_duplicates` on for an entity, its `collapse_duplicates_keep` setting
wins, so a run still resolves to your chosen end of it.

> **Trade-off:** with `ignore_unavailable` on, an entity that goes permanently
> unavailable (dead device, unplugged sensor) no longer shows that in the
> timeline. Set `ignore_unavailable: false` — globally or on that one entity — if
> you want availability changes to stay visible.

---

<a id="per-entity-configuration"></a>

## 🧩 Per-Entity Configuration

<a id="entity-example"></a>

### Example

```yaml
entities:
  - entity: binary_sensor.frontdoor_contact
    name: Front Door
    icon: mdi:door
    icon_color: '#ffcc00'
    state_color: '#00aaff'
    name_color: '#ffaa00'
    name_color_map:
      on: '#44ff44'
      off: '#ff4444'
    icon_color_map:
      on: '#ff4444'
      off: '#44ff44'
    icon_map:
      on: mdi:door-open
      off: mdi:door-closed
      default: mdi:door
    state_map:
      on: 'opened'
      off: 'closed'
    include_states:
      - on
      - off
```

<a id="entity-options"></a>

### Entity Options

| Option                     | Type    | Description                                                                                                                               |
| -------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | string  | Display name override                                                                                                                     |
| `icon`                     | string  | Static icon                                                                                                                               |
| `icon_map`                 | object  | State -> icon mapping                                                                                                                     |
| `icon_color`               | string  | Static icon color                                                                                                                         |
| `icon_color_map`           | object  | State -> color mapping                                                                                                                    |
| `state_map`                | object  | State -> label override                                                                                                                   |
| `include_states`           | list    | Only include events with these raw states                                                                                                 |
| `exclude_states`           | list    | Hide events with these raw states (alternative to `include_states`)                                                                       |
| `show_entity_picture`      | boolean | Show the entity picture instead of the icon when available                                                                                |
| `name_color`               | string  | Name color override (fallback: card -> theme)                                                                                             |
| `name_color_map`           | object  | Raw state -> name color mapping (fallback: entity name color -> card -> theme)                                                            |
| `state_color`              | string  | State color override (fallback: card -> theme)                                                                                            |
| `collapse_duplicates`      | boolean | Removes consecutive events with the same state for this entity only (overrides global setting).                                           |
| `collapse_duplicates_keep` | string  | Which event to keep when collapsing: `earliest` or `latest` (overrides global setting).                                                   |
| `ignore_unavailable`       | boolean | Hide `unavailable`/`unknown` events, restart artifacts and repeats of the previous value for this entity only (overrides global setting). |

---

<a id="examples"></a>

## 📌 Examples

<a id="presence-timeline"></a>

### Presence Timeline

```yaml
type: custom:timeline-card
title: Presence Timeline
hours: 24
limit: 10
relative_time: true
entities:
  - entity: person.tobi
    icon_map:
      home: mdi:home
      not_home: mdi:account-arrow-right
    state_map:
      home: 'at home'
      not_home: 'away'
```

<a id="door-monitoring"></a>

### Door Monitoring

```yaml
type: custom:timeline-card
title: Doors & Windows
hours: 6
limit: 12
show_states: true
entities:
  - entity: binary_sensor.frontdoor_contact
  - entity: binary_sensor.window_livingroom
```

<a id="timeline-card-as-popup-browser_mod"></a>

### Timeline Card as Popup (browser_mod)

You can use **hass-browser_mod (v2)** to open the Timeline Card in a popup instead of the default more-info dialog.

This is useful if you want a quick visual history on tap while keeping the standard more-info dialog available via hold or double-tap.

<details>
<summary><strong>Click to expand YAML example</strong></summary>

```yaml
- entity: binary_sensor.door_window_sensor_entrance_contact
  icon: mdi:door-open
  name: Main door
  tap_action:
    action: fire-dom-event
    browser_mod:
      service: browser_mod.popup
      data:
        content:
          type: custom:timeline-card
          title: Main door
          hours: 24
          limit: 12
          show_states: true
          show_names: false
          allow_multiline: true
          entities:
            - entity: binary_sensor.door_window_sensor_entrance_contact
              icon_color_map:
                'on': '#F08080'
                'off': '#77DD77'
              icon_map:
                'on': mdi:door-open
                'off': mdi:door-closed
              state_map:
                'on': opened
                'off': closed
              include_states:
                - 'on'
                - 'off'
              collapse_duplicates: true
  hold_action:
    action: more-info
  double_tap_action:
    action: more-info
```

</details>

---

<a id="locales"></a>

## 🌐 Locales

The card uses JSON-based localization.  
Available translations:

- English
- Czech
- German
- French
- Italian
- Dutch
- Polish
- Brazilian Portuguese
- Russian
- Swedish

---

<a id="license"></a>

## 📄 License

MIT License  
Free to use, free to modify.

Original work © 2025 Weedpump ([weedpump/timeline-card](https://github.com/weedpump/timeline-card)),
fork modifications © 2026 Controlá. See [LICENSE](LICENSE).
