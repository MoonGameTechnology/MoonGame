#!/usr/bin/env python3
"""One-time root migration of the existing signed production pair to transport TLS.

Preserves images, database volume and credentials. The deployment/erasure timers
are paused and restored; the shared deployment lock excludes concurrent rollouts.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from pki import profile_from_file, caddy_upstream


def run(*args):
    result = subprocess.run(args, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("E_TRANSPORT_ACTIVATE_COMMAND")
    return result.stdout


def inspect(name):
    return json.loads(run("docker", "inspect", name))[0]


def update_env(path, updates):
    # Never source shell input; preserve every unrelated credential byte-for-byte.
    lines = path.read_text().splitlines(keepends=True)
    lines = [line for line in lines if line.partition("=")[0] not in updates]
    text = "".join(lines)
    if text and not text.endswith("\n"):
        text += "\n"
    path.write_text(text + "".join(key + "=" + value + "\n" for key, value in updates.items()))
    path.chmod(0o600)


def preflight_environment(release, state):
    # Readiness is an ephemeral checker result used for forward and rollback.
    readiness = run("bash", "-c", '. "$1"; production_preflight "$2" || exit; '
        'printf "%s\\n%s\\n" "${BACKUP_READINESS_VERIFIED:-0}" "${BACKUP_READINESS_DEFERRED:-0}"',
        "preflight", str(release / "production-preflight.sh"), str(state / "server.env")).decode().splitlines()
    if len(readiness) != 2 or any(value not in {"0", "1"} for value in readiness):
        raise RuntimeError("E_TRANSPORT_PREFLIGHT")
    return dict(BACKUP_READINESS_VERIFIED=readiness[0], BACKUP_READINESS_DEFERRED=readiness[1])


def validate_database_urls(environment):
    from urllib.parse import urlsplit, parse_qs
    for key, value in environment.items():
        if (key.endswith("DATABASE_URL") or key == "DB_MIGRATION_URL") and value:
            query = parse_qs(urlsplit(value).query, keep_blank_values=True)
            if any(k.lower().startswith("ssl") or k.lower() == "uselibpqcompat" for k in query):
                raise RuntimeError("E_TRANSPORT_DATABASE_URL_OVERRIDE")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("E_TRANSPORT_ROOT")
    source = Path(__file__).resolve().parent.parent
    state = Path("/var/lib/moongame")
    transport = Path("/var/lib/moongame-transport")
    profile = profile_from_file(transport / "profiles/prod.json")
    profile_from_file(transport / "profiles/monitoring.json")
    folder = Path(profile["directory"])
    for file in [folder / "compose.yml", folder / "app/server.key", folder / "db/server.key",
                 transport / "bin/probe"]:
        if not file.is_file() or file.is_symlink():
            raise SystemExit("E_TRANSPORT_NOT_PREPARED")
    if not args.apply:
        print(json.dumps({"production_images": [inspect(n)["Config"]["Image"] for n in
              [profile["app"]["container"], "deploy-caddy-1"]], "transport_overlay": str(folder / "compose.yml")}))
        return
    timers = ["moongame-autoupdate.timer", "moongame-account-erasure.timer"]
    active = [unit for unit in timers if subprocess.run(["systemctl", "is-active", "--quiet", unit]).returncode == 0]
    backups = {}
    copied = {}
    compose = None
    changed = False
    success = False
    with open(state / "autoupdate.lock", "a", encoding="utf-8") as lock:
        try:
            for unit in active:
                run("systemctl", "stop", unit)
            deadline = time.monotonic() + 60
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() > deadline:
                        raise RuntimeError("E_TRANSPORT_DEPLOY_BUSY")
                    time.sleep(0.5)
            if subprocess.run(["systemctl", "is-active", "--quiet", "moongame-account-erasure.service"]).returncode == 0:
                raise RuntimeError("E_TRANSPORT_ERASURE_BUSY")
            app, edge = inspect(profile["app"]["container"]), inspect("deploy-caddy-1")
            environment = dict(value.split("=", 1) for value in app["Config"]["Env"] if "=" in value)
            # URL TLS overrides must not defeat PGSSLMODE or certificate checks.
            validate_database_urls(environment)
            run("docker", "network", "inspect", profile["db_network"], "deploy_monitor_front")
            release = (state / "current/deploy").resolve()
            # Compose needs the readiness result exported by the same protected
            # preflight used by stack.sh, including for a rollback. A bare
            # compose up defaults deferred-playtest back to an invalid state.
            readiness = preflight_environment(release, state)
            stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
            backup = folder / ("before-" + stamp)
            backup.mkdir(mode=0o700)
            for path in [state / "server.env", state / "Caddyfile", Path("/etc/moongame/account-erasure.env")]:
                if path.exists():
                    backups[path] = path.read_bytes()
                    target = backup / (str(path).replace("/", "_").lstrip("_"))
                    target.write_bytes(backups[path]); target.chmod(0o600)
            # This is an encrypted local maintenance snapshot, not an off-host backup.
            recipient = run("age-keygen", "-y", str(transport / "maintenance-backup.key")).decode().strip()
            dump = subprocess.Popen(["docker", "exec", profile["db"]["container"], "sh", "-c",
                'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            encrypted = subprocess.run(["age", "-r", recipient, "-o", str(backup / "database.dump.age")],
                                       stdin=dump.stdout, capture_output=True)
            dump.stdout.close()
            _, dump_error = dump.communicate()
            if dump.returncode or encrypted.returncode:
                raise RuntimeError("E_TRANSPORT_BACKUP")
            (backup / "database.dump.age").chmod(0o600)
            # Publish only public CA certificates into the persistent edge data volume.
            run("docker", "exec", "deploy-caddy-1", "mkdir", "-p", "/data/transport")
            for name in ["prod", "monitoring"]:
                run("docker", "cp", str(transport / name / "public/ca.crt"),
                    f"deploy-caddy-1:/data/transport/{name}-ca.crt")
            text = (state / "Caddyfile").read_text()
            pattern = r"(?m)^([ \t]*)reverse_proxy server:8788[ \t]*$"
            match = re.search(pattern, text)
            if not match or len(re.findall(pattern, text)) != 1:
                raise RuntimeError("E_TRANSPORT_CADDY_LAYOUT")
            block = "\n".join(match[1] + line for line in caddy_upstream(profile).strip().splitlines())
            text = re.sub(pattern, lambda _: block, text)
            pattern = r"(?m)^([ \t]*)reverse_proxy obs-grafana:3000[ \t]*\{[ \t]*$"
            matches = list(re.finditer(pattern, text))
            if len(matches) > 1:
                raise RuntimeError("E_TRANSPORT_CADDY_LAYOUT")
            if matches:
                indent = matches[0][1]
                replacement = indent + "reverse_proxy https://obs-grafana:3000 {\n" + indent + "  header_up Host {hostport}\n" + indent + "  transport http {\n" + indent + "    tls_trust_pool file /data/transport/monitoring-ca.crt\n" + indent + "    tls_server_name obs-grafana\n" + indent + "  }"
                text = re.sub(pattern, lambda _: replacement, text)
            preview = folder / "Caddyfile.next"
            preview.write_text(text); preview.chmod(0o600)
            run("docker", "cp", str(preview), "deploy-caddy-1:/config/transport-production-preview.Caddyfile")
            run("docker", "exec", "deploy-caddy-1", "caddy", "validate", "--config",
                "/config/transport-production-preview.Caddyfile", "--adapter", "caddyfile")
            # Keep native TLS/operator compatibility in the active control plane.
            for file in ["release-state.sh", "update.sh", "autoupdate.sh", "stack.sh", "account-erasure-docker.sh"]:
                target = release / file
                copied[target] = target.read_bytes()
                shutil.copy2(source / file, target)
            (release / "transport").mkdir(mode=0o755, exist_ok=True)
            shutil.copy2(source / "transport/version", release / "transport/version")
            update_env(state / "server.env", {
                "COMPOSE_TRANSPORT_FILE": str(folder / "compose.yml"), "DB_NETWORK": profile["db_network"],
                "TLS_CERT_FILE": "/transport/server.crt", "TLS_KEY_FILE": "/transport/server.key",
                "HEALTHCHECK_CA_FILE": "/transport/ca.crt", "HEALTHCHECK_TLS_SERVERNAME": profile["app"]["dns"][0],
                "LOCAL_TLS_CA_FILE": str(folder / "public/ca.crt"),
            })
            if Path("/etc/moongame/account-erasure.env").exists():
                update_env(Path("/etc/moongame/account-erasure.env"), {
                    "ERASURE_DOCKER_NETWORK": profile["db_network"],
                    "ERASURE_DB_TLS_CA_FILE": str(folder / "public/ca.crt"),
                })
            # A file bind mount retains its inode: update it in-place after validation.
            (state / "Caddyfile").write_text(text)
            files = app["Config"]["Labels"]["com.docker.compose.project.config_files"].split(",")
            base = ["docker", "compose", "--project-name", "deploy", "--env-file", str(state / "server.env")]
            for file in files:
                base += ["-f", file]
            env = dict(os.environ, VOID_IMAGE=app["Config"]["Image"], VOID_CADDY_IMAGE=edge["Config"]["Image"])
            env.update(readiness)
            compose = (base, env)
            changed = True
            # Drain application writes before changing PostgreSQL's network/config.
            run("docker", "stop", "--time", "30", profile["app"]["container"])
            result = subprocess.run(base + ["-f", str(folder / "compose.yml"), "up", "-d", "--no-build", "--pull", "never",
                "--wait", "--wait-timeout", "120"], env=env, capture_output=True)
            if result.returncode:
                error_log = backup / "compose-error.log"
                error_log.write_bytes(result.stderr); error_log.chmod(0o600)
                raise RuntimeError("E_TRANSPORT_COMPOSE")
            # A profile without proxy_networks does not recreate Caddy. A bind
            # file update must also be applied to the already running process.
            run("docker", "exec", "deploy-caddy-1", "caddy", "reload", "--config",
                "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
            # Both local authenticated identity checks and the public edge must pass.
            for path in ["/health", "/ready"]:
                run("bash", "-c", '. "$1"; release_local_probe "$2" "$3" >/dev/null', "probe",
                    str(release / "release-state.sh"), str(state / "server.env"), path)
            domain = next((line.split("=", 1)[1].strip().strip('"\'') for line in (state / "server.env").read_text().splitlines() if line.startswith("DOMAIN=")), "")
            if not re.fullmatch(r"[A-Za-z0-9.-]+", domain):
                raise RuntimeError("E_TRANSPORT_DOMAIN")
            run("curl", "-fsS", "--max-time", "10", "-o", "/dev/null", "https://" + domain + "/ready")
            success = True
            print("Production verified TLS and backend isolation are healthy; signed images and data volume retained.")
        except Exception:
            for path, data in backups.items():
                path.write_bytes(data)
            for path, data in copied.items():
                path.write_bytes(data)
            if changed and compose:
                base, env = compose
                rollback = subprocess.run(base + ["up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "120"], env=env, capture_output=True)
                reload = subprocess.run(["docker", "exec", "deploy-caddy-1", "caddy", "reload", "--config",
                    "/etc/caddy/Caddyfile", "--adapter", "caddyfile"], capture_output=True)
                if rollback.returncode or reload.returncode:
                    print("E_TRANSPORT_ROLLBACK: operator inspection required")
            raise
        finally:
            for unit in active:
                subprocess.run(["systemctl", "start", unit], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not success:
        raise SystemExit("E_TRANSPORT_ACTIVATE")


if __name__ == "__main__":
    main()
