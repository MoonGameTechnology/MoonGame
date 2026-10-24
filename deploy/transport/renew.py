#!/usr/bin/env python3
"""Serialize certificate renewal with the deployment agent, without shell eval."""
import fcntl
import os
from pathlib import Path
from pki import profile_from_file, renew


def main():
    if os.geteuid() != 0:
        raise SystemExit("E_TRANSPORT_ROOT")
    state = Path("/var/lib/moongame-transport")
    # This is the same lock held by autoupdate.sh.
    with open("/var/lib/moongame/autoupdate.lock", "a", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for file in sorted((state / "profiles").glob("*.json")):
            profile = profile_from_file(file)
            changed = renew(profile)
            print(profile["name"], "renewed:", ",".join(changed) or "unchanged")


if __name__ == "__main__":
    main()
