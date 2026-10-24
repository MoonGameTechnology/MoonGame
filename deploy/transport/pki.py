#!/usr/bin/env python3
"""Private-CA profiles for the existing native HTTPS and PostgreSQL TLS servers.

The CA key never enters a container. Profiles/outputs live in a private operator
directory, outside releases; leaf files keep the application/database UID.
"""
import argparse
import contextlib
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile


def command(*args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise RuntimeError("E_TRANSPORT_COMMAND")
    return result.stdout


def private_file(path, data, mode=0o600, uid=None):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("E_TRANSPORT_SYMLINK")
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        tmp = Path(stream.name)
        try:
            stream.write(data.encode() if isinstance(data, str) else data)
            stream.flush()
            os.fsync(stream.fileno())
            os.chmod(tmp, mode)
            if uid is not None:
                os.chown(tmp, uid, uid if os.geteuid() == 0 else os.getgid())
            os.replace(tmp, path)
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            tmp.unlink(missing_ok=True)


def profile_from_file(file):
    file = Path(file)
    info = file.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError("E_TRANSPORT_PROFILE")
    for parent in file.parents:
        entry = parent.lstat()
        sticky_root = entry.st_uid == 0 and entry.st_mode & stat.S_ISVTX
        if parent.is_symlink() or entry.st_uid not in {0, os.geteuid()} or (entry.st_mode & 0o022 and not sticky_root):
            raise ValueError("E_TRANSPORT_PROFILE_PARENT")
    profile = json.loads(file.read_text())
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", profile["name"]):
        raise ValueError("E_TRANSPORT_PROFILE")
    for kind in ["app", "db", *profile.get("extra_roles", {})]:
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", kind) or kind in {"private", "public", "config"}:
            raise ValueError("E_TRANSPORT_PROFILE")
        item = profile[kind] if kind in ["app", "db"] else profile["extra_roles"][kind]
        if "port" in item and (not isinstance(item["port"], int) or not 1 <= item["port"] <= 65535):
            raise ValueError("E_TRANSPORT_PROFILE")
        for key in ["service", "container"]:
            if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}", item[key]):
                raise ValueError("E_TRANSPORT_PROFILE")
        if not isinstance(item["uid"], int) or item["uid"] < 0:
            raise ValueError("E_TRANSPORT_PROFILE")
        if not item["dns"]:
            raise ValueError("E_TRANSPORT_PROFILE")
        for name in item["dns"]:
            if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}", name):
                raise ValueError("E_TRANSPORT_PROFILE")
    for key in ["front_network", "db_network"]:
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}", profile[key]):
            raise ValueError("E_TRANSPORT_PROFILE")
    if profile["front_network"] == profile["db_network"]:
        raise ValueError("E_TRANSPORT_PROFILE")
    for network in profile.get("proxy_networks", []):
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}", network) or network == profile["db_network"]:
            raise ValueError("E_TRANSPORT_PROFILE")
    root = Path(profile["directory"])
    if not root.is_absolute() or root == Path("/") or any(c in str(root) for c in "\r\n${},"):
        raise ValueError("E_TRANSPORT_PROFILE")
    # No symlink components: Docker mounts and OpenSSL must see the same tree.
    for parent in [root, *root.parents]:
        if parent.is_symlink():
            raise ValueError("E_TRANSPORT_SYMLINK")
        if parent.exists():
            entry = parent.stat()
            sticky_root = entry.st_uid == 0 and entry.st_mode & stat.S_ISVTX
            if entry.st_uid not in {0, os.geteuid()} or (entry.st_mode & 0o022 and not sticky_root):
                raise ValueError("E_TRANSPORT_DIRECTORY_PARENT")
    return profile


