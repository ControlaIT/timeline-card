import cs from './locales/cs.json';
import de from './locales/de.json';
import enGB from './locales/en-GB.json';
import enUS from './locales/en-US.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import nl from './locales/nl.json';
import pl from './locales/pl.json';
import ptBR from './locales/pt-BR.json';
import ru from './locales/ru.json';
import sv from './locales/sv.json';
import styles from './timeline-card.css';

import './editor/timeline-card-editor.js';

import { TranslationEngine } from './translation-engine.js';
import { relativeTime, formatAbsoluteTime } from './time-engine.js';

import { fetchHistory } from './history-fetch.js';
import { transformHistory } from './history-transform.js';
import { buildHistoryIndex } from './history-index.js';
import { collectReferencedEntities } from './placeholder-engine.js';
import { filterHistory, passesValueFilter } from './history-filter.js';

import { getCachedHistory, setCachedHistory } from './history-cache.js';

// Unified state transformer for both history + live
import { transformState } from './state-transform.js';
import { resolveStateMappedColor } from './color-engine.js';
import {
  createUnavailableGapTracker,
  shouldIgnoreUnavailable,
} from './availability-filter.js';
import {
  groupItemsByDay,
  formatDayLabel,
  formatDayDate,
} from './day-engine.js';
import { toCssLength } from './config-engine.js';
import { handleTapAction, resolveActionConfig } from './action-engine.js';

const translations = {
  cs,
  de,
  'en-gb': enGB,
  'en-us': enUS,
  fr,
  it,
  nl,
  pl,
  'pt-br': ptBR,
  ru,
  sv,
};

class TimelineCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('weedpump-timeline-card-editor');
  }

  static getStubConfig() {
    return {
      type: 'custom:timeline-card',
      title: 'Timeline',
      hours: 6,
      limit: 10,
      relative_time: true,
      show_names: true,
      show_states: true,
      show_icons: true,
      entities: [],
    };
  }

  setConfig(config) {
    if (!config.entities || !Array.isArray(config.entities)) {
      throw new Error("Please define 'entities' as a list.");
    }

    // 'hours'/'limit' are documented as required but were never actually
    // validated — omitting either used to fail silently later (an uncaught
    // rejection deep in the fetchHistory() promise chain, since `hours`
    // being undefined makes `new Date(...)` produce an Invalid Date, and
    // `.toISOString()` on that throws). Fail fast and visibly instead, same
    // as the entities check above.
    if (typeof config.hours !== 'number' || !(config.hours > 0)) {
      throw new Error(
        "timeline-card: 'hours' is required and must be a positive number."
      );
    }
    if (
      typeof config.limit !== 'number' ||
      !Number.isInteger(config.limit) ||
      config.limit <= 0
    ) {
      throw new Error(
        "timeline-card: 'limit' is required and must be a positive integer."
      );
    }

    this.entities = config.entities.map((e) =>
      typeof e === 'string'
        ? { entity: e }
        : {
            ...e,
            name_color: e.name_color || null,
            state_color: e.state_color || null,
          }
    );

    // Prevent conflicting filters on entity level
    for (const ent of this.entities) {
      const include = Array.isArray(ent.include_states)
        ? ent.include_states
        : [];
      const exclude = Array.isArray(ent.exclude_states)
        ? ent.exclude_states
        : [];

      if (include.length > 0 && exclude.length > 0) {
        throw new Error(
          `timeline-card: Entity "${ent.entity}" cannot use include_states and exclude_states simultaneously.`
        );
      }
    }

    this.limit = config.limit;
    this.hours = config.hours;
    this.title = typeof config.title === 'string' ? config.title : '';

    this.relativeTimeEnabled = config.relative_time ?? false;
    this.showDate = config.show_date ?? true;
    this.groupByDay = config.group_by_day ?? false;
    this.showStates = config.show_states ?? true;
    this.showNames = config.show_names ?? true;
    this.showIcons = config.show_icons ?? true;

    this.allowMultiline = config.allow_multiline ?? false;
    this.forceMultiline = config.force_multiline ?? false;
    this.compactLayout = config.compact_layout ?? false;
    // Mirror the boxes sitting left of the line, so each side leans towards it.
    // A no-op in `card_layout: left`, which has nothing on that side.
    this.mirrorSides = config.mirror_sides ?? false;
    const layout = (config.card_layout || 'center').toLowerCase();
    this.cardLayout = ['center', 'left', 'right'].includes(layout)
      ? layout
      : 'center';

    // Fixed width for every event box, so rows don't each size to their own
    // entity name. Applied as a CSS var on the host; in single-sided layouts the
    // grid column carries it instead — see applySingleSideWidth().
    this.eventWidth = toCssLength(config.event_width);

    // Entities referenced by `state_map` labels but not shown themselves. They
    // ride along on the history request so their values can be resolved at each
    // event's point in time.
    this.referencedEntities = collectReferencedEntities(this.entities);

    // What clicking an event does. Defaults to `more-info`, which is what the
    // card did unconditionally before this was configurable.
    this.tapAction = resolveActionConfig(config.tap_action);

    this.cardBackground = config.card_background ?? null;
    this.timelineLineStart = config.timeline_color_start ?? null;
    this.timelineLineEnd = config.timeline_color_end ?? null;
    this.dotColor = config.dot_color ?? null;

    if (this.compactLayout && this.cardLayout !== 'center') {
      throw new Error(
        'timeline-card: compact_layout is only supported with card_layout: center.'
      );
    }

    // NEW: global colors
    this.nameColor = config.name_color || null;
    this.stateColor = config.state_color || null;

    // Overflow handling
    const visibleRaw = config.visible_events;
    const visibleParsed =
      typeof visibleRaw === 'string' ? parseInt(visibleRaw, 10) : visibleRaw;
    this.visibleEventCount =
      Number.isInteger(visibleParsed) && visibleParsed > 0
        ? visibleParsed
        : null;
    const overflow = (config.overflow || 'collapse').toLowerCase();
    this.overflowMode = overflow === 'scroll' ? 'scroll' : 'collapse';
    this.maxHeight = toCssLength(config.max_height);
    this.expanded = false;

    this.refreshInterval = config.refresh_interval || null;
    this.refreshTimer = null;
    this.singleSideWidth = null;
    this.singleSideLayout = null;
    this.singleSideSignature = null;

    this.liveUnsub = null;

    this.items = [];
    this.loaded = false;
    this.config = config;

    // Live events can start arriving (via startLiveEvents(), triggered by the
    // very first `hass` setter call) before the initial history fetch has
    // populated `this.items` — the two are not sequenced. Normally this race
    // window is tiny, but right after an HA restart/reconnect it widens a lot
    // (every client's websocket reconnects at once, HA is under load, and the
    // REST history call can be delayed while live `state_changed` events keep
    // flowing) — and that's exactly when HA re-announces every entity's state
    // (`old_state: null`) as it rebuilds its state machine, even for entities
    // whose value didn't actually change. `collapse_duplicates` compares a
    // live event's `raw_state` against `this.items`, so with `this.items`
    // still empty at that point there's nothing to compare against and the
    // restart artifact slips through undeduped. Buffer live events until the
    // first history load (cache or network) has populated `this.items`, then
    // replay them through the normal path so the dedup check has real data.
    this._historyReady = false;
    this._pendingLiveEvents = [];

    // Per-entity memory of the value held before an unavailable/unknown gap,
    // so the live path can recognise an unchanged value coming back the same
    // way stripUnavailableArtifacts() does for history.
    this._liveGaps = createUnavailableGapTracker();

    this._applyThemeVars();
  }

  connectedCallback() {
    // Ensure structure exists immediately so card_mod can attach
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
    this.ensureCardExists();
  }

  ensureCardExists() {
    const root = this.shadowRoot;
    if (!root.querySelector('style')) {
      const styleEl = document.createElement('style');
      styleEl.textContent = styles;
      root.appendChild(styleEl);
    }
    if (!root.querySelector('ha-card')) {
      const card = document.createElement('ha-card');
      root.appendChild(card);
    }
  }

  _applyThemeVars() {
    this._setStyleVar('--tc-line-start', this.timelineLineStart);
    this._setStyleVar('--tc-line-end', this.timelineLineEnd);
    this._setStyleVar('--tc-dot-color', this.dotColor);
    this._setStyleVar('--tc-event-width', this.eventWidth);
  }

  _setStyleVar(name, value) {
    if (value) {
      this.style.setProperty(name, value);
    } else {
      this.style.removeProperty(name);
    }
  }

  set hass(hass) {
    this.hassInst = hass;

    if (!this.loaded) {
      this.loaded = true;

      const yamlLang = this.config.language;
      const haLang = hass?.locale?.language;
      const browserLang = navigator.language;

      this.language = yamlLang || haLang || browserLang || 'en-US';

      this.i18n = new TranslationEngine(translations);

      this.i18n.load(this.language).then(() => {
        // Keep the full normalized language code so region-specific formats work.
        this.languageCode = this.i18n.langCode || this.language.toLowerCase();
        this.loadHistory();

        if (this.refreshInterval && !this.refreshTimer) {
          this.startAutoRefresh();
        }
      });
    }

    if (this.hassInst?.connection && !this.liveUnsub) {
      this.startLiveEvents();
    }
  }

  async loadHistory() {
    const cached = getCachedHistory(
      this.entities,
      this.hours,
      this.languageCode,
      this.config
    );

    if (cached) {
      this.items = cached;
      this.render();
      this._markHistoryReady();
      this.refreshInBackground();
      return;
    }

    await this.refreshInForeground();
  }

  async refreshInForeground() {
    const raw = await fetchHistory(
      this.hassInst,
      this.entities,
      this.hours,
      this.referencedEntities
    );

    // Built from the raw response so referenced entities can be read at each
    // event's own timestamp rather than as they are now.
    const index = buildHistoryIndex(raw.data);

    const flat = transformHistory(
      raw,
      this.entities,
      this.hassInst.states,
      this.i18n,
      index
    );

    const items = filterHistory(
      flat,
      this.entities,
      this.limit,
      this.config // includes collapse_duplicates
    );

    setCachedHistory(
      this.entities,
      this.hours,
      this.languageCode,
      items,
      this.config
    );

    this.items = items;
    this.render();
    this._markHistoryReady();
  }

  // Marks the initial history load as complete and replays any live events
  // that arrived while `this.items` was still empty/stale, through the same
  // processLiveEvent() path used for events arriving after this point — so
  // collapse_duplicates (and any other this.items-dependent logic) sees them
  // in the same order they actually happened, compared against real data.
  _markHistoryReady() {
    if (this._historyReady) return;
    this._historyReady = true;

    const pending = this._pendingLiveEvents;
    this._pendingLiveEvents = [];
    for (const data of pending) {
      this.processLiveEvent(data);
    }
  }

  async refreshInBackground() {
    const raw = await fetchHistory(
      this.hassInst,
      this.entities,
      this.hours,
      this.referencedEntities
    );

    // Built from the raw response so referenced entities can be read at each
    // event's own timestamp rather than as they are now.
    const index = buildHistoryIndex(raw.data);

    const flat = transformHistory(
      raw,
      this.entities,
      this.hassInst.states,
      this.i18n,
      index
    );

    const items = filterHistory(
      flat,
      this.entities,
      this.limit,
      this.config // includes collapse_duplicates
    );

    if (JSON.stringify(items) === JSON.stringify(this.items)) return;

    setCachedHistory(
      this.entities,
      this.hours,
      this.languageCode,
      items,
      this.config
    );

    this.items = items;
    this.render();
  }

  startAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);

    this.refreshTimer = setInterval(() => {
      this.refreshInBackground();
    }, this.refreshInterval * 1000);
  }

  startLiveEvents() {
    const entityIds = this.entities.map((e) => e.entity);

    this.liveUnsub = this.hassInst.connection.subscribeEvents((msg) => {
      const data = msg?.data;
      if (!data?.entity_id) return;
      if (!entityIds.includes(data.entity_id)) return;

      if (!this._historyReady) {
        this._pendingLiveEvents.push(data);
        return;
      }

      this.processLiveEvent(data);
    }, 'state_changed');
  }

  processLiveEvent(data) {
    const entityId = data.entity_id;
    const newState = data.new_state;

    const cfg = this.entities.find((e) => e.entity === entityId);

    // --- HA logbook parity (components/logbook/queries/common.py) ---
    // The logbook keeps a state row only when
    //   OLD_STATE.state_id IS NOT NULL AND States.state != OLD_STATE.state
    // Unlike the history REST API, a live `state_changed` event carries
    // `old_state`, so both halves of that rule can be applied verbatim.
    //
    // No old_state means the entity was just added to the state machine
    // rather than changed — which is precisely what every entity looks like
    // while HA rebuilds its state machine after a restart or an integration
    // reload. Same state on both sides means only attributes moved.
    if (!data.old_state) return;
    if (data.old_state.state === newState?.state) return;

    // Going (or coming back) unavailable is the other half of the restart
    // churn; the history path strips it in stripUnavailableArtifacts().
    if (
      shouldIgnoreUnavailable(cfg, this.config) &&
      !this._liveGaps.keep(entityId, data.old_state.state, newState?.state)
    ) {
      return;
    }
    // ----------------------------------------------------------------

    // --- include/exclude filter for LIVE EVENTS ---
    const include = Array.isArray(cfg?.include_states)
      ? cfg.include_states
      : null;
    const exclude = Array.isArray(cfg?.exclude_states)
      ? cfg.exclude_states
      : null;

    if (include && !include.includes(newState.state)) {
      return; // ignore this live event (not in include list)
    }
    if (exclude && exclude.includes(newState.state)) {
      return; // ignore this live event (blocked by exclude list)
    }
    if (!passesValueFilter(newState.state, cfg)) {
      return; // ignore this live event (outside min_value/max_value range)
    }
    // ---------------------------------------------

    const item = transformState(
      entityId,
      newState,
      this.hassInst,
      this.entities,
      this.i18n
    );

    if (!item) return;

    // --- NEW: collapse duplicates for LIVE events ---
    const collapse =
      cfg?.collapse_duplicates ?? this.config.collapse_duplicates ?? false;

    if (collapse) {
      const last = this.items.find((i) => i.id === item.id);
      if (last && last.raw_state === item.raw_state) {
        return; // ignore duplicate
      }
    }
    // -------------------------------------------------

    // Insert new event at the top
    this.items.unshift(item);

    // Limit size
    if (this.limit && this.items.length > this.limit) {
      this.items = this.items.slice(0, this.limit);
    }

    this.render();
  }

  disconnectedCallback() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (typeof this.liveUnsub === 'function') {
      this.liveUnsub();
    }
    this.liveUnsub = null;
  }

  // ------------------------------------
  // Helper: Capitalize state string
  // ------------------------------------
  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // ------------------------------------
  // RENDER CARD
  // ------------------------------------
  render() {
    // Check if we already have a shadow root
    let root = this.shadowRoot;

    // If not, create it
    if (!root) {
      root = this.attachShadow({ mode: 'open' });
    }

    // Ensure card exists
    this.ensureCardExists();
    let card = root.querySelector('ha-card');

    if (this.cardBackground) {
      card.style.background = this.cardBackground;
    } else {
      card.style.removeProperty('background');
    }

    if (!this.items.length) {
      card.innerHTML = `
          <div style="padding:12px">${this.i18n.t('ui.no_events')}</div>
      `;
      return;
    }

    const overflowMode = this.overflowMode === 'scroll' ? 'scroll' : 'collapse';
    const hasVisibleLimit =
      overflowMode === 'collapse' &&
      Number.isInteger(this.visibleEventCount) &&
      this.visibleEventCount > 0;
    const visibleLimit = hasVisibleLimit ? this.visibleEventCount : null;

    const shouldCollapse =
      overflowMode === 'collapse' &&
      visibleLimit !== null &&
      !this.expanded &&
      this.items.length > visibleLimit;

    const hiddenCount =
      overflowMode === 'collapse' && visibleLimit
        ? Math.max(this.items.length - visibleLimit, 0)
        : 0;

    const eventBoxClassName = [
      'event-box',
      this.allowMultiline ? 'auto-multiline' : '',
      this.forceMultiline ? 'force-multiline' : '',
      // Don't advertise a click that does nothing.
      this.tapAction.action === 'none' ? 'no-action' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const renderedItems = shouldCollapse
      ? this.items.slice(0, visibleLimit)
      : this.items;

    const layout =
      ['center', 'left', 'right'].includes(this.cardLayout) && this.cardLayout
        ? this.cardLayout
        : 'center';
    const compactClass =
      this.compactLayout && layout === 'center' ? 'compact' : '';
    const mirrorClass = this.mirrorSides ? 'mirror' : '';

    const renderRow = (item, index) => {
      const side =
        layout === 'center'
          ? index % 2 === 0
            ? 'left'
            : 'right'
          : layout === 'left'
            ? 'right'
            : 'left';

      const entityCfg = item.entityCfg || {};
      const entityPicture = item.entity_picture;
      const showEntityPicture =
        this.showIcons && entityCfg.show_entity_picture && entityPicture;

      // COLOR RESOLUTION: entity state map → entity → card → theme/css
      const nameColor = resolveStateMappedColor(
        item.raw_state,
        entityCfg.name_color_map,
        entityCfg.name_color,
        this.nameColor
      );
      const stateColor = entityCfg.state_color || this.stateColor || '';

      const renderEventBox = () => `
        <div class="${eventBoxClassName}" data-entity-id="${item.id}">
          ${
            this.showIcons
              ? showEntityPicture
                ? `<img class="entity-picture" src="${entityPicture}" alt="">`
                : `<ha-icon icon="${item.icon}" style="color:${item.icon_color};"></ha-icon>`
              : ``
          }
          <div class="text">
            <div class="row">
              ${
                this.showNames
                  ? `<div class="primary-text name" style="${
                      nameColor ? `color:${nameColor};` : ''
                    }">${item.name}</div>`
                  : ``
              }
              ${
                this.showStates
                  ? this.showNames
                    ? `<div class="secondary-text state" style="${
                        stateColor ? `color:${stateColor};` : ''
                      }">${item.state}</div>`
                    : `<div class="primary-text state" style="${
                        stateColor ? `color:${stateColor};` : ''
                      }">${this.capitalize(item.state)}</div>`
                  : ``
              }
            </div>
            <div class="time">
              ${
                this.relativeTimeEnabled
                  ? relativeTime(item.time, this.i18n)
                  : formatAbsoluteTime(
                      item.time,
                      this.languageCode,
                      this.i18n,
                      { includeDate: this.showDate }
                    )
              }
            </div>
          </div>
        </div>
      `;

      return `
        <div class="timeline-row">
          <div class="side left">
            ${side === 'left' ? renderEventBox() : ''}
          </div>

          <div class="dot"></div>

          <div class="side right">
            ${side === 'right' ? renderEventBox() : ''}
          </div>
        </div>
      `;
    };

    // Each "wrapper" owns its own timeline line — when grouping by day,
    // every day gets an independent line/dot sequence instead of one
    // continuous line spanning the whole history window.
    const renderWrapper = (items) => `
      <div class="wrapper ${compactClass} ${mirrorClass} layout-${layout}">
        <div class="timeline-line"></div>
        ${items.map((item, index) => renderRow(item, index)).join('')}
      </div>
    `;

    const rows = this.groupByDay
      ? groupItemsByDay(renderedItems)
          .map(
            (group) => `
              <div class="day-group layout-${layout}">
                <div class="day-header">
                  <span class="day-header-relative">${formatDayLabel(group.date, this.i18n, this.languageCode)}</span>
                  <span class="day-header-date">${formatDayDate(group.date, this.i18n, this.languageCode)}</span>
                </div>
                ${renderWrapper(group.items)}
              </div>
            `
          )
          .join('')
      : renderWrapper(renderedItems);

    const containerStyles = [];
    if (this.maxHeight) {
      containerStyles.push(`max-height:${this.maxHeight};`);
    }
    if (overflowMode === 'scroll' || containerStyles.length) {
      containerStyles.push('overflow-y:auto;');
    }
    const containerStyle = containerStyles.join('');

    const collapseToggle =
      overflowMode === 'collapse' && hiddenCount > 0
        ? `
          <div class="toggle-row">
            <button class="toggle-button" type="button" id="tc-toggle-hidden" aria-expanded="${this.expanded}">
              ${
                this.expanded
                  ? this.i18n.t('ui.show_less')
                  : this.i18n.t('ui.show_more', { n: hiddenCount })
              }
            </button>
          </div>
        `
        : '';

    card.innerHTML = `
        ${this.title ? `<h1 class="card-title">${this.title}</h1>` : ''}
        <div class="timeline-container ${
          overflowMode === 'scroll' ? 'scrollable' : ''
        }" style="${containerStyle}">
          ${rows}
        </div>
        ${collapseToggle}
    `;

    const toggleBtn = root.getElementById('tc-toggle-hidden');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.expanded = !this.expanded;
        this.render();
      });
    }

    root.querySelectorAll('.event-box[data-entity-id]').forEach((el) => {
      el.addEventListener('click', () => {
        handleTapAction({
          config: this.tapAction,
          node: this,
          hass: this.hassInst,
          entityId: el.dataset.entityId,
        });
      });
    });

    // Ensure single-sided layouts share the same card width (widest card)
    this.applySingleSideWidth(root, layout);
  }

  getCardSize() {
    return this.visibleEventCount || this.limit || 3;
  }

  applySingleSideWidth(root, layout) {
    if (layout === 'center') {
      this.singleSideWidth = null;
      this.singleSideLayout = null;
      this.singleSideSignature = null;
      return;
    }

    // With `group_by_day` there's one `.wrapper` per day instead of a single
    // one for the whole card — measure across all of them and apply the same
    // shared width to each, so single-sided columns stay aligned across day
    // groups instead of each day sizing independently.
    const wrappers = Array.from(root.querySelectorAll('.wrapper'));
    if (!wrappers.length) return;

    // An explicit `event_width` is the whole point of measuring — every box the
    // same width — so honour it directly and skip the measuring pass. Here the
    // grid column has to carry it, not the box: `.wrapper.layout-* .event-box`
    // is `width: 100%` and outranks the `--tc-event-width` declaration.
    if (this.eventWidth) {
      this.singleSideWidth = null;
      this.singleSideLayout = layout;
      this.singleSideSignature = null;
      wrappers.forEach((w) =>
        w.style.setProperty('--tc-event-col-width', this.eventWidth)
      );
      return;
    }

    const measure = () => {
      const signature = `${layout}-${this.allowMultiline}-${this.forceMultiline}`;
      if (this.singleSideSignature !== signature) {
        wrappers.forEach((w) => w.style.removeProperty('--tc-event-col-width'));
        this.singleSideWidth = null;
        this.singleSideLayout = layout;
        this.singleSideSignature = signature;
      }

      const boxes = wrappers.flatMap((w) =>
        Array.from(w.querySelectorAll('.event-box'))
      );
      if (!boxes.length) return;

      const wrapperRect = wrappers[0].getBoundingClientRect();
      const lineColRaw = getComputedStyle(wrappers[0]).getPropertyValue(
        '--tc-line-column'
      );
      const lineCol = parseFloat(lineColRaw) || 0;
      const gap = 16; // column-gap defined in CSS
      const maxAvailable = Math.max(wrapperRect.width - lineCol - gap, 0);

      const max = boxes.reduce((acc, box) => {
        const isForce = box.classList.contains('force-multiline');

        const prevWidthBox = box.style.width;
        const prevMaxWidth = box.style.maxWidth;
        box.style.width = isForce ? 'min-content' : 'max-content';
        box.style.maxWidth = 'none';

        const natural = Math.ceil(box.scrollWidth + 8); // small buffer for font/layout shifts

        box.style.width = prevWidthBox;
        box.style.maxWidth = prevMaxWidth;

        return Math.max(acc, natural);
      }, 0);

      if (max > 0) {
        const clamped = Math.min(max, maxAvailable);
        const target = Math.min(maxAvailable, clamped);

        this.singleSideWidth = target;
        this.singleSideLayout = layout;
        wrappers.forEach((w) =>
          w.style.setProperty('--tc-event-col-width', `${target}px`)
        );
      } else {
        this.singleSideWidth = null;
        wrappers.forEach((w) => w.style.removeProperty('--tc-event-col-width'));
      }
    };

    const schedule = () => {
      requestAnimationFrame(measure);
      setTimeout(() => requestAnimationFrame(measure), 120);
    };

    schedule();
    if (document.fonts?.ready) {
      document.fonts.ready.then(schedule);
    }
  }
}

customElements.define('timeline-card', TimelineCard);

// Register card in Home Assistant card picker
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'timeline-card',
  name: 'Timeline Card',
  description:
    'A timeline-based event history card with icons, states and WS updates.',
});
