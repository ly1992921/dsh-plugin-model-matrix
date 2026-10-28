/**
 * Two-Bar Model Selection Component (Provider + Model) with Real-Time Provider Status Lights.
 * Designed for DeepSeek Harness Composer Input Bar (`conversation.input.model`).
 */
export function createTwoBarModelSelect({ React, ReactDOM, primitives, orderModelProviders, calculateMenuPos }) {
  const {
    useState,
    useRef,
    useEffect,
    useLayoutEffect,
    useMemo,
    useCallback,
    useSyncExternalStore,
    useId,
    createElement: h,
    Fragment
  } = React;

  const MEASURE_STYLE = { visibility: "hidden", left: 0, top: 0 };

  return function TwoBarModelSelect({ locked, available, directory, load, select, t, renderSlot }) {
    const state = useSyncExternalStore((fn) => directory.subscribe(fn), () => directory.getSnapshot());
    const [openMenu, setOpenMenu] = useState(null); // 'provider' | 'model' | null
    const [query, setQuery] = useState("");
    const [providerStatus, setProviderStatus] = useState({}); // { [providerId]: { state: 'ok'|'fail'|'pending', title: '' } }
    const [lastSelectedModelByProvider, setLastSelectedModelByProvider] = useState({});
    const [toast, setToast] = useState(null);
    const toastSeq = useRef(0);

    const rootRef = useRef(null);
    const providerTriggerRef = useRef(null);
    const triggerRef = useRef(null);
    const searchRef = useRef(null);
    const menuRef = useRef(null);
    const [menuPos, setMenuPos] = useState(null);
    const id = useId();

    const accountProviderName = t ? t("provider.account") : "DeepSeek 账号";

    const groups = useMemo(() => {
      return (orderModelProviders ? orderModelProviders(state.groups || []) : (state.groups || [])).map((group) => ({
        ...group,
        provider: {
          id: group.id,
          name: group.id === "deepseek-account" ? accountProviderName : group.name || group.id
        }
      }));
    }, [state.groups, accountProviderName]);

    const currentGroupId = state.current?.provider;
    const currentGroup = useMemo(() => {
      return groups.find((g) => g.id === currentGroupId) || groups[0];
    }, [groups, currentGroupId]);

    const currentModelId = state.current?.model;
    const currentModel = useMemo(() => {
      if (!currentGroup) return null;
      return currentGroup.models.find((m) => m.id === currentModelId) || null;
    }, [currentGroup, currentModelId]);

    const reasoning = currentModel?.reasoning;
    const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
    const effortLabel = useMemo(() => {
      if (!reasoning || !effectiveEffort) return undefined;
      const match = reasoning.efforts?.find((e) => e.id === effectiveEffort);
      return match ? match.name : effectiveEffort;
    }, [reasoning, effectiveEffort]);

    const effortChoices = useMemo(() => {
      if (!reasoning) return [];
      return [
        ...(reasoning.defaultEffort === undefined ? [{ key: "provider-default", effort: undefined, label: "Default" }] : []),
        ...(reasoning.efforts || []).map((eff) => ({ key: `effort:${eff.id}`, effort: eff.id, label: eff.name }))
      ];
    }, [reasoning]);

    const filteredModels = useMemo(() => {
      if (!currentGroup) return [];
      const list = currentGroup.models || [];
      const q = query.trim().toLowerCase();
      if (!q) return list;
      return list.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
    }, [currentGroup, query]);

    const showSearch = (currentGroup?.models?.length ?? 0) > 4;
    const busy = state.pending !== null;

    // Lightweight single-model probe for the provider
    const probeProvider = useCallback(async (group) => {
      if (!group || !group.id || !group.models || group.models.length === 0) return;
      const targetModel = group.models[0];
      const providerId = group.id;

      setProviderStatus((prev) => ({
        ...prev,
        [providerId]: { state: "pending", title: "正在检测连通性..." }
      }));

      try {
        let ok = true;
        let detail = "连通正常";

        if (providerId === "nous-portal") {
          const res = await fetch("/api/nous-portal/probe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: targetModel.id })
          }).then((r) => r.json());
          ok = res.status?.state === "ok";
          detail = ok ? "连通正常" : (res.status?.detail || res.status?.code || "失败");
        } else if (providerId === "opencode-zen") {
          const res = await fetch("/api/opencode-zen/probe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: targetModel.id })
          }).then((r) => r.json());
          ok = res.status?.state === "ok";
          detail = ok ? "连通正常" : (res.status?.detail || res.status?.code || "失败");
        } else if (providerId === "commandcode" || providerId === "commandcode-settings" || providerId === "commandcode-provider") {
          const res = await fetch("/api/commandcode-settings/probe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: targetModel.id })
          }).then((r) => r.json());
          ok = res.status?.state === "ok";
          detail = ok ? "连通正常" : (res.status?.detail || res.status?.code || "失败");
        } else {
          if (state.failures?.some((f) => f.id === providerId)) {
            const failure = state.failures.find((f) => f.id === providerId);
            ok = false;
            detail = failure?.message || "提供商初始化异常";
          } else {
            ok = true;
            detail = "渠道就绪";
          }
        }

        setProviderStatus((prev) => ({
          ...prev,
          [providerId]: {
            state: ok ? "ok" : "fail",
            title: ok ? `状态正常: ${detail} (测试模型: ${targetModel.name || targetModel.id})` : `状态异常: ${detail}`
          }
        }));
      } catch (err) {
        setProviderStatus((prev) => ({
          ...prev,
          [providerId]: {
            state: "fail",
            title: `检测失败: ${err.message || String(err)}`
          }
        }));
      }
    }, [state.failures]);

    // Auto-probe current provider once on mount
    useEffect(() => {
      if (currentGroup && !providerStatus[currentGroup.id]) {
        probeProvider(currentGroup);
      }
    }, [currentGroup?.id, probeProvider]);

    // Close on outside click
    useEffect(() => {
      if (openMenu === null) return;
      const closeOutside = (event) => {
        if (rootRef.current?.contains(event.target)) return;
        if (menuRef.current?.contains(event.target)) return;
        setOpenMenu(null);
      };
      document.addEventListener("mousedown", closeOutside);
      return () => document.removeEventListener("mousedown", closeOutside);
    }, [openMenu]);

    // Close on Escape
    useEffect(() => {
      if (openMenu === null) return;
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpenMenu(null);
        }
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, [openMenu]);

    // Floating menu placement
    useLayoutEffect(() => {
      if (!available || openMenu === null) {
        setMenuPos(null);
        return;
      }
      const place = () => {
        const activeTrigger = openMenu === "provider" ? providerTriggerRef.current : triggerRef.current;
        if (!activeTrigger) return;
        const rect = activeTrigger.getBoundingClientRect();
        const MARGIN = 12;
        const lw = menuRef.current?.offsetWidth ?? 280;
        const lh = menuRef.current?.offsetHeight ?? 300;
        let x = rect.left;
        let y = rect.top - 8 - lh;
        if (y < MARGIN) y = rect.bottom + 8;
        if (x + lw > window.innerWidth - MARGIN) x = window.innerWidth - lw - MARGIN;
        if (x < MARGIN) x = MARGIN;
        setMenuPos({ left: x, top: y });
      };
      place();
      window.addEventListener("scroll", place, true);
      window.addEventListener("resize", place);
      const menu = menuRef.current;
      const observer = typeof ResizeObserver !== "undefined" && menu !== null ? new ResizeObserver(place) : null;
      if (menu !== null) observer?.observe(menu);
      return () => {
        observer?.disconnect();
        window.removeEventListener("scroll", place, true);
        window.removeEventListener("resize", place);
      };
    }, [available, openMenu, query]);

    if (!available) return null;

    const close = () => {
      setOpenMenu(null);
      setQuery("");
    };

    const openProviderMenu = () => {
      if (state.status !== "ready") load();
      setOpenMenu("provider");
    };

    const openModelMenu = () => {
      if (state.status !== "ready") load();
      setQuery("");
      setOpenMenu("model");
    };

    const submit = (selection) => {
      select(selection).then((res) => {
        if (!res?.ok && res?.error) {
          toastSeq.current += 1;
          setToast({ seq: toastSeq.current, text: res.error.message || String(res.error) });
        } else {
          close();
        }
      });
    };

    const chooseProvider = (group) => {
      if (group.id !== currentGroup?.id) {
        const rememberedId = lastSelectedModelByProvider[group.id];
        const targetModel = (rememberedId && group.models.find((m) => m.id === rememberedId)) || group.models[0];
        if (targetModel) {
          submit({
            provider: group.id,
            model: targetModel.id,
            ...(targetModel.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: targetModel.reasoning.defaultEffort })
          });
        }
        probeProvider(group);
        setOpenMenu("model");
        setQuery("");
      } else {
        probeProvider(group);
        close();
      }
    };

    const chooseModel = (model) => {
      if (!currentGroup) return;
      setLastSelectedModelByProvider((prev) => ({ ...prev, [currentGroup.id]: model.id }));
      submit({
        provider: currentGroup.id,
        model: model.id,
        ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort })
      });
    };

    const chooseEffort = (effort) => {
      if (!state.current) return;
      submit({
        provider: state.current.provider,
        model: state.current.model,
        ...(effort === undefined ? {} : { reasoningEffort: effort })
      });
    };

    const providerLabel = currentGroup ? currentGroup.provider.name : "选择提供商";
    const modelLabel = currentModel ? currentModel.name : "选择模型";
    const triggerLabel = effortLabel ? `${modelLabel} · ${effortLabel}` : modelLabel;
    const activeStatus = providerStatus[currentGroup?.id] || { state: "unknown", title: "未检测" };

    const renderStatusDot = (pId, extraStyle = {}) => {
      const status = providerStatus[pId] || { state: "unknown", title: "点击切换并检测" };
      const isOk = status.state === "ok";
      const isFail = status.state === "fail";
      const isPending = status.state === "pending";
      const dotColor = isOk ? "#10b981" : isFail ? "#ef4444" : isPending ? "#3b82f6" : "#71717a";
      const dotGlow = isOk ? "0 0 5px rgba(16, 185, 129, 0.7)" : isFail ? "0 0 5px rgba(239, 68, 68, 0.7)" : isPending ? "0 0 5px rgba(59, 130, 246, 0.7)" : "none";

      return h("span", {
        title: status.title,
        className: isPending ? "dsh-status-dot-pending" : undefined,
        style: {
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          backgroundColor: dotColor,
          boxShadow: dotGlow,
          display: "inline-block",
          flex: "none",
          transition: "all 0.2s ease",
          ...extraStyle
        }
      });
    };

    return h("div", { ref: rootRef, className: "dsh-twobar-root" },
      // Bar 1: Provider Trigger
      h("button", {
        ref: providerTriggerRef,
        type: "button",
        className: "dsh-twobar-trigger" + (openMenu === "provider" ? " dsh-twobar-active" : ""),
        title: `提供商: ${providerLabel} (${activeStatus.title})`,
        disabled: locked,
        onClick: () => {
          if (openMenu === "provider") close();
          else openProviderMenu();
        }
      },
        renderStatusDot(currentGroup?.id, { marginRight: "2px" }),
        h("span", { className: "dsh-twobar-label" }, providerLabel),
        h("svg", {
          className: "dsh-twobar-chevron" + (openMenu === "provider" ? " dsh-twobar-chevron-open" : ""),
          viewBox: "0 0 24 24",
          width: 12,
          height: 12,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2
        }, h("path", { d: "M6 9l6 6 6-6" }))
      ),

      // Bar 2: Model Trigger
      h("button", {
        ref: triggerRef,
        type: "button",
        className: "dsh-twobar-trigger" + (openMenu === "model" ? " dsh-twobar-active" : ""),
        title: `模型: ${triggerLabel}`,
        disabled: locked,
        onClick: () => {
          if (openMenu === "model") close();
          else openModelMenu();
        }
      },
        h("span", { className: "dsh-twobar-label" }, modelLabel),
        effortLabel ? h("span", { className: "dsh-twobar-effort" }, effortLabel) : null,
        busy
          ? (primitives?.StateDot ? h(primitives.StateDot, { state: "ongoing" }) : h("span", null, "..."))
          : h("svg", {
              className: "dsh-twobar-chevron" + (openMenu === "model" ? " dsh-twobar-chevron-open" : ""),
              viewBox: "0 0 24 24",
              width: 12,
              height: 12,
              fill: "none",
              stroke: "currentColor",
              strokeWidth: 2
            }, h("path", { d: "M6 9l6 6 6-6" }))
      ),

      // Portal Dropdown Menu
      openMenu !== null && ReactDOM.createPortal(
        h("div", {
          ref: menuRef,
          id: `${id}-menu`,
          className: "dsh-twobar-menu",
          style: menuPos ?? MEASURE_STYLE,
          role: "menu"
        },
          // Provider Menu List
          openMenu === "provider" && h(Fragment, null,
            h("div", { className: "dsh-twobar-header" },
              h("span", null, `选择提供商 (${groups.length})`),
              h("button", {
                type: "button",
                className: "dsh-twobar-header-action",
                onClick: () => {
                  if (currentGroup) probeProvider(currentGroup);
                  load();
                }
              }, "检测当前连通性")
            ),
            h("div", { className: "dsh-twobar-list" },
              groups.map((group) => {
                const selected = group.id === currentGroup?.id;
                return h("button", {
                  key: group.id,
                  type: "button",
                  className: "dsh-twobar-item" + (selected ? " dsh-twobar-item-selected" : ""),
                  onClick: () => chooseProvider(group)
                },
                  h("div", { style: { display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" } },
                    renderStatusDot(group.id),
                    h("span", { className: "dsh-twobar-item-title" }, group.provider.name)
                  ),
                  h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
                    h("span", { className: "dsh-twobar-badge" }, `${group.models.length} 个模型`),
                    selected ? h("span", { style: { fontWeight: "bold" } }, "✓") : null
                  )
                );
              })
            )
          ),

          // Model Menu List
          openMenu === "model" && h(Fragment, null,
            h("div", { className: "dsh-twobar-header" },
              h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
                renderStatusDot(currentGroup?.id),
                h("span", null, `${currentGroup?.provider.name ?? "提供商"} · 模型 (${filteredModels.length})`)
              ),
              h("button", {
                type: "button",
                className: "dsh-twobar-header-action",
                onClick: () => setOpenMenu("provider")
              }, "切换提供商")
            ),
            showSearch && h("div", { className: "dsh-twobar-search-box" },
              h("input", {
                ref: searchRef,
                type: "text",
                className: "dsh-twobar-search-input",
                placeholder: `在 ${currentGroup?.provider.name ?? ""} 中搜索模型...`,
                value: query,
                onChange: (e) => setQuery(e.target.value),
                autoFocus: true
              })
            ),
            h("div", { className: "dsh-twobar-list" },
              filteredModels.length === 0
                ? h("div", { className: "dsh-twobar-empty" }, "没有匹配的模型")
                : filteredModels.map((model) => {
                    const selected = state.current?.provider === currentGroup?.id && state.current?.model === model.id;
                    return h("button", {
                      key: model.id,
                      type: "button",
                      className: "dsh-twobar-item" + (selected ? " dsh-twobar-item-selected" : ""),
                      onClick: () => chooseModel(model)
                    },
                      h("span", { className: "dsh-twobar-item-title" }, model.name || model.id),
                      selected ? h("span", { style: { marginLeft: "8px", fontWeight: "bold" } }, "✓") : null
                    );
                  })
            ),
            reasoning !== undefined && effortChoices.length > 0 && h("div", { className: "dsh-twobar-effort-section" },
              h("span", { className: "dsh-twobar-effort-label" }, "推理强度:"),
              h("div", { className: "dsh-twobar-effort-pills" },
                effortChoices.map((level) => {
                  const isEffortSelected = effectiveEffort === level.effort;
                  return h("button", {
                    key: level.key,
                    type: "button",
                    className: "dsh-twobar-effort-pill" + (isEffortSelected ? " dsh-twobar-effort-active" : ""),
                    onClick: () => chooseEffort(level.effort)
                  }, level.label);
                })
              )
            )
          )
        ),
        document.body
      ),

      // Toast Notification
      toast !== null && primitives?.Toast && h(primitives.Toast, {
        text: toast.text,
        onDone: () => setToast(null)
      }, toast.seq)
    );
  };
}
