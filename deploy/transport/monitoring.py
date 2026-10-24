"""Generate native, verified TLS configuration for the opt-in monitoring stack."""
import json
from pathlib import Path
import shutil
from pki import private_file


def render_monitoring(p):
    root = Path(p["directory"])
    source = Path(__file__).resolve().parent.parent / "observability"
    config = root / "config"
    config.mkdir(mode=0o755, exist_ok=True)
    provisioning = config / "provisioning"
    shutil.copytree(source / "grafana/provisioning", provisioning, dirs_exist_ok=True)
    data_source = provisioning / "datasources/prometheus.yml"
    # This is a public CA certificate, never an encryption/signing private key.
    ca = (root / "ca.crt").read_text()
    data_source.write_text("apiVersion: 1\nprune: true\ndatasources:\n"
        "  - name: Prometheus\n    uid: moongame-prometheus\n    type: prometheus\n"
        "    access: proxy\n    url: https://obs-prometheus:9090\n    isDefault: true\n"
        "    editable: false\n    jsonData:\n      httpMethod: GET\n      timeInterval: 15s\n"
        "      queryTimeout: 10s\n      prometheusType: Prometheus\n      tlsAuthWithCACert: true\n"
        "      serverName: obs-prometheus\n    secureJsonData:\n      tlsCACert: |\n" +
        "".join("        " + line + "\n" for line in ca.splitlines()))
    data_source.chmod(0o644)
    # Remove the original datasource definition after replacing the same UID.
    for path in (provisioning / "datasources").glob("*.y*ml"):
        if path != data_source:
            path.unlink()
    prometheus = (source / "prometheus.yml").read_text()
    for name, identity in [("prometheus", "localhost"), ("alloy", "obs-alloy"), ("observer", "obs-alloy")]:
        needle = f"  - job_name: {name}\n"
        if prometheus.count(needle) != 1:
            raise ValueError("E_TRANSPORT_MONITORING_CONFIG")
        prometheus = prometheus.replace(needle, needle + "    scheme: https\n    tls_config:\n"
            f"      ca_file: /transport/ca.crt\n      server_name: {identity}\n      min_version: TLS12\n")
    private_file(config / "prometheus.yml", prometheus, 0o644)
    private_file(config / "prometheus-web.yml", "tls_server_config:\n"
        "  cert_file: /transport/server.crt\n  key_file: /transport/server.key\n  min_version: TLS12\n", 0o644)
    private_file(config / "config.alloy", (source / "config.alloy").read_text() + "\nhttp {\n  tls {\n"
        '    cert_file = "/transport/server.crt"\n    key_file = "/transport/server.key"\n'
        '    min_version = "TLS12"\n  }\n}\n', 0o644)
    loki = (source / "loki.yml").read_text()
    needle = "  http_listen_port: 3100\n"
    if loki.count(needle) != 1:
        raise ValueError("E_TRANSPORT_MONITORING_CONFIG")
    loki = loki.replace(needle, needle + "  grpc_listen_address: 127.0.0.1\n"
        "  tls_min_version: VersionTLS12\n  http_tls_config:\n"
        "    cert_file: /transport/server.crt\n    key_file: /transport/server.key\n")
    private_file(config / "loki.yml", loki, 0o644)
    q = json.dumps

    def mounts(role, extra):
        values = [(root / role, "/transport"), (root.parent / "bin/probe", "/transport-probe"), *extra]
        return "\n".join("      - type: bind\n        source: " + q(str(src)) + "\n        target: " + q(target) +
            "\n        read_only: true\n        bind: { create_host_path: false }" for src, target in values)

    def health(port, path):
        return f'    healthcheck:\n      test: [CMD, /transport-probe, --port, "{port}", --path, "{path}"]\n'

    return f'''# Native TLS; only Grafana joins the Caddy-facing monitoring network.
services:
  obs-grafana:
    environment:
      GF_SERVER_PROTOCOL: https
      GF_SERVER_CERT_FILE: /transport/server.crt
      GF_SERVER_CERT_KEY: /transport/server.key
      GF_SERVER_ROOT_URL: ${{OBS_GRAFANA_ROOT_URL:-https://localhost:3000/}}
      GF_SECURITY_COOKIE_SECURE: 'true'
    volumes:
{mounts('app', [(provisioning, '/etc/grafana/provisioning')])}
    networks: !override [observability, transport-monitor-front]
{health(3000, '/api/health')}
  obs-prometheus:
    command: [--config.file=/etc/prometheus/prometheus.yml, --web.config.file=/etc/prometheus/transport-web.yml, --storage.tsdb.path=/prometheus, --storage.tsdb.retention.time=7d, --storage.tsdb.retention.size=1500MB, --query.timeout=10s, --query.max-concurrency=4, --query.max-samples=100000]
    volumes:
{mounts('db', [(config / 'prometheus.yml', '/etc/prometheus/prometheus.yml'), (config / 'prometheus-web.yml', '/etc/prometheus/transport-web.yml')])}
{health(9090, '/-/ready')}
  obs-alloy:
    volumes:
{mounts('alloy', [(config / 'config.alloy', '/etc/alloy/config.alloy')])}
{health(12345, '/-/ready')}
  obs-loki:
    volumes:
{mounts('loki', [(config / 'loki.yml', '/etc/loki/config.yml')])}
{health(3100, '/ready')}
networks:
  transport-monitor-front:
    external: true
    name: {q(p['front_network'])}
'''
