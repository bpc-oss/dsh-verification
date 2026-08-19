window.__ModuleLoader__.load({
  id: "@bpc-oss/dsh-client-ui-verification",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let jsx = require("react/jsx-runtime").jsx;
    let jsxs = require("react/jsx-runtime").jsxs;
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
    
    // src/client.tsx
    
    var name = "client-ui-verification";
    var inject = ["slots", "sessions", "locale"];
    function SettingsPanel({ useProjection, t }) {
      const projection = useProjection ? useProjection("verification") : void 0;
      const t_ = t ?? ((key) => key);
      if (projection == null) {
        return /* @__PURE__ */ jsxs("div", { "data-verification-settings": true, children: [
          /* @__PURE__ */ jsx("div", { className: "verification-section-title", children: t_("settings.title") }),
          /* @__PURE__ */ jsx("div", { className: "verification-settings-note", children: t_("settings.noSessionNote") })
        ] });
      }
      return /* @__PURE__ */ jsxs("div", { "data-verification-settings": true, children: [
        /* @__PURE__ */ jsx("div", { children: t_("settings.title") }),
        /* @__PURE__ */ jsx("div", { children: projection.plan ? projection.plan.frozenAt ? t_("settings.frozen") : t_("settings.unfrozen") : "\u2014" }),
        /* @__PURE__ */ jsxs("div", { children: [
          t_("settings.evidenceCount"),
          ": ",
          projection.evidenceRefs.length,
          " \xB7 ",
          t_("settings.failuresCount"),
          ": ",
          projection.captureFailures.length,
          " \xB7",
          " ",
          t_("settings.epochs"),
          ": ",
          projection.taskEpochs.length
        ] })
      ] });
    }
    function apply(ctx) {
      const slots = ctx.get("slots");
      if (!slots) {
        return;
      }
      const localeAny = ctx.get("locale");
      const t = typeof localeAny?.bind === "function" ? localeAny.bind("verification") : (key) => key;
      ctx.effect(() => {
        return localeAny?.register?.("verification", { en, zh });
      });
      slots.inject(
        "settings.section",
        () => slots.register(
          {
            name: "settings.section",
            id: "verification",
            order: 25,
            locale: "verification",
            label: () => t("settings.title"),
            inject: () => ({ t })
          },
          SettingsPanel
        )
      );
    }
    module.exports = { SettingsPanel: SettingsPanel, apply: apply, inject: inject, name: name };
    return module.exports;
  }
});
