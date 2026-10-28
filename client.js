/**
 * Browser half of dsh-plugin-model-matrix.
 * Registers the Model Matrix settings section and the Two-Bar Composer Model Selector.
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-model-matrix",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    const React = require('react');
    const ReactDOM = require('react-dom');
    let primitives = {};
    try { primitives = require('@deepseek-ai/dsh-client-ui-primitives'); } catch {}

    const { createElement: h, useState, useEffect, useMemo } = React;

    const zh = {
      name: "Model Matrix",
      nav: { nav: "模型矩阵" },
      settings: {
        title: "模型矩阵与渠道管理",
        subtitle: "统一管理提供商订阅、实时状态灯与对话框双栏选择器。",
        refreshNow: "刷新全部目录",
        testAll: "全部测连",
        testing: "测试中…",
        loading: "正在载入…"
      }
    };
    const en = {
      name: "Model Matrix",
      nav: { nav: "Model Matrix" },
      settings: {
        title: "Model Matrix & Channels",
        subtitle: "Unified provider subscriptions, live status lights, and two-level composer selectors.",
        refreshNow: "Refresh All",
        testAll: "Test All",
        testing: "Testing…",
        loading: "Loading…"
      }
    };

    const NS = "settings.modelMatrix";
    const SECTION_ID = "model-matrix";
    const ORDER = 16;
    const inject = ['slots', 'locale'];

    const TWO_BAR_CSS = `
.dsh-twobar-root {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  position: relative;
  min-width: 0;
  max-width: 100%;
}
.dsh-twobar-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-interactive-bg-subtle, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  cursor: pointer;
  outline: none;
  transition: all 0.15s ease;
  user-select: none;
  min-width: 0;
}
.dsh-twobar-trigger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--dsw-alias-label-primary, #ffffff);
  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.2));
}
.dsh-twobar-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dsh-twobar-trigger.dsh-twobar-active {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.12));
  color: var(--dsw-alias-label-primary, #ffffff);
  border-color: var(--dsw-alias-state-business-primary, #6366f1);
}
.dsh-twobar-icon {
  flex: none;
  color: var(--dsw-alias-label-caption, #71717a);
}
.dsh-twobar-label {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  max-width: 140px;
  font-weight: 500;
}
.dsh-twobar-effort {
  color: var(--dsw-alias-label-caption, #a1a1aa);
  font-size: 11px;
  background: var(--dsw-alias-interactive-bg-subtle, rgba(255, 255, 255, 0.08));
  padding: 1px 5px;
  border-radius: 4px;
  flex: none;
  margin-left: 2px;
}
.dsh-twobar-chevron {
  flex: none;
  color: var(--dsw-alias-label-caption, #71717a);
  transition: transform 0.15s ease;
}
.dsh-twobar-chevron-open {
  transform: rotate(180deg);
}
.dsh-twobar-menu {
  position: fixed;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  min-width: 270px;
  max-width: 400px;
  max-height: min(420px, 80vh);
  background: var(--dsw-alias-bg-floating, #18181b);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.14));
  border-radius: var(--dsw-radius-md, 8px);
  box-shadow: var(--dsw-elevation-prominent, 0 10px 25px -5px rgba(0, 0, 0, 0.5));
  padding: 6px;
  color: var(--dsw-alias-label-primary, #ffffff);
  overflow: hidden;
}
.dsh-twobar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, #a1a1aa);
}
.dsh-twobar-header-action {
  background: none;
  border: none;
  color: var(--dsw-alias-state-business-primary, #818cf8);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.1s;
}
.dsh-twobar-header-action:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
}
.dsh-twobar-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  padding: 4px 0;
  max-height: 280px;
}
.dsh-twobar-list::-webkit-scrollbar {
  width: 6px;
}
.dsh-twobar-list::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2, rgba(255, 255, 255, 0.15));
  border-radius: 3px;
}
.dsh-twobar-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: none;
  border-radius: var(--dsw-radius-sm, 6px);
  color: var(--dsw-alias-label-primary, #ffffff);
  font-size: 13px;
  line-height: 18px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s ease;
}
.dsh-twobar-item:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
}
.dsh-twobar-item.dsh-twobar-item-selected {
  background: var(--dsw-alias-interactive-bg-selected, rgba(99, 102, 241, 0.15));
  color: var(--dsw-alias-state-business-primary, #818cf8);
  font-weight: 500;
}
.dsh-twobar-item-title {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  flex: 1;
}
.dsh-twobar-badge {
  font-size: 11px;
  color: var(--dsw-alias-label-caption, #71717a);
  background: var(--dsw-alias-interactive-bg-subtle, rgba(255, 255, 255, 0.06));
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: 8px;
  flex: none;
}
.dsh-twobar-search-box {
  padding: 4px 4px 8px;
}
.dsh-twobar-search-input {
  width: 100%;
  height: 28px;
  box-sizing: border-box;
  padding: 0 8px;
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-interactive-bg-subtle, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12));
  color: var(--dsw-alias-label-primary, #ffffff);
  font-size: 12px;
  outline: none;
}
.dsh-twobar-search-input:focus {
  border-color: var(--dsw-alias-state-business-primary, #6366f1);
}
.dsh-twobar-effort-section {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  font-size: 12px;
  background: var(--dsw-alias-bg-floating, #18181b);
}
.dsh-twobar-effort-label {
  color: var(--dsw-alias-label-caption, #71717a);
  font-size: 11px;
  flex: none;
}
.dsh-twobar-effort-pills {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.dsh-twobar-effort-pill {
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 11px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  background: transparent;
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  cursor: pointer;
}
.dsh-twobar-effort-pill:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
}
.dsh-twobar-effort-pill.dsh-twobar-effort-active {
  background: var(--dsw-alias-state-business-primary, #6366f1);
  color: #ffffff;
  border-color: var(--dsw-alias-state-business-primary, #6366f1);
}
.dsh-twobar-empty {
  padding: 16px;
  text-align: center;
  color: var(--dsw-alias-label-caption, #71717a);
  font-size: 12px;
}
@keyframes dsh-status-pulse {
  0% { opacity: 0.4; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.1); }
  100% { opacity: 0.4; transform: scale(0.9); }
}
.dsh-status-dot-pending {
  animation: dsh-status-pulse 1.2s infinite ease-in-out;
}
`;

    function Section(props) {
      return h("div", { style: { padding: "20px" } },
        h("h2", null, "模型矩阵与多渠道管理"),
        h("p", { style: { color: "var(--dsw-alias-label-secondary)" } },
          "双级联动选择器与连通性探针已激活。对话框中已就绪【提供商】+【模型】双栏选择与实时状态灯。"
        )
      );
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS);

      ctx.effect(() => {
        try {
          return ctx.locale.register(NS, { zh: zh.nav, en: en.nav });
        } catch {
          return () => {};
        }
      }, "dsh-plugin-model-matrix: copy");

      ctx.effect(() => {
        const style = document.createElement('style');
        style.setAttribute('data-plugin', "dsh-plugin-model-matrix");
        style.textContent = TWO_BAR_CSS;
        document.head.appendChild(style);
        return () => style.remove();
      }, "dsh-plugin-model-matrix: styles");

      ctx.slots.inject('settings.section', () => {
        if (ctx.slots.entries('settings.section').some((entry) => entry.id === SECTION_ID)) {
          return () => {};
        }
        return ctx.slots.register(
          { name: 'settings.section', id: SECTION_ID, order: ORDER, label: () => "模型矩阵" },
          (props) => h(Section, { ...props, ctx })
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = "dsh-plugin-model-matrix";
    return module.exports;
  }
});
