"""M1: build masked instances tree (enforce-standard-masked condition).
Steps:
  1. Copy instances-enf -> instances-enf-masked (dereference symlinks)
  2. Remove reference/ dirs
  3. Sanitize instance_meta.json (drop gt_summary/oracle/gold keys + value fingerprints)
  4. Rewrite prompt lines mentioning reference/ (record diffs)
  5. Leak-scan gate: regex over whole tree; fail if any hit
  6. Write SHA256 manifest
"""
import os, re, shutil, json, hashlib, sys

SRC = r"C:\Users\bpshi\instances-enf"
DST = r"C:\Users\bpshi\instances-enf-masked"
MANIFEST = r"C:\Users\bpshi\masked-manifest.json"
DIFFLOG = r"C:\Users\bpshi\masked-diffs.json"

LEAK_PATTERNS = [
    r"gt_summary", r"oracle(?!_)", r"_ref\.(csv|npy|json|npz|png)", r"hidden_suite",
    r"true_states", r"support_truth_hidden", r"solutions_ref", r"reference_metrics",
    r"risk_summary\.csv", r"deployment_truth", r"truth\.csv", r"truth\.npy",
]
# expected_outputs file names (allowed in prompts/framework_task_info)
ALLOWED_EO = ["prediction_quantiles.npy", "risk_summary.csv", "simulation.py",
              "final_coords.npy", "heat_capacity_curve.npy", "temperature_observables.json",
              "visualization.png", "transition_analysis.json", "inferred_network.npy",
              "edge_sign_predictions.npy", "hub_genes.json", "method_comparison.json",
              "network_metrics.json", "analysis.py"]
META_STRIP_KEYS = ["gt_summary", "oracle_metrics", "gold_metrics", "solutions_ref",
                   "hidden_suite", "reference_files", "expected_outputs",
                   "acceptance_audit", "checksums", "scorer_meta",
                   "hidden_generation", "hidden_suite_manifest", "hidden_nuisance",
                   "initial_state_records", "phase_summary", "phase_fit_diagnostics",
                   "summary", "hidden_", "generation_time_seconds"]

def leak_scan(root):
    hits = []
    for dirpath, dirnames, filenames in os.walk(root):
        if "reference" in dirnames:
            hits.append(("dir", os.path.join(dirpath, "reference")))
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            try:
                with open(p, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception:
                continue
            for pat in LEAK_PATTERNS:
                for m in re.finditer(pat, content, re.IGNORECASE):
                    # allow expected_outputs file names when mentioned standalone
                    ctx = content[max(0, m.start()-60):m.end()+60]
                    if any(eo in ctx for eo in ALLOWED_EO):
                        continue
                    # allow case_pack parameter values (task input names, not gold)
                    if "case_pack" in ctx or "suite_mode" in ctx or "task_id" in ctx and "hidden" in pat:
                        continue
                    # allow scoring-description mentions of 'oracle' in prompts
                    if "oracle" in pat and any(w in ctx for w in ("scorer", "evaluat", "comput", "solution")):
                        continue
                    hits.append(("regex", p, pat))
                    break
    return hits

def sanitize_nested(obj, removed_log, path=""):
    """Recursively remove keys matching hidden/gold/truth/ref/suite/summary/oracle."""
    if isinstance(obj, dict):
        for k in list(obj.keys()):
            kl = k.lower()
            if any(s in kl for s in ("hidden", "gold", "truth", "oracle", "answer",
                                     "gt_", "reference", "suite", "summary",
                                     "nuisance", "initial_state", "phase")):
                removed_log.append(path + "/" + k)
                del obj[k]
            else:
                sanitize_nested(obj[k], removed_log, path + "/" + k)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            sanitize_nested(item, removed_log, path + f"[{i}]")

def sanitize_meta(meta_path):
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except Exception as e:
        return {"path": meta_path, "error": str(e)}
    removed = {}
    for k in META_STRIP_KEYS:
        if k in meta:
            removed[k] = meta.pop(k)
    removed_log = []
    sanitize_nested(meta, removed_log)
    for r in removed_log:
        removed[r] = "<nested>"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    return {"path": meta_path, "removed": list(removed.keys())}

def rewrite_prompts(task_dir):
    """Rewrite prompt lines mentioning reference/ ; return diff list."""
    diffs = []
    for fn in os.listdir(task_dir):
        if not fn.startswith("prompt_") or not fn.endswith(".md"):
            continue
        p = os.path.join(task_dir, fn)
        with open(p, "r", encoding="utf-8") as f:
            lines = f.readlines()
        changed = []
        new_lines = []
        for i, line in enumerate(lines):
            if "reference" in line.lower():
                changed.append({"line": i + 1, "before": line.strip()[:120]})
                new_lines.append("[redacted reference mention]\n")
            else:
                new_lines.append(line)
        if changed:
            with open(p, "w", encoding="utf-8") as f:
                f.writelines(new_lines)
            diffs.append({"file": os.path.join(task_dir, fn), "changes": changed})
    return diffs

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def main():
    if os.path.exists(DST):
        print("DST exists; removing", flush=True)
        shutil.rmtree(DST)
    print("Copying tree (dereference symlinks)...", flush=True)
    # copytree with follow_symlinks=True dereferences symlinks
    shutil.copytree(SRC, DST, symlinks=False, ignore=shutil.ignore_patterns())
    print("Copy done.", flush=True)

    diffs_all = []
    sanitized = []
    tasks = [d for d in os.listdir(DST) if os.path.isdir(os.path.join(DST, d))]
    print(f"tasks: {len(tasks)}", flush=True)
    for t in tasks:
        tdir = os.path.join(DST, t)
        ref = os.path.join(tdir, "reference")
        if os.path.isdir(ref):
            shutil.rmtree(ref)
        # remove data/manifest.json (contains reference_model / suite info)
        man = os.path.join(tdir, "data", "manifest.json")
        if os.path.exists(man):
            os.remove(man)
        meta = os.path.join(tdir, "instance_meta.json")
        if os.path.exists(meta):
            sanitized.append(sanitize_meta(meta))
        fti = os.path.join(tdir, "framework_task_info.json")
        if os.path.exists(fti):
            sanitized.append(sanitize_meta(fti))
        diffs_all.extend(rewrite_prompts(tdir))

    with open(DIFFLOG, "w", encoding="utf-8") as f:
        json.dump({"prompt_diffs": diffs_all, "meta_sanitized": sanitized}, f, ensure_ascii=False, indent=1)

    print("Leak scan...", flush=True)
    hits = leak_scan(DST)
    if hits:
        print(f"LEAK SCAN FAILED: {len(hits)} hits", flush=True)
        for h in hits[:20]:
            print("  ", h, flush=True)
        sys.exit(1)
    print("LEAK SCAN PASS (zero hits)", flush=True)

    # manifest
    manifest = {}
    for dirpath, dirnames, filenames in os.walk(DST):
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, DST)
            manifest[rel] = sha256_file(p)
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    print(f"MANIFEST written: {len(manifest)} files", flush=True)
    print("M1 DONE", flush=True)

if __name__ == "__main__":
    main()