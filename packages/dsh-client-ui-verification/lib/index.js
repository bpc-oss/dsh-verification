// src/evidence-format.ts
function stringifyPayload(payload) {
  try {
    return JSON.stringify(payload);
  } catch {
    return "[unserializable payload]";
  }
}
function commandOutputSummary(exitCode) {
  if (typeof exitCode === "number" && exitCode === 0) {
    return "\u547D\u4EE4\u8FD0\u884C\u6210\u529F";
  }
  return `\u547D\u4EE4\u6267\u884C\u5931\u8D25 (${typeof exitCode === "number" ? `exitCode: ${exitCode}` : "\u672A\u8FD4\u56DE\u9000\u51FA\u7801"})`;
}
function commandOutputDetail(payload) {
  const stdout = payload.stdout;
  const stderr = payload.stderr;
  if (typeof stdout === "string" && stdout.length > 0) {
    return `stdout: ${stdout}`;
  }
  if (typeof stderr === "string" && stderr.length > 0) {
    return `stderr: ${stderr}`;
  }
  return stringifyPayload(payload);
}
function fileExistsSummary(exists) {
  if (exists === true) {
    return "\u6587\u4EF6\u5DF2\u751F\u6210";
  }
  return "\u6587\u4EF6\u672A\u751F\u6210\u6216\u672A\u786E\u8BA4\u5B58\u5728";
}
function fileExistsDetail(payload) {
  if (typeof payload.path === "string" && payload.path.length > 0) {
    return `path: ${payload.path}`;
  }
  return stringifyPayload(payload);
}
function fileDiffSummary(payload) {
  if (typeof payload.path === "string" && payload.path.length > 0) {
    return `\u5DF2\u4FEE\u6539\u6587\u4EF6: ${payload.path}`;
  }
  return "\u6587\u4EF6\u5DF2\u4FEE\u6539";
}
function fileDiffDetail(payload) {
  const path = typeof payload.path === "string" && payload.path.length > 0 ? `path: ${payload.path}` : "";
  const diff = typeof payload.diff === "string" && payload.diff.length > 0 ? `diff: ${payload.diff}` : "";
  if (path && diff) {
    return `${path}
${diff}`;
  }
  if (path || diff) {
    return path || diff;
  }
  return stringifyPayload(payload);
}
var formatByEvidenceType = {
  command_output: (payload) => {
    const exitCode = payload.exitCode;
    return {
      summary: commandOutputSummary(exitCode),
      ok: exitCode === 0,
      detail: commandOutputDetail(payload)
    };
  },
  file_exists: (payload) => {
    const exists = payload.exists;
    return {
      summary: fileExistsSummary(exists),
      ok: exists === true,
      detail: fileExistsDetail(payload)
    };
  },
  file_diff: (payload) => ({
    summary: fileDiffSummary(payload),
    ok: true,
    detail: fileDiffDetail(payload)
  }),
  pro_review: (payload) => {
    const verdict = payload.verdict;
    const result = payload.result;
    return {
      summary: "AI \u5BA1\u6838\u8BC1\u636E",
      ok: verdict !== "fail" && result !== "fail",
      detail: stringifyPayload(payload)
    };
  },
  quote_with_location: (payload) => ({
    summary: "\u5DF2\u5B8C\u6210\u9010\u9879\u6838\u5BF9\uFF0C\u5305\u542B\u5F15\u7528\u4F4D\u7F6E",
    ok: true,
    detail: stringifyPayload(payload)
  })
};
function toPlainLanguage(ev) {
  const payload = ev.payload;
  const formatter = formatByEvidenceType[ev.evidenceType];
  if (formatter) {
    return formatter(payload);
  }
  return {
    summary: `\u8BC1\u636E\u7C7B\u578B: ${ev.evidenceType}`,
    ok: true,
    detail: stringifyPayload(payload)
  };
}
function summarizeEvidence(ref) {
  return {
    summary: ref.summary || `\u8BC1\u636E\u7C7B\u578B: ${ref.evidenceType}`,
    ok: !ref.truncated,
    detail: `call ${ref.callId} \xB7 blob ${ref.blobHash.slice(0, 8)} \xB7 seq ${ref.resultSeq}`
  };
}
function verdictLabel(verdict) {
  if (!verdict) {
    return "missing";
  }
  return verdict.result;
}

