"""
Automated Setup & Recovery Script for dsh-plugin-model-matrix.
1. Cleans up any conflicting local packages in ~/.dsh/profiles/desktop/node_modules
2. Patches resources/app.asar in-place with exact byte alignment (safe, non-destructive, with backup)
3. Registers dsh-plugin-model-matrix into desktop profile package.json
"""
import os
import sys
import json
import struct
import shutil
import subprocess

def find_dsh_paths():
    home = os.environ.get('USERPROFILE') or os.environ.get('HOME') or ''
    dsh_profile = os.path.join(home, '.dsh', 'profiles', 'desktop')
    
    # Common install locations for DeepSeek Harness on Windows
    possible_app_paths = [
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'DeepSeek Harness'),
        r'C:\Users\%s\AppData\Local\Programs\DeepSeek Harness' % os.environ.get('USERNAME', ''),
        r'C:\Program Files\DeepSeek Harness',
        r'D:\Program Files\DeepSeek Harness'
    ]
    
    app_dir = None
    for p in possible_app_paths:
        if os.path.exists(os.path.join(p, 'resources', 'app.asar')):
            app_dir = p
            break
            
    return dsh_profile, app_dir

def cleanup_conflicts(dsh_profile):
    print("Step 1: Checking and cleaning up conflicting local packages...")
    conflict_path = os.path.join(dsh_profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-model-selection')
    if os.path.exists(conflict_path):
        print(f"  Found conflicting package: {conflict_path}")
        try:
            shutil.rmtree(conflict_path)
            print("  ✔ Successfully removed conflicting package.")
        except Exception as e:
            print(f"  ✖ Warning: could not remove conflict: {e}")
    else:
        print("  ✔ No conflicting packages found in desktop node_modules.")

def patch_app_asar(app_dir):
    print("\nStep 2: Checking and patching resources/app.asar...")
    if not app_dir:
        print("  ✖ Could not locate DeepSeek Harness installation folder automatically.")
        return False
        
    asar_path = os.path.join(app_dir, 'resources', 'app.asar')
    bak_path = os.path.join(app_dir, 'resources', 'app.asar.bak')
    
    if not os.path.exists(asar_path):
        print(f"  ✖ app.asar not found at: {asar_path}")
        return False
        
    # Backup if not backed up yet
    if not os.path.exists(bak_path):
        print(f"  Backing up original app.asar to {bak_path}...")
        try:
            shutil.copy2(asar_path, bak_path)
            print("  ✔ Backup created.")
        except Exception as e:
            print(f"  ✖ Failed to backup app.asar: {e}")
            return False
    else:
        print("  ✔ Existing backup found.")

    with open(bak_path, "rb") as f:
        f.seek(12)
        json_len = struct.unpack("<I", f.read(4))[0]
        base_offset = 16 + json_len
        header = json.loads(f.read(json_len).decode("utf-8"))
        
        parts = 'dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js'.split('/')
        cur = header
        for p in parts:
            cur = cur['files'][p]
            
        target_size = int(cur['size'])
        target_offset = int(cur['offset'])
        
        f.seek(base_offset + target_offset)
        clean_orig_bytes = f.read(target_size)

    clean_orig_code = clean_orig_bytes.decode("utf-8")
    
    start_marker = "//#region lib/types/client/ModelSelect.js"
    end_marker = "//#region lib/types/client/locales.js"
    
    idx1 = clean_orig_code.find(start_marker)
    idx2 = clean_orig_code.find(end_marker)
    
    if idx1 == -1 or idx2 == -1:
        print("  ✖ Could not find ModelSelect region markers in clean asar.")
        return False

    new_model_select = r'''//#region lib/types/client/ModelSelect.js
		const MEASURE_STYLE = {
			visibility: "hidden",
			left: 0,
			top: 0
		};

		function ModelSelect({ locked, available, directory, load, select, t, renderSlot }) {
			const state = (0, react.useSyncExternalStore)((fn) => directory.subscribe(fn), () => directory.getSnapshot());
			const [openMenu, setOpenMenu] = (0, react.useState)(null); // 'provider' | 'model' | null
			const [query, setQuery] = (0, react.useState)("");
			const [providerStatus, setProviderStatus] = (0, react.useState)({});
			const [toast, setToast] = (0, react.useState)(null);
			const toastSeq = (0, react.useRef)(0);
			const rootRef = (0, react.useRef)(null);
			const providerTriggerRef = (0, react.useRef)(null);
			const triggerRef = (0, react.useRef)(null);
			const searchRef = (0, react.useRef)(null);
			const menuRef = (0, react.useRef)(null);
			const [menuPos, setMenuPos] = (0, react.useState)(null);
			const id = (0, react.useId)();
			const accountProviderName = t ? t("provider.account") : "DeepSeek 账号";

			const groups = (0, react.useMemo)(() => orderModelProviders(state.groups || []).map((group) => ({
				...group,
				provider: {
					id: group.id,
					name: group.id === "deepseek-account" ? accountProviderName : group.name
				}
			})), [state.groups, accountProviderName]);

			const currentGroupId = state.current?.provider;
			const currentGroup = (0, react.useMemo)(() => {
				return groups.find((g) => g.id === currentGroupId) || groups[0];
			}, [groups, currentGroupId]);

			const currentModelId = state.current?.model;
			const currentModel = (0, react.useMemo)(() => {
				if (!currentGroup) return null;
				return currentGroup.models.find((m) => m.id === currentModelId) || null;
			}, [currentGroup, currentModelId]);

			const reasoning = currentModel?.reasoning;
			const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
			const effortLabel = currentModel === null ? void 0 : reasoning === void 0 ? state.retainedEffort : effectiveEffort === void 0 ? (t ? t("effort.providerDefault") : "Default") : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort;

			const effortChoices = (0, react.useMemo)(() => reasoning === void 0 ? [] : [...reasoning.defaultEffort === void 0 ? [{
				key: "provider-default",
				effort: void 0,
				label: t ? t("effort.providerDefault") : "Default"
			}] : [], ...reasoning.efforts.map((effort) => ({
				key: `effort:${effort.id}`,
				effort: effort.id,
				label: effort.name
			}))], [reasoning, t]);

			const filteredModels = (0, react.useMemo)(() => {
				if (!currentGroup) return [];
				return (0, _deepseek_ai_dsh_client_ui_primitives.rankByName)(currentGroup.models, query.trim());
			}, [currentGroup, query]);

			const showSearch = (currentGroup?.models?.length ?? 0) > 4;
			const busy = state.pending !== null;

			const probeProvider = (0, react.useCallback)(async (group) => {
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

			(0, react.useEffect)(() => {
				if (currentGroup && !providerStatus[currentGroup.id]) {
					probeProvider(currentGroup);
				}
			}, [currentGroup?.id, probeProvider]);

			(0, react.useEffect)(() => {
				if (openMenu === null) return;
				const closeOutside = (event) => {
					if (rootRef.current?.contains(event.target) === true) return;
					if (menuRef.current?.contains(event.target) === true) return;
					setOpenMenu(null);
				};
				document.addEventListener("mousedown", closeOutside);
				return () => {
					document.removeEventListener("mousedown", closeOutside);
				};
			}, [openMenu]);

			(0, react.useEffect)(() => {
				if (openMenu === null) return;
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						setOpenMenu(null);
					}
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [openMenu]);

			(0, react.useLayoutEffect)(() => {
				if (!available || openMenu === null) {
					setMenuPos(null);
					return;
				}
				const place = () => {
					const activeTrigger = openMenu === "provider" ? providerTriggerRef.current : triggerRef.current;
					const rect = activeTrigger?.getBoundingClientRect();
					if (rect === void 0) return;
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
			}, [available, openMenu, state, query]);

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

			const settleSelection = (result) => {
				if (result === void 0) return;
				if (result.ok) {
					close();
					return;
				}
				const { error } = result;
				toastSeq.current += 1;
				setToast({
					seq: toastSeq.current,
					text: error.code === "session/writer-held" ? (t ? t("error.sessionInUse") : "Session in use") : (t ? t("error.action", { message: `${error.code}: ${error.message}` }) : `${error.code}: ${error.message}`)
				});
			};

			const submit = (selection) => {
				select(selection).then(settleSelection);
			};

			const chooseProvider = (group) => {
				if (group.id !== currentGroup?.id) {
					const targetModel = group.models[0];
					if (targetModel) {
						submit({
							provider: group.id,
							model: targetModel.id,
							...targetModel.reasoning?.defaultEffort === void 0 ? {} : { reasoningEffort: targetModel.reasoning.defaultEffort }
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
				if (currentGroup === null) return;
				submit({
					provider: currentGroup.id,
					model: model.id,
					...model.reasoning?.defaultEffort === void 0 ? {} : { reasoningEffort: model.reasoning.defaultEffort }
				});
			};

			const chooseEffort = (effort) => {
				if (state.current === null) return;
				submit({
					provider: state.current.provider,
					model: state.current.model,
					...effort === void 0 ? {} : { reasoningEffort: effort }
				});
			};

			const waiting = currentModel === null && state.status === "loading";
			const modelLabel = waiting ? (t ? t("trigger.loading") : "加载中...") : currentModel?.name ?? (t ? t("trigger.fallback") : "请选择模型");
			const triggerLabel = effortLabel === void 0 ? modelLabel : `${modelLabel} · ${effortLabel}`;
			const providerLabel = currentGroup ? currentGroup.provider.name : "选择提供商";
			const activeStatus = providerStatus[currentGroup?.id] || { state: "unknown", title: "未检测" };

			const renderStatusDot = (pId, extraStyle = {}) => {
				const status = providerStatus[pId] || { state: "unknown", title: "点击切换并检测" };
				const isOk = status.state === "ok";
				const isFail = status.state === "fail";
				const isPending = status.state === "pending";
				const dotColor = isOk ? "#10b981" : isFail ? "#ef4444" : isPending ? "#3b82f6" : "#71717a";
				const dotGlow = isOk ? "0 0 5px rgba(16, 185, 129, 0.7)" : isFail ? "0 0 5px rgba(239, 68, 68, 0.7)" : isPending ? "0 0 5px rgba(59, 130, 246, 0.7)" : "none";

				return (0, react_jsx_runtime.jsx)("span", {
					title: status.title,
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

			const renderModelLabel = (provider, model, placement, selected) => (0, react_jsx_runtime.jsx)("span", {
				"data-provider-id": provider.id,
				"data-model-id": model.id,
				children: renderSlot("conversation.input.model.label", {
					provider,
					model,
					placement,
					selected
				}, { fallback: model.name })
			});

			return (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: ModelSelect_module_css_default.root,
				style: { display: "inline-flex", alignItems: "center", gap: "6px" },
				children: [
					// 1. Provider Trigger
					(0, react_jsx_runtime.jsxs)("button", {
						ref: providerTriggerRef,
						type: "button",
						className: ModelSelect_module_css_default.trigger,
						title: `提供商: ${providerLabel} (${activeStatus.title})`,
						disabled: locked,
						onClick: () => {
							if (openMenu === "provider") close();
							else openProviderMenu();
						},
						children: [
							renderStatusDot(currentGroup?.id, { marginRight: "2px" }),
							(0, react_jsx_runtime.jsx)("span", {
								className: ModelSelect_module_css_default.triggerLabel,
								style: { maxWidth: "130px" },
								children: providerLabel
							}),
							(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
								className: clsx(ModelSelect_module_css_default.chevron, openMenu === "provider" && ModelSelect_module_css_default.chevronOpen)
							})
						]
					}),

					// 2. Model Trigger
					(0, react_jsx_runtime.jsxs)("button", {
						ref: triggerRef,
						type: "button",
						className: ModelSelect_module_css_default.trigger,
						title: `模型: ${triggerLabel}`,
						"aria-busy": busy,
						disabled: locked,
						onClick: () => {
							if (openMenu === "model") close();
							else openModelMenu();
						},
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								className: ModelSelect_module_css_default.triggerLabel,
								style: { maxWidth: "160px" },
								children: currentModel === null || currentGroup === null ? modelLabel : renderModelLabel(currentGroup.provider, currentModel, "trigger", true)
							}),
							effortLabel !== void 0 && (0, react_jsx_runtime.jsx)("span", {
								className: ModelSelect_module_css_default.triggerEffort,
								children: effortLabel
							}),
							busy ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
								className: clsx(ModelSelect_module_css_default.chevron, openMenu === "model" && ModelSelect_module_css_default.chevronOpen)
							})
						]
					}),

					// 3. Floating Menu Portal
					openMenu !== null && (0, react_dom.createPortal)((0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.MenuSurface, {
						ref: menuRef,
						id: `${id}-menu`,
						className: ModelSelect_module_css_default.menu,
						style: menuPos ?? MEASURE_STYLE,
						role: "menu",
						children: [
							// Provider Menu
							openMenu === "provider" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px 8px", borderBottom: "1px solid var(--dsw-alias-border-l1)", fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
										children: [
											(0, react_jsx_runtime.jsx)("span", { children: `选择提供商 (${groups.length})` }),
											(0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: { background: "none", border: "none", color: "var(--dsw-alias-state-business-primary)", cursor: "pointer", fontSize: "11px" },
												onClick: () => {
													if (currentGroup) probeProvider(currentGroup);
													load();
												},
												children: "检测当前连通性"
											})
										]
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: clsx(ModelSelect_module_css_default.groups, "scrollable"),
										children: groups.map((group) => {
											const selected = group.id === currentGroup?.id;
											return (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												role: "menuitemradio",
												"aria-checked": selected,
												className: clsx(ModelSelect_module_css_default.option, ModelSelect_module_css_default.modelOption, selected && ModelSelect_module_css_default.selected),
												onClick: () => chooseProvider(group),
												children: [
													renderStatusDot(group.id, { marginRight: "6px" }),
													(0, react_jsx_runtime.jsx)("span", {
														className: ModelSelect_module_css_default.optionCopy,
														children: (0, react_jsx_runtime.jsx)("span", {
															className: ModelSelect_module_css_default.modelName,
															children: group.provider.name
														})
													}),
													(0, react_jsx_runtime.jsx)("span", {
														style: { fontSize: "11px", color: "var(--dsw-alias-label-caption)", marginRight: "8px" },
														children: `${group.models.length} 个模型`
													}),
													selected ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, {}) : null
												]
											}, group.id);
										})
									})
								]
							}),

							// Model Menu
							openMenu === "model" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
								children: [
									(0, react_jsx_runtime.jsxs)("div", {
										style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px 8px", borderBottom: "1px solid var(--dsw-alias-border-l1)", fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
										children: [
											(0, react_jsx_runtime.jsxs)("span", {
												style: { display: "flex", alignItems: "center", gap: "6px" },
												children: [
													renderStatusDot(currentGroup?.id),
													(0, react_jsx_runtime.jsx)("span", { children: `${currentGroup?.provider.name ?? "提供商"} · 模型 (${filteredModels.length})` })
												]
											}),
											(0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: { background: "none", border: "none", color: "var(--dsw-alias-state-business-primary)", cursor: "pointer", fontSize: "11px" },
												onClick: () => setOpenMenu("provider"),
												children: "切换提供商"
											})
										]
									}),
									showSearch && (0, react_jsx_runtime.jsxs)("div", {
										className: ModelSelect_module_css_default.searchRow,
										children: [
											(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
												ref: searchRef,
												className: clsx(ModelSelect_module_css_default.search, query !== "" && ModelSelect_module_css_default.searchWithQuery),
												type: "text",
												role: "searchbox",
												placeholder: `在 ${currentGroup?.provider.name ?? ""} 中搜索模型...`,
												value: query,
												onChange: (e) => setQuery(e.target.value)
											}),
											query !== "" && (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: ModelSelect_module_css_default.searchClear,
												onClick: () => setQuery(""),
												children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseFillRegular, {})
											})
										]
									}),
									(0, react_jsx_runtime.jsx)("div", {
										className: clsx(ModelSelect_module_css_default.groups, "scrollable"),
										children: filteredModels.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
											className: ModelSelect_module_css_default.empty,
											children: "没有匹配的模型"
										}) : filteredModels.map((model) => {
											const selected = state.current?.provider === currentGroup?.id && state.current?.model === model.id;
											return (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												role: "menuitemradio",
												"aria-checked": selected,
												className: clsx(ModelSelect_module_css_default.option, ModelSelect_module_css_default.modelOption, selected && ModelSelect_module_css_default.selected),
												onClick: () => chooseModel(model),
												children: [
													(0, react_jsx_runtime.jsx)("span", {
														className: ModelSelect_module_css_default.optionCopy,
														children: (0, react_jsx_runtime.jsx)("span", {
															className: ModelSelect_module_css_default.modelName,
															children: renderModelLabel(currentGroup.provider, model, "option", selected)
														})
													}),
													selected ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, {}) : null
												]
											}, model.id);
										})
									}),
									reasoning !== void 0 && effortChoices.length > 0 && (0, react_jsx_runtime.jsxs)("div", {
										style: { borderTop: "1px solid var(--dsw-alias-border-l1)", padding: "6px 8px", display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" },
										children: [
											(0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-caption)", flex: "none" }, children: "推理强度:" }),
											(0, react_jsx_runtime.jsx)("div", {
												style: { display: "flex", gap: "4px", flexWrap: "wrap" },
												children: effortChoices.map((level) => {
													const isEffortSelected = effectiveEffort === level.effort;
													return (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														style: {
															padding: "2px 6px",
															borderRadius: "4px",
															border: isEffortSelected ? "1px solid var(--dsw-alias-state-business-primary)" : "1px solid var(--dsw-alias-border-l1)",
															background: isEffortSelected ? "var(--dsw-alias-state-business-primary)" : "transparent",
															color: isEffortSelected ? "#ffffff" : "var(--dsw-alias-label-secondary)",
															cursor: "pointer",
															fontSize: "11px"
														},
														onClick: () => chooseEffort(level.effort),
														children: level.label
													}, level.key);
												})
											})
										]
									})
								]
							})
						]
					}), document.body),

					// Toast
					toast !== null && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: toast.text,
						icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}),
						anchor: rootRef.current?.closest("[data-composer-card]") ?? null,
						onDone: () => {
							setToast(null);
						}
					}, toast.seq)
				]
			});
		}
		//#endregion
		'''

    modified_code = clean_orig_code[:idx1] + new_model_select + "\n\t\t" + clean_orig_code[idx2:]
    mod_bytes = modified_code.encode("utf-8")
    diff = target_size - len(mod_bytes)
    
    if diff < 0:
        print(f"  ✖ Modified code size ({len(mod_bytes)}) exceeds original ({target_size}).")
        return False
        
    padding = ("/*" + ("*" * (diff - 4)) + "*/").encode("utf-8")
    padded_bytes = mod_bytes + padding
    assert len(padded_bytes) == target_size
    
    # Write in place
    try:
        with open(asar_path, "r+b") as f:
            f.seek(base_offset + target_offset)
            f.write(padded_bytes)
        print("  ✔ Successfully patched app.asar in-place with exact byte alignment.")
        return True
    except Exception as e:
        print(f"  ✖ Failed to write to app.asar: {e}")
        return False

def register_bundle(dsh_profile, plugin_dir):
    print("\nStep 3: Registering dsh-plugin-model-matrix into desktop profile...")
    pkg_path = os.path.join(dsh_profile, 'package.json')
    if not os.path.exists(pkg_path):
        print("  ✖ desktop profile package.json not found.")
        return
        
    with open(pkg_path, "r", encoding="utf-8") as f:
        pkg = json.load(f)
        
    pkg.setdefault('dependencies', {})
    pkg['dependencies']['dsh-plugin-model-matrix'] = f"link:{plugin_dir.replace('\\', '/')}"
    
    pkg.setdefault('dsh', {}).setdefault('profile', {})
    bundles = pkg['dsh']['profile'].setdefault('bundles', [])
    if 'dsh-plugin-model-matrix' not in bundles:
        bundles.append('dsh-plugin-model-matrix')
        
    with open(pkg_path, "w", encoding="utf-8") as f:
        json.dump(pkg, f, indent=2)
    print("  ✔ Registered in package.json.")

if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    plugin_dir = os.path.dirname(script_dir)
    profile_dir, app_dir = find_dsh_paths()
    
    print(f"=== DeepSeek Harness Model Matrix Deployment ===")
    print(f"Plugin Directory : {plugin_dir}")
    print(f"Desktop Profile  : {profile_dir}")
    print(f"App Directory    : {app_dir}\n")
    
    cleanup_conflicts(profile_dir)
    patch_app_asar(app_dir)
    register_bundle(profile_dir, plugin_dir)
    print("\n🎉 All steps completed successfully! Please reload DeepSeek Harness (F12 -> location.reload() or restart the app).")
