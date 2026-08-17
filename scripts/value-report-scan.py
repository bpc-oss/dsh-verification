import glob, os, json
import zstandard as zstd

SESSIONS = r"C:\Users\Administrator\.dsh\sessions"
files = glob.glob(os.path.join(SESSIONS, "*", "*.jsonl.zstd"))
files += glob.glob(os.path.join(SESSIONS, "*", "*", "*.jsonl.zstd"))

def dec(p):
    try:
        with open(p, "rb") as f:
            d = zstd.ZstdDecompressor()
            with d.stream_reader(f, read_across_frames=True) as r:
                return r.read().decode("utf-8", "replace")
    except Exception:
        return None

def is_smoke(ws):
    return ".smoke" in ws or "tmp-profile-pkgs" in ws or "profiles-verify" in ws or "resources-host" in ws

agg = {"contracts":0,"verdicts":0,"pass":0,"fail":0,"need_human":0,
       "gates":0,"gate_done":0,"gate_failed":0,"gate_blocked":0,
       "evidence":0,"capfail":0,"sessions":set()}
agg_real = dict(agg)
per_session = {}

for f in files:
    t = dec(f)
    if t is None: continue
    sid = os.path.basename(os.path.dirname(f))
    ws = os.path.basename(os.path.dirname(os.path.dirname(f)))
    smoke = is_smoke(ws)
    local = {k: 0 for k in ("contracts","verdicts","pass","fail","gates","gate_done","gate_failed","evidence","capfail")}
    for line in t.splitlines():
        if '"verification/change"' not in line: continue
        try: ev = json.loads(line)
        except Exception: continue
        if ev.get("type") != "verification/change": continue
        rec = (ev.get("data") or {}).get("record")
        if not rec: continue
        kind = rec.get("kind")
        agg["sessions"].add(sid)
        if smoke: continue
        agg_real["sessions"].add(sid)
        local["contracts"] += 1 if kind == "plan" else 0
        if kind == "verdicts":
            for ac_id, v in (rec.get("verdicts") or {}).items():
                agg_real["verdicts"] += 1; local["verdicts"] += 1
                r = v.get("result")
                if r == "pass": agg_real["pass"] += 1; local["pass"] += 1
                elif r == "fail": agg_real["fail"] += 1
                elif r == "need_human": agg_real["need_human"] += 1
        elif kind == "gate":
            st = (rec.get("entry") or {}).get("status")
            agg_real["gates"] += 1; local["gates"] += 1
            if st == "done": agg_real["gate_done"] += 1; local["gate_done"] += 1
            elif st == "failed": agg_real["gate_failed"] += 1
            elif st == "blocked": agg_real["gate_blocked"] += 1
        elif kind == "evidence": agg_real["evidence"] += 1; local["evidence"] += 1
        elif kind == "capture-failure": agg_real["capfail"] += 1; local["capfail"] += 1
    if local["contracts"] or local["verdicts"] or local["gates"] or local["evidence"] or local["capfail"]:
        per_session[sid] = (ws, local)

print("=== REAL-SESSION AGGREGATE (excluding smoke/test/verify workspaces) ===")
A = agg_real
print("sessions:", len(A["sessions"]))
print("contracts:", A["contracts"])
print("verdicts:", A["verdicts"], "| pass:", A["pass"], "| fail:", A["fail"], "| need_human:", A["need_human"])
print("gates:", A["gates"], "| done(pass):", A["gate_done"], "| failed:", A["gate_failed"], "| blocked:", A["gate_blocked"])
print("evidence refs:", A["evidence"], "| capture failures:", A["capfail"])
print()
print("=== PER-SESSION (real) ===")
for sid, (ws, l) in sorted(per_session.items(), key=lambda kv: -sum(kv[1][1].values())):
    print(f"- {sid}  {ws}")
    print(f"    contracts={l['contracts']} verdicts={l['verdicts']}(pass {l['pass']}) gates={l['gates']}(done {l['gate_done']}) evidence={l['evidence']} capfail={l['capfail']}")