// src/components.tsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var fallbackT = (key) => key;
function shortHash(hash) {
  return hash.length > 12 ? `${hash.slice(0, 8)}\u2026${hash.slice(-4)}` : hash;
}
function ContractCard({ contract, t = fallbackT }) {
  return /* @__PURE__ */ jsxs("div", { "data-verification-contract": true, children: [
    /* @__PURE__ */ jsx("div", { className: "verification-section-title", children: t("contract.goal") }),
    /* @__PURE__ */ jsx("div", { className: "verification-goal", children: contract.goal }),
    /* @__PURE__ */ jsx("div", { className: "verification-section-title", children: t("contract.ac") }),
    /* @__PURE__ */ jsx("ul", { className: "verification-ac-list", children: contract.acceptanceCriteria.map((ac) => /* @__PURE__ */ jsxs(
      "li",
      {
        "data-ac": ac.id,
        title: ac.selector ? `${t(`hint.${ac.oracleHint}`)} \xB7 ${ac.selector.toolIdentity} \xB7 ${shortHash(ac.selector.normalizedArgsHash)} \xB7 ${ac.selector.evidenceType}` : t(`hint.${ac.oracleHint}`),
        children: [
          /* @__PURE__ */ jsx("span", { className: "verification-ac-id", children: ac.id }),
          /* @__PURE__ */ jsx("span", { className: "verification-ac-desc", children: ac.desc })
        ]
      },
      ac.id
    )) }),
    contract.constraints.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("div", { className: "verification-section-title", children: t("contract.constraints") }),
      /* @__PURE__ */ jsx("ul", { className: "verification-constraint-list", children: contract.constraints.map((c) => /* @__PURE__ */ jsxs("li", { "data-constraint": c.id, children: [
        /* @__PURE__ */ jsx("span", { className: "verification-constraint-id", children: c.id }),
        /* @__PURE__ */ jsx("span", { className: "verification-constraint-desc", children: c.desc }),
        /* @__PURE__ */ jsx("code", { className: "verification-constraint-check", children: c.check })
      ] }, c.id)) })
    ] })
  ] });
}
function VerdictSummary({
  contract,
  verdicts,
  gateLog,
  t = fallbackT
}) {
  const latestGate = gateLog[gateLog.length - 1];
  return /* @__PURE__ */ jsxs("div", { "data-verification-verdicts": true, children: [
    /* @__PURE__ */ jsx("div", { className: "verification-section-title", children: t("dock.title") }),
    /* @__PURE__ */ jsx("ul", { className: "verification-verdict-list", children: contract.acceptanceCriteria.map((ac) => {
      const verdict = verdicts[ac.id];
      const label = verdictLabel(verdict);
      return /* @__PURE__ */ jsxs("li", { "data-ac": ac.id, "data-verdict": label, className: `verification-verdict-${label}`, children: [
        /* @__PURE__ */ jsx("span", { className: "verification-verdict-label", children: t(`verdict.${label}`) }),
        /* @__PURE__ */ jsx("span", { className: "verification-verdict-ac", children: ac.id }),
        verdict && /* @__PURE__ */ jsxs("span", { className: "verification-verdict-tier", children: [
          t("verdict.tier"),
          " ",
          verdict.oracleTier
        ] }),
        verdict?.detail && /* @__PURE__ */ jsx("div", { className: "verification-verdict-detail", children: verdict.detail })
      ] }, ac.id);
    }) }),
    latestGate && /* @__PURE__ */ jsx("div", { className: `verification-gate verification-gate-${latestGate.status}`, children: t(`gate.${latestGate.status}`) })
  ] });
}
function EvidencePanel({ evidence, t = fallbackT }) {
  if (evidence.length === 0) {
    return /* @__PURE__ */ jsx("div", { "data-verification-evidence": true, className: "verification-evidence-empty", children: t("evidence.empty") });
  }
  return /* @__PURE__ */ jsxs("details", { "data-verification-evidence": true, className: "verification-evidence-panel", children: [
    /* @__PURE__ */ jsxs("summary", { children: [
      t("evidence.title"),
      " (",
      evidence.length,
      ")"
    ] }),
    /* @__PURE__ */ jsx("ul", { className: "verification-evidence-list", children: evidence.slice(-20).map((entry) => {
      const plain = summarizeEvidence(entry);
      return /* @__PURE__ */ jsxs("li", { "data-evidence-type": entry.evidenceType, className: plain.ok ? "verification-evidence-ok" : "verification-evidence-bad", children: [
        /* @__PURE__ */ jsx("span", { className: "verification-evidence-state", children: plain.ok ? t("evidence.ok") : t("evidence.bad") }),
        /* @__PURE__ */ jsx("span", { className: "verification-evidence-type", children: entry.evidenceType }),
        /* @__PURE__ */ jsx("span", { className: "verification-evidence-summary", children: plain.summary }),
        entry.truncated && /* @__PURE__ */ jsx("span", { className: "verification-evidence-truncated", children: t("evidence.truncated") })
      ] }, entry.callId);
    }) })
  ] });
}
function VerificationDock({
  useProjection,
  t = fallbackT
}) {
  const projection = useProjection ? useProjection("verification") : void 0;
  if (projection == null || projection.plan == null) {
    return null;
  }
  const contract = projection.plan.contract;
  return /* @__PURE__ */ jsxs("div", { "data-verification-dock": true, children: [
    /* @__PURE__ */ jsx(ContractCard, { contract, t }),
    /* @__PURE__ */ jsx(VerdictSummary, { contract, verdicts: projection.verdicts, gateLog: projection.gateLog, t }),
    /* @__PURE__ */ jsx(EvidencePanel, { evidence: projection.evidenceRefs, t })
  ] });
}

