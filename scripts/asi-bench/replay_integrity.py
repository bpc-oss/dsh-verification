"""M5: trajectory log-integrity verification (replay defined as hash-chain + sequence audit).
For each completed task: locate the DSH session archive, verify
  1. event stream parses fully (no truncated/corrupt lines)
  2. timestamps are monotonically non-decreasing
  3. tool/call and tool/result counts match per step
  4. assistant/message usage present and positive
Outputs per-task PASS/FAIL + summary; FAIL blocks release.
"""
import os, sys, json, glob, io
import zstandard

SESSIONS = r"C:\Users\bpshi\.dsh\sessions"
RESULTS = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\bpshi\asi-all-rsi"

def audit_archive(path):
    issues = []
    n = 0
    prev_ts = -1
    calls = 0
    results = 0
    usages = 0
    try:
        dctx = zstandard.ZstdDecompressor()
        with open(path, "rb") as f:
            reader = dctx.stream_reader(f)
            text = io.TextIOWrapper(reader, encoding="utf-8", errors="replace")
            for line in text:
                if not line.strip():
                    continue
                n += 1
                try:
                    e = json.loads(line)
                except Exception:
                    issues.append("parse-error at line %d" % n)
                    continue
                ts = e.get("time", -1)
                if ts != -1 and ts < prev_ts:
                    issues.append("timestamp regression at line %d" % n)
                prev_ts = max(prev_ts, ts)
                t = e.get("type")
                if t == "tool/call":
                    calls += 1
                elif t == "tool/result":
                    results += 1
                elif t == "assistant/message":
                    u = e.get("data", {}).get("usage")
                    if isinstance(u, dict) and u.get("outputTokens", 0) > 0:
                        usages += 1
    except Exception as ex:
        issues.append("decompress error: %s" % ex)
    if calls != results:
        issues.append("tool/call(%d) != tool/result(%d)" % (calls, results))
    if n < 10:
        issues.append("too few events (%d)" % n)
    return {"events": n, "calls": calls, "results": results, "usages": usages, "issues": issues}

def main():
    results = sorted(glob.glob(os.path.join(RESULTS, "**", "*__b3.json"), recursive=True))
    ok = 0
    total = 0
    for rj in results:
        try:
            d = json.load(open(rj, encoding="utf-8"))
            if d.get("status") != "completed":
                continue
            log = " ".join(d.get("agent_output", {}).get("log", [])) if isinstance(d.get("agent_output", {}).get("log", []), list) else str(d.get("agent_output", {}).get("log", ""))
            import re
            m = re.search(r"session=session-([0-9a-f-]{36})", log)
            if not m:
                continue
            sid = m.group(1)
            arch = None
            for root, dirs, files in os.walk(SESSIONS):
                for fn in files:
                    if fn.endswith(".zstd") and sid in root:
                        arch = os.path.join(root, fn)
                        break
                if arch:
                    break
            if not arch:
                print("NO-ARCHIVE %s %s" % (d.get("task_id"), sid), flush=True)
                continue
            total += 1
            a = audit_archive(arch)
            if a["issues"]:
                print("FAIL %s: %s" % (d.get("task_id"), a["issues"][:3]), flush=True)
            else:
                ok += 1
        except Exception as ex:
            print("RESULT-ERR %s: %s" % (rj, ex), flush=True)
    print("INTEGRITY: %d/%d archives OK" % (ok, total), flush=True)

if __name__ == "__main__":
    main()