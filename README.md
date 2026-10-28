# dsh-plugin-model-matrix

> Ecosystem enhancement plugin for DeepSeek Harness: **Two-Level Composer Model Selector** + **Real-Time Provider Status Lights** + **Unified Subscription Management Suite**.

[中文文档 (Chinese)](README.zh.md)

---

## 📖 Background & Problems Solved

When using DeepSeek Harness with multiple subscription providers (such as Nous Portal, Opencode Zen, Command Code, custom enterprise endpoints, etc.):

1. **Overwhelming Model Counts**: Dozens or hundreds of models from every provider were lumped into a single, massive vertical dropdown list, making selection exhausting.
2. **Auto-Refresh Disruption**: The default client triggered an asynchronous catalog `reload()` whenever opening the menu. When network requests completed, the list re-rendered, jumping the scroll position back to the top and clearing the user's active search query.
3. **Connectivity Dilemma**: Probing dozens of models continuously creates massive network overhead and rate-limit risks; probing nothing leaves the user blind to channel availability.

`dsh-plugin-model-matrix` provides a complete, architectural solution to these problems.

---

## ✨ Key Features

### 1. Two-Level Composer Selection Bars (Two-Bar Selector)
Splits the model selector into two horizontal buttons:
- **Left Bar (Provider Selector)**:
  - Displays the active provider (e.g. `Ideal Model`, `Nous Portal`, `Opencode Zen`, `DeepSeek`).
  - Clicking opens a clean provider list with model counts.
  - Selecting a provider remembers the last-used model and **automatically unfolds the Model menu**.
- **Right Bar (Model Selector)**:
  - **Only displays models belonging to the active provider**!
  - Auto-presents an in-provider fuzzy search box when models > 4.
  - Seamless Reasoning Effort tuning (`Low` / `Medium` / `High` pills).

### 2. Provider-Side Real-Time Status Lights
- **Light Location**: Positioned directly on the Provider bar and inside the Provider menu items.
- **On-Demand Single-Model Probing**: **Only triggered when switching to a provider, testing exactly ONE model**.
- **Zero Mass Polling**: Eliminates background rate limits while providing instant, honest feedback.
- **Color Indicators**:
  - 🟢 **Green**: Connected and operational.
  - 🔴 **Red**: Authentication error, unconfigured key, or offline endpoint.
  - 🔵 **Blue**: Actively probing (pulsing dot).
  - ⚪ **Gray**: Untested.

### 3. Stable, Interruption-Free Experience
- Opening the menu reads directly from memory cache when available; no unsolicited asynchronous reload storms.
- User search queries and scroll positions are strictly preserved during background heartbeats.

### 4. Unified Subscription Management
Integrates management panels for:
- **Nous Research Portal**: Hermes subscription, `:free` tier tagging, OAuth/API key management.
- **Opencode Zen**: 9 free models with automated session gatekeeping.
- **Command Code**: Cost-based tier classification (Free / Plan / Paid) with models.dev real-time pricing.

---

## 📂 Directory Structure

```
dsh-plugin-model-matrix/
├── package.json               # DSH bundle metadata
├── cordis.patch.yml           # Cordis loader patch configuration
├── index.js                   # Host-side entry (REST routes, probe worker)
├── client.js                  # Client-side entry (Two-bar UI, styles injection)
├── src/
│   ├── ui/
│   │   ├── ModelSelect.js     # Two-bar composer component
│   │   └── styles.js          # Theme-matched CSS
│   ├── core/
│   │   ├── probe.js           # Lightweight probe engine
│   │   ├── store.js           # Visibility and tier storage
│   │   └── api.js             # API route handlers
│   ├── providers/
│   │   ├── nous-portal.js     # Nous Portal adapter
│   │   ├── opencode-zen.js    # Opencode Zen adapter
│   │   └── commandcode.js     # Command Code adapter
│   └── settings/
│       └── settings-page.js   # Settings dashboard component
├── locale/
│   ├── zh.json                # Simplified Chinese translations
│   └── en.json                # English translations
└── scripts/
    ├── install.js             # One-click installation script
    └── test.js                # Automated verification script
```

---

## 🚀 Installation

Run the installer from the repository root:

```bash
node scripts/install.js
```

Then reload DeepSeek Harness (Press `F12` -> `location.reload()` in console, or restart the desktop app from the system tray).

---

## 📜 License

[MIT License](LICENSE) © 2026 ly1992921
