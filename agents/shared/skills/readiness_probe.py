"""Bounded readiness probe process; stdout contains only sanitized observations."""
import ipaddress
import json
import socket
import sys
from urllib.parse import urlsplit

from shared.harness.autonomy import PinnedHTTPS, json_scalar
from .readiness import HttpProbe


def probe(value):
    import os
    connection = None
    try:
        parsed = urlsplit(value.url)
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)}
        networks = [ipaddress.ip_network(item) for item in value.allowed_cidrs]
        if not addresses or any(ipaddress.ip_address(address).is_multicast or ipaddress.ip_address(address).is_unspecified or (not ipaddress.ip_address(address).is_global and not any(ipaddress.ip_address(address) in network for network in networks)) for address in addresses):
            return {"status": "blocked", "reason": "address_policy"}
        headers = {"Accept": "application/json, text/html", "Accept-Encoding": "identity"}
        if value.bearer_env:
            secret = os.getenv(value.bearer_env)
            if not secret or any(c in secret for c in "\r\n"):
                return {"status": "blocked", "reason": "credential_missing"}
            headers["Authorization"] = "Bearer " + secret
        connection = PinnedHTTPS(parsed.hostname, parsed.port or 443, sorted(addresses)[0])
        connection.request("GET", parsed.path or "/", headers=headers)
        response = connection.getresponse()
        observed = {"http_status": response.status}
        if 300 <= response.status < 400:
            return {**observed, "status": "blocked", "reason": "redirect"}
        if response.status != value.expected_status:
            return {**observed, "status": "blocked", "reason": "unexpected_status"}
        if value.revision_pointer is not None or value.ready_pointer is not None:
            if response.getheader("Content-Encoding", "identity") != "identity":
                return {**observed, "status": "error", "reason": "encoded_response"}
            body = response.read(65537)
            if len(body) > 65536:
                return {**observed, "status": "error", "reason": "response_limit"}
            document = json.loads(body)
            if value.revision_pointer is not None:
                revision = json_scalar(document, value.revision_pointer)
                if not isinstance(revision, str) or not 1 <= len(revision) <= 200:
                    return {**observed, "status": "error", "reason": "invalid_revision"}
                observed["revision"] = revision
            if value.ready_pointer is not None and json_scalar(document, value.ready_pointer) is not True:
                return {**observed, "status": "blocked", "reason": "worker_not_ready"}
        return {**observed, "status": "passed"}
    except Exception:
        return {"status": "error", "reason": "probe_failed"}
    finally:
        if connection:
            connection.close()


if __name__ == "__main__":
    try:
        value = HttpProbe.model_validate(json.loads(sys.stdin.buffer.read(32769)))
        print(json.dumps(probe(value)))
    except Exception:
        print(json.dumps({"status": "error", "reason": "invalid_probe_configuration"}))
