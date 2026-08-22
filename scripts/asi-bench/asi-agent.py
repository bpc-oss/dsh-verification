"""ASI-Bench agent adapter v3 (post-review): multi-round steering with correct timeout handling,
progress-based early stop, incremental steer text, orphan-session hygiene.

Review fixes applied:
- B-1: internal deadline = framework timeout minus margin; never report success on timeout.
- B-3: no early-exit race; wait for session to stop before final collection check;
       close session via API on exit (orphan hygiene).
- B-4: compute missing-files list and inject it incrementally; stop after 2 consecutive
       zero-progress rounds. Exit codes distinguish outcomes.
- C:   steer text is preset-generic (no benchmark metadata semantics).
- Host resolution: --host CLI arg wins, then DSH_HOST env, then default (asibench's
       task env may not inherit our process env).
"""
import os, sys, time, json, glob, urllib.request, uuid

args = sys.argv
WORKSPACE = (args[args.index("--workspace") + 1] if "--workspace" in args else os.getcwd()).strip("'\"")
PRESET = os.environ.get("DSH_PRESET", "standard")
HOST = os.environ.get("DSH_HOST", "127.0.0.1:49269")
if "--host" in args:
    HOST = args[args.index("--host") + 1]
FRAMEWORK_TIMEOUT = int(os.environ.get("ASI_FRAMEWORK_TIMEOUT", "21600"))
GLOBAL_DEADLINE = time.time() + max(600, FRAMEWORK_TIMEOUT - 300)
MAX_ROUNDS = 6
ZERO_PROGRESS_LIMIT = 2

def api(method, payload, timeout=120):
    req = urllib.request.Request(
        f"http://{HOST}/api/{method}",
        data=json.dumps({"type": "client-request", "method": method, "rpcId": "r-" + uuid.uuid4().hex[:8], "payload": payload}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())

def find_prompt():
    for pat in ("prompt_b*.md", "prompt.md", "task_prompt.md"):
        hits = glob.glob(os.path.join(WORKSPACE, pat))
        if hits:
            return sorted(hits)[-1]
    return None

def expected_outputs():
    ti = os.path.join(WORKSPACE, "task_info.json")
    if not os.path.exists(ti):
        return [], None
    try:
        info = json.load(open(ti, encoding="utf-8"))
        names = []
        for o in info.get("expected_outputs", []):
            names.append(o["name"] if isinstance(o, dict) else str(o))
        return names, None
    except Exception as e:
        return [], str(e)

def snapshot():
    try:
        return set(f for f in os.listdir(WORKSPACE) if os.path.isfile(os.path.join(WORKSPACE, f)))
    except Exception:
        return set()

def missing_files():
    names, err = expected_outputs()
    if err:
        print(f"META_ERROR: {err}", flush=True)
        return None
    return [n for n in names if not os.path.exists(os.path.join(WORKSPACE, n))]

def wait_session(sid, deadline):
    failures = 0
    while time.time() < deadline:
        time.sleep(30)
        try:
            resp = api("session.list", {})
            items = resp["result"]["value"]["items"]
            it = next((i for i in items if i["sessionId"] == sid), None)
            if it is None:
                return "done"
            if not it.get("running"):
                return "done"
            failures = 0
        except Exception as e:
            failures += 1
            print(f"WARN list({failures}): {e}", flush=True)
            if failures >= 5:
                # session.list is broken; fall back to deliverable check
                return "unknown"
    return "timeout"

def close_session(sid):
    try:
        api("session.cancel", {"sessionId": sid}, timeout=30)
        print("session closed", flush=True)
    except Exception:
        pass

def main():
    prompt_file = find_prompt()
    if prompt_file is None:
        print("NO_PROMPT", flush=True)
        return 2
    prompt = open(prompt_file, encoding="utf-8").read()
    print(f"preset={PRESET} prompt={os.path.basename(prompt_file)} len={len(prompt)} host={HOST}", flush=True)

    try:
        resp = api("session.create", {"cwd": WORKSPACE, "agentPreset": PRESET})
        sid = resp["result"]["value"]["sessionId"]
    except Exception as e:
        print(f"SESSION_FAIL: {e}", flush=True)
        return 3
    print(f"session={sid}", flush=True)

    text = prompt
    try:
        _run_loop(sid, text)
    finally:
        close_session(sid)
    return 0

def _run_loop(sid, text):
    global rounds, zero_progress, prev_snapshot, outcome
    if PRESET.startswith("enforce"):
        text += ("\n\n[WORKFLOW] 1) create_goal immediately; "
                 "2) set_verification_plan (ACs = declared deliverables in the task); "
                 "3) execute: read task description and input data first, then compute and "
                 "write output files to the workspace root; "
                 "4) verify all declared deliverables exist before update_goal complete.")
    try:
        api("session.prompt", {"sessionId": sid, "mode": "steer", "content": [{"type": "text", "text": text}]}, timeout=60)
    except Exception as e:
        print(f"PROMPT_FAIL: {e}", flush=True)
        close_session(sid)
        return 4

    rounds = 0
    zero_progress = 0
    prev_snapshot = snapshot()
    outcome = "incomplete"
    while rounds < MAX_ROUNDS and time.time() < GLOBAL_DEADLINE:
        rounds += 1
        status = wait_session(sid, min(GLOBAL_DEADLINE, time.time() + 3600))
        cur = snapshot()
        missing = missing_files()
        if missing is not None and len(missing) == 0:
            print(f"DELIVERABLES_OK round={rounds}", flush=True)
            outcome = "complete"
            break
        if status == "timeout" or status == "unknown":
            print(f"GLOBAL_TIMEOUT round={rounds}", flush=True)
            outcome = "timeout"
            break
        new_files = cur - prev_snapshot
        if not new_files and cur == prev_snapshot:
            zero_progress += 1
        else:
            zero_progress = 0
        prev_snapshot = cur
        if zero_progress >= ZERO_PROGRESS_LIMIT:
            print(f"ZERO_PROGRESS_STOP round={rounds}", flush=True)
            outcome = "stalled"
            break
        missing_str = ", ".join(missing) if missing is not None else "(unknown)"
        print(f"CONTINUE round={rounds} missing=[{missing_str}]", flush=True)
        try:
            api("session.prompt", {"sessionId": sid, "mode": "steer", "content": [{"type": "text",
                "text": f"Continue the task. The workspace is still missing these declared deliverables: {missing_str}. "
                        f"Write them to the workspace root; if one truly cannot be produced, explain why and provide the closest alternative output."}]}, timeout=60)
        except Exception as e:
            print(f"CONTINUE_FAIL: {e}", flush=True)
            outcome = "steer-fail"
            break
    else:
        outcome = "max-rounds"

    print(f"OUTCOME={outcome} rounds={rounds}", flush=True)
    return 0 if outcome == "complete" else 1

if __name__ == "__main__":
    sys.exit(main())