# scripts/

Herramientas de diagnóstico contra instalaciones reales de Home Assistant. No
forman parte del bundle ni de la suite de tests (`npm run build` / `npx vitest`
las ignoran) — son sondas para verificar contra HA de verdad lo que la card
asume del API.

Las credenciales salen del `.env` de `Controlá/` (pares `HA_<NOMBRE>_URL` /
`HA_<NOMBRE>_TOKEN`), reutilizando `Controlá/scripts/ha_debug.py`. Ese fichero no
está en ningún repo y no se commitea nunca.

## `probe_logbook.py`

Inspecciona las dos rutas por las que la card lee eventos personalizados de
logbook (`logbook.log`), que son la fuente de datos de la opción
`show_logbook_entries`. Existe porque las dos formas **no coinciden** y hay que
verificarlas por separado: `logbook/get_events` devuelve `when` (epoch float en
HA recientes, string ISO en versiones antiguas), mientras que el evento de bus
`logbook_entry` no trae `when` en absoluto y la hora hay que leerla del
`time_fired` del sobre.

Aplica el mismo criterio de admisión que `src/logbook-transform.js`
(`message` presente, sin `state`, sin `source`, con `entity_id`), así que el
recuento que imprime es exactamente lo que la card mostraría.

```bash
# Qué devolvería un refresco: total de entradas vs. las que la card admitiría
python3 scripts/probe_logbook.py events NUMA_GRANADAVEGA --hours 168
python3 scripts/probe_logbook.py events NUMA_GRANADAVEGA \
    --entity binary_sensor.numa_granadavega_401_motion_group --raw

# Forma del evento de bus en tiempo real
python3 scripts/probe_logbook.py listen NUMA_GRANADAVEGA --seconds 60
```

`--entity` es repetible; omitirlo consulta todas las entidades (útil para ver
cuánto ruido de automatizaciones filtra el criterio `source`).

`listen` sin más puede tardar mucho en capturar algo, porque solo salta cuando
alguien llama a `logbook.log`. Para no esperar:

```bash
python3 scripts/probe_logbook.py listen NUMA_GRANADAVEGA --seconds 30 \
    --fire binary_sensor.numa_granadavega_401_motion_group
```

> `--fire` es la **única operación de escritura** del script: llama a
> `logbook.log` en esa instalación, lo que añade una línea a su logbook. No
> modifica estados ni entidades, pero es visible para el cliente — conviene
> avisar antes de usarlo contra un hotel en producción.

Requiere `websocket-client` y `requests` (`pip install websocket-client requests`).
