#!/usr/bin/env python3
"""
真实任务 benchmark（真实会话回放审计）。
========================================

数据源：本地 .dsh/sessions 全部会话存档中的 append-only verification/change 事件
（plan / evidence / verdicts / gate / capture-failure）。

方法：对每个真实（非 smoke/测试工作区）会话的每个契约：
  1. 提取契约（goal + AC + 冻结 selector）；
  2. 提取全部证据记录（callId/toolIdentity/argsHash/evidenceType/summary）与裁决/闸门记录；
  3. 逐 AC 审计：记录在案的裁决（pass/fail）+ oracle 层级 + 理由；
  4. 一致性验证（引擎"抓假完成"是否属实）：
     - fail 理由含 "no committed run for selector (tool, hash, type)" → 检查会话日志中
       是否存在 toolIdentity==tool 且 normalizedArgsHash==hash 的证据；不存在 → 引擎判定成立（真缺证据）；
     - 其他 fail → 按裁决 claimId 定位绑定证据，核对 summary 是否支持失败结论；
  5. 汇总指标 + 输出 Markdown 报告。

注意：payload 不落盘（引擎用内存 blob store，日志仅存 blobHash），故不做 oracle 重放，
只做"日志权威裁决 + 一致性验证"——这正是可复核的真实数据基准。
"""
import glob
import json
import os
import re
import sys
import datetime
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


def collect_events(ws: str, sid: str, path: str):
    """返回该会话按 kind 分组的记录列表（保留顺序）。"""
    t = dec(path)
    if t is None:
        return None
    out = {"plan": [], "evidence": [], "verdicts": [], "gate": [], "capture-failure": []}
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
        kind = rec.get("kind")
        if kind in out:
            out[kind].append(rec)
    return out


NO_RUN_RE = re.compile(r"no committed run for selector \((\S+), ([0-9a-f]+), (\S+)\)")


def audit_session(sid, ws, recs):
    rows = []
    # 取最后一个 plan 之后的裁决/闸门作为"该契约的最终评估"（简单起见：全契约并集，按 AC 取最新裁决）
    verdicts_latest = {}
    for vr in recs["verdicts"]:
        for ac_id, v in (vr.get("verdicts") or {}).items():
            verdicts_latest[ac_id] = v
    gates = [g.get("entry") for g in recs["gate"] if g.get("entry")]
    evidence = recs["evidence"]

    for plan in recs["plan"]:
        contract = plan.get("contract") or {}
        goal = contract.get("goal", "")
        acs = contract.get("acceptanceCriteria") or []
        for ac in acs:
            ac_id = ac.get("id")
            v = verdicts_latest.get(ac_id)
            if v is None:
                continue  # 无裁决记录（advisory 未评估）→ 不计入 AC 审计
            result = v.get("result")
            tier = v.get("oracleTier")
            detail = v.get("detail", "")
            claim_id = v.get("claimId", "")
            # 一致性验证
            consistency = "ok"
            note = ""
            m = NO_RUN_RE.search(detail)
            if m and result == "fail":
                tool, ahash, etype = m.group(1), m.group(2), m.group(3)
                matched = [
                    e for e in evidence
                    if e.get("toolIdentity") == tool and e.get("normalizedArgsHash") == ahash
                ]
                if matched:
                    consistency = "FLAG"
                    note = f"selector({tool},{ahash}) 竟有 {len(matched)} 条证据，但裁决为 no-committed-run"
                else:
                    note = f"selector({tool},{ahash},{etype}) 无匹配证据 → 引擎判定成立"
            elif result == "fail" and claim_id:
                bound = [e for e in evidence if e.get("callId") == claim_id]
                if bound:
                    note = f"绑定证据: {bound[0].get('evidenceType')} {bound[0].get('summary','')[:90]}"
                else:
                    note = f"claimId={claim_id} 未在日志证据中找到"
            rows.append({
                "session": sid, "ws": ws, "goal": goal[:60], "ac": ac_id,
                "hint": ac.get("oracleHint"), "selector_tool": (ac.get("selector") or {}).get("toolIdentity"),
                "result": result, "tier": tier, "detail": detail[:120], "consistency": consistency, "note": note[:160]
            })
    return rows, {"gates": gates, "evidence": len(evidence), "capfail": len(recs["capture-failure"])}


