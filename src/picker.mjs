import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

const app = new App(
  { name: "Server Ops", version: "0.2.0" },
  { availableDisplayModes: ["inline"] },
  { autoResize: false },
);

const $ = (id) => document.getElementById(id);

const I18N = {
  zh: {
    pageTitle: "SSH 服务器",
    pageSubtitle: "独立管理服务器连接与加密凭据，仅勾选授权的服务器对 Agent 可见。",
    addBtn: "+ 添加服务器",
    emptyTitle: "还没有保存的服务器",
    emptyHint: "添加一台 SSH 服务器并勾选授权后，即可让 Agent 执行运维命令或上传文件。密码与口令将加密存储在系统钥匙串中。",
    emptyAddBtn: "+ 添加第一台服务器",
    authorizedCount: (n) => `已授权 ${n} 台`,
    authPassword: "密码",
    authPrivateKey: "私钥",
    testBtn: "测试",
    testingBtn: "测试中…",
    editBtn: "编辑",
    deleteBtn: "删除",
    confirmDelete: (name) => `确认删除「${name}」？已保存的凭据也会一并清除。`,
    statusOk: "已连通",
    statusFailed: "连接失败",
    modalAdd: "添加 SSH 服务器",
    modalEdit: "编辑 SSH 服务器",
    lblName: "显示名称（可选）",
    phName: "例如：生产 Web 服务器",
    lblHost: "主机地址",
    lblPort: "端口",
    lblUser: "用户名",
    lblAuth: "认证方式",
    lblPassword: "密码",
    lblKeypath: "私钥文件路径",
    lblPassphrase: "私钥口令（可选）",
    hintSavedSecret: "已加密保存；留空表示保持不变",
    cancel: "取消",
    save: "保存",
    saving: "保存中…",
    loadFailed: "无法读取服务器列表。",
    saveFailed: "保存失败。",
    testSuccess: (name, info) => `「${name}」连接成功：${info}`,
    testFail: (name, err) => `「${name}」连接失败：${err}`,
    keyRequired: "请填写私钥文件路径。",
    passwordRequired: "请填写登录密码。",
  },
  en: {
    pageTitle: "SSH Servers",
    pageSubtitle: "Manage SSH profiles with encrypted credentials. Only checked servers are visible to the agent.",
    addBtn: "+ Add Server",
    emptyTitle: "No saved servers yet",
    emptyHint: "Add an SSH server and check it to authorize remote commands and file uploads. Secrets are stored encrypted in the OS keychain.",
    emptyAddBtn: "+ Add Your First Server",
    authorizedCount: (n) => `${n} authorized`,
    authPassword: "Password",
    authPrivateKey: "SSH Key",
    testBtn: "Test",
    testingBtn: "Testing…",
    editBtn: "Edit",
    deleteBtn: "Delete",
    confirmDelete: (name) => `Delete "${name}"? Stored credentials will also be removed.`,
    statusOk: "Connected",
    statusFailed: "Failed",
    modalAdd: "Add SSH Server",
    modalEdit: "Edit SSH Server",
    lblName: "Display Name (optional)",
    phName: "e.g. Production Web",
    lblHost: "Host",
    lblPort: "Port",
    lblUser: "Username",
    lblAuth: "Authentication",
    lblPassword: "Password",
    lblKeypath: "Private Key Path",
    lblPassphrase: "Key Passphrase (optional)",
    hintSavedSecret: "Encrypted secret saved; leave blank to keep unchanged",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    loadFailed: "Could not load saved servers.",
    saveFailed: "Failed to save changes.",
    testSuccess: (name, info) => `Connected to ${name}: ${info}`,
    testFail: (name, err) => `Connection failed for ${name}: ${err}`,
    keyRequired: "Please enter a private key path.",
    passwordRequired: "Please enter a password.",
  },
};

let t = I18N.en;
let profiles = [];
let selected = new Set();
let busy = false;
let testingId = null;
let editingProfile = null;
let authType = "password";

async function callTool(name, args = {}) {
  const reply = await app.callServerTool({ name, arguments: args });
  if (reply.isError) {
    throw new Error(reply.content?.find((item) => item.type === "text")?.text || "Tool error");
  }
  return reply.structuredContent;
}

function showBanner(message = "", kind = "") {
  const el = $("banner");
  el.textContent = message;
  el.className = `banner${kind ? ` ${kind}` : ""}`;
  el.hidden = !message;
}

function applyAppearance() {
  const ctx = app.getHostContext();
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  document.body.classList.toggle("compact", Boolean(ctx?.containerDimensions?.maxHeight));
}

function syncModelContext() {
  if (!app.getHostCapabilities()?.updateModelContext) return;
  const names = profiles.filter((p) => selected.has(p.id)).map((p) => `${p.name} (${p.id})`);
  const content =
    names.length > 0
      ? [{ type: "text", text: `Authorized SSH servers for server-ops: ${names.join(", ")}` }]
      : [];
  void app.updateModelContext({ content }).catch(() => {});
}

