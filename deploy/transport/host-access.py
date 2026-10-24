#!/usr/bin/env python3
"""Restrict local users' connections to Docker-private service addresses.

Only host OUTPUT is filtered: container FORWARD traffic and public HTTP/HTTPS/SSH
are unaffected. Root operators retain access; the observer gets app/metrics ports.
"""
import argparse
import ipaddress
import json
import os
import subprocess

CHAIN = "MOONGAME_LOCAL"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--observer-uid", type=int, required=True)
    parser.add_argument("--check", action="store_true", help="validate rules without changing the firewall")
    parser.add_argument("--edge-container", default="deploy-caddy-1")
    parser.add_argument("networks", nargs="+")
    args = parser.parse_args()
    if os.geteuid() != 0 or args.observer_uid <= 0:
        raise SystemExit("E_TRANSPORT_ROOT")
    networks = json.loads(subprocess.check_output(["docker", "network", "inspect", *args.networks]))
    edge = json.loads(subprocess.check_output(["docker", "inspect", args.edge_container]))[0]
    edge_ips = {str(ipaddress.ip_address(value[key])) for value in edge["NetworkSettings"]["Networks"].values()
                for key in ["IPAddress", "GlobalIPv6Address"] if value.get(key)}
    ipv4, ipv6 = set(), set()
    for network in networks:
        for config in network["IPAM"]["Config"]:
            subnet = ipaddress.ip_network(config["Subnet"])
            (ipv4 if subnet.version == 4 else ipv6).add(str(subnet))
    for tool, subnets, loopback in [("iptables", ipv4, "127.0.0.0/8"), ("ip6tables", ipv6, "::1/128")]:
        # iptables-restore applies each table's update atomically. Preserve all
        # existing host/provider/Docker rules; only our dedicated chain is reset.
        run = lambda *argv: subprocess.run([tool, "-w", "10", *argv], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        rules = ["*filter", f":{CHAIN} - [0:0]", f"-F {CHAIN}",
                 f"-A {CHAIN} -m owner --uid-owner 0 -j RETURN"]
        # Published public ports are DNATed before OUTPUT filtering. Preserve
        # access to the public edge even when its post-DNAT IP is private.
        for address in sorted(edge_ips):
            if (ipaddress.ip_address(address).version == 4) == (tool == "iptables"):
                rules.append(f"-A {CHAIN} -d {address} -p tcp -m multiport --dports 80,443 -j RETURN")
        for subnet in sorted(subnets):
            rules += [f"-A {CHAIN} -d {subnet} -p tcp -m owner --uid-owner {args.observer_uid} -m multiport --dports 8788,9108 -j RETURN",
                      f"-A {CHAIN} -d {subnet} -j REJECT"]
        rules += [f"-A {CHAIN} -d {loopback} -p tcp -m owner --uid-owner {args.observer_uid} -m multiport --dports 8788,9108 -j RETURN",
                  f"-A {CHAIN} -d {loopback} -p tcp -m multiport --dports 5432,8788,3000,9090,3100,12345,12346,9108 -j REJECT",
                  f"-A {CHAIN} -j RETURN", "COMMIT", ""]
        restore = [tool + "-restore", "--wait", "10", "--noflush"]
        subprocess.run(restore + ["--test"], input="\n".join(rules).encode(), check=True)
        if args.check:
            continue
        subprocess.run(restore, input="\n".join(rules).encode(), check=True)
        if run("-C", "OUTPUT", "-j", CHAIN).returncode:
            subprocess.run([tool, "-w", "10", "-I", "OUTPUT", "1", "-j", CHAIN], check=True)


if __name__ == "__main__":
    main()
