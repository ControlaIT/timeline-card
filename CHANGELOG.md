# Changelog

## Unreleased

- `show_names`, `show_states` and `show_icons` can now be set per entity, overriding the card-wide setting — for "show everything, except don't bother with the state of this one". Omitting the key inherits, which is not the same as `false`, so the resolution uses `??` rather than `||`. In the UI editor these are a three-way choice (Inherit from card / Show / Hide) instead of the switch used elsewhere: they default to on, so an unset switch would render as off and claim the opposite of what's actually on screen, with no way back to inheriting once toggled. Hiding the name still promotes the state to the primary line, as it already did card-wide
- `state_map` labels can now interpolate live values with `{...}` placeholders instead of being fixed strings: `{temperature}` for the entity's own attribute, `{sensor.x}` for another entity's state, `{sensor.x.humidity}` for another entity's attribute, and `{state}` for the raw state — so a climate event can read `Cool 24°C` rather than just `Cool`. Every value is resolved **at the moment of the event**, not the current one: referenced entities ride along on the existing history request (no extra round trip) and are looked up at each event's own timestamp by binary search, while live events read from `hass.states`, which for an event that just happened is the same thing. They don't get timeline rows of their own. This is deliberately not Jinja — Home Assistant's template engine only knows the present, with no way to render "as of 10:11", so a template on a past event would quietly report today's value; the trade-off is no filters or arithmetic, and numbers render exactly as HA reports them (`24.0`, not `24`). A templated label also suppresses the automatic `unit_of_measurement` suffix, since the label already spells out its own formatting — otherwise `'{state} grados'` on a °C sensor would read `23 grados °C`. Filters, colors and icons continue to work off the raw state, not the rendered label
- Added `tap_action`, using Home Assistant's standard action config, so clicking an event can do something other than open its more-info dialog — `navigate`, `url`, `perform-action` (and the older `call-service` spelling), `toggle`, `assist`, `fire-dom-event` or `none`, all with optional `confirmation` and `exemptions`. The card previously fired `hass-more-info` unconditionally, which stays the default. The frontend's own `handleAction()` isn't reachable from a custom card and the `custom-card-helpers` package predates both `perform-action` and `assist`, so the dispatch is implemented here against the same DOM events and `hass` calls; the config schema and the editor's action picker (HA's `ui_action` selector) are the stock ones. Two things a custom card can't reach into the frontend for: `confirmation` falls back to the browser's native confirm dialog rather than HA's styled one, and `assist` relies on the voice dialog already having been loaded, since built-in cards pass an import for it that a custom card has no way to supply. Card-level only — there is no per-entity override
- Added `mirror_sides` option to flip the cards sitting left of the timeline line into a mirror image of the ones on the right — icon on the inner edge, text ranged towards the line — instead of laying every card out left-to-right regardless of its side. Most visible together with `event_width`, where a fixed width otherwise leaves the content of the left-hand column stranded at its far edge. Only the alignment flips, not the reading order: the name still comes before the state. In `card_layout: right` every card sits left of the line, so all of them mirror; in `card_layout: left` nothing does
- Added `event_width` option to give every event card the same width instead of letting each one size to its own entity name, which left the timeline as a ragged column of different-sized boxes. A bare number is px, a string with a unit is used as authored. The width is a target rather than a floor: where the card is too narrow to fit it, boxes are capped at the space available, equally on every row. In `left`/`right` layouts, where the card already measured the widest event and matched the rest to it, an explicit `event_width` replaces that measurement
- Added `group_by_day` option to split the timeline into one independent segment per calendar day, each with its own "Today"/"Yesterday"/weekday header and its own line, instead of one continuous line across the whole history window. The header aligns to the timeline line rather than always to the left: centred on it in `card_layout: center`, and ranged to the line's side in `left`/`right`. In those two layouts the wrapper is only as wide as its content and centres itself, so the line isn't at a fixed offset within the card — the day group is shrunk to the wrapper and the header stretched back across it, keeping the header's own text out of that measurement so a long date can't widen the group and push the line off to the side
- Fixed `setConfig` silently accepting a missing `hours`/`limit` (both documented as required) — it now throws a clear, visible error immediately instead of leaving the card permanently blank from an uncaught rejection deep in the history-fetch promise chain
- Fixed `collapse_duplicates` not catching Home Assistant restart/reconnect artifacts (an entity re-announcing its unchanged state with `old_state: null` right after `hass` reconnects). Live `state_changed` events start flowing as soon as the card connects, but the initial history fetch that populates `this.items` (what `collapse_duplicates` compares against) is async and can still be pending — normally a tiny window, but it widens a lot right after a full HA restart, which is exactly when every entity re-announces itself at once. Live events arriving before history has loaded are now buffered and replayed once it has, so the dedup check always has real data to compare against
- Added `ignore_unavailable` option (**on by default**, overridable per entity) to stop the timeline filling with events for entities that never actually changed when Home Assistant restarts. `collapse_duplicates` was structurally unable to remove these: a restart reads as `off → unavailable → off`, and since the collapser only compresses consecutive runs of one value, the `unavailable` in the middle breaks the run and all three entries survive. The new option drops `unavailable`/`unknown` entries and any value that returns unchanged on the other side of such a gap, while keeping a value that genuinely changed while the entity was away. The same gap tracking runs on the live WebSocket path, so a device that merely drops off and recovers with the same value — a connection blip, an integration reload that keeps the entity registered — doesn't produce a spurious entry either, even though every event in that sequence carries a real `old_state`. Note the trade-off: an entity going permanently unavailable no longer shows up either — set `ignore_unavailable: false` on that entity to keep it visible
- Fixed restart noise still reaching the timeline when the restart left no `unavailable` row behind at all. On a clean shutdown an entity that doesn't publish availability records nothing, so the history simply gains a second identical row (`closed (09:00) → closed (12:00)`) with no gap for the filter above to recognise — surfacing as a phantom event for a door that never opened. History now applies the half of the logbook rule the REST API allows (`States.state != OLD_STATE.state`): a row repeating the previous value of the same entity is not a state change, whatever wrote it, and is dropped under the same `ignore_unavailable` switch. This is intentionally not delegated to `collapse_duplicates` — that option is a display preference about runs of real events, opt-in and off by default, so it was never going to filter restart artifacts; where the two overlap, an entity's `collapse_duplicates_keep` setting still decides which end of a run survives
- Live `state_changed` events are now filtered exactly like Home Assistant's own logbook does (`components/logbook/queries/common.py` keeps a row only when `OLD_STATE.state_id IS NOT NULL AND States.state != OLD_STATE.state`): events with no `old_state` — an entity being added to the state machine, i.e. every entity during a restart or integration reload — and events whose state equals `old_state` (attribute-only changes) are no longer shown. The card previously discarded `old_state` entirely and never inspected it

## v1.11.0

- Added Dutch translations by **@VGrol**, Thank you!
- Added per-entity `name_color_map` option to set the displayed entity name color based on the raw state
- Fixed missing text fields in the Home Assistant UI editor by replacing internal `ha-textfield` usage with native inputs

## v1.10.0

- Added Polish translations by **@Bagerian**, Thank you!
- Added `collapse_duplicates_keep` option (`earliest` / `latest`) to control which event is kept when collapsing duplicate states — configurable globally and per entity

## v1.9.0

- Added Czech translations by **@trigger737**, Thank you!

## v1.8.1

- Fixed event tile hover highlight not visible in light mode

## v1.8.0

- Added Russian translations by **@kai-zer-ru**, Thank you!
- Editor: migrated language, overflow, and card layout dropdowns to `ha-selector` for compatibility with the new Home Assistant UI by **@kai-zer-ru**
- Editor: fixed entity picker compatibility with updated Home Assistant selector event format by **@kai-zer-ru**
- Editor: fixed language selector not allowing "Auto" to be re-selected after a language was chosen
- Added `min_value` and `max_value` per-entity options to filter events by numeric state (e.g. only show sensor readings ≥ 50 or ≤ 21); non-numeric states are excluded when a value filter is active
- Added default icons for `input_text`, `input_boolean`, `input_number`, `input_select`, `automation`, and `script` domains
- Clicking an event tile now opens the More Info dialog for that entity

## v1.7.0

- **Fixed & Improved `collapse_duplicates`:**
  - Logic updated to track states separately per entity, fixing issues where interleaved events from other entities broke the collapsing.
  - Changed behavior to keep the **earliest** event (start time) of a duplicate sequence instead of the latest.
- Added Italian translations by **@gcosta74**, Thank you!

## v1.6.0

- Fixed: card_mod compatibility and localize empty state message by **@kvanzuijlen**, Thank you!
- Added Swedish translations by **@naitkris**, Thank you!
- Added card option `card_background` to set background color
- Added card options `timeline_color_start`, `timeline_color_end`, `dot_color` to set timeline & dots color
- Added entity option `show_entity_picture` to show the entity picture instead of icon if available
- Added transparency slider to all color pickers

## v1.5.1

- Resolved a CustomElementRegistry conflict with the LLM Vision Card by
  renaming the internal editor element to a unique identifier.
  This prevents the Timeline Card from failing to load when both cards
  are installed.

## v1.5.0

- fixed z-state: the dots of the TimelineCard are no longer displayed above other cards/windows
- Added a card-level `show_date` option (YAML + UI) to hide the date portion and display time only on event tiles.

## v1.4.1

- Left/right layouts now center the timeline line and tiles as a single block.

## v1.4.0

- Added card option `force_multiline` to always place the state below the name.
- Added `card_layout` with `center` (default), `left`, and `right` single-sided timeline layouts using consistent card widths.
- UI editor: reorganized card settings sections and now only show relevant options (visible events for collapse, max height for scroll) with clearer compact layout hint.

## v1.3.1

- Added missing translations for the collapse button.

## v1.3.0

### 🎉 The Card is now fully configurable via the Home Assistant UI editor

### Changes in this release:

- New overflow handling: show only the first N events, collapse the rest behind a toggle or switch to a scrollable container.
- Added compact layout option to reduce vertical spacing.
- Added en-US and en-GB locale files and improved German time suffixes.
- Entity filtering extended with `exclude_states`; states can now show `attributes.unit_of_measurement` suffixes.
- Docs: new browser_mod v2 popup example and refreshed README.

## v1.2.0

- Brazilian Portuguese translations added by **@Bsector**, Thanks!
- Added support for collapsing consecutive duplicate events in history and live updates.

## v1.1.1

- Fix: Add include_states filtering for live WebSocket events
- Fix: Safe-check liveUnsub to avoid errors in HA editor mode
- Fix: Lowercase states when names are displayed

## v1.1.0

- French translations added by **@bsdev90**, Thanks!
- Display the state in the style of the name if `show_names: false` is set
- Added Options `name_color:` and `state_color:` Defineable card wide or per entity.
- Register card in Home Assistant card picker

## v1.0.1

- fixed styling in light mode
- automatic multiline wrapping for long names/states via Card Option `allow_multiline: true/false`
- shortening overly long states

## v1.0.0

### Changes in this release:

- ### Live updates via WebSocket — timeline updates instantly without page refresh:

  The card listens to Home Assistant’s state_changed events via WebSockets.

  Any change of the configured entities is added to the timeline immediately — without refreshing the page.

  **No configuration is required.**

  Live updates work automatically as soon as the card is loaded.

- ### Auto Refresh

  Auto Refresh interval in seconds via YAML option `refresh_interval: 60`

  You can enable an optional background refresh interval.

  The card will periodically re-fetch history data without reloading the UI.

## v0.3.0

- added HACS validation Workflow

## v0.2.0

- Added german and english translations

## v0.1.1

- github actions