def main():
    files = glob.glob(os.path.join(SESSIONS, "*", "*.jsonl.zstd"))
    files += glob.glob(os.path.join(SESSIONS, "*", "*", "*.jsonl.zstd"))
    all_rows = []
    stats = {"sessions": set(), "contracts": 0, "evidence": 0, "capfail": 0,
             "gates": 0, "gate_failed": 0, "gate_done": 0, "verdicts": 0,
             "pass": 0, "fail": 0, "flags": 0}
    for f in files:
        ws = os.path.basename(os.path.dirname(os.path.dirname(f)))
        sid = os.path.basename(os.path.dirname(f))
        if is_smoke(ws):
            continue
        recs = collect_events(ws, sid, f)
        if recs is None or not any(recs.values()):
            continue
        stats["sessions"].add(sid)
        stats["contracts"] += len(recs["plan"])
        stats["evidence"] += len(recs["evidence"])
        stats["capfail"] += len(recs["capture-failure"])
        for g in recs["gate"]:
            e = g.get("entry") or {}
            st = e.get("status")
            if st:
                stats["gates"] += 1
                if st == "failed":
                    stats["gate_failed"] += 1
                elif st == "done":
                    stats["gate_done"] += 1
        rows, _ = audit_session(sid, ws, recs)
        for r in rows:
            stats["verdicts"] += 1
            if r["result"] == "pass":
                stats["pass"] += 1
            elif r["result"] == "fail":
                stats["fail"] += 1
            if r["consistency"] == "FLAG":
                stats["flags"] += 1
        all_rows.extend(rows)

    print("=" * 90)
    print("真实任务 benchmark · 真实会话回放审计（排除 smoke/测试工作区）")
    print("=" * 90)
    print(f"真实验证会话: {len(stats['sessions'])}  契约: {stats['contracts']}  证据: {stats['evidence']}  捕获失败: {stats['capfail']}")
    print(f"完成闸门评估: {stats['gates']}（failed={stats['gate_failed']} done={stats['gate_done']}）→ 真实'假完成'被拒: {stats['gate_failed']}")
    print(f"AC 级裁决: {stats['verdicts']}（pass={stats['pass']} fail={stats['fail']}）")
    if stats["verdicts"]:
        print(f"真实任务 fail 率（被引擎判定证据不足/失败）: {stats['fail']/stats['verdicts']*100:.0f}%")
    print(f"一致性 FLAG（引擎 fail 但日志存在匹配证据）: {stats['flags']}")
    print()
    print("--- 逐 AC 审计明细 ---")
    for r in all_rows:
        print(f"[{r['session'][:20]}] {r['ac']:<14} {r['result']:>4} T{r['tier']} {r['hint']:<6} sel={r['selector_tool']:<6} {r['detail'][:70]}")
        if r["note"]:
            print(f"    └ {r['consistency']}: {r['note'][:140]}")
    print()
    print("--- 闸门明细 ---")
    for f in sorted(files):
        ws = os.path.basename(os.path.dirname(os.path.dirname(f)))
        sid = os.path.basename(os.path.dirname(f))
        if is_smoke(ws):
            continue
        recs = collect_events(ws, sid, f)
        if recs is None:
            continue
        for g in recs["gate"]:
            e = g.get("entry") or {}
            if e.get("status") == "failed":
                print(f"[{sid[:20]}] gate FAILED: {str(e.get('reasons'))[:160]}")


if __name__ == "__main__":
    main()
