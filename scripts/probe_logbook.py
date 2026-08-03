#!/usr/bin/env python3
"""Sonda del logbook de Home Assistant para timeline-card.

La card lee eventos personalizados (`logbook.log`) por dos caminos, y este script
permite inspeccionar los dos contra una instalación real antes de tocar código:

  - `logbook/get_events` sobre WebSocket, que es lo que se pide en cada refresco.
  - el evento de bus `logbook_entry`, que es lo que llega en tiempo real.

Las dos formas NO coinciden: `get_events` devuelve `when` (epoch float en HA
recientes, string ISO en versiones antiguas) mientras que el evento de bus no
trae `when` en absoluto y hay que leer la hora de `time_fired` del sobre. Esa
diferencia es justo lo que hay que verificar aquí.

Credenciales: reutiliza el `.env` de `Controlá/` (pares HA_<NOMBRE>_URL /
HA_<NOMBRE>_TOKEN), a través de `Controlá/scripts/ha_debug.py`.

Uso:
    python3 scripts/probe_logbook.py events NUMA_GRANADAVEGA --hours 168
    python3 scripts/probe_logbook.py events NUMA_GRANADAVEGA --entity binary_sensor.x
    python3 scripts/probe_logbook.py listen NUMA_GRANADAVEGA --seconds 60
    python3 scripts/probe_logbook.py listen NUMA_GRANADAVEGA --fire binary_sensor.x

`--fire` escribe una entrada de prueba en el logbook de esa instalación (a través
de `logbook.log`) para no tener que esperar a que salte una automatización. Es la
única operación de escritura del script, y solo añade una línea al logbook.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ha_debug.py vive en Controlá/scripts/, dos niveles por encima de este repo.
CONTROLA_SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(CONTROLA_SCRIPTS))

try:
    import websocket  # websocket-client
except ImportError:
    print("Falta 'websocket-client'. Instala con: pip install websocket-client", file=sys.stderr)
    sys.exit(1)

try:
    from ha_debug import (  # noqa: E402
        ENV_PATH,
        discover_installations,
        get_installation,
        load_env,
    )
except ImportError:
    print(f"No se encontró ha_debug.py en {CONTROLA_SCRIPTS}", file=sys.stderr)
    sys.exit(1)


def connect(inst: dict[str, str], timeout: int = 60) -> websocket.WebSocket:
    url = inst["url"].replace("https://", "wss://").replace("http://", "ws://")
    ws = websocket.create_connection(f"{url}/api/websocket", timeout=timeout)
    ws.recv()  # auth_required
    ws.send(json.dumps({"type": "auth", "access_token": inst["token"]}))
    reply = json.loads(ws.recv())
    if reply.get("type") != "auth_ok":
        print(f"Autenticación rechazada: {reply}", file=sys.stderr)
        sys.exit(1)
    return ws


def is_custom_entry(entry: dict) -> bool:
    """Mismo criterio que src/logbook-transform.js::isCustomLogbookEntry."""
    return (
        entry.get("message") is not None
        and entry.get("state") is None
        and not entry.get("source")
        and isinstance(entry.get("entity_id"), str)
    )


def cmd_events(inst: dict[str, str], args) -> None:
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=args.hours)

    payload = {
        "id": 1,
        "type": "logbook/get_events",
        "start_time": start.isoformat(),
        "end_time": end.isoformat(),
    }
    if args.entity:
        payload["entity_ids"] = args.entity

    ws = connect(inst)
    ws.send(json.dumps(payload))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1 and msg.get("type") == "result":
            break
    ws.close()

    if not msg.get("success"):
        print(f"El comando falló: {msg.get('error')}", file=sys.stderr)
        sys.exit(1)

    entries = msg.get("result", [])
    custom = [e for e in entries if is_custom_entry(e)]

    print(f"ventana:  {start.isoformat()} -> {end.isoformat()}")
    print(f"entidades: {', '.join(args.entity) if args.entity else '(todas)'}")
    print(f"total:     {len(entries)}")
    print(f"con message: {len([e for e in entries if 'message' in e])}")
    print(f"logbook.log: {len(custom)}   <- lo que la card mostraría\n")

    for entry in custom:
        when = entry.get("when")
        stamp = (
            datetime.fromtimestamp(when, timezone.utc).isoformat()
            if isinstance(when, (int, float))
            else str(when)
        )
        print(f"{stamp}  {entry.get('name')!r} / {entry.get('message')!r}")
        if args.raw:
            print(f"  {json.dumps(entry, ensure_ascii=False)}")


def cmd_listen(inst: dict[str, str], args) -> None:
    ws = connect(inst, timeout=args.seconds + 10)
    ws.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "logbook_entry"}))
    ws.recv()  # result de la suscripción
    print(f"suscrito a logbook_entry, escuchando {args.seconds}s...", flush=True)

    if args.fire:
        def fire():
            # Un margen para que la suscripción esté establecida antes de disparar.
            time.sleep(2)
            import requests

            requests.post(
                f"{inst['url']}/api/services/logbook/log",
                headers={
                    "Authorization": f"Bearer {inst['token']}",
                    "Content-Type": "application/json",
                },
                json={
                    "name": "Sonda timeline-card",
                    "message": "Verificando la forma del evento de bus",
                    "entity_id": args.fire,
                },
                timeout=15,
            )
            print(f"disparado logbook.log sobre {args.fire}", flush=True)

        threading.Thread(target=fire, daemon=True).start()

    deadline = time.time() + args.seconds
    count = 0
    while time.time() < deadline:
        try:
            ws.settimeout(max(1, deadline - time.time()))
            msg = json.loads(ws.recv())
        except Exception:
            break
        if msg.get("type") != "event":
            continue
        count += 1
        event = msg["event"]
        print(f"\n>>> logbook_entry #{count}", flush=True)
        print(json.dumps(event, ensure_ascii=False, indent=2), flush=True)
        print(f"    time_fired: {event.get('time_fired')!r}", flush=True)
        print(f"    ¿la card lo aceptaría? {is_custom_entry(event.get('data', {}))}", flush=True)

    ws.close()
    print(f"\ntotal recibidos: {count}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_events = sub.add_parser("events", help="Consulta logbook/get_events")
    p_events.add_argument("instalacion")
    p_events.add_argument("--hours", type=int, default=24)
    p_events.add_argument("--entity", action="append", help="Repetible; omitido = todas")
    p_events.add_argument("--raw", action="store_true", help="Volcar el JSON completo")

    p_listen = sub.add_parser("listen", help="Escucha el evento de bus logbook_entry")
    p_listen.add_argument("instalacion")
    p_listen.add_argument("--seconds", type=int, default=60)
    p_listen.add_argument("--fire", metavar="ENTITY_ID", help="Dispara un logbook.log de prueba")

    args = parser.parse_args()

    installations = discover_installations(load_env(ENV_PATH))
    if not installations:
        print(f"No hay instalaciones configuradas en {ENV_PATH}", file=sys.stderr)
        sys.exit(1)
    inst = get_installation(installations, args.instalacion)

    {"events": cmd_events, "listen": cmd_listen}[args.command](inst, args)


if __name__ == "__main__":
    main()
