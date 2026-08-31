#!/usr/bin/env python3
"""Read-only IMAP header notifier. It never fetches bodies or changes message flags."""

from __future__ import annotations

import email.policy
import hashlib
import imaplib
import json
import os
import re
import ssl
import subprocess
import sys
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.parser import BytesParser
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo


STATE_DIR = Path(os.environ.get("MAIL_STATE_DIR", "/var/lib/zdr-mail-monitor"))
STATE_FILE = STATE_DIR / "state.json"
DISCORD_SEND = os.environ.get("DISCORD_SEND", "/srv/ops/discord-send.sh")


def clean(value: str | None, limit: int) -> str:
    if not value:
        return "unknown"
    try:
        decoded = str(make_header(decode_header(value)))
    except Exception:
        decoded = value
    decoded = re.sub(r"[\x00-\x1f\x7f]+", " ", decoded)
    decoded = re.sub(r"\s+", " ", decoded).strip()
    return decoded[:limit] or "unknown"


def load_state() -> dict:
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def save_state(state: dict) -> None:
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(STATE_FILE)


def notify(message: str) -> None:
    subprocess.run(
        [DISCORD_SEND, "email-inbox", message],
        check=True,
        timeout=30,
        stdin=subprocess.DEVNULL,
    )


def formatted_message_date(raw_date: str | None, zone: ZoneInfo) -> str:
    if not raw_date:
        return "unknown"
    try:
        parsed = parsedate_to_datetime(raw_date)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(zone).strftime("%Y-%m-%d %H:%M:%S %Z")
    except (TypeError, ValueError, OverflowError):
        return clean(raw_date, 100)


def uidvalidity(client: imaplib.IMAP4_SSL) -> str:
    _, values = client.response("UIDVALIDITY")
    if not values or values[0] is None:
        return "unknown"
    match = re.search(rb"(\d+)", values[0])
    return match.group(1).decode("ascii") if match else "unknown"


def fetch_headers(client: imaplib.IMAP4_SSL, uid: int) -> bytes:
    status, data = client.uid(
        "fetch",
        str(uid),
        "(BODY.PEEK[HEADER.FIELDS (FROM DATE SUBJECT MESSAGE-ID)])",
    )
    if status != "OK":
        raise RuntimeError(f"header fetch failed for UID {uid}")
    for item in data:
        if isinstance(item, tuple) and isinstance(item[1], bytes):
            return item[1]
    raise RuntimeError(f"header payload missing for UID {uid}")


def main() -> int:
    host = os.environ["MAIL_IMAP_HOST"]
    port = int(os.environ.get("MAIL_IMAP_PORT", "993"))
    username = os.environ["MAIL_USERNAME"]
    password = os.environ["MAIL_PASSWORD"]
    folder = os.environ.get("MAIL_FOLDER", "INBOX")
    zone = ZoneInfo(os.environ.get("MAIL_TIMEZONE", "Asia/Karachi"))
    include_subject = os.environ.get("MAIL_INCLUDE_SUBJECT", "false").lower() == "true"
    max_messages = max(1, min(100, int(os.environ.get("MAIL_MAX_MESSAGES_PER_RUN", "20"))))
    state = load_state()

    try:
        context = ssl.create_default_context()
        with imaplib.IMAP4_SSL(host, port, ssl_context=context, timeout=15) as client:
            client.login(username, password)
            status, _ = client.select(folder, readonly=True)
            if status != "OK":
                raise RuntimeError(f"cannot open mailbox folder {folder!r} read-only")

            validity = uidvalidity(client)
            status, data = client.uid("search", None, "ALL")
            if status != "OK":
                raise RuntimeError("IMAP UID search failed")
            uids = [int(item) for item in (data[0] or b"").split()]
            highest = max(uids, default=0)

            if not state.get("uidvalidity"):
                state.update({"uidvalidity": validity, "last_uid": highest, "last_error": ""})
                notify(
                    f"[BASELINE] ZDR mailbox monitor started {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
                    f"Mailbox: {clean(username, 200)}; existing messages were not replayed."
                )
                save_state(state)
                return 0

            if state.get("uidvalidity") != validity:
                notify(
                    f"[WARN] ZDR mailbox UIDVALIDITY changed {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
                    "A new baseline was recorded; old messages were not replayed."
                )
                state.update({"uidvalidity": validity, "last_uid": highest, "last_error": ""})
                save_state(state)
                return 0

            if state.get("last_error"):
                notify(
                    f"[RESOLVED] ZDR mailbox connection recovered "
                    f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}"
                )
                state["last_error"] = ""
                save_state(state)

            last_uid = int(state.get("last_uid", 0))
            new_uids = [uid for uid in uids if uid > last_uid][:max_messages]
            for uid in new_uids:
                raw = fetch_headers(client, uid)
                message = BytesParser(policy=email.policy.default).parsebytes(raw)
                display_name, address = parseaddr(str(message.get("From", "")))
                display_name = clean(display_name, 100)
                address = clean(address, 254)
                subject = clean(str(message.get("Subject", "")), 180)
                message_date = formatted_message_date(str(message.get("Date", "")), zone)
                detected = datetime.now(zone).strftime("%Y-%m-%d %H:%M:%S %Z")
                lines = [
                    "[NEW EMAIL]",
                    f"From: {display_name} <{address}>",
                    f"Message date: {message_date}",
                    f"Detected: {detected}",
                    f"Mailbox: {clean(username, 200)}",
                ]
                if include_subject:
                    lines.insert(2, f"Subject: {subject}")
                notify("\n".join(lines))
                state["last_uid"] = uid
                save_state(state)

            print(f"mail monitor OK: {len(new_uids)} new message(s)")
            return 0
    except Exception as exc:
        error_text = clean(f"{type(exc).__name__}: {exc}", 300)
        error_hash = hashlib.sha256(error_text.encode("utf-8")).hexdigest()
        if state.get("last_error") != error_hash:
            try:
                notify(
                    f"[FAIL] ZDR mailbox monitor {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
                    f"{error_text}"
                )
                state["last_error"] = error_hash
                save_state(state)
            except Exception as notify_exc:
                print(f"mail monitor could not queue its failure: {notify_exc}", file=sys.stderr)
        print(f"mail monitor failed: {error_text}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
