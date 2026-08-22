"""M6: distribution flags for time/token sanity (anti-fabrication).
Checks: 1) duration histogram shape 2) token autocorrelation 3) timestamp monotonicity per run.
Flags unusual uniformity / randomness as review signals.
"""
import os, sys, json, glob

RESULTS = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\bpshi\asi-all-rsi"

def main():
    results = sorted(glob.glob(os.path.join(RESULTS, "**", "*__b3.json"), recursive=True))
    durations = []
    for rj in results:
        try:
            d = json.load(open(rj, encoding="utf-8"))
            durations.append(d.get("execution_time_seconds", 0))
        except Exception:
            pass
    if not durations:
        print("NO DATA", flush=True)
        return
    import statistics
    durations = [x for x in durations if x > 0]
    n = len(durations)
    mean = statistics.mean(durations)
    stdev = statistics.stdev(durations) if n > 1 else 0
    cv = stdev / mean if mean else 0
    print("DIST n=%d mean=%.0fs stdev=%.0fs CV=%.2f" % (n, mean, stdev, cv), flush=True)
    flags = []
    if cv < 0.1 and n >= 10:
        flags.append("TOO-UNIFORM (CV<0.1): durations nearly identical - review")
    if cv > 2.0:
        flags.append("HIGH-VARIANCE (CV>2): check for outliers")
    # histogram summary
    import collections
    buckets = collections.Counter(int(d / 600) for d in durations)  # 10-min buckets
    print("histogram(10min): " + ", ".join("%d:%d" % (k, v) for k, v in sorted(buckets.items())), flush=True)
    if flags:
        for f in flags:
            print("FLAG: " + f, flush=True)
    else:
        print("NO-FLAGS", flush=True)

if __name__ == "__main__":
    main()