@contextlib.contextmanager
def locked(root):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = root.stat()
    if info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError("E_TRANSPORT_DIRECTORY")
    fd = os.open(root / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def valid_for(path, seconds):
    return subprocess.run(["openssl", "x509", "-in", str(path), "-noout", "-checkend", str(seconds)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def pending_roles(root, profile):
    file = root / "pending.json"
    if not file.exists():
        return set()
    info = file.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
            or info.st_nlink != 1 or info.st_mode & 0o077):
        raise ValueError("E_TRANSPORT_PENDING")
    roles = json.loads(file.read_text())
    if not isinstance(roles, list) or any(role not in {"app", "db", *profile.get("extra_roles", {})} for role in roles):
        raise ValueError("E_TRANSPORT_PENDING")
    return set(roles)


def key_matches(cert, key):
    try:
        return command("openssl", "x509", "-in", str(cert), "-noout", "-pubkey") == command(
            "openssl", "pkey", "-in", str(key), "-pubout")
    except RuntimeError:
        return False


def prepare(profile):
    root = Path(profile["directory"])
    with locked(root):
        pending = pending_roles(root, profile)
        private = root / "private"
        private.mkdir(mode=0o700, exist_ok=True)
        if private.is_symlink() or private.stat().st_uid != os.geteuid() or private.stat().st_mode & 0o077:
            raise ValueError("E_TRANSPORT_DIRECTORY")
        ca_key, ca = private / "ca.key", root / "ca.crt"
        if ca_key.exists() != ca.exists():
            raise ValueError("E_TRANSPORT_CA_INCOMPLETE")
        if ca_key.exists():
            key_info = ca_key.lstat()
            if (not stat.S_ISREG(key_info.st_mode) or key_info.st_uid != os.geteuid()
                    or key_info.st_nlink != 1 or key_info.st_mode & 0o077):
                raise ValueError("E_TRANSPORT_KEY")
        if not ca.exists():
            with tempfile.TemporaryDirectory(dir=private) as work:
                key, cert = Path(work) / "ca.key", Path(work) / "ca.crt"
                command("openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                        "-nodes", "-sha256", "-days", "3650", "-subj", f"/CN=MoonGame {profile['name']} transport CA",
                        "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
                        "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-keyout", str(key), "-out", str(cert))
                private_file(ca_key, key.read_bytes(), 0o400)
                private_file(ca, cert.read_bytes(), 0o644)
        if not valid_for(ca, 30 * 86400):
            raise ValueError("E_TRANSPORT_CA_EXPIRING")
        public = root / "public"
        public.mkdir(mode=0o755, exist_ok=True)
        if public.is_symlink() or public.stat().st_uid != os.geteuid() or public.stat().st_mode & 0o022:
            raise ValueError("E_TRANSPORT_DIRECTORY")
        os.chmod(public, 0o755)
        private_file(public / "ca.crt", ca.read_bytes(), 0o644)
        changed = []
        for kind in ["app", "db", *profile.get("extra_roles", {})]:
            item = profile[kind] if kind in ["app", "db"] else profile["extra_roles"][kind]
            folder = root / kind
            folder.mkdir(mode=0o755, exist_ok=True)
            if folder.is_symlink() or folder.stat().st_uid != os.geteuid() or folder.stat().st_mode & 0o022:
                raise ValueError("E_TRANSPORT_DIRECTORY")
            # mkdir's requested mode is filtered by the service's umask 0077.
            # Docker mounts this directory itself; its non-root UID needs traversal.
            os.chmod(folder, 0o755)
            cert, key = folder / "server.crt", folder / "server.key"
            if cert.exists() != key.exists() and kind not in pending:
                raise ValueError("E_TRANSPORT_LEAF_INCOMPLETE")
            if key.exists():
                if key.is_symlink() or key.stat().st_nlink != 1:
                    raise ValueError("E_TRANSPORT_KEY")
                os.chmod(key, 0o400)
                os.chown(key, item["uid"], item["uid"] if os.geteuid() == 0 else os.getgid())
            if not cert.exists() or not key.exists() or not valid_for(cert, 30 * 86400) or not key_matches(cert, key):
                with tempfile.TemporaryDirectory(dir=private) as work:
                    work = Path(work)
                    sans = ",".join("DNS:" + name for name in item["dns"])
                    # Local psql operators can verify the database's loopback identity.
                    if kind == "db":
                        sans += ",IP:" + str(ipaddress.ip_address("127.0.0.1"))
                    (work / "extensions").write_text("basicConstraints=critical,CA:FALSE\n"
                        "keyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=" + sans + "\n")
                    command("openssl", "req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                            "-nodes", "-subj", f"/CN={item['dns'][0]}", "-keyout", str(work / "key"), "-out", str(work / "csr"))
                    command("openssl", "x509", "-req", "-in", str(work / "csr"), "-CA", str(ca), "-CAkey", str(ca_key),
                            "-set_serial", "0x" + os.urandom(16).hex(), "-days", "90", "-sha256",
                            "-extfile", str(work / "extensions"), "-out", str(work / "cert"))
                    command("openssl", "verify", "-CAfile", str(ca), "-verify_hostname", item["dns"][0], str(work / "cert"))
                    # Persist intent before publishing either leaf file. A crash
                    # or failed Docker command must not lose the required apply.
                    pending.add(kind)
                    private_file(root / "pending.json", json.dumps(sorted(pending)))
                    private_file(key, (work / "key").read_bytes(), 0o400, item["uid"])
                    private_file(cert, (work / "cert").read_bytes(), 0o644)
                changed.append(kind)
            private_file(folder / "ca.crt", ca.read_bytes(), 0o644)
        # Unix-socket maintenance stays local. TCP never falls back to plaintext.
        private_file(root / "pg_hba.conf", "local all all trust\n"
                     "hostnossl all all 0.0.0.0/0 reject\nhostnossl all all ::/0 reject\n"
                     "hostssl all all 0.0.0.0/0 scram-sha-256\nhostssl all all ::/0 scram-sha-256\n", 0o644)
        if profile.get("kind") == "monitoring":
            from monitoring import render_monitoring
            private_file(root / "compose.yml", render_monitoring(profile))
        else:
            private_file(root / "compose.yml", render_overlay(profile))
        private_file(root / "caddy-upstream.txt", caddy_upstream(profile))
        return changed


def render_overlay(p):
    q = json.dumps
    root = Path(p["directory"])
    app, db = p["app"]["service"], p["db"]["service"]
    proxy_names = [f"transport-proxy-{i}" for i, _ in enumerate(p.get("proxy_networks", []))]
    proxy = ("  caddy:\n    networks: !override [transport-front, " + ", ".join(proxy_names) + "]\n") if proxy_names else ""
    proxy_networks = "".join(f"  {key}:\n    external: true\n    name: {q(value)}\n" for key, value in zip(proxy_names, p.get("proxy_networks", [])))
    return f'''# Generated from a private transport profile. No CA private key is mounted.
services:
  {app}:
    environment:
      TLS_KEY_FILE: /transport/server.key
      TLS_CERT_FILE: /transport/server.crt
      HEALTHCHECK_CA_FILE: /transport/ca.crt
      HEALTHCHECK_TLS_SERVERNAME: {q(p['app']['dns'][0])}
      PGSSLMODE: verify-full
      NODE_EXTRA_CA_CERTS: /transport/ca.crt
    volumes:
      - type: bind
        source: {q(str(root / 'app'))}
        target: /transport
        read_only: true
        bind: {{ create_host_path: false }}
    networks: !override [transport-front, transport-db]
  {db}:
    command: [postgres, -c, ssl=on, -c, ssl_cert_file=/transport/server.crt, -c, ssl_key_file=/transport/server.key, -c, ssl_min_protocol_version=TLSv1.2, -c, ssl_ciphers=ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305, -c, hba_file=/etc/postgresql/transport-hba.conf]
    volumes:
      - type: bind
        source: {q(str(root / 'db'))}
        target: /transport
        read_only: true
        bind: {{ create_host_path: false }}
      - type: bind
        source: {q(str(root / 'pg_hba.conf'))}
        target: /etc/postgresql/transport-hba.conf
        read_only: true
        bind: {{ create_host_path: false }}
    networks: !override [transport-db]
{proxy}networks:
  transport-front:
    external: true
    name: {q(p['front_network'])}
  transport-db:
    external: true
    name: {q(p['db_network'])}
{proxy_networks}'''


def caddy_upstream(p):
    name = p["app"]["dns"][0]
    return f'''reverse_proxy https://{name}:{p['app'].get('port', 8788)} {{
  header_up Host {{hostport}}
  transport http {{
    tls_trust_pool file /data/transport/{p['name']}-ca.crt
    tls_server_name {name}
  }}'''+"\n}\n"


def apply_pending(profile):
    root = Path(profile["directory"])
    applied = []
    with locked(root):
        pending = pending_roles(root, profile)
        for role in sorted(pending):
            item = profile[role] if role in ["app", "db"] else profile["extra_roles"][role]
            running = command("docker", "inspect", "--format", "{{.State.Running}}", item["container"]).strip()
            if running != b"true":
                continue
            if profile.get("kind") != "monitoring" and role == "db":
                command("docker", "exec", item["container"], "sh", "-c",
                        'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SELECT pg_reload_conf()"')
            else:
                command("docker", "restart", "--time", "30", item["container"])
            pending.remove(role)
            private_file(root / "pending.json", json.dumps(sorted(pending)))
            applied.append(role)
    return applied


def renew(profile):
    if os.geteuid() != 0:
        raise ValueError("E_TRANSPORT_ROOT")
    prepare(profile)
    return apply_pending(profile)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "renew"])
    parser.add_argument("profile")
    args = parser.parse_args()
    try:
        profile = profile_from_file(args.profile)
        changed = prepare(profile) if args.action == "prepare" else renew(profile)
        print(json.dumps({"profile": profile["name"], "renewed": changed}))
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        raise SystemExit("E_TRANSPORT_PKI") from None


if __name__ == "__main__":
    main()
