import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

const APP_VERSION = typeof __SERVER_OPS_VERSION__ === "string" ? __SERVER_OPS_VERSION__ : "0.3.1";

const app = new App(
  { name: "Server Ops", version: APP_VERSION },
  { availableDisplayModes: ["inline"] },
  { autoResize: false },
);

const $ = (id) => document.getElementById(id);

const SERVER_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><line x1="6" y1="7" x2="6.01" y2="7"/><line x1="6" y1="17" x2="6.01" y2="17"/></svg>';

const I18N = {
  zh: {
    pageTitle: "Server Ops",
    pageSubtitle: "独立管理 SSH 服务器与加密凭据，打开开关即可授权给 Agent 使用。",
    addBtn: "+ 添加服务器",
    emptyTitle: "暂无已保存的服务器",
    emptyHint: "添加 SSH 服务器并开启授权开关，即可让 Agent 执行命令或上传文件。凭据加密保存在系统钥匙串中。",
    emptyAddBtn: "+ 添加服务器",
    authorizedCount: (n) => `已授权 ${n} 台`,
    authPassword: "密码",
    authPrivateKey: "私钥",
    testBtn: "测试",
    testingBtn: "测试中…",
    editBtn: "编辑",
    deleteBtn: "删除",
    toggleTitle: "授权给 Agent",
    confirmDelete: (name) => `确认删除「${name}」？已保存的加密凭据也会一并清除。`,
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
    directTag: "直连",
    lblBypassProxy: "绕过代理直连（Bypass TUN）",
    hintBypassProxy: "跳过 FlClash / Clash / Surge 等 TUN 虚拟网卡，通过物理网卡直连（支持 macOS / Windows）。",
    checkUpdate: "检查更新",
    checkingUpdate: "检查中…",
    upToDate: (v) => `已是最新版本 v${v}`,
    updateAvailable: (v) => `发现新版本 v${v}`,
    updateCardTitle: "发现 Server Ops 新版本",
    updateDoneTitle: "Server Ops 更新完成",
    updateFailTitle: "Server Ops 更新失败",
    updateDefaultSummary: "包含功能优化与问题修复，支持原地一键升级。",
    updateStepPreparing: "正在准备更新…",
    updateStepDownloading: "正在下载更新包…",
    updateStepVerifying: "正在校验安装包完整性…",
    updateStepInstalling: "正在安装新版本…",
    updateCompletedReload: (v) => `已安装 v${v}，正在自动重载插件，重新打开面板即可使用新版本。`,
    updateCompletedManual: (v) => `已安装 v${v}，请在 MCP Servers 设置中刷新或重启客户端后生效。`,
    updateRolledBack: "更新失败，已自动回滚至当前版本。",
    updateFailedGeneric: "更新失败，请稍后重试或前往发布页手动升级。",
    skipVersion: "忽略此版本",
    remindLater: "稍后提醒",
    gotIt: "知道了",
    releaseNotes: "更新说明",
    openRelease: "查看更新",
    updateNow: "立即升级",
    retryUpdate: "重试升级",
    updateFailed: (err) => `检查更新失败：${err}`,
  },
  en: {
    pageTitle: "Server Ops",
    pageSubtitle: "Manage SSH servers with encrypted credentials. Toggle a host on to authorize the agent.",
    addBtn: "+ Add Server",
    emptyTitle: "No saved servers yet",
    emptyHint: "Add an SSH server and toggle it on to authorize remote commands and file uploads. Secrets are stored encrypted in the OS keychain.",
    emptyAddBtn: "+ Add Server",
    authorizedCount: (n) => `${n} authorized`,
    authPassword: "Password",
    authPrivateKey: "SSH Key",
    testBtn: "Test",
    testingBtn: "Testing…",
    editBtn: "Edit",
    deleteBtn: "Delete",
    toggleTitle: "Authorize for agent",
    confirmDelete: (name) => `Delete "${name}"? Stored encrypted credentials will also be removed.`,
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
    directTag: "Direct",
    lblBypassProxy: "Direct Connect (Bypass TUN)",
    hintBypassProxy: "Bypass TUN proxies (FlClash / Clash / Surge) via the physical network interface (macOS & Windows).",
    checkUpdate: "Check Updates",
    checkingUpdate: "Checking…",
    upToDate: (v) => `Up to date (v${v})`,
    updateAvailable: (v) => `New version v${v} available`,
    updateCardTitle: "Server Ops update available",
    updateDoneTitle: "Server Ops updated",
    updateFailTitle: "Server Ops update failed",
    updateDefaultSummary: "Includes fixes and improvements with in-place one-click upgrade.",
    updateStepPreparing: "Preparing update…",
    updateStepDownloading: "Downloading update package…",
    updateStepVerifying: "Verifying package integrity…",
    updateStepInstalling: "Installing new version…",
    updateCompletedReload: (v) => `Installed v${v}. Reloading plugin automatically — reopen the panel to use it.`,
    updateCompletedManual: (v) => `Installed v${v}. Refresh Server Ops in MCP Servers settings or restart the client to apply.`,
    updateRolledBack: "Update failed and automatically rolled back to the current version.",
    updateFailedGeneric: "Update failed. Retry or open the release page to upgrade manually.",
    skipVersion: "Skip version",
    remindLater: "Later",
    gotIt: "Got it",
    releaseNotes: "Release notes",
    openRelease: "View release",
    updateNow: "Update now",
    retryUpdate: "Retry",
    updateFailed: (err) => `Update check failed: ${err}`,
  },
};