function applyStaticLabels() {
  $("page-title").textContent = t.pageTitle;
  $("page-subtitle").textContent = t.pageSubtitle;
  $("add-btn").textContent = t.addBtn;
  $("empty-title").textContent = t.emptyTitle;
  $("empty-hint").textContent = t.emptyHint;
  $("empty-add-btn").textContent = t.emptyAddBtn;
  $("lbl-name").textContent = t.lblName;
  $("f-name").placeholder = t.phName;
  $("lbl-host").textContent = t.lblHost;
  $("lbl-port").textContent = t.lblPort;
  $("lbl-user").textContent = t.lblUser;
  $("lbl-auth").textContent = t.lblAuth;
  $("seg-password").textContent = t.authPassword;
  $("seg-key").textContent = t.authPrivateKey;
  $("lbl-password").textContent = t.lblPassword;
  $("lbl-keypath").textContent = t.lblKeypath;
  $("lbl-passphrase").textContent = t.lblPassphrase;
  $("hint-password").textContent = t.hintSavedSecret;
  $("hint-passphrase").textContent = t.hintSavedSecret;
  $("cancel-btn").textContent = t.cancel;
  $("save-btn").textContent = t.save;
}

function renderList() {
  const countEl = $("count-pill");
  countEl.textContent = t.authorizedCount(selected.size);
  countEl.classList.toggle("active", selected.size > 0);

  $("empty-state").hidden = profiles.length > 0;
  const container = $("server-list");
  container.replaceChildren();

  for (const profile of profiles) {
    const isSelected = selected.has(profile.id);
    const card = document.createElement("div");
    card.className = `card${isSelected ? " selected" : ""}`;

    const main = document.createElement("label");
    main.className = "card-main";

    const checkWrap = document.createElement("span");
    checkWrap.className = "check-wrap";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = isSelected;
    box.disabled = busy;
    box.onchange = () => void toggleAuthorize(profile.id, box.checked);

    const checkVisual = document.createElement("span");
    checkVisual.className = "check-box";
    checkVisual.innerHTML = isSelected
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : "";
    checkWrap.append(box, checkVisual);

    const info = document.createElement("div");
    info.className = "info";

    const nameLine = document.createElement("div");
    nameLine.className = "name-line";
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = profile.name;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = profile.authType === "privateKey" ? t.authPrivateKey : t.authPassword;
    nameLine.append(nameEl, tag);

    const metaLine = document.createElement("div");
    metaLine.className = "meta-line";
    const sub = document.createElement("span");
    sub.className = "mono";
    sub.textContent = profile.subtitle;
    metaLine.append(sub);

    if (profile.lastConnectError) {
      const st = document.createElement("span");
      st.className = "status-dot err";
      st.textContent = t.statusFailed;
      st.title = profile.lastConnectError;
      metaLine.append(st);
    } else if (profile.lastConnectedAt) {
      const st = document.createElement("span");
      st.className = "status-dot ok";
      st.textContent = t.statusOk;
      metaLine.append(st);
    }

    info.append(nameLine, metaLine);
    main.append(checkWrap, info);

    const actions = document.createElement("div");
    actions.className = "actions";

    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "btn btn-ghost";
    testBtn.textContent = testingId === profile.id ? t.testingBtn : t.testBtn;
    testBtn.disabled = busy || testingId !== null;
    testBtn.onclick = () => void runTest(profile);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-ghost";
    editBtn.textContent = t.editBtn;
    editBtn.disabled = busy;
    editBtn.onclick = () => openModal(profile);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-ghost danger";
    delBtn.textContent = t.deleteBtn;
    delBtn.disabled = busy;
    delBtn.onclick = () => void removeProfile(profile);

    actions.append(testBtn, editBtn, delBtn);
    card.append(main, actions);
    container.append(card);
  }
}

function setAuthType(next) {
  authType = next;
  $("seg-password").classList.toggle("active", next === "password");
  $("seg-key").classList.toggle("active", next === "privateKey");
  $("group-password").hidden = next !== "password";
  $("group-key").hidden = next !== "privateKey";
  $("group-passphrase").hidden = next !== "privateKey";
}

function openModal(profile = null) {
  editingProfile = profile;
  $("modal-title").textContent = profile ? t.modalEdit : t.modalAdd;
  $("f-name").value = profile?.displayName ?? "";
  $("f-host").value = profile?.host ?? "";
  $("f-port").value = String(profile?.port ?? 22);
  $("f-user").value = profile?.username ?? "";
  $("f-password").value = "";
  $("f-keypath").value = profile?.privateKeyPath ?? "";
  $("f-passphrase").value = "";
  $("hint-password").hidden = !(profile && profile.hasPassword);
  $("hint-passphrase").hidden = !(profile && profile.hasPassphrase);
  $("form-error").hidden = true;
  setAuthType(profile?.authType ?? "password");
  $("modal-backdrop").hidden = false;
  $("f-host").focus();
}

function closeModal() {
  $("modal-backdrop").hidden = true;
  editingProfile = null;
}

