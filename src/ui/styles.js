export const TWO_BAR_CSS = `
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
