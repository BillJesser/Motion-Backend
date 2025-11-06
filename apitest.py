#!/usr/bin/env python3
"""Motion Backend smoke test for billyboss4@outlook.com."""

import json
import sys
from pathlib import Path
from typing import Any, Dict

import requests

API_BASE = "https://qekks9l4k1.execute-api.us-east-2.amazonaws.com"
EMAIL = "billyboss4@outlook.com"
PASSWORD = "Lucy1100342350!"
MOTION_EVENT_ID = "365a5596-a6cf-46ee-9675-63017035d7b6"
LOG_FILE = Path("motion-backend-smoketest.log")

def pretty(title: str, payload: Any) -> None:
    print(f"\n=== {title} ===")
    if isinstance(payload, (dict, list)):
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(payload)

def _safe_json(resp: requests.Response) -> Dict[str, Any]:
    try:
        return resp.json()
    except ValueError:
        return {"raw": resp.text}

def post_json(path: str, body: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{API_BASE}{path}"
    resp = requests.post(url, json=body, timeout=30)
    data = _safe_json(resp)
    pretty(f"POST {path} [{resp.status_code}]", data)
    resp.raise_for_status()
    return data

def delete_json(path: str, body: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{API_BASE}{path}"
    resp = requests.delete(url, json=body, timeout=30)
    data = _safe_json(resp)
    pretty(f"DELETE {path} [{resp.status_code}]", data)
    resp.raise_for_status()
    return data

def get_json(path: str, params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    url = f"{API_BASE}{path}"
    resp = requests.get(url, params=params, timeout=30)
    data = _safe_json(resp)
    pretty(f"GET {path} [{resp.status_code}]", data)
    resp.raise_for_status()
    return data

def log(payload: Dict[str, Any]) -> None:
    with LOG_FILE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, indent=2, sort_keys=True))
        fh.write("\n\n")

def main() -> None:
    LOG_FILE.write_text("")

    signin = post_json("/auth/signin", {"email": EMAIL, "password": PASSWORD})
    log(signin)

    motion_save = post_json(
        "/users/saved-events",
        {"email": EMAIL, "source": "motion", "eventId": MOTION_EVENT_ID},
    )
    log(motion_save)

    ai_save_payload = {
        "email": EMAIL,
        "source": "ai",
        "event": {
            "title": "Downtown Art Walk",
            "description": "Gallery crawl with late-night hours.",
            "start_date": "2025-10-02",
            "end_date": "2025-10-02",
            "start_time": "18:00",
            "end_time": "21:00",
            "timezone": "America/New_York",
            "location": {
                "venue": "Town Square",
                "city": "Alpharetta",
                "state": "GA",
                "country": "USA"
            },
            "source_url": "https://example.com/events/art-walk",
            "tags": ["arts", "community"]
        }
    }
    ai_save = post_json("/users/saved-events", ai_save_payload)
    log(ai_save)

    saved_events = ai_save.get("savedEvents") or motion_save.get("savedEvents") or []
    ai_event_id = None
    for entry in saved_events:
        if entry and entry.get("source") == "ai":
            ai_event_id = entry.get("eventId")
            break
    if ai_event_id:
        print(f"Captured AI event ID: {ai_event_id}")
    else:
        print("Warning: AI event ID not captured; subsequent lookups may skip.")

    profile = get_json("/users/profile", {"email": EMAIL})
    log(profile)

    saved_list = get_json("/users/saved-events", {"email": EMAIL})
    log(saved_list)

    get_json(f"/events/{MOTION_EVENT_ID}")
    if ai_event_id:
        get_json(f"/ai-events/{ai_event_id}")

    delete_json(
        "/users/saved-events",
        {"email": EMAIL, "eventId": MOTION_EVENT_ID, "source": "motion"}
    )
    if ai_event_id:
        delete_json(
            "/users/saved-events",
            {"email": EMAIL, "eventId": ai_event_id, "source": "ai"}
        )

    final_saved = get_json("/users/saved-events", {"email": EMAIL})
    log(final_saved)

    print(f"\nRaw responses logged to {LOG_FILE.resolve()}")

if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as exc:
        print("\nHTTP request failed:", exc)
        if exc.response is not None:
            try:
                print(json.dumps(exc.response.json(), indent=2, sort_keys=True))
            except ValueError:
                print(exc.response.text)
        sys.exit(1)
    except Exception as exc:
        print(f"\nUnexpected error: {exc}")
        sys.exit(1)