async function refresh({ quiet = false } = {}) {
  try {
    const res = await callTool("picker_read");
    profiles = res?.profiles ?? [];
    selected = new Set(res?.serverIds ?? []);
    renderList();
    if (!quiet) showBanner();
  } catch (err) {
    if (!quiet) showBanner(err instanceof Error ? err.message : t.loadFailed, "error");
  }
}

async function toggleAuthorize(id, checked) {
  if (busy) return;
  busy = true;
  const next = new Set(selected);
  if (checked) next.add(id);
  else next.delete(id);
  try {
    const res = await callTool("picker_save", { serverIds: [...next] });
    selected = new Set(res?.serverIds ?? []);
    syncModelContext();
    showBanner();
  } catch (err) {
    showBanner(err instanceof Error ? err.message : t.saveFailed, "error");
  } finally {
    busy = false;
    renderList();
  }
}

async function runTest(profile) {
  if (testingId) return;
  testingId = profile.id;
  renderList();
  showBanner();
  try {
    const res = await callTool("profile_test", { profileId: profile.id });
    if (res?.profiles) profiles = res.profiles;
    if (res?.serverIds) selected = new Set(res.serverIds);
    if (res?.ok) {
      showBanner(t.testSuccess(profile.name, res.info || "OK"), "success");
    } else {
      showBanner(t.testFail(profile.name, res?.error || "Unknown error"), "error");
    }
  } catch (err) {
    showBanner(t.testFail(profile.name, err instanceof Error ? err.message : String(err)), "error");
  } finally {
    testingId = null;
    renderList();
  }
}

async function removeProfile(profile) {
  if (busy) return;
  if (!window.confirm(t.confirmDelete(profile.name))) return;
  busy = true;
  renderList();
  try {
    const res = await callTool("profile_delete", { profileId: profile.id });
    profiles = res?.profiles ?? [];
    selected = new Set(res?.serverIds ?? []);
    syncModelContext();
    showBanner();
  } catch (err) {
    showBanner(err instanceof Error ? err.message : t.saveFailed, "error");
  } finally {
    busy = false;
    renderList();
  }
}

async function submitForm(event) {
  event.preventDefault();
  const errEl = $("form-error");
  errEl.hidden = true;

  const host = $("f-host").value.trim();
  const port = Number.parseInt($("f-port").value, 10) || 22;
  const username = $("f-user").value.trim();
  const displayName = $("f-name").value.trim();
  const password = $("f-password").value;
  const privateKeyPath = $("f-keypath").value.trim();
  const passphrase = $("f-passphrase").value;

  if (authType === "privateKey" && !privateKeyPath) {
    errEl.textContent = t.keyRequired;
    errEl.hidden = false;
    return;
  }
  if (authType === "password" && !password && !editingProfile?.hasPassword) {
    errEl.textContent = t.passwordRequired;
    errEl.hidden = false;
    return;
  }

  const saveBtn = $("save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = t.saving;
  try {
    const payload = {
      ...(editingProfile ? { profileId: editingProfile.id } : {}),
      ...(displayName ? { displayName } : {}),
      host,
      port,
      username,
      authType,
      ...(authType === "password" && password ? { password } : {}),
      ...(authType === "privateKey" ? { privateKeyPath } : {}),
      ...(authType === "privateKey" && passphrase ? { passphrase } : {}),
    };
    const res = await callTool("profile_save", payload);
    profiles = res?.profiles ?? [];
    selected = new Set(res?.serverIds ?? []);
    closeModal();
    renderList();
    showBanner();
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : t.saveFailed;
    errEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = t.save;
  }
}

async function start() {
  app.onhostcontextchanged = applyAppearance;
  app.ontoolresult = (result) => {
    if (result?.structuredContent?.profiles) {
      profiles = result.structuredContent.profiles;
      selected = new Set(result.structuredContent.serverIds ?? []);
      renderList();
    }
  };

  $("add-btn").onclick = () => openModal(null);
  $("empty-add-btn").onclick = () => openModal(null);
  $("modal-close").onclick = closeModal;
  $("cancel-btn").onclick = closeModal;
  $("modal-backdrop").onclick = (e) => {
    if (e.target === $("modal-backdrop")) closeModal();
  };
  $("seg-password").onclick = () => setAuthType("password");
  $("seg-key").onclick = () => setAuthType("privateKey");
  $("profile-form").onsubmit = (e) => void submitForm(e);

  await app.connect();
  t = app.getHostContext()?.locale?.startsWith("zh") ? I18N.zh : I18N.en;
  document.documentElement.lang = t === I18N.zh ? "zh-CN" : "en";
  applyAppearance();
  applyStaticLabels();

  new ResizeObserver(() => {
    if (!document.body.classList.contains("compact")) return;
    const height = Math.ceil($("app-root").getBoundingClientRect().height);
    if (height > 0) void app.sendSizeChanged({ height });
  }).observe($("app-root"));

  await refresh();
}

void start().catch(() => showBanner(t.loadFailed, "error"));