// src/locales.ts
var en = {
  "dock.title": "Verification",
  "contract.goal": "Goal",
  "contract.ac": "Acceptance criteria",
  "contract.constraints": "Constraints",
  "contract.outOfScope": "Out of scope",
  "hint.test": "test",
  "hint.run": "run",
  "hint.file": "file",
  "hint.schema": "schema",
  "hint.review": "review",
  "hint.human": "human",
  "verdict.pass": "Pass",
  "verdict.fail": "Fail",
  "verdict.need_human": "Needs human",
  "verdict.missing": "No verdict",
  "verdict.tier": "tier",
  "gate.done": "Completion gate: passed",
  "gate.failed": "Completion gate: rejected",
  "gate.blocked": "Completion gate: blocked on human",
  "evidence.title": "Evidence",
  "evidence.ok": "OK",
  "evidence.bad": "Failed",
  "evidence.empty": "No evidence recorded yet",
  "evidence.truncated": "truncated (incomplete)",
  "settings.title": "Verification",
  "settings.frozen": "contract frozen",
  "settings.unfrozen": "contract not frozen",
  "settings.evidenceCount": "captured evidence",
  "settings.failuresCount": "capture failures",
  "settings.epochs": "task epochs",
  "settings.noSessionNote": "This page shows the verification engine state after you declare a contract. In a session: create_goal, then set_verification_plan, and the frozen selector / evidence / verdicts will appear here."
};
var zh = {
  "dock.title": "\u9A8C\u8BC1",
  "contract.goal": "\u76EE\u6807",
  "contract.ac": "\u9A8C\u6536\u6807\u51C6",
  "contract.constraints": "\u7981\u4EE4",
  "contract.outOfScope": "\u4E0D\u505A\u7684\u4E8B",
  "hint.test": "\u6D4B\u8BD5",
  "hint.run": "\u8FD0\u884C",
  "hint.file": "\u6587\u4EF6",
  "hint.schema": "\u7ED3\u6784",
  "hint.review": "\u590D\u6838",
  "hint.human": "\u4EBA\u5DE5",
  "verdict.pass": "\u901A\u8FC7",
  "verdict.fail": "\u672A\u901A\u8FC7",
  "verdict.need_human": "\u9700\u4EBA\u5DE5\u786E\u8BA4",
  "verdict.missing": "\u672A\u88C1\u51B3",
  "verdict.tier": "\u88C1\u5224\u5C42\u7EA7",
  "gate.done": "\u5B8C\u6210\u95F8\u95E8\uFF1A\u901A\u8FC7",
  "gate.failed": "\u5B8C\u6210\u95F8\u95E8\uFF1A\u88AB\u62D2",
  "gate.blocked": "\u5B8C\u6210\u95F8\u95E8\uFF1A\u7B49\u5F85\u4EBA\u5DE5",
  "evidence.title": "\u8BC1\u636E",
  "evidence.ok": "\u6709\u6548",
  "evidence.bad": "\u5931\u8D25",
  "evidence.empty": "\u6682\u65E0\u8BC1\u636E",
  "evidence.truncated": "\u622A\u65AD\uFF08\u4E0D\u5B8C\u6574\uFF09",
  "settings.title": "\u9A8C\u8BC1\u5F15\u64CE",
  "settings.frozen": "\u5951\u7EA6\u5DF2\u51BB\u7ED3",
  "settings.unfrozen": "\u5951\u7EA6\u672A\u51BB\u7ED3",
  "settings.evidenceCount": "\u5DF2\u91C7\u96C6\u8BC1\u636E",
  "settings.failuresCount": "\u91C7\u96C6\u5931\u8D25",
  "settings.epochs": "\u4EFB\u52A1\u5468\u671F",
  "settings.noSessionNote": "\u6B64\u9875\u5728\u4F1A\u8BDD\u4E2D\u58F0\u660E\u610F\u56FE\u5951\u7EA6\u540E\u5C55\u793A\u9A8C\u8BC1\u5F15\u64CE\u72B6\u6001\uFF1Acreate_goal \u540E\u8C03\u7528 set_verification_plan\uFF0C\u51BB\u7ED3\u7684 selector / \u8BC1\u636E / \u88C1\u51B3\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002\u5F53\u524D\u65E0\u6D3B\u52A8\u5951\u7EA6\uFF0C\u4EC5\u663E\u793A\u8BF4\u660E\u3002"
};

// src/index.ts
function apply() {
}
export {
  ContractCard,
  EvidencePanel,
  VerdictSummary,
  VerificationDock,
  apply,
  en,
  summarizeEvidence,
  toPlainLanguage,
  verdictLabel,
  zh
};
//# sourceMappingURL=index.js.map