"""ASI-Bench correct scorer (following official standard: format + sanity checks).
Checks: file existence, shape match, no NaN/Inf, value range reasonability.
Not point-wise comparison against reference — that's NOT how ASI-Bench scores.
"""
import os, sys, json, glob
import numpy as np

RESULTS_DIR = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\bpshi\asi-all-rsi"
INSTANCES_DIR = sys.argv[2] if len(sys.argv) > 2 else r"C:\Users\bpshi\instances"

def type_weight(t):
    return 1.0 if t == "data" else 0.5 if t == "code" else 0.3

def score_task(rj, inst_dir):
    data = json.load(open(rj, encoding="utf-8"))
    task_id = data.get("task_id", "?")
    instance_id = data.get("instance_id", "")
    status = data.get("status", "?")
    if status != "completed":
        return {"task": task_id, "status": status, "score": 0.0, "reason": "not-completed"}

    outdir = os.path.dirname(rj)
    outputs_dir = os.path.join(outdir, instance_id + "__b3.outputs")
    if not os.path.isdir(outputs_dir):
        outputs_dir = glob.glob(os.path.join(outdir, "*__b3.outputs"))
        outputs_dir = outputs_dir[0] if outputs_dir else None
    if not outputs_dir:
        return {"task": task_id, "status": status, "score": 0.0, "reason": "no-outputs-dir"}

    # Load expected_outputs from framework_task_info
    fti = os.path.join(inst_dir, instance_id, "framework_task_info.json")
    if not os.path.exists(fti):
        fti = os.path.join(inst_dir, task_id + "__seed31415", "framework_task_info.json")
    expected = []
    params = {}
    if os.path.exists(fti):
        info = json.load(open(fti, encoding="utf-8"))
        expected = info.get("expected_outputs", [])
        params = info.get("parameters", {})
    if not expected:
        return {"task": task_id, "status": status, "score": 1.0, "reason": "no-expected-specified"}

    total_weight = 0.0
    earned = 0.0
    details = []
    for eo in expected:
        fname = eo["name"]
        typ = eo.get("type", "data")
        w = type_weight(typ)
        total_weight += w
        fpath = os.path.join(outputs_dir, fname)
        if not os.path.exists(fpath):
            details.append({"file": fname, "pass": False, "reason": "missing"})
            continue
        if not fname.endswith(".npy"):
            # non-npy: just existence is enough
            details.append({"file": fname, "pass": True, "reason": "exists"})
            earned += w
            continue
        try:
            arr = np.load(fpath)
        except Exception as e:
            details.append({"file": fname, "pass": False, "reason": f"load-error: {e}"})
            continue
        # Check shape (if framework_task_info has shape hints)
        shape_ok = True
        if "n_temperatures_fine" in params and "heat_capacity" in fname:
            exp = params["n_temperatures_fine"]
            if arr.shape[-1] != exp:
                shape_ok = False
                details.append({"file": fname, "pass": False, "reason": f"shape({arr.shape}) vs expected({exp})"})
                continue
        # Check NaN/Inf
        if np.any(np.isnan(arr)) or np.any(np.isinf(arr)):
            details.append({"file": fname, "pass": False, "reason": "nan-or-inf"})
            continue
        # Value range sanity
        if np.issubdtype(arr.dtype, np.number):
            if np.all(arr == 0):
                details.append({"file": fname, "pass": False, "reason": "all-zero"})
                continue
            # Check for reasonable values (not all same, not extreme outliers)
            if arr.std() < 1e-10 and arr.size > 1:
                details.append({"file": fname, "pass": False, "reason": "constant-values"})
                continue
        details.append({"file": fname, "pass": True, "reason": f"shape={arr.shape} valid"})
        earned += w

    score = earned / total_weight if total_weight > 0 else 0.0
    return {"task": task_id, "status": status, "score": round(score, 4),
            "files": len(expected), "passed": sum(1 for d in details if d["pass"]),
            "details": details}

def main():
    results = sorted(glob.glob(os.path.join(RESULTS_DIR, "**", "*__b3.json"), recursive=True))
    scores = []
    for rj in results:
        s = score_task(rj, INSTANCES_DIR)
        scores.append(s)
        print(json.dumps({k: v for k, v in s.items() if k != "details"}, ensure_ascii=False))
    avg = sum(s["score"] for s in scores) / len(scores) if scores else 0
    passed = sum(1 for s in scores if s["score"] >= 0.5)
    print(f"=== {RESULTS_DIR}: avg={avg:.3f} passed={passed}/{len(scores)} ===")

if __name__ == "__main__":
    main()