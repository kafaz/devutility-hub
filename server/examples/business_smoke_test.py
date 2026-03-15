#!/usr/bin/env python3
import argparse
import json
import sys
import time
import urllib.error
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser(description="Simple business smoke controller for DevUtility diagnostic workbench")
    parser.add_argument("--action", default="health-check", help="business action name")
    parser.add_argument("--target", default="", help="logical business target")
    parser.add_argument("--url", default="", help="optional http endpoint to invoke")
    parser.add_argument("--method", default="POST", help="http method when --url is provided")
    parser.add_argument("--timeout", type=float, default=5.0, help="http timeout seconds")
    parser.add_argument("--expect-status", type=int, default=200, help="expected http status when --url is provided")
    args = parser.parse_args()

    payload = sys.stdin.read()
    started_at = time.time()
    result = {
        "action": args.action,
        "target": args.target,
        "url": args.url,
        "method": args.method.upper(),
        "payload": payload,
        "startedAt": started_at,
    }

    if not args.url:
        result.update({
            "mode": "mock",
            "status": "ok",
            "message": "No URL provided, emitted a mock business verification result.",
            "durationMs": int((time.time() - started_at) * 1000),
        })
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    body = payload.encode("utf-8") if payload else None
    request = urllib.request.Request(args.url, data=body if args.method.upper() != "GET" else None, method=args.method.upper())
    if body:
        request.add_header("Content-Type", "application/json; charset=utf-8")

    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            text = response.read().decode("utf-8", errors="replace")
            result.update({
                "mode": "http",
                "httpStatus": response.status,
                "responseBody": text[:2000],
                "durationMs": int((time.time() - started_at) * 1000),
            })
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0 if response.status == args.expect_status else 2
    except urllib.error.HTTPError as exc:
        result.update({
            "mode": "http",
            "httpStatus": exc.code,
            "error": exc.reason,
            "responseBody": exc.read().decode("utf-8", errors="replace")[:2000],
            "durationMs": int((time.time() - started_at) * 1000),
        })
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2
    except Exception as exc:
        result.update({
            "mode": "http",
            "error": str(exc),
            "durationMs": int((time.time() - started_at) * 1000),
        })
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