let t = I18N.en;
let profiles = [];
let selected = new Set();
let busy = false;
let testingId = null;
let editingProfile = null;
let authType = "password";
let appVersion = APP_VERSION;
let checkingUpdate = false;
let latestUpdateInfo = null;
let installState = { status: "idle" };
let snoozedThisSession = false;
let updatePollTimer = null;

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
  $("lbl-bypass-proxy").textContent = t.lblBypassProxy;
  $("hint-bypass-proxy").textContent = t.hintBypassProxy;
  $("cancel-btn").textContent = t.cancel;
  $("save-btn").textContent = t.save;
  $("version-label").textContent = `v${appVersion}`;
  $("check-update-label").textContent = t.checkUpdate;
}

function renderList() {
  const countEl = $("count-pill");
  countEl.textContent = t.authorizedCount(selected.size);
  countEl.classList.toggle("active", selected.size > 0);

  const hasItems = profiles.length > 0;
  $("empty-state").hidden = hasItems;
  const container = $("server-list");
  container.hidden = !hasItems;
  container.replaceChildren();

  for (const profile of profiles) {
    const isSelected = selected.has(profile.id);
    const row = document.createElement("div");
    row.className = `row${isSelected ? " selected" : ""}`;

    const left = document.createElement("div");
    left.className = "row-left";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.innerHTML = SERVER_ICON;

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
    if (profile.bypassProxy) {
      const directTag = document.createElement("span");
      directTag.className = "tag tag-direct";
      directTag.textContent = t.directTag;
      nameLine.append(directTag);
    }

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
    left.append(avatar, info);

    const right = document.createElement("div");
    right.className = "row-right";

    const actions = document.createElement("div");
    actions.className = "actions";

    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "btn btn-icon";
    testBtn.textContent = testingId === profile.id ? t.testingBtn : t.testBtn;
    testBtn.disabled = busy || testingId !== null;
    testBtn.onclick = () => void runTest(profile);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-icon";
    editBtn.textContent = t.editBtn;
    editBtn.disabled = busy;
    editBtn.onclick = () => openModal(profile);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-icon danger";
    delBtn.textContent = t.deleteBtn;
    delBtn.disabled = busy;
    delBtn.onclick = () => void removeProfile(profile);

    actions.append(testBtn, editBtn, delBtn);

    const divider = document.createElement("span");
    divider.className = "divider-v";

    const sw = document.createElement("label");
    sw.className = "switch";
    sw.title = t.toggleTitle;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = isSelected;
    box.disabled = busy;
    box.setAttribute("aria-label", `${t.toggleTitle}: ${profile.name}`);
    box.onchange = () => void toggleAuthorize(profile.id, box.checked);

    const track = document.createElement("span");
    track.className = "track";
    const thumb = document.createElement("span");
    thumb.className = "thumb";
    track.append(thumb);
    sw.append(box, track);

    right.append(actions, divider, sw);
    row.append(left, right);
    container.append(row);
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
  $("f-bypass-proxy").checked = Boolean(profile?.bypassProxy);
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
    if (res?.version) {
      appVersion = res.version;
      $("version-label").textContent = `v${appVersion}`;
    }
    if (res?.installState) {
      installState = res.installState;
      ensureUpdatePolling();
      renderUpdateToast();
    }
    renderList();
    if (!quiet) showBanner();
  } catch (err) {
    if (!quiet) showBanner(err instanceof Error ? err.message : t.loadFailed, "error");
  }
}

