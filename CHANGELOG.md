# Changelog

## Unreleased

- Fixed a restart repeat showing up as a new event when it was the first row in the window. The history response opens each entity with the value it carried into the window, and `stripUnavailableArtifacts()` uses that row to judge unavailable gaps — but consumes it, so the repeat check that runs next had no previous value for the first real row: a door that was `closed` going in and re-announced `closed` on a clean restart read as "Door: closed". The repeat check now starts from that carried-in value. Entities with `collapse_duplicates` on are unaffected, since their `collapse_duplicates_keep` decides repeats instead
- Fixed real events disappearing when `include_states`, `exclude_states`, `min_value` or `max_value` hid the rows between them. Restart filtering — dropping a row that repeats the entity's previous value — ran after those filters, so it compared each row with the previous one _left on screen_: with `include_states: [on]`, `off → on → off → on` read as `on → on` and lost every activation but the first, even with `collapse_duplicates` off. Restart filtering (unavailable gaps included) now runs first, on the full history, which is what `old_state` already gave the live path. `collapse_duplicates` keeps working on the filtered events, as it always has upstream: it's a display preference about what reads as a run on screen
- Fixed markup in Home Assistant values being rendered as HTML. The card builds its rows with `innerHTML`, and entity names, states, `state_map` labels, `extra_text`, Logbook messages and the values their placeholders pull in were all interpolated raw — so a `logbook.log` call or a text sensor carrying `<img src=x onerror=…>` ran in the dashboard. Every value that comes from an event (text, plus the entity id, icon and picture URL in attributes) is now escaped. Values written in the card's own config — `title`, colours — are still taken as authored. Labels were never documented to accept HTML, so no supported config changes appearance
- Fixed live `state_map` labels and `extra_text` retaining a referenced entity's previous value when its update arrives just after the event. Referenced state and attribute updates now recalculate recent live rows during the same 2-second margin, including Logbook extra text. Each row keeps its original attributes and other reference values; the next state change or Logbook entry of its own entity closes its update window.
- Fixed `{sensor.x}` placeholders on past events showing the referenced entity's previous value when it changed together with the event's own entity. Home Assistant writes a derived entity — a template sensor over a climate's `temperature` — a few milliseconds after the one it derives from, so a climate switching `off → heat` at 16 °C read `Heat - 25 °C` (Sercotel 204: climate at `22:58:16.822`, setpoint sensor at `22:58:16.825`). A referenced entity now counts as having its value at an event if it took it up to 2 s afterwards, for `state_map` labels, `extra_text` and Logbook entries alike — but never past the same entity's next row (state change or Logbook entry), so two events a second apart don't both read the second one's value. The margin lives in the lookup over the history response rather than in the config: it compensates for how HA orders writes, not for anything a dashboard author decides, and 2 s covers that ordering without reaching changes that belong to a later event. Referencing the event's own attribute (`{temperature}`) avoids the problem, but isn't a substitute: a recorder that excludes climate attributes leaves nothing to read
- Added `extra_text` (card-wide, overridable per entity) to draw a fourth line on each event, on top of the name, state and timestamp — for a climate row that should read the setpoint and the humidity it was at, not just `Cool`. It reuses the `{...}` placeholders and the point-in-time resolution the `state_map` labels already had, so referenced entities ride along on the same history request and each event resolves against the values of its own moment. It is deliberately not tied to the state, unlike a `state_map` entry: the line renders on every event rather than only on the states a map happens to name, so an open-ended state (a number, a text sensor) doesn't need one map entry per value to get one. Precedence is entity → card → none, resolved with `??` so an explicit `extra_text: ''` on an entity opts out of a card-wide default rather than inheriting it — YAML-only, since the visual editor's empty field means "inherit" (there's no third state to spend on an opt-out that a per-entity switch would need, and the same field is how you clear the key). No `show_extra` toggle was added to go with `show_names`/`show_states`/`show_icons`: the presence of `extra_text` is already the switch, and a fourth toggle would only add a way for the two to disagree. A template resolving to nothing — a sensor that's gone, an attribute the entity lacks — drops the line instead of drawing it blank, so an entity that only sometimes carries a value doesn't leave holes down one side of the timeline. Like a templated state label it never gets `unit_of_measurement` appended, since the template spells out its own units. `logbook.log` entries resolve it as well: their placeholders use the same history index at the entry timestamp (or current HA state for a live entry), so an automation can show the room temperature when it applied a setpoint
- `force_multiline` now gives **every** field its own line — name, state, extra line, timestamp — where it previously only pushed the state below the name. With two fields those were the same layout, so the only rows that change are ones using `extra_text`. Without it, the timestamp and the extra line share a row reading `time · extra` beneath `name · state`. That ordering is chosen in the renderer rather than with CSS `order`, because `allow_multiline` only wraps when it has to and `order` can't tell whether it wrapped — it would silently flip the reading order at whatever width the box happened to hit
- `overflow: collapse` (`visible_events`) now reveals events in pages instead of all at once: each "Show more" click adds another `visible_events` (fewer on the last click, if that's all that's left) instead of dumping every remaining fetched item into the DOM in one go. The button label is a plain "Show more"/"Show less" — it no longer states the batch size, so it reads the same on every click including a shorter last one. Fetching still happens once, up front, for the whole `hours` window — HA's `history/period` has no cursor, so splitting that fetch into growing time slices per click was evaluated and dropped: for a low-churn entity (needing most of the window to reach a page), each wider re-request re-downloads the earlier slice too, ending up costing more total data and round-trips than one request for the full window. Only what's revealed in the DOM is paged
- Fixed WebSocket event subscriptions not being released when a card is removed
  from a dashboard. `subscribeEvents()` returns its unsubscribe callback through
  a promise; the card now handles that API shape for both state and logbook
  listeners, preventing duplicate live rows and leaked listeners after
  dashboard navigation.
- Added `show_logbook_entries` (off by default, overridable per entity) to show custom events written by the `logbook.log` service. These were never showing up, and no filter was to blame: they aren't state changes, so the `history/period` API the card reads returns rows from the `states` table and never sees them, while the live path subscribes to `state_changed` and `logbook.log` fires `logbook_entry`. The card now also queries `logbook/get_events` over the WebSocket and subscribes to that second bus event, so entries appear immediately rather than waiting for `refresh_interval`. The entry's `message` becomes the row's secondary text — the same two rows a state change already draws, in their place in the timeline by when they happened, so nothing about the layout changes. The primary text resolves `name` (entity config) → the entry's own `name` → `friendly_name` → `entity_id`: `logbook.log` requires a `name` argument, so every entry carries one whether or not it was written with this card in mind, and letting it through would label the row differently from every state row of the same entity — breaking the column a reader uses to tell entities apart. Omitting `name` on the entity restores the entry speaking for itself. Only `logbook.log` entries are admitted: the logbook also records every automation and script firing ("triggered by state of …"), which would swamp the timeline, and HA marks those with a `source` field a `logbook.log` never has. The logbook is fetched in parallel with the history and failures are swallowed to `[]`, so an HA version without the command, or a disabled recorder, can't take the timeline down with it
- A logbook entry carries a message where a state would be, so every option that selects or renders on state is skipped for those rows: `include_states`/`exclude_states` (which would reject all of them outright, `null` matching no listed state), `min_value`/`max_value` (`parseFloat(null)` is `NaN`), `collapse_duplicates` (they all share `raw_state: null`, so a run of them would collapse to one and lose every message but the first — two `logbook.log` calls are two events, never duplicates) and `ignore_unavailable` (an entry can't be a restart artifact). `state_map`, `icon_map` and `icon_color_map` are keyed by state and equally inapplicable; the icon resolves `logbook_icon` → `icon` → `icon_map.default` → the entity's own icon → `mdi:message-text`. Resolving `icon_map` against the entity's _current_ state was rejected as it would label a past message with a value it never had — for the same reason the domain fallback is skipped, since it would return `mdi:eye-off` for a `binary_sensor`, reading as "off". Added `logbook_icon`/`logbook_icon_color` per entity for when these rows should stand out from the state changes around them
- `state_map` now accepts a `default` key that labels every state the map doesn't name, so an entity whose state is open-ended — a number, a text sensor, a PMS status code — no longer needs one line per possible value, and a value nobody anticipated still gets a readable label instead of falling back to the raw state. It's the same `default` key `icon_map` already used, resolved in the same order: exact state → `default` → locale table → raw state, so an exact entry always wins and the catch-all beats the locale table (it was written for this entity; the locale table wasn't). Combined with the `{...}` placeholders it becomes a template rather than a fixed word — `default: '{state} kWh'` — while a plain string collapses every value into one label for a timeline that only needs to say "something happened here". It labels, it doesn't filter: `include_states`/`exclude_states` still decide what reaches the timeline, off the raw state as before. The one thing it costs is an entity whose state is literally the word `default`, which can no longer be mapped exactly — the same trade-off `icon_map` has always made
- A `state_map` label written as an empty string now shows as blank instead of quietly falling through to the raw state, and no longer picks up the `unit_of_measurement` suffix on the way out (which would have rendered a bare `" °C"`). A key with no value at all (`off:` in YAML, which parses as null) still falls through, since that's a half-written config rather than a request for a blank label
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
