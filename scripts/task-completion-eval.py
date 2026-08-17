#!/usr/bin/env python3
"""
完成任务能力评估（真实数据）——真实任务 benchmark 第二程。
================================================================

只测"拦截"不够：核心价值是**能否让真实完成的任务通过**（不被误拒）。
本脚本对每个真实契约的每条 fail 裁决做"交付物存在性"交叉验证：

  1. 从 AC 描述中提取交付路径（如 docs/、src/ 等目录线索）；
  2. 从会话证据日志收集该 AC 权威作用域内的写类证据（write/edit → file_diff，
     路径含交付线索）——证据表明交付物被真实产生；
  3. 若存在写类证据指向交付物、但 gate 判 fail → **假拒绝（false rejection）候选**；
     若既无写类证据也无匹配 selector 证据 → 一致 fail（真负）。

输出：逐 AC 分类 + 汇总指标（真负 / 假拒绝 / 真通过），并对假拒绝给出证据链。
"""
import glob
import json
import os
import re
import zstandard as zstd

SESSIONS = r"C:\Users\Administrator\.dsh\sessions"


def is_smoke(ws: str) -> bool:
    return ".smoke" in ws or "tmp-profile-pkgs" in ws or "profiles-verify" in ws or "resources-host" in ws


def dec(path: str):
    try:
        with open(path, "rb") as f:
            d = zstd.ZstdDecompressor()
            with d.stream_reader(f, read_across_frames=True) as r:
                return r.read().decode("utf-8", "replace")
    except Exception:
        return None


def collect(path: str):
    t = dec(path)
    if t is None:
        return None
    out = {"plan": [], "evidence": [], "verdicts": []}
    for line in t.splitlines():
        if '"verification/change"' not in line:
            continue
        try:
            ev = json.loads(line)
        except Exception:
            continue
        if ev.get("type") != "verification/change":
            continue
        rec = (ev.get("data") or {}).get("record") or {}
        k = rec.get("kind")
        if k in out:
            out[k].append(rec)
    return out


# 交付路径线索：AC 描述/目标里常见的可验证产物目录
DELIVERABLE_HINTS = ["docs", "src", "config", "lib", "test", "scripts", "README", "package.json", "report", "design", "plan"]


def hint_of(ac_desc: str, goal: str) -> list:
    hints = []
    low = (ac_desc or "").lower() + " " + (goal or "").lower()
    for h in DELIVERABLE_HINTS:
        if h in low:
            hints.append(h)
    return hints


def analyze():
    files = glob.glob(os.path.join(SESSIONS, "*", "*.jsonl.zstd"))
    files += glob.glob(os.path.join(SESSIONS, "*", "*", "*.jsonl.zstd"))
    rows = []
    for f in files:
        ws = os.path.basename(os.path.dirname(os.path.dirname(f)))
        sid = os.path.basename(os.path.dirname(f))
        if is_smoke(ws):
            continue
        recs = collect(f)
        if recs is None or not any(recs.values()):
            continue
        # 最新裁决
        verdicts_latest = {}
        for vr in recs["verdicts"]:
            for ac_id, v in (vr.get("verdicts") or {}).items():
                verdicts_latest[ac_id] = v
        write_evidence = [e for e in recs["evidence"] if e.get("evidenceType") == "file_diff" and e.get("toolIdentity") in ("write", "edit")]
        for plan in recs["plan"]:
            contract = plan.get("contract") or {}
            goal = contract.get("goal", "")
            for ac in (contract.get("acceptanceCriteria") or []):
                ac_id = ac.get("id")
                v = verdicts_latest.get(ac_id)
                if v is None:
                    continue
                result = v.get("result")
                detail = v.get("detail", "")
                hints = hint_of(ac.get("desc", ""), goal)
                # 写类证据中路径含任一 hint 的证据
                produced = [
                    e.get("summary", "") for e in write_evidence
                    if any(h in (e.get("summary", "").lower()) for h in hints)
                ]
                if result == "fail" and produced:
                    cls = "FALSE_REJECTION(候选)"
                    note = f"存在写类证据 {len(produced)} 条（如 {produced[0][:80]}），但 gate 判 fail: {detail[:70]}"
                elif result == "fail":
                    cls = "一致fail(真负候选)"
                    note = f"无写类证据匹配交付线索 {hints}；{detail[:70]}"
                else:
                    cls = "pass"
                    note = ""
                rows.append({
                    "session": sid[:22], "ac": ac_id, "result": result, "class": cls,
                    "hints": hints, "note": note[:200]
                })
    return rows


def main():
    rows = analyze()
    print("=" * 92)
    print("完成任务能力评估 · 真实数据（交付物存在性 × gate 裁决交叉验证）")
    print("=" * 92)
    from collections import Counter
    c = Counter(r["class"] for r in rows)
    for k in sorted(c):
        print(f"  {k}: {c[k]}")
    print()
    for r in rows:
        print(f"[{r['session']}] {r['ac']:<16} {r['result']:>4}  {r['class']:<20} hints={r['hints']}")
        if r["note"]:
            print(f"    └ {r['note']}")


if __name__ == "__main__":
    main()