const ACTIVE_INSTALL_STATUSES = new Set(["preparing", "downloading", "verifying", "installing"]);
const PROGRESS_BY_STATUS = {
  preparing: 18,
  downloading: 48,
  verifying: 76,
  installing: 92,
};

function stopUpdatePolling() {
  if (updatePollTimer) {
    clearTimeout(updatePollTimer);
    updatePollTimer = null;
  }
}

function ensureUpdatePolling() {
  if (!ACTIVE_INSTALL_STATUSES.has(installState?.status)) {
    stopUpdatePolling();
    return;
  }
  if (updatePollTimer) return;
  updatePollTimer = setTimeout(async () => {
    updatePollTimer = null;
    try {
      const next = await callTool("update_status");
      if (next?.status) {
        installState = next;
        renderUpdateToast();
      }
    } catch {
      // 若插件已完成替换并正在重载，短暂通信中断属于正常现象
    }
    ensureUpdatePolling();
  }, 700);
}

function renderUpdateToast() {
  const toast = $("update-toast");
  const dot = $("update-toast-dot");
  const titleEl = $("update-toast-title");
  const verEl = $("update-toast-ver");
  const bodyEl = $("update-toast-body");
  const progWrap = $("update-progress");
  const progBar = $("update-progress-bar");
  const skipBtn = $("update-skip-btn");
  const laterBtn = $("update-later-btn");
  const notesBtn = $("update-notes-btn");
  const installBtn = $("update-install-btn");
  const footerDot = $("update-dot");
  const footerLabel = $("check-update-label");

  const status = installState?.status || "idle";
  const isInstalling = ACTIVE_INSTALL_STATUSES.has(status);
  const isCompleted = status === "completed";
  const isFailed = status === "failed" || status === "rolled-back";
  const hasUpdate = Boolean(latestUpdateInfo?.hasUpdate);
  const targetVer = installState?.version || latestUpdateInfo?.latestVersion || "";

  if (!checkingUpdate) {
    if (hasUpdate && !isCompleted) {
      footerDot.hidden = false;
      footerLabel.textContent = t.updateAvailable(latestUpdateInfo.latestVersion);
    } else {
      footerDot.hidden = true;
      footerLabel.textContent = t.checkUpdate;
    }
  }

  const shouldShow =
    isInstalling ||
    (isCompleted && !snoozedThisSession) ||
    (isFailed && !snoozedThisSession) ||
    (hasUpdate && !latestUpdateInfo?.ignored && !snoozedThisSession);

  if (!shouldShow || !targetVer) {
    toast.hidden = true;
    return;
  }

  toast.hidden = false;
  verEl.textContent = `v${appVersion} -> v${targetVer}`;

  dot.className = `update-toast-dot${
    isInstalling ? " working" : isCompleted ? " ok" : isFailed ? " err" : ""
  }`;

  if (isCompleted) {
    titleEl.textContent = t.updateDoneTitle;
    bodyEl.textContent = installState?.reloaded
      ? t.updateCompletedReload(targetVer)
      : t.updateCompletedManual(targetVer);
    progWrap.hidden = true;
    skipBtn.hidden = true;
    notesBtn.hidden = true;
    installBtn.hidden = true;
    laterBtn.hidden = false;
    laterBtn.disabled = false;
    laterBtn.textContent = t.gotIt;
    return;
  }

  if (isInstalling) {
    titleEl.textContent = t.updateCardTitle;
    const stepText = {
      preparing: t.updateStepPreparing,
      downloading: t.updateStepDownloading,
      verifying: t.updateStepVerifying,
      installing: t.updateStepInstalling,
    };
    bodyEl.textContent = stepText[status] || t.updateStepInstalling;
    progWrap.hidden = false;
    progBar.style.width = `${PROGRESS_BY_STATUS[status] || 50}%`;
    skipBtn.hidden = true;
    laterBtn.hidden = true;
    notesBtn.hidden = true;
    installBtn.hidden = true;
    return;
  }

  progWrap.hidden = true;

  if (isFailed) {
    titleEl.textContent = t.updateFailTitle;
    const base = status === "rolled-back" ? t.updateRolledBack : t.updateFailedGeneric;
    bodyEl.textContent = installState?.error ? `${base} (${installState.error})` : base;
  } else {
    titleEl.textContent = t.updateCardTitle;
    bodyEl.textContent = latestUpdateInfo?.summary || t.updateDefaultSummary;
  }

  const canOpenLink = Boolean(latestUpdateInfo?.releaseUrl && app.getHostCapabilities()?.openLinks);
  const canInstall = Boolean(latestUpdateInfo?.canInstall);

  skipBtn.hidden = isFailed;
  skipBtn.disabled = false;
  skipBtn.textContent = t.skipVersion;

  laterBtn.hidden = false;
  laterBtn.disabled = false;
  laterBtn.textContent = t.remindLater;

  if (canInstall) {
    notesBtn.hidden = !canOpenLink;
    notesBtn.className = "toast-btn secondary";
    notesBtn.textContent = t.releaseNotes;

    installBtn.hidden = false;
    installBtn.disabled = false;
    installBtn.textContent = isFailed ? t.retryUpdate : t.updateNow;
  } else {
    notesBtn.hidden = !canOpenLink;
    notesBtn.className = "toast-btn primary";
    notesBtn.textContent = t.openRelease;
    installBtn.hidden = true;
  }
}

