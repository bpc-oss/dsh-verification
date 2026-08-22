"""Summarize time and token cost per condition with Input/Output/Cache breakdown.
Per condition: iterate result JSONs -> extract sessionId from agent log -> find session archive -> sum usage.
"""
import os, sys, json, glob, re
import zstandard, io

RESULTS_DIRS = sys.argv[1] if len(sys.argv) > 1 else "asi-all-rsi,asi-all-enf,asi-all-std,asi-all-min"
SESSIONS_DIR = sys.argv[2] if len(sys.argv) > 2 else r"C:\Users\bpshi\.dsh\sessions"
HOME = sys.argv[3] if len(sys.argv) > 3 else r"C:\Users\bpshi"

def parse_session_usage(path):
    inp = 0
    out = 0
    cache = 0
    try:
        dctx = zstandard.ZstdDecompressor()
        with open(path, 'rb') as f:
            reader = dctx.stream_reader(f)
            text = io.TextIOWrapper(reader, encoding='utf-8', errors='replace')
            for line in text:
                if not line.strip():
                    continue
                try:
                    e = json.loads(line)
                    if e.get('type') == 'assistant/message':
                        u = e.get('data', {}).get('usage')
                        if isinstance(u, dict):
                            inp += u.get('inputTokens', 0) or 0
                            out += u.get('outputTokens', 0) or 0
                            cache += u.get('cacheReadTokens', 0) or 0
                except (json.JSONDecodeError, KeyError):
                    pass
    except Exception:
        pass
    return inp, out, cache

def find_archive(sid, sessions_dir):
    for root, dirs, files in os.walk(sessions_dir):
        for fn in files:
            if fn.endswith('.zstd') and sid in root:
                return os.path.join(root, fn)
    return None

def main():
    conditions = [c.strip() for c in RESULTS_DIRS.split(",")]
    hdr = ("condition,results,total_time_min,avg_time_min,completed,failed,"
           "input_tok,output_tok,cache_tok,total_tok,avg_output_tok,"
           "input_per_task,output_per_task,cache_per_task,total_per_task")
    print(hdr)
    for cond in conditions:
        results_dir = os.path.join(HOME, cond)
        results = sorted(glob.glob(os.path.join(results_dir, "**", "*__b3.json"), recursive=True))
        total_time = 0.0
        completed = 0
        failed = 0
        inp = out = cache = 0
        n_tok_sessions = 0
        for rj in results:
            try:
                d = json.load(open(rj, encoding="utf-8"))
                total_time += d.get("execution_time_seconds", 0)
                if d.get("status") == "completed":
                    completed += 1
                else:
                    failed += 1
                log = " ".join(d.get("agent_output", {}).get("log", [])) if isinstance(d.get("agent_output", {}).get("log", []), list) else str(d.get("agent_output", {}).get("log", ""))
                m = re.search(r"session=session-([0-9a-f-]{36})", log)
                if m:
                    arch = find_archive(m.group(1), SESSIONS_DIR)
                    if arch:
                        i, o, c = parse_session_usage(arch)
                        inp += i
                        out += o
                        cache += c
                        n_tok_sessions += 1
            except Exception:
                pass
        n = max(1, len(results))
        nt = max(1, n_tok_sessions)
        print(f"{cond},{len(results)},{total_time/60:.0f},{total_time/60/n:.1f},{completed},{failed},"
              f"{inp},{out},{cache},{inp+out+cache},{out//nt},"
              f"{inp//n},{out//n},{cache//n},{(inp+out+cache)//n}")
if __name__ == "__main__":
    main()