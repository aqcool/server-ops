import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

const app = new App(
  { name: "Server Ops", version: "0.1.0" },
  { availableDisplayModes: ["inline"] },
  { autoResize: false },
);

const element = (id) => document.getElementById(id);
const picker = element("picker");
const servers = element("servers");
const status = element("status");
const countBadge = element("count");

let profiles = [];
let selected = new Set();
let saving = false;
let refreshing = null;

const chinese = {
  title: "授权 SSH 服务器",
  loading: "正在读取 ~/.ssh/config…",
  empty: "未发现 SSH 主机配置",
  emptyHint: "请在 ~/.ssh/config 中添加 Host 别名后点击刷新",
  refresh: "刷新",
  loadFailed: "无法读取服务器列表。",
  saveFailed: "无法保存服务器授权。",
  selectedCount: (n) => `已授权 ${n} 台`,
};

const english = {
  title: "Authorized SSH Servers",
  loading: "Loading ~/.ssh/config…",
  empty: "No SSH hosts found",
  emptyHint: "Add Host aliases in ~/.ssh/config and click Refresh",
  refresh: "Refresh",
  loadFailed: "Could not load SSH servers.",
  saveFailed: "Could not save server selection.",
  selectedCount: (n) => `${n} selected`,
};

let text = english;

async function call(name, args = {}) {
  const reply = await app.callServerTool({ name, arguments: args });
  if (reply.isError) {
    throw new Error(reply.content?.find((item) => item.type === "text")?.text || "Tool error");
  }
  return reply.structuredContent;
}

function showError(message = "") {
  status.textContent = message;
  status.hidden = !message;
}

function applyAppearance() {
  const context = app.getHostContext();
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}

function syncModelContext() {
  if (!app.getHostCapabilities()?.updateModelContext) return;
  const ids = [...selected];
  const content =
    ids.length > 0
      ? [{ type: "text", text: `Authorized SSH servers for server-ops: ${ids.join(", ")}` }]
      : [];
  void app.updateModelContext({ content }).catch(() => {});
}

function render() {
  element("empty").hidden = profiles.length > 0;
  countBadge.textContent = text.selectedCount(selected.size);
  servers.replaceChildren();
  for (const profile of profiles) {
    const label = document.createElement("label");
    label.className = "server";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = selected.has(profile.id);
    box.onchange = () => void toggle(profile.id, box);

    const mark = document.createElement("span");
    mark.className = "mark";
    mark.setAttribute("aria-hidden", "true");

    const info = document.createElement("span");
    info.className = "server-info";

    const name = document.createElement("span");
    name.className = "server-name";
    name.textContent = profile.name;
    name.title = profile.name;
    info.append(name);

    if (profile.subtitle) {
      const sub = document.createElement("span");
      sub.className = "server-sub";
      sub.textContent = profile.subtitle;
      sub.title = profile.subtitle;
      info.append(sub);
    }

    label.append(box, mark, info);
    servers.append(label);
  }
}

async function refresh({ quiet = false } = {}) {
  if (saving) return;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const result = await call("picker_read");
      profiles = result?.profiles ?? [];
      selected = new Set(result?.serverIds ?? []);
      render();
      if (!quiet) showError();
    } catch {
      if (!quiet) showError(text.loadFailed);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function toggle(id, box) {
  if (saving) return;
  saving = true;
  showError();
  const next = new Set(selected);
  if (box.checked) next.add(id);
  else next.delete(id);

  const inputs = servers.querySelectorAll("input");
  for (const input of inputs) input.disabled = true;
  let saveFailed = false;
  try {
    const result = await call("picker_save", { serverIds: [...next] });
    selected = new Set(result?.serverIds ?? []);
    countBadge.textContent = text.selectedCount(selected.size);
    syncModelContext();
  } catch {
    saveFailed = true;
    box.checked = selected.has(id);
    showError(text.saveFailed);
  } finally {
    saving = false;
    for (const input of inputs) input.disabled = false;
    box.focus();
  }
  if (saveFailed) void refresh({ quiet: true });
}

async function start() {
  app.onhostcontextchanged = applyAppearance;
  app.ontoolresult = (result) => {
    if (result?.structuredContent?.profiles) {
      profiles = result.structuredContent.profiles;
      selected = new Set(result.structuredContent.serverIds ?? []);
      render();
      element("loading").hidden = true;
    }
  };

  await app.connect();
  text = app.getHostContext()?.locale?.startsWith("zh") ? chinese : english;
  document.documentElement.lang = text === chinese ? "zh-CN" : "en";
  applyAppearance();

  element("title").textContent = text.title;
  element("refresh-btn").textContent = text.refresh;
  element("refresh-btn").onclick = () => void refresh();
  element("empty-title").textContent = text.empty;
  element("empty-hint").textContent = text.emptyHint;

  new ResizeObserver(() => {
    const height = Math.ceil(picker.getBoundingClientRect().height);
    if (height > 0) void app.sendSizeChanged({ height });
  }).observe(picker);

  const loading = element("loading");
  loading.textContent = text.loading;
  try {
    await refresh();
  } finally {
    loading.hidden = true;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh({ quiet: true });
  });
  window.addEventListener("focus", () => {
    void refresh({ quiet: true });
  });
}

void start().catch(() => showError(text.loadFailed));
