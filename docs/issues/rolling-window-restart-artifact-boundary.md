# Un mismo evento cambia de timestamp entre recargas, cuando el borde de la ventana cae dentro de un hueco `unavailable`

- **Origen**: [ITD-428](https://controlait.atlassian.net/browse/ITD-428) (Jira), reportado por
  Tomás Kancyper sobre el Activity Log de Ona Alanda 108.
- **Relacionado**: [ITD-427](https://controlait.atlassian.net/browse/ITD-427) (mismo hilo de
  Slack, mismo enlace de reproducción) — no es la misma causa, pero comparte el mecanismo de
  fondo: la card no tiene memoria entre cargas, todo se recalcula desde cero sobre la ventana
  rodante `hours` que toque en cada `hass.callApi('history/period', ...)`.
- **Estado**: arreglado (sesión 2026-08-12). Ver "Fix aplicado" al final; se deja el resto del
  documento intacto como registro de la investigación original.

## Síntoma reportado

En la página completa de Activity Log de una habitación, al volver a abrir el mismo enlace
minutos después, el evento más antiguo visible cambió de hora: antes aparecía a las 15:19,
después a las 15:39. El ticket lo interpreta como "el timestamp de un mismo evento no es
estable" y pide investigar zona horaria, caché, orden o reemplazo de dato.

## Causa raíz confirmada

**No es el mismo evento con una hora inestable — son dos eventos reales distintos, y cuál de
los dos se oculta depende de si el borde de la ventana de `hours` ya pasó por en medio.**

Reconstruido contra el histórico real de Ona (TimescaleDB, `ha_ona_scribe.states_raw`,
`climate.ona_alanda_108_global_climate`) para el 9 de agosto de 2026:

```
09/08 15:19:06  climate → cool          (evento real: se encendió)
09/08 15:32:14  climate → unavailable   (parpadeo de conexión, ver nota de contexto abajo)
09/08 15:39:41  climate → cool          (vuelve, MISMO valor que antes del parpadeo)
```

`09/08 15:19:06 + 48h = 11/08 15:19:06` y `09/08 15:39:41 + 48h = 11/08 15:39:41` — exactamente
las dos horas que reportó Tomás el 11 de agosto. La ventana configurada en ese momento
(`algorithms-hass`, `config/dashboard/main.yaml.jinja`, `_TIMELINE_HOURS`) era 48h.

### El mecanismo, línea por línea

La card no cachea entre recargas de página reales (`history-cache.js` es un `Map` en memoria de
módulo, TTL 60s, se resetea con cualquier reload). Cada carga vuelve a pedir
`history/period/{ahora - hours}` hasta `{ahora}` (`history-fetch.js`) y vuelve a correr el
filtro desde cero.

`stripUnavailableArtifacts()` (`src/availability-filter.js`) decide si un valor que "vuelve sin
cambios" después de un hueco `unavailable`/`unknown` es un parpadeo (se oculta) comparando contra
`lastShownState`, una variable que el propio filtro construye **solo con lo que trae esa consulta
concreta**:

```js
export function stripUnavailableArtifacts(items, entities, globalConfig = {}) {
  const lastShownState = {};
  const gapSinceLastShown = {};

  return items.filter((item) => {
    ...
    if (isUnavailableState(item.raw_state)) {
      gapSinceLastShown[item.id] = true;
      return false;
    }

    const cameBackUnchanged =
      gapSinceLastShown[item.id] && lastShownState[item.id] === item.raw_state;

    gapSinceLastShown[item.id] = false;
    if (cameBackUnchanged) return false;

    lastShownState[item.id] = item.raw_state;
    return true;
  });
}
```

- **Si la ventana incluye 15:19:06** (el `cool` de antes del parpadeo): el filtro lo procesa
  primero, guarda `lastShownState = 'cool'`; al llegar a 15:39:41 reconoce
  `cameBackUnchanged = true` y lo descarta. Solo se ve 15:19:06.
- **Si "ahora" avanzó lo suficiente para que el inicio de la ventana caiga entre 15:19:06 y
  15:32:14** (es decir, 15:19:06 ya quedó fuera de la consulta): el primer dato que el filtro ve
  para esa entidad es directamente el `unavailable` de las 15:32:14. `lastShownState[id]` nunca
  se llegó a fijar en `'cool'` — sigue `undefined`. Al llegar a 15:39:41,
  `cameBackUnchanged = true && (undefined === 'cool')` → `false`. El evento **ya no se reconoce
  como parpadeo** y se muestra como si fuera un encendido real. Ahora es 15:39:41 el que ocupa el
  puesto de "evento más antiguo visible".

Es decir: el filtro es correcto _dentro de una sola consulta_, pero no tiene memoria de lo que
vio en la consulta anterior — así que su resultado para un evento cercano al borde de la ventana
depende de en qué instante exacto se recarga la página, no solo de los datos.

### Por qué esto no es caché, zona horaria ni orden

- **Caché**: descartado — `history-cache.js` es memoria de módulo JS, se pierde en cualquier
  recarga real de página (F5 / reabrir enlace), y su TTL (60s) es demasiado corto para explicar
  una discrepancia de 20 minutos aunque no se perdiera.
- **Zona horaria**: descartado — `relative_time: false` (config real usada en
  `algorithms-hass`) fuerza hora absoluta vía `formatAbsoluteTime()`; ambos timestamps
  reportados corresponden a filas reales y distintas del recorder, no a una conversión
  distinta del mismo dato.
- **Orden**: descartado — el reordenado (`filtered.sort()` en `history-filter.js`) es estable y
  no depende de qué instante se ejecuta la consulta, solo del contenido ya filtrado.

## Nota de contexto (no es parte de este bug)

El parpadeo `cool → unavailable → cool` de origen (el hueco a las 15:32:14) es en sí mismo un
problema de conectividad real entre HA y el equipo de A/C en Ona — no ficticio, no de esta card.
Ver el hilo de investigación en `algorithms-hass` (sesión 2026-08-12, ITD-427/428): en el mismo
periodo, `climate.ona_alanda_108_global_climate` llegó a parpadear a `unavailable` ~24 veces en
60h, y `climate.ona_alanda_109_global_climate` ~46 veces. Ese es un problema de infraestructura a
investigar aparte; lo único que aporta esta nota es que da munición de sobra para que el borde de
la ventana de 96h siga tropezando con parejas `valor → unavailable → mismo valor` en el futuro.

## Impacto tras subir la ventana de 48h a 96h (ITD-427)

`algorithms-hass` ya amplió `_ACTIVITY_HOURS`/`_TIMELINE_HOURS` de 48h a 96h (commit pendiente de
deploy, ver ese repo). Esto **no arregla el defecto**, solo lo reubica: el caso concreto reportado
(que caía justo en el borde de 48h) ya no va a reproducirse en ese punto exacto, pero el mecanismo
es estructural — cualquier hueco `mismo_valor → unavailable → mismo_valor` que quede justo a
caballo del nuevo borde de 96h producirá el mismo efecto. Con el nivel de flapping visto en Ona
(hasta 46 parpadeos/60h), es cuestión de tiempo que vuelva a pasar, ahí o en cualquier otro hotel
con conectividad inestable.

## Dónde mirar para el fix

- `src/availability-filter.js` → `stripUnavailableArtifacts()`: necesitaría ver un evento
  "antes del borde" para decidir bien sobre uno "después del borde". Dos vías posibles, sin
  explorar en profundidad todavía:
  1. Pedir el historial con un margen extra antes de `hours` (p. ej. `hours + look_back`) solo
     para alimentar `lastShownState` de cada entidad, y descartar ese margen antes de renderizar
     — el filtro tendría contexto aunque el evento pre-hueco caiga fuera de lo que se muestra.
  2. Usar el propio estado ACTUAL de la entidad (`hass.states[entity_id].state`, disponible sin
     otra llamada) como aproximación de "qué había antes" cuando el primer item de la ventana ya
     es un hueco — funciona si el valor no cambió desde entonces, que es el caso típico de un
     parpadeo de conexión, pero no si hubo un cambio real justo antes del hueco y fuera de
     ventana (edge case dentro del edge case).
  - Ambas tienen trade-offs de coste (llamada extra / precisión) que no se han evaluado contra
    el resto de la arquitectura de fetch de la card (`history-fetch.js`, `history-cache.js`) — se
    deja para cuando se aborde la tarea.
- El mismo `history-filter.js` ya deja constancia en sus propios comentarios de que
  `stripUnavailableArtifacts()` "expects items sorted OLDEST first, so 'the value this entity had
  before it went away' is well defined" — el bug es exactamente el caso en que esa asunción deja
  de cumplirse porque "antes de que se fuera" cayó fuera de la ventana pedida.

## Fix aplicado

Ninguna de las dos vías esbozadas arriba hizo falta: `history/period` ya devuelve gratis el dato
que faltaba. Por cada entidad, la API rellena una fila sintética al inicio exacto de la ventana
(`last_changed === start`) con el valor que la entidad tenía al entrar al rango — `history-index.js`
ya lo documentaba en su propio comentario ("that row is exactly the value an entity carried into
the range") para resolver `state_map`, pero `history-transform.js` la descartaba sin más
(`flat.filter(e => e.time.getTime() !== start.getTime())`) antes de que llegara a
`stripUnavailableArtifacts()`.

Cambios:

- `src/history-transform.js`: ya no descarta esa fila sintética — la conserva y la marca
  `item.contextOnly = true`.
- `src/history-filter.js`: los filtros de `include_states`/`exclude_states`/`min_value`/`max_value`
  dejan pasar un item `contextOnly` sin evaluarlo (igual que ya hacían con `kind === 'logbook'`),
  porque nunca se va a mostrar — solo debe llegar intacto a `stripUnavailableArtifacts()`.
- `src/availability-filter.js` → `stripUnavailableArtifacts()`: un item `contextOnly` sigue
  alimentando `lastShownState`/`gapSinceLastShown` como cualquier otro, pero nunca se devuelve en
  el resultado (ni siquiera con `ignore_unavailable: false`, porque no es un evento real que
  mostrar).

Con esto, el caso del síntoma original queda así: la ventana abre entre 15:19:06 (`cool`) y
15:32:14 (`unavailable`); la fila sintética de esa entidad trae `cool` con timestamp = inicio de
ventana, así que `lastShownState` queda en `'cool'` antes de procesar el hueco real — exactamente
lo que se habría visto con una ventana más ancha. El `cool` de las 15:39:41 se reconoce como
parpadeo y se descarta, igual que si el borde de la ventana nunca hubiera caído ahí.

Tests: `tests/history-transform.test.js` (nuevo, verifica el marcado `contextOnly`),
`tests/availability-filter.test.js` (casos `contextOnly` + regresión explícita del síntoma) y
`tests/history-filter.test.js` no necesitó cambios — la suite completa (172 tests) y `npm run
build` pasan.