async function runUpdateCheck({ quiet = false, force = false } = {}) {
  if (checkingUpdate) return;
  checkingUpdate = true;
  const btn = $("check-update-btn");
  const label = $("check-update-label");
  btn.disabled = true;
  label.textContent = t.checkingUpdate;
  try {
    const res = await callTool("update_check", force ? { force: true } : {});
    if (res?.currentVersion) {
      appVersion = res.currentVersion;
      $("version-label").textContent = `v${appVersion}`;
    }
    if (res?.installState) {
      installState = res.installState;
      ensureUpdatePolling();
    }
    latestUpdateInfo = res?.hasUpdate ? res : null;
    if (force) {
      snoozedThisSession = false;
    }
    if (!res?.hasUpdate && !quiet) {
      showBanner(t.upToDate(res?.currentVersion || appVersion), "success");
    }
  } catch (err) {
    if (!quiet) {
      showBanner(t.updateFailed(err instanceof Error ? err.message : String(err)), "error");
    }
  } finally {
    checkingUpdate = false;
    btn.disabled = false;
    renderUpdateToast();
  }
}

async function dismissCurrentUpdate() {
  const targetVer = latestUpdateInfo?.latestVersion;
  if (!targetVer) return;
  try {
    await callTool("update_dismiss", { version: targetVer });
    if (latestUpdateInfo) latestUpdateInfo.ignored = true;
    renderUpdateToast();
  } catch (err) {
    showBanner(err instanceof Error ? err.message : t.saveFailed, "error");
  }
}

async function startInPlaceUpdate() {
  const targetVer = installState?.version || latestUpdateInfo?.latestVersion;
  if (!targetVer) return;
  snoozedThisSession = false;
  installState = { status: "preparing", version: targetVer };
  renderUpdateToast();
  try {
    const next = await callTool("update_install", { version: targetVer });
    if (next?.status) {
      installState = next;
    }
    ensureUpdatePolling();
    renderUpdateToast();
  } catch (err) {
    installState = {
      status: "failed",
      version: targetVer,
      error: err instanceof Error ? err.message : String(err),
    };
    renderUpdateToast();
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
  const bypassProxy = $("f-bypass-proxy").checked;

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
      bypassProxy,
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
    if (result?.structuredContent?.version) {
      appVersion = result.structuredContent.version;
      $("version-label").textContent = `v${appVersion}`;
    }
    if (result?.structuredContent?.installState) {
      installState = result.structuredContent.installState;
      ensureUpdatePolling();
      renderUpdateToast();
    }
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
  $("check-update-btn").onclick = () => void runUpdateCheck({ quiet: false, force: true });
  $("update-skip-btn").onclick = () => void dismissCurrentUpdate();
  $("update-later-btn").onclick = () => {
    snoozedThisSession = true;
    renderUpdateToast();
  };
  $("update-notes-btn").onclick = () => {
    const url = latestUpdateInfo?.releaseUrl;
    if (!url) return;
    if (app.getHostCapabilities()?.openLinks) {
      void app.openLink({ url }).catch(() => {});
    }
  };
  $("update-install-btn").onclick = () => void startInPlaceUpdate();

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
  void runUpdateCheck({ quiet: true });
}

void start().catch(() => showBanner(t.loadFailed, "error"));
