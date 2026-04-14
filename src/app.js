/* ============================================================
   LabOS v3.2 — Frontend Application Logic
   Dashboard · Chat · Queue · Papers · Memory · Compare · GitHub · SSH Terminal
   ============================================================ */

const API = "__PORT_8000__";

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------
const I18N_STORAGE_KEY = "labos.locale";
const DEFAULT_LOCALE = "zh-CN";
const SUPPORTED_LOCALES = ["zh-CN", "en"];

let currentLocale = localStorage.getItem(I18N_STORAGE_KEY) || DEFAULT_LOCALE;
let localeMessages = {};
let fallbackMessages = {};

function interpolate(template, params = {}) {
  if (typeof template !== "string") return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return params[key] !== undefined ? String(params[key]) : `{${key}}`;
  });
}

async function loadLocaleMessages(locale) {
  const targetLocale = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;

  const [targetRes, fallbackRes] = await Promise.all([
    fetch(`./locales/${targetLocale}.json`),
    fetch(`./locales/${DEFAULT_LOCALE}.json`)
  ]);

  if (!targetRes.ok) {
    throw new Error(`Failed to load locale: ${targetLocale}`);
  }
  if (!fallbackRes.ok) {
    throw new Error(`Failed to load fallback locale: ${DEFAULT_LOCALE}`);
  }

  localeMessages = await targetRes.json();
  fallbackMessages = await fallbackRes.json();
  currentLocale = targetLocale;
  localStorage.setItem(I18N_STORAGE_KEY, currentLocale);
  document.documentElement.lang = currentLocale;
}

function t(key, params = {}) {
  const raw =
    localeMessages[key] ??
    fallbackMessages[key] ??
    key;

  return interpolate(raw, params);
}

function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (el.tagName === "OPTION") {
      el.text = t(key);
    } else {
      el.textContent = t(key);
    }
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    el.setAttribute("placeholder", t(key));
  });

  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.dataset.i18nTitle;
    el.setAttribute("title", t(key));
  });

  const langSelect = document.getElementById("language-select");
  if (langSelect) {
    langSelect.value = currentLocale;
  }
}

function refreshStaticTranslatedUI() {
  const titles = {
    dashboard: t("nav.overview"),
    chat: t("nav.chat"),
    projects: t("nav.projects"),
    "project-detail": currentProject ? currentProject.name : t("projects.detailTitle"),
    settings: t("nav.settings"),
    terminal: t("nav.terminal")
  };

  const titleEl = document.getElementById("view-title");
  if (titleEl) {
    titleEl.textContent = titles[currentView] || currentView;
  }

  const badge = document.getElementById("project-badge");
  if (badge && currentView === "project-detail" && currentProject) {
    badge.textContent = currentProject.name;
  }

  if (currentView === "chat" && !currentSessionId) {
    addChatWelcome();
  }
}

async function setLocale(locale) {
  await loadLocaleMessages(locale);
  applyI18n(document);
  refreshStaticTranslatedUI();
}

async function changeLanguage(locale) {
  try {
    await setLocale(locale);
    applyI18n(document);
    refreshStaticTranslatedUI();

    if (currentView === "dashboard") loadDashboard();
    if (currentView === "projects") loadProjectList();

    if (currentView === "project-detail") {
      loadExperiments();
      loadPapers();
      loadMemories();
      if (currentDetailExp) openExperimentDetail(currentDetailExp);
    }

    if (currentView === "chat") {
  const chatMessages = document.getElementById("chat-messages");
  if (chatMessages) {
    chatMessages.innerHTML = "";
  }

  await loadSessions();

  if (currentSessionId) {
    await loadChatHistory();
  } else {
    addChatWelcome();
  }

  const llmStatus = document.getElementById("llm-status");
  if (llmStatus) {
    loadConfig();
  }

    }

    if (currentView === "settings") {
      loadConfig();
      loadLLMProfiles();
    }

    updateStats();
  } catch (e) {
    console.error("changeLanguage:", e);
  }
}

window.t = t;
window.setLocale = setLocale;
window.changeLanguage = changeLanguage;
window.applyI18n = applyI18n;
window.getCurrentLocale = () => currentLocale;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentView = "dashboard";
let currentProject = null;
let currentSessionId = "";
let isStreaming = false;
let experimentFilter = "all";
let currentDetailExp = null;
let pollInterval = null;
let compareSelected = new Set();
let currentChatTaskType = "general";
let experimentEventSource = null;  // SSE connection for real-time experiment logs

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadLocaleMessages(currentLocale);
    applyI18n(document);  
    refreshStaticTranslatedUI();

    if (!currentSessionId) {
      addChatWelcome();
    }
  } catch (e) {
    console.error("Failed to initialize locale:", e);
  }

  checkHealth();
  loadConfig();
  loadPipelineSettings();
  loadLLMProfiles();
  autoResizeTextarea();
  loadDashboard();
  setInterval(checkHealth, 30000);
});

async function checkHealth() {
  try {
    const r = await fetch(`${API}/api/health`);
    const d = await r.json();
    if (d.status === "ok") {
      document.getElementById("status-dot").className = "status-dot connected";
      document.getElementById("status-text").textContent = `v${d.version || '3.0'}`;
    }
  } catch (e) {
    void e;
    document.getElementById("status-dot").className = "status-dot error";
    document.getElementById("status-text").textContent = t("status.offline");
  }
}

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------
function switchView(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  // project-detail is a sub-view of projects
  const viewId = view === "project-detail" ? "view-project-detail" : `view-${view}`;
  const el = document.getElementById(viewId);
  if (el) el.classList.add("active");
  const navView = view === "project-detail" ? "projects" : view;
  const nav = document.querySelector(`.nav-item[data-view="${navView}"]`);
  if (nav) nav.classList.add("active");

  const titles = {
  dashboard: t("nav.overview"),
  chat: t("nav.chat"),
  projects: t("nav.projects"),
  "project-detail": currentProject ? currentProject.name : t("projects.detailTitle"),
  settings: t("nav.settings"),
  terminal: t("nav.terminal")
};
document.getElementById("view-title").textContent = titles[view] || view;
  // Update project badge
  const badge = document.getElementById("project-badge");
  if (view === "project-detail" && currentProject) {
    badge.textContent = currentProject.name;
    badge.classList.add("visible");
  } else {
    badge.textContent = "";
    badge.classList.remove("visible");
  }

  if (view === "dashboard") loadDashboard();
  if (view === "projects") loadProjectList();
  if (view === "project-detail") { loadExperiments(); loadPapers(); loadMemories(); }
  if (view === "settings") { loadConfig(); loadLLMProfiles(); }
  if (view === "chat") {
    loadSessions();
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages && !currentSessionId) {
      chatMessages.innerHTML = "";
      addChatWelcome();
    }
  }
  updateStats();
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
async function loadDashboard() {
  // Global dashboard — shows cross-project overview
  try {
    const r = await fetch(`${API}/api/projects`);
    const projects = await r.json();

    // Aggregate stats
    let totalExps = 0, totalRunning = 0, totalMemories = 0, totalPapers = 0;
    for (const p of projects) {
      totalExps += p.experiment_count || 0;
    }
    // Also get global stats
    try {
      const sr = await fetch(`${API}/api/stats?project_id=`);
      const s = await sr.json();
      totalExps = s.total_experiments || totalExps;
      totalRunning = s.running || 0;
      totalMemories = s.memories || 0;
      totalPapers = s.papers || 0;
    } catch(e) { void e; }

    document.getElementById("dash-kpis").innerHTML = `
      <div class="kpi-card"><div class="kpi-value">${projects.length}</div><div class="kpi-label">${t("nav.projects")}</div></div>
      <div class="kpi-card"><div class="kpi-value">${totalExps}</div><div class="kpi-label">${t("project.tabs.experiments")}</div></div>
      <div class="kpi-card kpi-running"><div class="kpi-value">${totalRunning}</div><div class="kpi-label">${t("status.running")}</div></div>
      <div class="kpi-card"><div class="kpi-value">${totalMemories}</div><div class="kpi-label">${t("project.tabs.memory")}</div></div>
      <div class="kpi-card"><div class="kpi-value">${totalPapers}</div><div class="kpi-label">${t("project.tabs.papers")}</div></div>
    `;
    // Project summary cards
    const projSummary = document.getElementById("dash-project-summary");
    if (projects.length > 0) {
      projSummary.innerHTML = projects.map(p => `
        <div class="recent-exp-row" onclick="openProjectDetail('${p.id}')">
          <span style="font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.name)}</span>
          <span style="font-size:var(--text-xs);color:var(--color-text-faint);">${t("projects.experimentCount", { count: p.experiment_count || 0 })}</span>
        </div>
      `).join("");
    } else {
      projSummary.innerHTML = `<div class="empty-state small">${t("projects.empty")}<a href="#" onclick="showNewProjectModal();return false;">${t("common.createOne")}</a></div>`;
    }

    // Recent experiments across all projects
    if (projects.length > 0) {
      let allExps = [];
      for (const p of projects.slice(0, 5)) {
        try {
          const er = await fetch(`${API}/api/experiments?project_id=${p.id}`);
          const exps = await er.json();
          exps.forEach(e => { e._project_name = p.name; });
          allExps = allExps.concat(exps);
        } catch(e) { void e; }
      }
      allExps.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      const recent = allExps.slice(0, 5);
      if (recent.length > 0) {
        document.getElementById("dash-recent-exps").innerHTML = recent.map(e => `
          <div class="recent-exp-row" onclick="openProjectDetail('${e.project_id}');setTimeout(()=>openExperimentDetail('${e.id}'),300)">
            <span class="status-badge ${e.status}">${statusLabel(e.status)}</span>
            <span class="recent-exp-name">${esc(e.name)}</span>
            <span class="recent-exp-time">${formatTime(e.updated_at)}</span>
          </div>
        `).join("");
      } else {
        document.getElementById("dash-recent-exps").innerHTML = `<div class="empty-state small">${t("experiment.none")}</div>`;
      }
    } else {
      document.getElementById("dash-recent-exps").innerHTML = `<div class="empty-state small">${t("experiment.none")}</div>`;
    }
  } catch (e) {
    console.error("loadDashboard:", e);
  }
}

// ---------------------------------------------------------------------------
// Projects (List & Detail)
// ---------------------------------------------------------------------------
async function loadProjectList() {
  try {
    const r = await fetch(`${API}/api/projects`);
    const projects = await r.json();
    const grid = document.getElementById("project-grid");
    const countEl = document.getElementById("projects-count");
    if (countEl) countEl.textContent = projects.length > 0 ? t("projects.total", { count: projects.length }) : "";

    if (projects.length === 0) {
      grid.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg><p>${t("projects.empty")}</p></div>`;
      return;
    }

    grid.innerHTML = projects.map(p => `
      <div class="project-card" onclick="openProjectDetail('${p.id}')">
        <div class="project-card-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <span class="project-card-name">${esc(p.name)}</span>
        </div>
        ${p.description ? `<div class="project-card-desc">${esc(p.description.substring(0, 100))}</div>` : ''}
        ${p.repo_url ? `<div class="project-card-repo">${esc(p.repo_url)}</div>` : ''}
        <div class="project-card-stats">
          <span>🧪 ${t("projects.experimentCount", { count: p.experiment_count || 0 })}</span>
        </div>
      </div>
    `).join("");
  } catch (e) {
    console.error("loadProjectList:", e);
  }
}

async function openProjectDetail(projectId) {
  try {
    const r = await fetch(`${API}/api/projects/${projectId}`);
    currentProject = await r.json();
    // Populate project detail header
    document.getElementById("project-detail-name").textContent = currentProject.name;
    const repoEl = document.getElementById("project-detail-repo");
    if (currentProject.repo_url) {
      repoEl.innerHTML = `<a href="${esc(currentProject.repo_url)}" target="_blank" rel="noopener">${esc(currentProject.repo_url)}</a>`;
    } else {
      repoEl.textContent = "";
    }
    document.getElementById("project-detail-desc").textContent = currentProject.description || "";
    // Switch to project detail view
    switchView("project-detail");
  } catch (e) {
    console.error("openProjectDetail:", e);
  }
}

function backToProjectList() {
  currentProject = null;
  switchView("projects");
}

function switchProjectTab(tab, btn) {
  document.querySelectorAll(".project-sub-tabs .tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".project-sub").forEach(t => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  const el = document.getElementById(`psub-${tab}`);
  if (el) el.classList.add("active");
  // Reload data for the tab
  if (tab === "experiments") loadExperiments();
  if (tab === "papers") loadPapers();
  if (tab === "memory") loadMemories();
}

function showNewProjectModal() {
  document.getElementById("modal-title").textContent = t("modal.newProject");
  document.getElementById("modal-body").innerHTML = `
    <div class="form-group"><label>${t("modal.projectName")}</label><input type="text" id="new-proj-name" class="form-input" placeholder="Example: MemRL Memory Experiment"></div>
    <div class="form-group"><label>${t("modal.githubRepoOptional")}</label><input type="text" id="new-proj-repo" class="form-input" placeholder="https://github.com/MemTensor/MemRL"></div>
    <div class="form-group"><label>${t("modal.descriptionOptional")}</label><textarea id="new-proj-desc" class="form-input" rows="3" placeholder="Project goals..."></textarea></div>
    <div class="form-actions" style="margin-top:var(--space-4);"><button class="btn-primary btn-sm" onclick="createProject()">${t("actions.create")}</button><button class="btn-ghost btn-sm" onclick="closeModal()">${t("actions.cancel")}</button></div>
  `;
  document.getElementById("modal-overlay").classList.add("open");
  setTimeout(() => document.getElementById("new-proj-name")?.focus(), 100);
}

async function createProject() {
  const name = document.getElementById("new-proj-name").value.trim();
  if (!name) return;
  const repo = document.getElementById("new-proj-repo").value.trim();
  const desc = document.getElementById("new-proj-desc").value.trim();
  try {
    const r = await fetch(`${API}/api/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, repo_url: repo, description: desc }) });
    const d = await r.json();
    closeModal();
    openProjectDetail(d.id);
  } catch (e) {
    console.error("createProject:", e);
  }
}

function showCreateProjectFromChat() {
  document.getElementById("modal-title").textContent = "从对话创建项目";
  document.getElementById("modal-body").innerHTML = `
    <div class="form-group"><label>项目名称</label><input type="text" id="new-proj-name" class="form-input" placeholder="例: MemRL 记忆增强实验"></div>
    <div class="form-group"><label>GitHub 仓库 (可选)</label><input type="text" id="new-proj-repo" class="form-input" placeholder="https://github.com/..."></div>
    <div class="form-group"><label>描述 (可选)</label><textarea id="new-proj-desc" class="form-input" rows="3" placeholder="项目目标..."></textarea></div>
    <div class="form-actions" style="margin-top:var(--space-4);">
      <button class="btn-primary btn-sm" onclick="createProjectFromChat()">创建并关联对话</button>
      <button class="btn-ghost btn-sm" onclick="closeModal()">取消</button>
    </div>
  `;
  document.getElementById("modal-overlay").classList.add("open");
  setTimeout(() => document.getElementById("new-proj-name")?.focus(), 100);
}

async function createProjectFromChat() {
  const name = document.getElementById("new-proj-name").value.trim();
  if (!name) return;
  const repo = document.getElementById("new-proj-repo").value.trim();
  const desc = document.getElementById("new-proj-desc").value.trim();
  try {
    const r = await fetch(`${API}/api/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, repo_url: repo, description: desc }) });
    const d = await r.json();
    // Link current chat session to the new project
    if (currentSessionId) {
      await fetch(`${API}/api/chat/sessions/${currentSessionId}/link?project_id=${d.id}`, { method: "POST" });
    }
    currentProject = d;
    closeModal();
    showToast(t("projects.createFromChatSuccess", { name }));
    document.querySelectorAll(".chat-create-project-hint").forEach(el => el.remove());
    loadSessions();
  } catch (e) {
    console.error("createProjectFromChat:", e);
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
async function loadSessions() {
  try {
    const pid = currentProject ? currentProject.id : "";
    const r = await fetch(`${API}/api/chat/sessions?project_id=${pid}`);
    const sessions = await r.json();
    const list = document.getElementById("sessions-list");
    if (sessions.length === 0) {
      list.innerHTML = `<div class="empty-state small">${t("chat.noSessions")}</div>`;
      return;
    }
    list.innerHTML = sessions.map(s => `
      <div class="session-item ${s.session_id === currentSessionId ? 'active' : ''}" onclick="switchSession('${s.session_id}')">
        <div class="session-info-row">
          <span class="session-msgs">${s.msg_count} 条</span>
          <span class="session-time">${formatTime(s.last_msg)}</span>
        </div>
        <button class="session-delete" onclick="event.stopPropagation();deleteSession('${s.session_id}')" title="删除会话">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join("");
  } catch (e) {
    void e;
  }
}

function startNewSession() {
  currentSessionId = `sess_${Date.now().toString(36)}`;
  document.getElementById("chat-messages").innerHTML = "";
  addChatWelcome();
  loadSessions();
}

async function switchSession(sessionId) {
  currentSessionId = sessionId;
  document.getElementById("chat-messages").innerHTML = "";
  await loadChatHistory();
  loadSessions();
}

async function deleteSession(sessionId) {
  try {
    const pid = currentProject ? currentProject.id : "";
    await fetch(`${API}/api/chat/sessions/${sessionId}?project_id=${pid}`, { method: "DELETE" });
    if (sessionId === currentSessionId) startNewSession();
    loadSessions();
  } catch (e) {
    void e;
  }
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
function addChatWelcome() {
  const msgs = document.getElementById("chat-messages");
  msgs.innerHTML = `
    <div class="chat-welcome">
      <div class="welcome-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="1.5">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
      </div>
      <h2>${t("chat.welcomeTitle")}</h2>
      <p>${t("chat.welcomeSubtitle")}</p>
      <div class="welcome-hints">
        <button class="hint-chip hint-chip-code" onclick="insertHintWithType('', 'code')">
          <span class="chip-icon">💻</span>${t("chat.task.code")}
        </button>
        <button class="hint-chip hint-chip-paper" onclick="insertHintWithType('', 'paper')">
          <span class="chip-icon">📄</span>${t("chat.task.paper")}
        </button>
        <button class="hint-chip hint-chip-experiment" onclick="insertHintWithType('', 'experiment')">
          <span class="chip-icon">🧪</span>${t("chat.task.experiment")}
        </button>
        <button class="hint-chip hint-chip-general" onclick="insertHintWithType('', 'general')">
          <span class="chip-icon">💬</span>${t("chat.task.general")}
        </button>
      </div>
    </div>
  `;
}

function insertHint(text) {
  const input = document.getElementById("chat-input");
  input.value = text;
  input.focus();
  autoResize(input);
}

function insertHintWithType(text, taskType) {
  currentChatTaskType = taskType;
  const sel = document.getElementById("chat-task-select");
  if (sel) sel.value = taskType;
  const input = document.getElementById("chat-input");
  input.value = text;
  input.focus();
  autoResize(input);
}

function onChatTaskTypeChange(val) {
  currentChatTaskType = val;
}

function handleChatKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

async function sendMessage() {
  if (isStreaming) return;
  const input = document.getElementById("chat-input");
  const msg = input.value.trim();
  if (!msg) return;
  // Ensure we have a session ID before first message
  if (!currentSessionId) currentSessionId = `sess_${Date.now().toString(36)}`;

  input.value = "";
  autoResize(input);
  isStreaming = true;
  document.getElementById("send-btn").disabled = true;

  const welcome = document.querySelector(".chat-welcome");
  if (welcome) welcome.remove();

  appendChatMsg("user", msg);
  const aiDiv = appendChatMsg("assistant", "", true);
  const contentEl = aiDiv.querySelector(".msg-content");
  contentEl.classList.add("msg-streaming");

  try {
    const response = await fetch(`${API}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: currentProject?.id || "", session_id: currentSessionId, message: msg, task_type: currentChatTaskType }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "请求失败" }));
      contentEl.classList.remove("msg-streaming");
      contentEl.innerHTML = `<span style="color:var(--color-error);">${esc(err.detail || '请求失败')}</span>`;
      isStreaming = false;
      document.getElementById("send-btn").disabled = false;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) { contentEl.innerHTML = `<span style="color:var(--color-error);">${esc(parsed.error)}</span>`; break; }
            const delta = parsed.choices?.[0]?.delta?.content || "";
            if (delta) { fullText += delta; contentEl.innerHTML = renderMarkdown(fullText); scrollChatBottom(); }
          } catch (e) { void e; }
        }
      }
    }
    contentEl.classList.remove("msg-streaming");
    if (fullText) contentEl.innerHTML = renderMarkdown(fullText);
  } catch (e) {
    contentEl.classList.remove("msg-streaming");
    contentEl.innerHTML = `<span style="color:var(--color-error);">连接失败: ${esc(e.message)}</span>`;
  }
  isStreaming = false;
  document.getElementById("send-btn").disabled = false;
  scrollChatBottom();
  loadSessions();

  // Show "create project" option if not linked to a project
  if (!currentProject) {
    const createBtn = document.createElement("div");
    createBtn.className = "chat-create-project-hint";
    createBtn.innerHTML = `<button class="btn-ghost btn-sm" onclick="showCreateProjectFromChat()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
      将对话创建为项目
    </button>`;
    document.getElementById("chat-messages").appendChild(createBtn);
    scrollChatBottom();
  }
}

function appendChatMsg(role, content) {
  const msgs = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<div class="msg-avatar">${role === "user" ? t("chat.user") : t("chat.ai")}</div>`
  msgs.appendChild(div);
  scrollChatBottom();
  return div;
}

function scrollChatBottom() {
  const msgs = document.getElementById("chat-messages");
  msgs.scrollTop = msgs.scrollHeight;
}

async function loadChatHistory() {
  try {
    const pid = currentProject ? currentProject.id : "";
    const r = await fetch(`${API}/api/chat/history?project_id=${pid}&session_id=${currentSessionId}&limit=50`);
    const history = await r.json();
    if (history.length > 0) {
      const welcome = document.querySelector(".chat-welcome");
      if (welcome) welcome.remove();
      history.forEach(m => appendChatMsg(m.role, m.content));
    } else {
      addChatWelcome();
    }
  } catch (e) { void e; }
}

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------
async function loadExperiments() {
  if (!currentProject) return;
  try {
    const r = await fetch(`${API}/api/experiments?project_id=${currentProject.id}`);
    const exps = await r.json();
    const list = document.getElementById("experiment-list");
    const filtered = experimentFilter === "all" ? exps : exps.filter(e => e.status === experimentFilter);

    // Show/hide compare button
    const completedCount = exps.filter(e => e.status === "completed").length;
    document.getElementById("compare-btn").style.display = completedCount >= 2 ? "" : "none";

    if (filtered.length === 0) {
      list.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><p>${experimentFilter === 'all' ? t("experiment.none") : t("experiment.noMatch")}</p></div>`;
      return;
    }

    list.innerHTML = filtered.map(exp => {
      const steps = exp.steps || [];
      const pipelineHTML = ["ideation", "planning", "experiment", "writing"].map(stage => {
        const step = steps.find(s => s.stage === stage);
        return `<div class="pipeline-dot ${step ? step.status : 'pending'}" title="${stage}"></div>`;
      }).join("");

      const isChecked = compareSelected.has(exp.id);
      const stageLabelsMap = { ideation: "假设生成", planning: "实验规划", experiment: "实验执行", writing: "报告撰写" };
      const modeIcon = exp.execution_mode === "real" ? "🚀" : "🧠";

      // Build inline approval card for pending_approval experiments
      let approvalHTML = "";
      if (exp.status === "pending_approval") {
        const stageName = stageLabelsMap[exp.current_stage] || exp.current_stage;
        approvalHTML = `
          <div class="exp-approval-inline" id="approval-inline-${exp.id}" onclick="event.stopPropagation()">
            <div class="exp-approval-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>「${esc(stageName)}」已完成，等待审批</span>
            </div>
            <div class="exp-approval-output" id="approval-output-${exp.id}">
              <div class="loading-dots">加载中...</div>
            </div>
            <div class="exp-approval-controls">
              <textarea class="form-input exp-approval-comment" id="approval-comment-${exp.id}" placeholder="审批意见（可选）..." rows="2"></textarea>
              <div class="exp-approval-actions">
                <button class="btn-primary btn-sm" onclick="approveFromCard('${exp.id}', '${exp.current_stage}', 'approve')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  批准 → 下一阶段
                </button>
                <button class="btn-warning btn-sm" onclick="approveFromCard('${exp.id}', '${exp.current_stage}', 'revise')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  修改重跑
                </button>
                <button class="btn-danger btn-sm" onclick="approveFromCard('${exp.id}', '${exp.current_stage}', 'reject')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  拒绝终止
                </button>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="exp-card ${exp.status === 'pending_approval' ? 'pending-approval-card' : ''}" onclick="openExperimentDetail('${exp.id}')">
          <div class="exp-card-header">
            ${exp.status === 'completed' ? `<label class="exp-check" onclick="event.stopPropagation()"><input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleCompare('${exp.id}', this.checked)"></label>` : ''}
            <span class="exp-card-name">${esc(exp.name)}</span>
            ${exp.execution_mode && exp.status !== 'queued' ? `<span class="exec-mode-badge-sm ${exp.execution_mode === 'real' ? 'mode-real' : 'mode-simulate'}">${modeIcon}</span>` : ''}
            <span class="status-badge ${exp.status}">${statusLabel(exp.status)}</span>
          </div>
          ${exp.status !== 'pending_approval' && exp.hypothesis ? `<div class="exp-card-hypothesis">${esc(exp.hypothesis.substring(0, 200))}</div>` : ''}
          ${approvalHTML}
          <div class="exp-card-footer">
            <div class="exp-pipeline">${pipelineHTML}</div>
            <span class="exp-card-id">${exp.id}</span>
          </div>
          <div class="exp-card-actions">
            ${exp.status === 'pending_approval' ? '' : exp.status !== 'running' ? `<button class="btn-primary btn-sm" onclick="event.stopPropagation();startExperiment('${exp.id}')">启动</button>` : `<button class="btn-danger btn-sm" onclick="event.stopPropagation();stopExperiment('${exp.id}')">停止</button>`}
            <button class="btn-ghost btn-sm" onclick="event.stopPropagation();deleteExperiment('${exp.id}')">删除</button>
          </div>
        </div>
      `;
    }).join("");

    // Load approval outputs for pending experiments (async)
    for (const exp of filtered.filter(e => e.status === "pending_approval")) {
      loadApprovalOutput(exp.id);
    }
  } catch (e) {
    console.error("loadExperiments:", e);
  }
}

function toggleCompare(expId, checked) {
  if (checked) compareSelected.add(expId);
  else compareSelected.delete(expId);
}

function filterExperiments(filter, btn) {
  experimentFilter = filter;
  // Update active tab in either context
  const parent = btn.closest(".queue-tabs");
  if (parent) parent.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  btn.classList.add("active");
  loadExperiments();
}

function showNewExperimentModal() {
  if (!currentProject) {
    showToast(t("experiment.needProjectFirst"));
    return;
  }

  document.getElementById("modal-title").textContent = t("experiment.newExperiment");
  document.getElementById("modal-body").innerHTML = `
    <div class="form-group">
      <label>${t("experiment.name")}</label>
      <input type="text" id="new-exp-name" class="form-input" placeholder="例: 分层记忆结构对比">
    </div>
    <div class="form-group">
      <label>${t("experiment.initialHypothesis")}</label>
      <textarea id="new-exp-hypothesis" class="form-input" rows="3" placeholder="我们假设..."></textarea>
    </div>
    <div class="form-group">
      <label>${t("experiment.priority")}</label>
      <select id="new-exp-priority" class="form-input">
        <option value="0">普通</option>
        <option value="1">高</option>
        <option value="2">紧急</option>
      </select>
    </div>
    <div class="form-actions" style="margin-top:var(--space-4);">
      <button class="btn-primary btn-sm" onclick="createExperiment()">${t("actions.create")}</button>
      <button class="btn-ghost btn-sm" onclick="closeModal()">${t("actions.cancel")}</button>
    </div>
  `;
  document.getElementById("modal-overlay").classList.add("open");
  setTimeout(() => document.getElementById("new-exp-name")?.focus(), 100);
}

async function createExperiment() {
  const name = document.getElementById("new-exp-name").value.trim();
  if (!name) return;
  const hypothesis = document.getElementById("new-exp-hypothesis").value.trim();
  const priority = parseInt(document.getElementById("new-exp-priority").value) || 0;
  try {
    await fetch(`${API}/api/experiments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: currentProject.id, name, hypothesis, priority }) });
    closeModal();
    loadExperiments();
    updateStats();
  } catch (e) { console.error("createExperiment:", e); }
}

async function startExperiment(expId) {
  document.getElementById("modal-title").textContent = t("experiment.startExperiment");
  document.getElementById("modal-body").innerHTML = `
    <div style="margin-bottom:var(--space-4)">
      <p style="color:var(--color-text-secondary);font-size:var(--text-sm);margin-bottom:var(--space-4)">
        ${t("experiment.runningModePrompt")}
      </p>
      <div class="exec-mode-options">
        <label class="exec-mode-option selected" onclick="selectExecMode(this, 'simulate')">
          <div class="exec-mode-icon">🧠</div>
          <div class="exec-mode-info">
            <strong>${t("experiment.mode.simulate")}</strong>
            <span>${t("experiment.mode.simulateDesc")}</span>
          </div>
          <input type="radio" name="exec-mode" value="simulate" checked style="display:none">
        </label>
        <label class="exec-mode-option" onclick="selectExecMode(this, 'real')">
          <div class="exec-mode-icon">🚀</div>
          <div class="exec-mode-info">
            <strong>${t("experiment.mode.real")}</strong>
            <span>${t("experiment.mode.realDesc")}</span>
          </div>
          <input type="radio" name="exec-mode" value="real" style="display:none">
        </label>
      </div>
    </div>
    <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-4)">
      <button class="btn-ghost btn-sm" onclick="closeModal()">${t("actions.cancel")}</button>
      <button class="btn-primary btn-sm" onclick="confirmStartExperiment('${expId}')">${t("actions.start")}</button>
    </div>
  `;
  document.getElementById("modal-overlay").classList.add("open");
}

let selectedExecMode = "simulate";
function selectExecMode(el, mode) {
  selectedExecMode = mode;
  document.querySelectorAll(".exec-mode-option").forEach(o => o.classList.remove("selected"));
  el.classList.add("selected");
}

async function confirmStartExperiment(expId) {
  closeModal();
  try {
    const r = await fetch(`${API}/api/experiments/${expId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ execution_mode: selectedExecMode }),
    });
    const d = await r.json();
    showToast(d.message || t("experiment.started"));
    showToast(t("experiment.stopped"));
    loadExperiments();
    startExperimentPoll();
    connectExperimentSSE(expId);  // Start real-time log streaming
  } catch (e) { console.error("startExperiment:", e); }
}

async function stopExperiment(expId) {
  try {
    await fetch(`${API}/api/experiments/${expId}/stop`, { method: "POST" });
    showToast("实验已停止");
    loadExperiments();
  } catch (e) { void e; }
}

async function deleteExperiment(expId) {
  if (!confirm(t("experiment.deleteConfirm"))) return;
  try {
    await fetch(`${API}/api/experiments/${expId}`, { method: "DELETE" });
    compareSelected.delete(expId);
    loadExperiments();
    updateStats();
  } catch (e) { void e; }
}

function startExperimentPoll() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    loadExperiments();
    if (currentDetailExp) refreshDetailPanel(currentDetailExp);
    updateStats();
  }, 3000);
  setTimeout(() => { if (pollInterval) clearInterval(pollInterval); }, 600000);
}

// ---------------------------------------------------------------------------
// Experiment Detail
// ---------------------------------------------------------------------------
async function openExperimentDetail(expId) {
  currentDetailExp = expId;
  try {
    const r = await fetch(`${API}/api/experiments/${expId}`);
    const exp = await r.json();
    document.getElementById("detail-title").textContent = exp.name;
    // Show execution mode badge
    const modeLabel = exp.execution_mode === "real" ? "🚀 真实执行" : "🧠 模拟执行";
    const modeClass = exp.execution_mode === "real" ? "mode-real" : "mode-simulate";
    const existingBadge = document.getElementById("detail-exec-mode");
    if (existingBadge) existingBadge.remove();
    const badge = document.createElement("span");
    badge.id = "detail-exec-mode";
    badge.className = `exec-mode-badge ${modeClass}`;
    badge.textContent = modeLabel;
    document.getElementById("detail-title").after(badge);

    const stages = ["ideation", "planning", "experiment", "writing"];
    const stageLabels = { ideation: "假设生成", planning: "实验规划", experiment: "实验执行", writing: "报告撰写" };
    const steps = exp.steps || [];

    let pipelineHTML = "";
    stages.forEach((stage, i) => {
      const step = steps.find(s => s.stage === stage);
      const status = step ? step.status : "pending";
      pipelineHTML += `<div class="pipeline-stage ${status}">${stageLabels[stage]}</div>`;
      if (i < stages.length - 1) {
        const prevDone = step && step.status === "completed";
        pipelineHTML += `<div class="pipeline-connector ${prevDone ? 'active' : ''}"></div>`;
      }
    });
    document.getElementById("pipeline-visual").innerHTML = pipelineHTML;

    const logs = (exp.logs || []).reverse();
    document.getElementById("detail-logs").innerHTML = logs.length > 0
      ? logs.map(l => `<div class="log-entry ${logEntryClass(l)}"><span class="log-time">${formatTime(l.created_at)}</span>${esc(l.message)}</div>`).join("")
      : '<div class="empty-state small">暂无日志</div>';

    loadExperimentReports(expId);

    const fbHistory = document.getElementById("feedback-history");
    if (exp.feedback) {
      const entries = exp.feedback.split("\n").filter(Boolean);
      fbHistory.innerHTML = entries.map(e => {
        const match = e.match(/^\[(.*?)\]\s*(.*)/);
        return `<div class="feedback-entry"><div class="fb-time">${match ? match[1] : ''}</div>${esc(match ? match[2] : e)}</div>`;
      }).join("");
    } else {
      fbHistory.innerHTML = '<div style="font-size:var(--text-xs);color:var(--color-text-faint);padding:var(--space-4);">暂无反馈</div>';
    }

    document.getElementById("detail-panel").classList.add("open");
    if (exp.status === "running" || exp.status === "pending_approval") {
      startExperimentPoll();
      connectExperimentSSE(expId);  // Real-time log streaming
    }

    // Show/hide approval banner
    const banner = document.getElementById("approval-banner");
    if (exp.status === "pending_approval") {
      const stageLabels = { ideation: "假设生成", planning: "实验规划", experiment: "实验执行", writing: "报告撰写" };
      const stageName = stageLabels[exp.current_stage] || exp.current_stage;
      document.getElementById("approval-stage-label").textContent = `「${stageName}」已完成，等待审批`;
      // Load approval output
      try {
        const ar = await fetch(`${API}/api/experiments/${expId}/approvals`);
        const approvals = await ar.json();
        const pending = approvals.find(a => a.status === "pending");
        if (pending && pending.stage_output) {
          document.getElementById("approval-output").innerHTML = renderMarkdown(pending.stage_output.substring(0, 3000));
        } else {
          document.getElementById("approval-output").innerHTML = '<p style="color:var(--color-text-faint);font-size:var(--text-sm)">无输出内容</p>';
        }
      } catch (e) { void e; }
      banner.style.display = "";
      banner.dataset.stage = exp.current_stage;
    } else {
      banner.style.display = "none";
    }
  } catch (e) { console.error("openExperimentDetail:", e); }
}

async function refreshDetailPanel(expId) {
  try {
    const r = await fetch(`${API}/api/experiments/${expId}`);
    const exp = await r.json();
    const stages = ["ideation", "planning", "experiment", "writing"];
    const stageLabels = { ideation: "假设生成", planning: "实验规划", experiment: "实验执行", writing: "报告撰写" };
    const steps = exp.steps || [];
    let pipelineHTML = "";
    stages.forEach((stage, i) => {
      const step = steps.find(s => s.stage === stage);
      const status = step ? step.status : "pending";
      pipelineHTML += `<div class="pipeline-stage ${status}">${stageLabels[stage]}</div>`;
      if (i < stages.length - 1) { pipelineHTML += `<div class="pipeline-connector ${step && step.status === 'completed' ? 'active' : ''}"></div>`; }
    });
    document.getElementById("pipeline-visual").innerHTML = pipelineHTML;
    const logs = (exp.logs || []).reverse();
    document.getElementById("detail-logs").innerHTML = logs.length > 0
      ? logs.map(l => `<div class="log-entry ${logEntryClass(l)}"><span class="log-time">${formatTime(l.created_at)}</span>${esc(l.message)}</div>`).join("")
      : '<div class="empty-state small">暂无日志</div>';
    loadExperimentReports(expId);

    // Handle approval banner in refresh
    const banner = document.getElementById("approval-banner");
    if (exp.status === "pending_approval") {
      const stageLabels2 = { ideation: "假设生成", planning: "实验规划", experiment: "实验执行", writing: "报告撰写" };
      document.getElementById("approval-stage-label").textContent = `「${stageLabels2[exp.current_stage] || exp.current_stage}」已完成，等待审批`;
      if (banner.style.display === "none") {
        try {
          const ar2 = await fetch(`${API}/api/experiments/${expId}/approvals`);
          const approvals2 = await ar2.json();
          const pending2 = approvals2.find(a => a.status === "pending");
          if (pending2 && pending2.stage_output) {
            document.getElementById("approval-output").innerHTML = renderMarkdown(pending2.stage_output.substring(0, 3000));
          }
        } catch (e) { void e; }
      }
      banner.style.display = "";
      banner.dataset.stage = exp.current_stage;
    } else {
      banner.style.display = "none";
    }

    if (exp.status === "completed" || exp.status === "failed" || exp.status === "stopped" || exp.status === "rejected") {
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      disconnectExperimentSSE();
    }
  } catch (e) { void e; }
}

function closeDetailPanel() {
  document.getElementById("detail-panel").classList.remove("open");
  currentDetailExp = null;
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  disconnectExperimentSSE();
}

// ---------------------------------------------------------------------------
// Report Timeline (v3.4)
// ---------------------------------------------------------------------------
async function loadExperimentReports(expId) {
  const container = document.getElementById("reports-timeline");
  if (!container) return;
  try {
    const r = await fetch(`${API}/api/experiments/${expId}/reports`);
    const reports = await r.json();

    if (reports.length === 0) {
      // Fallback to old report field
      const expR = await fetch(`${API}/api/experiments/${expId}`);
      const exp = await expR.json();
      if (exp.report) {
        container.innerHTML = `<div class="report-content">${renderMarkdown(exp.report)}</div>`;
      } else {
        container.innerHTML = '<div class="empty-state small">暂无报告</div>';
      }
      return;
    }

    const stageLabels = { ideation: "调研报告", planning: "分析报告", experiment: "实验报告", writing: "综合报告" };
    const stageIcons = { ideation: "🔍", planning: "📊", experiment: "🧪", writing: "📝" };

    container.innerHTML = reports.map(rpt => `
      <div class="report-timeline-item" data-stage="${esc(rpt.stage)}">
        <div class="report-timeline-header">
          <span class="report-stage-icon">${stageIcons[rpt.stage] || "📋"}</span>
          <div class="report-timeline-info">
            <span class="report-timeline-title">${esc(rpt.title || stageLabels[rpt.stage] || rpt.stage)}</span>
            <span class="report-timeline-type">${esc(rpt.report_type || rpt.stage)}</span>
          </div>
          <span class="report-timeline-time">${formatTime(rpt.created_at)}</span>
          <button class="btn-icon-sm report-delete-btn" onclick="deleteReport(${rpt.id}, '${esc(expId)}')" title="删除报告">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="report-timeline-content">${renderMarkdown(rpt.content || '')}</div>
      </div>
    `).join("");
  } catch(e) {
    container.innerHTML = '<div class="empty-state small">加载报告失败</div>';
    console.error("loadExperimentReports:", e);
  }
}

async function deleteReport(reportId, expId) {
  if (!confirm("确定删除此报告？")) return;
  try {
    await fetch(`${API}/api/reports/${reportId}`, { method: "DELETE" });
    loadExperimentReports(expId);
    showToast("报告已删除");
  } catch(e) { showToast("删除失败"); }
}

function switchDetailTab(tab, btn) {
  document.querySelectorAll(".detail-tabs .tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".detail-tab").forEach(t => t.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById(`dtab-${tab}`).classList.add("active");
}

async function submitFeedback() {
  if (!currentDetailExp) return;
  const input = document.getElementById("feedback-input");
  const feedback = input.value.trim();
  if (!feedback) return;
  try {
    await fetch(`${API}/api/experiments/${currentDetailExp}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedback }) });
    input.value = "";
    openExperimentDetail(currentDetailExp);
    showToast("反馈已提交");
  } catch (e) { void e; }
}

// ---------------------------------------------------------------------------
// Experiment Comparison
// ---------------------------------------------------------------------------
function openCompareModal() {
  if (!confirm(t("experiment.deleteConfirm"))) return;
  runComparison();
}

async function runComparison() {
  document.getElementById("compare-panel").classList.add("open");
  document.getElementById("compare-content").innerHTML = `<div class="empty-state small">${t("detail.loading")}</div>`;

  try {
    const r = await fetch(`${API}/api/experiments/compare`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experiment_ids: Array.from(compareSelected) }),
    });
    const data = await r.json();

    if (data.error) {
      document.getElementById("compare-content").innerHTML = `<div class="empty-state small">${esc(data.error)}</div>`;
      return;
    }

    let html = '<div class="compare-table"><table><thead><tr><th>实验</th><th>状态</th><th>假设</th><th>结论</th></tr></thead><tbody>';
    for (const e of data.experiments) {
      html += `<tr><td>${esc(e.name)}</td><td><span class="status-badge ${e.status}">${statusLabel(e.status)}</span></td><td class="compare-cell">${esc((e.hypothesis || '').substring(0, 150))}</td><td class="compare-cell">${esc((e.result_summary || '').substring(0, 150))}</td></tr>`;
    }
    html += '</tbody></table></div>';

    if (data.comparison) {
      html += `<div class="compare-analysis">${renderMarkdown(data.comparison)}</div>`;
    }

    document.getElementById("compare-content").innerHTML = html;
  } catch (e) {
    document.getElementById("compare-content").innerHTML = `<div class="empty-state small">对比失败: ${esc(e.message)}</div>`;
  }
}

function closeComparePanel() {
  document.getElementById("compare-panel").classList.remove("open");
}

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------
async function loadPapers() {
  if (!currentProject) return;
  try {
    const r = await fetch(`${API}/api/papers?project_id=${currentProject.id}`);
    const papers = await r.json();
    document.getElementById("papers-count").textContent = papers.length > 0 ? `共 ${papers.length} 篇` : "";
    const list = document.getElementById("papers-list");

    if (papers.length === 0) {
      list.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg><p>${t("papers.empty")}</p>/div>';
      return;
    }

    list.innerHTML = papers.map(p => `
      <div class="paper-card">
        <div class="paper-title">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}</div>
        <div class="paper-meta">
          <span class="paper-authors">${esc(p.authors)}</span>
          ${p.year ? `<span class="paper-year">${p.year}</span>` : ''}
          ${p.venue ? `<span class="paper-venue">${esc(p.venue)}</span>` : ''}
          ${p.citation_count > 0 ? `<span class="paper-cite">引用 ${p.citation_count}</span>` : ''}
        </div>
        ${p.abstract ? `<div class="paper-abstract">${esc(p.abstract.substring(0, 250))}${p.abstract.length > 250 ? '...' : ''}</div>` : ''}
        <button class="paper-delete" onclick="deletePaper('${esc(p.id)}')" title="移除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join("");
  } catch (e) { void e; }
}

function showPaperSearchModal() {
  if (!currentProject) { showToast("请先进入一个项目"); return; }
  // Switch to papers sub-tab within project detail
  switchProjectTab('papers', document.querySelector('.project-sub-tabs .tab[data-ptab="papers"]'));
  setTimeout(() => document.getElementById("paper-search-input")?.focus(), 100);
}

async function searchPapersUI() {
  const query = document.getElementById("paper-search-input").value.trim();
  if (!query) return;
  const list = document.getElementById("papers-list");
  list.innerHTML = `<div class="empty-state small">${t("papers.searching")}</div>`;

  try {
    const r = await fetch(`${API}/api/papers/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, project_id: currentProject.id, limit: 15 }),
    });
    const papers = await r.json();

    if (papers.length === 0 || papers[0]?.error) {
      list.innerHTML = `<div class="empty-state small">${papers[0]?.error || t("papers.notFound")}</div>`;
      return;
    }

    showToast(t("papers.foundAndSaved", { count: papers.length }));
    loadPapers();
  } catch (e) {
    list.innerHTML = `<div class="empty-state small">${t("papers.searchFailed", { message: e.message })}</div>`;
  }
}

async function deletePaper(paperId) {
  try {
    await fetch(`${API}/api/papers/${paperId}`, { method: "DELETE" });
    loadPapers();
  } catch (e) { void e; }
}

// ---------------------------------------------------------------------------
// Memory (with semantic search)
// ---------------------------------------------------------------------------
async function loadMemories() {
  if (!currentProject) return;
  try {
    const r = await fetch(`${API}/api/memories?project_id=${currentProject.id}`);
    const mems = await r.json();
    document.getElementById("memory-stats").innerHTML = t("memory.total", { count: mems.length });
    renderMemoryList(mems);
  } catch (e) {
    void e;
  }
}

function renderMemoryList(mems) {
  const list = document.getElementById("memory-list");
  if (mems.length === 0) {
    list.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5"><path d="M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7z"/><circle cx="12" cy="9" r="2.5"/></svg><p>${t("memory.empty")}</p></div>`;
    return;
  }
  list.innerHTML = mems.map(m => `
    <div class="mem-item">
      <span class="mem-category ${m.category}">${m.category}</span>
      <span class="mem-content">${esc(m.content)}</span>
      ${m.similarity !== undefined ? `<span class="mem-sim">${(m.similarity * 100).toFixed(0)}%</span>` : ''}
      <span class="mem-time">${formatTime(m.created_at)}</span>
      <button class="mem-delete" onclick="deleteMemory(${m.id})" title="${t("actions.delete")}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join("");
}

async function searchMemoriesUI() {
  if (!currentProject) return;
  const query = document.getElementById("memory-search-input").value.trim();
  if (!query) {
    loadMemories();
    return;
  }

  try {
    const r = await fetch(`${API}/api/memories/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: currentProject.id, query, top_k: 20 }),
    });
    const results = await r.json();
    document.getElementById("memory-stats").innerHTML = t("memory.searchResults", { count: results.length });
    renderMemoryList(results);
  } catch (e) {
    void e;
  }
}

async function reindexMemories() {
  showToast(t("memory.reindexing"));
  try {
    const r = await fetch(`${API}/api/memories/reindex?project_id=${currentProject?.id || ''}`, {
      method: "POST"
    });
    const d = await r.json();
    showToast(d.message || t("common.success"));
  } catch (e) {
    showToast(t("memory.reindexFailed", { message: e.message }));
  }
}

async function deleteMemory(id) {
  try {
    await fetch(`${API}/api/memories/${id}`, { method: "DELETE" });
    loadMemories();
  } catch (e) { void e; }
}

function showAddMemoryModal() {
  if (!currentProject) { showToast("请先进入一个项目"); return; }
  document.getElementById("modal-title").textContent = "添加记忆";
  document.getElementById("modal-body").innerHTML = `
    <div class="form-group"><label>类别</label><select id="new-mem-category" class="form-input"><option value="general">通用</option><option value="project_info">项目信息</option><option value="hypothesis">假设</option><option value="result">结果</option><option value="feedback">反馈</option><option value="reference">参考文献</option><option value="code_analysis">代码分析</option></select></div>
    <div class="form-group"><label>内容</label><textarea id="new-mem-content" class="form-input" rows="4" placeholder="输入要记住的信息..."></textarea></div>
    <div class="form-actions" style="margin-top:var(--space-4);"><button class="btn-primary btn-sm" onclick="addMemory()">添加</button><button class="btn-ghost btn-sm" onclick="closeModal()">取消</button></div>
  `;
  document.getElementById("modal-overlay").classList.add("open");
}

async function addMemory() {
  const category = document.getElementById("new-mem-category").value;
  const content = document.getElementById("new-mem-content").value.trim();
  if (!content) return;
  try {
    await fetch(`${API}/api/memories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: currentProject.id, content, category }) });
    closeModal();
    loadMemories();
  } catch (e) { void e; }
}

// ---------------------------------------------------------------------------
// GitHub Code Analysis
// ---------------------------------------------------------------------------

async function triggerGitHubAnalysis() {
  if (!currentProject) {
    showToast(t("experiment.needProjectFirst"));
    return;
  }
  if (!currentProject.repo_url) {
    showToast(t("code.noRepoUrl"));
    return;
  }

  const resultEl = document.getElementById("code-analysis-result");
  if (resultEl) {
    resultEl.innerHTML = `<div class="empty-state small">${t("code.analyzing")}</div>`;
  }

  try {
    const r = await fetch(
      `${API}/api/github/analyze?project_id=${currentProject.id}&repo_url=${encodeURIComponent(currentProject.repo_url)}`,
      { method: "POST" }
    );
    const data = await r.json();

    if (data.error) {
      if (resultEl) {
        resultEl.innerHTML = `<div class="empty-state small">${esc(data.error)}</div>`;
      }
      return;
    }

    let html = `<div class="code-meta">`;
    html += `<span class="code-lang">${esc(data.language || t("common.unknown"))}</span>`;
    html += `<span class="code-stars">${data.stars || 0} stars</span>`;
    html += `<span class="code-files">${data.file_count || 0} files</span>`;
    html += `</div>`;

    if (data.analysis) {
      html += `<div class="code-analysis-body">${renderMarkdown(data.analysis)}</div>`;
    }

    if (data.file_tree && data.file_tree.length > 0) {
      html += `<details class="file-tree-details"><summary>${t("code.fileTreeTop100")}</summary><pre class="file-tree">${esc(data.file_tree.slice(0, 100).join("\n"))}</pre></details>`;
    }

    if (resultEl) {
      resultEl.innerHTML = html;
    }

    showToast(t("code.analysisComplete"));
  } catch (e) {
    if (resultEl) {
      resultEl.innerHTML = `<div class="empty-state small">${t("code.analysisFailed", { message: e.message })}</div>`;
    }
  }
}

function closeCodePanel() {
  document.getElementById("code-panel").classList.remove("open");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function loadConfig() {
  try {
    const r = await fetch(`${API}/api/config`);
    const config = await r.json();
    const setVal = (id, key) => {
      const el = document.getElementById(id); if (!el || !config[key]) return;
      const v = config[key].value || "";
      if (v.includes("****")) {
        el.value = "";
        el.placeholder = t("settings.maskedPlaceholder");
      }
      else { el.value = v; }
    };
    setVal("cfg-llm-url", "llm_api_url"); setVal("cfg-llm-key", "llm_api_key"); setVal("cfg-llm-model", "llm_model");
    setVal("cfg-ssh-host", "ssh_host"); setVal("cfg-ssh-port", "ssh_port"); setVal("cfg-ssh-user", "ssh_user"); setVal("cfg-ssh-pass", "ssh_password");
    setVal("cfg-embed-url", "embedding_api_url"); setVal("cfg-embed-key", "embedding_api_key"); setVal("cfg-embed-model", "embedding_model");
    setVal("cfg-dify-url", "dify_api_url"); setVal("cfg-dify-key", "dify_api_key");

    const llmKey = config.llm_api_key?.value || "";
    const badge = document.getElementById("llm-status");
    if ((llmKey && !llmKey.includes("****") && llmKey.length > 0) || (llmKey.includes("****") && llmKey.length > 8)) {
      badge.textContent = "LLM 已配置"; badge.className = "llm-badge ok";
    } else {
      badge.textContent = "LLM 未配置"; badge.className = "llm-badge";
    }
  } catch (e) { void e; }
}

// ---------------------------------------------------------------------------
// LLM Profiles (v3.4)
// ---------------------------------------------------------------------------
async function loadLLMProfiles() {
  try {
    const r = await fetch(`${API}/api/llm-profiles`);
    const profiles = await r.json();
    const container = document.getElementById("llm-profiles-list");
    if (!container) return;

    if (profiles.length === 0) {
      container.innerHTML = '<div class="empty-state small">暂无LLM配置档。点击"添加配置"创建。</div>';
      return;
    }

    const taskTypeLabels = { general: "通用对话", code: "代码分析", paper: "论文调研", experiment: "实验设计" };
    const taskTypeIcons = { general: "💬", code: "💻", paper: "📄", experiment: "🧪" };

    container.innerHTML = profiles.map(p => `
      <div class="profile-card" data-task-type="${esc(p.task_type)}">
        <div class="profile-card-header">
          <span class="profile-icon">${taskTypeIcons[p.task_type] || "⚙️"}</span>
          <div class="profile-info">
            <span class="profile-name">${esc(p.name)}</span>
            <span class="profile-type-badge">${taskTypeLabels[p.task_type] || p.task_type}</span>
          </div>
          ${p.is_default ? '<span class="profile-default-badge">默认</span>' : ''}
        </div>
        <div class="profile-card-body">
          <div class="profile-detail"><span class="profile-detail-label">模型</span><span class="profile-detail-value">${esc(p.model)}</span></div>
          <div class="profile-detail"><span class="profile-detail-label">API</span><span class="profile-detail-value">${esc(p.api_url)}</span></div>
          <div class="profile-detail"><span class="profile-detail-label">Key</span><span class="profile-detail-value">${esc(p.api_key)}</span></div>
        </div>
        <div class="profile-card-actions">
          <button class="btn-ghost btn-sm" onclick="editProfile('${esc(p.id)}')">编辑</button>
          <button class="btn-ghost btn-sm" onclick="testProfile('${esc(p.id)}')">测试</button>
          <button class="btn-danger btn-sm" onclick="deleteProfile('${esc(p.id)}')">删除</button>
        </div>
      </div>
    `).join("");

    // Update LLM badge in chat
    const defaultProfile = profiles.find(p => p.is_default && p.task_type === "general");
    const badge = document.getElementById("llm-status");
    if (defaultProfile && badge) {
      badge.textContent = `LLM: ${defaultProfile.model}`;
      badge.className = "llm-badge ok";
    }
  } catch(e) { console.error("loadLLMProfiles:", e); }
}

function showAddProfileModal() {
  showProfileModal(null);
}

function showProfileModal(profile) {
  const isEdit = !!profile;
  document.getElementById("modal-title").textContent = isEdit ? "编辑LLM配置" : "添加LLM配置";
  document.getElementById("modal-body").innerHTML = `
    <div class="form-group">
      <label>配置名称</label>
      <input type="text" id="profile-name" class="form-input" placeholder="例: DeepSeek通用" value="${isEdit ? esc(profile.name) : ''}">
    </div>
    <div class="form-group">
      <label>任务类型</label>
      <select id="profile-task-type" class="form-input">
        <option value="general" ${isEdit && profile.task_type === 'general' ? 'selected' : ''}>通用对话</option>
        <option value="code" ${isEdit && profile.task_type === 'code' ? 'selected' : ''}>代码分析</option>
        <option value="paper" ${isEdit && profile.task_type === 'paper' ? 'selected' : ''}>论文调研</option>
        <option value="experiment" ${isEdit && profile.task_type === 'experiment' ? 'selected' : ''}>实验设计</option>
      </select>
    </div>
    <div class="form-group">
      <label>API 地址</label>
      <input type="text" id="profile-api-url" class="form-input" placeholder="https://api.deepseek.com" value="${isEdit ? esc(profile.api_url) : ''}">
    </div>
    <div class="form-group">
      <label>API Key</label>
      <input type="password" id="profile-api-key" class="form-input" placeholder="sk-..." value="">
      ${isEdit ? '<span class="form-hint">留空不修改</span>' : ''}
    </div>
    <div class="form-group">
      <label>模型</label>
      <input type="text" id="profile-model" class="form-input" placeholder="deepseek-chat" value="${isEdit ? esc(profile.model) : ''}">
    </div>
    <div class="form-group">
      <label>系统提示词（可选）</label>
      <textarea id="profile-system-prompt" class="form-input" rows="3" placeholder="可选的基础提示词...">${isEdit ? esc(profile.system_prompt || '') : ''}</textarea>
    </div>
    <div class="form-group" style="display:flex;align-items:center;gap:var(--space-2);">
      <input type="checkbox" id="profile-is-default" ${isEdit && profile.is_default ? 'checked' : ''}>
      <label for="profile-is-default" style="margin:0;">设为该类型的默认配置</label>
    </div>
    <div class="form-actions" style="margin-top:var(--space-4);">
      <button class="btn-primary btn-sm" onclick="saveProfile('${isEdit ? profile.id : ''}')">${isEdit ? '更新' : '创建'}</button>
      <button class="btn-ghost btn-sm" onclick="closeModal()">取消</button>
    </div>
  `;
  document.getElementById("modal-overlay").classList.add("open");
  setTimeout(() => document.getElementById("profile-name")?.focus(), 100);
}

async function saveProfile(profileId) {
  const name = document.getElementById("profile-name").value.trim();
  const task_type = document.getElementById("profile-task-type").value;
  const api_url = document.getElementById("profile-api-url").value.trim();
  const api_key = document.getElementById("profile-api-key").value.trim();
  const model = document.getElementById("profile-model").value.trim();
  const system_prompt = document.getElementById("profile-system-prompt").value.trim();
  const is_default = document.getElementById("profile-is-default").checked ? 1 : 0;

  if (!name || !api_url || !model) { showToast("请填写名称、API地址和模型"); return; }

  try {
    if (profileId) {
      // Update
      const body = { name, task_type, api_url, model, system_prompt, is_default };
      if (api_key) body.api_key = api_key;
      await fetch(`${API}/api/llm-profiles/${profileId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
    } else {
      // Create
      if (!api_key) { showToast("请填写API Key"); return; }
      await fetch(`${API}/api/llm-profiles`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, task_type, api_url, api_key, model, system_prompt, is_default })
      });
    }
    closeModal();
    loadLLMProfiles();
    showToast(profileId ? "配置已更新" : "配置已创建");
  } catch(e) { showToast("保存失败"); }
}

async function editProfile(profileId) {
  try {
    const r = await fetch(`${API}/api/llm-profiles`);
    const profiles = await r.json();
    const profile = profiles.find(p => p.id === profileId);
    if (profile) showProfileModal(profile);
  } catch(e) { showToast("加载失败"); }
}

async function testProfile(profileId) {
  showToast("测试中...");
  try {
    const r = await fetch(`${API}/api/llm-profiles/${profileId}/test`, { method: "POST" });
    const d = await r.json();
    showToast(d.message || (d.status === "ok" ? "连接成功" : "连接失败"));
  } catch(e) { showToast("测试失败"); }
}

async function deleteProfile(profileId) {
  if (!confirm("确定删除此LLM配置？")) return;
  try {
    await fetch(`${API}/api/llm-profiles/${profileId}`, { method: "DELETE" });
    loadLLMProfiles();
    showToast("已删除");
  } catch(e) { showToast("删除失败"); }
}

async function saveSettings() {
  const configs = {};
  const fields = [
    { id: "cfg-llm-url", key: "llm_api_url", cat: "llm" }, { id: "cfg-llm-key", key: "llm_api_key", cat: "llm" }, { id: "cfg-llm-model", key: "llm_model", cat: "llm" },
    { id: "cfg-ssh-host", key: "ssh_host", cat: "server" }, { id: "cfg-ssh-port", key: "ssh_port", cat: "server" }, { id: "cfg-ssh-user", key: "ssh_user", cat: "server" }, { id: "cfg-ssh-pass", key: "ssh_password", cat: "server" },
    { id: "cfg-embed-url", key: "embedding_api_url", cat: "embedding" }, { id: "cfg-embed-key", key: "embedding_api_key", cat: "embedding" }, { id: "cfg-embed-model", key: "embedding_model", cat: "embedding" },
    { id: "cfg-dify-url", key: "dify_api_url", cat: "dify" }, { id: "cfg-dify-key", key: "dify_api_key", cat: "dify" },
  ];
  const sensitiveKeys = ["llm_api_key", "ssh_password", "embedding_api_key", "dify_api_key"];
  fields.forEach(f => {
    const el = document.getElementById(f.id); if (!el) return;
    if (sensitiveKeys.includes(f.key) && !el.value) return;
    configs[f.key] = { value: el.value, category: f.cat };
  });
  try {
    await fetch(`${API}/api/config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ configs }) });
    showToast("配置已保存");
    loadConfig();
  } catch (e) { showToast("保存失败"); }
}

async function testLLM() {
  const el = document.getElementById("llm-test-result"); el.textContent = "测试中..."; el.className = "test-result";
  try { const r = await fetch(`${API}/api/config/test-llm`, { method: "POST" }); const d = await r.json(); el.textContent = d.message; el.className = `test-result ${d.status}`; } catch (e) { el.textContent = "失败"; el.className = "test-result error"; }
}

async function testEmbedding() {
  const el = document.getElementById("embed-test-result"); el.textContent = "测试中..."; el.className = "test-result";
  try { const r = await fetch(`${API}/api/config/test-embedding`, { method: "POST" }); const d = await r.json(); el.textContent = d.message; el.className = `test-result ${d.status}`; } catch (e) { el.textContent = "失败"; el.className = "test-result error"; }
}

async function testDify() {
  const el = document.getElementById("dify-test-result"); el.textContent = "测试中..."; el.className = "test-result";
  try { const r = await fetch(`${API}/api/config/test-dify`, { method: "POST" }); const d = await r.json(); el.textContent = d.message; el.className = `test-result ${d.status}`; } catch (e) { el.textContent = "失败"; el.className = "test-result error"; }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
async function updateStats() {
  try {
    const pid = currentProject ? currentProject.id : "";
    const r = await fetch(`${API}/api/stats?project_id=${pid}`);
    const s = await r.json();
    document.getElementById("header-stats").innerHTML = `
      <span class="stat-item">${t("project.tabs.experiments")} <span class="stat-value">${s.total_experiments}</span></span>
      <span class="stat-item">${t("status.running")} <span class="stat-value">${s.running}</span></span>
      <span class="stat-item">${t("project.tabs.memory")} <span class="stat-value">${s.memories}</span></span>
      <span class="stat-item">${t("project.tabs.papers")} <span class="stat-value">${s.papers || 0}</span></span>
    `;
  } catch (e) { void e; }
}

// ---------------------------------------------------------------------------
// Modal / Toast
// ---------------------------------------------------------------------------
function closeModal() { document.getElementById("modal-overlay").classList.remove("open"); }

function showToast(msg) {
  let container = document.getElementById("toast-container");
  if (!container) { container = document.createElement("div"); container.id = "toast-container"; container.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:200;display:flex;flex-direction:column;gap:8px;"; document.body.appendChild(container); }
  const toast = document.createElement("div");
  toast.style.cssText = "padding:8px 16px;background:var(--color-surface-2);border:1px solid var(--color-border-strong);border-radius:8px;font-size:var(--text-xs);color:var(--color-text);box-shadow:var(--shadow-md);animation:fadeIn 0.2s var(--ease-out);";
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; toast.style.transition = "opacity 0.3s"; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ---------------------------------------------------------------------------
// SSH Terminal
// ---------------------------------------------------------------------------
function openSSHPanel() {
  document.getElementById("ssh-panel").classList.add("open");
  document.getElementById("ssh-command-input").focus();
}

function closeSSHPanel() {
  document.getElementById("ssh-panel").classList.remove("open");
}

async function executeSSHCommand() {
  const input = document.getElementById("ssh-command-input");
  const cmd = input.value.trim();
  if (!cmd) return;
  input.value = "";

  const output = document.getElementById("ssh-output");
  output.innerHTML += `<div class="ssh-line cmd"><span class="ssh-prompt">$</span> ${esc(cmd)}</div>`;
  output.innerHTML += `<div class="ssh-line pending">${t("ssh.running")}</div>`;
  output.scrollTop = output.scrollHeight;

  document.getElementById("ssh-status").textContent = t("ssh.running");
  document.getElementById("ssh-status").className = "ssh-status running";

  try {
    const r = await fetch(`${API}/api/ssh/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: cmd,
        project_id: currentProject?.id || "",
        experiment_id: currentDetailExp || "",
      }),
    });
    const data = await r.json();

    const pendingEl = output.querySelector(".ssh-line.pending:last-child");
    if (pendingEl) pendingEl.remove();

    if (data.error && !data.output) {
      output.innerHTML += `<div class="ssh-line error">${esc(data.error)}</div>`;
      document.getElementById("ssh-status").textContent = t("ssh.error");
      document.getElementById("ssh-status").className = "ssh-status error";
    } else {
      if (data.output) {
        data.output.split("\n").forEach(line => {
          output.innerHTML += `<div class="ssh-line">${esc(line)}</div>`;
        });
      }
      if (data.error) {
        output.innerHTML += `<div class="ssh-line error">${esc(data.error)}</div>`;
      }
      output.innerHTML += `<div class="ssh-line exit-code">${t("ssh.exitCode", { code: data.exit_code ?? "N/A" })}</div>`;
      document.getElementById("ssh-status").textContent = t("ssh.completed", { code: data.exit_code ?? "?" });
      document.getElementById("ssh-status").className = `ssh-status ${data.exit_code === 0 ? "ok" : "error"}`;
    }
  } catch (e) {
    const pendingEl = output.querySelector(".ssh-line.pending:last-child");
    if (pendingEl) pendingEl.remove();
    output.innerHTML += `<div class="ssh-line error">${t("ssh.connectionFailed")}: ${esc(e.message)}</div>`;
    document.getElementById("ssh-status").textContent = t("ssh.connectionFailed");
    document.getElementById("ssh-status").className = "ssh-status error";
  }

  output.scrollTop = output.scrollHeight;
}
  
    

async function testSSH() {
  const el = document.getElementById("ssh-test-result");
  el.textContent = t("actions.test") + "...";
  el.className = "test-result";

  try {
    const r = await fetch(`${API}/api/ssh/test`, { method: "POST" });
    const d = await r.json();
    if (d.error) {
      el.textContent = d.error;
      el.className = "test-result error";
    } else {
      el.textContent = t("ssh.testSuccess", { code: d.exit_code });
      el.className = `test-result ${d.exit_code === 0 ? "ok" : "error"}`;
    }
  } catch (e) {
    el.textContent = t("ssh.testFailed");
    el.className = "test-result error";
  }
}

async function executeExperimentSSH(expId) {
  showToast(t("ssh.runRemote"));
  try {
    const r = await fetch(`${API}/api/experiments/${expId}/execute`, { method: "POST" });
    const d = await r.json();
    if (d.ssh_result?.error) {
      showToast(t("ssh.remoteError", { message: d.ssh_result.error }));
    } else {
      showToast(t("ssh.remoteStarted"));
      if (currentDetailExp === expId) refreshDetailPanel(expId);
      loadExperiments();
    }
  } catch (e) {
    showToast(t("ssh.remoteFailed", { message: e.message }));
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function esc(str) { if (!str) return ""; const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }

function escAttr(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(text) {
  if (!text) return "";
  let html = esc(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^#### (.*$)/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
  html = html.replace(/^- (.*$)/gm, '<li>$1</li>');
  html = html.replace(/^(\d+)\. (.*$)/gm, '<li>$2</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // Simple table support
  html = html.replace(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/g, (match, header, body) => {
    const ths = header.split("|").filter(Boolean).map(h => `<th>${h.trim()}</th>`).join("");
    const rows = body.trim().split("\n").map(row => {
      const tds = row.split("|").filter(Boolean).map(c => `<td>${c.trim()}</td>`).join("");
      return `<tr>${tds}</tr>`;
    }).join("");
    return `<table class="md-table"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
  });
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  if (!html.startsWith('<')) html = '<p>' + html + '</p>';
  return html;
}

function statusLabel(status) {
  const labels = {
    queued: t("status.queued"),
    running: t("status.running"),
    completed: t("status.completed"),
    failed: t("status.failed"),
    stopped: t("status.stopped"),
    idle: t("status.idle"),
    pending_approval: t("status.pendingApproval"),
    rejected: t("status.rejected")
  };
  return labels[status] || status;
}

function formatTime(ts) {
  if (!ts) return "";
  try { const d = new Date(ts); return d.toLocaleTimeString(currentLocale, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
}); }
  catch (e) { void e; return ts; }
}

function autoResizeTextarea() {
  const textarea = document.getElementById("chat-input");
  if (textarea) textarea.addEventListener("input", () => autoResize(textarea));
}

function autoResize(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; }

// ---------------------------------------------------------------------------
// Pipeline Settings
// ---------------------------------------------------------------------------
function logEntryClass(l) {
  const msg = l.message || "";
  if (msg.includes('[自动Debug]')) {
    if (msg.includes('✅')) return 'DEBUG-OK';
    if (msg.includes('❌')) return 'DEBUG-FAIL';
    return 'DEBUG';
  }
  if (msg.includes('[Codex 回合')) return 'CODEX';
  if (msg.includes('[Codex]')) return 'CODEX';
  return l.level || '';
}

// ---------------------------------------------------------------------------
// SSE Real-time Experiment Logs
// ---------------------------------------------------------------------------
function connectExperimentSSE(expId) {
  disconnectExperimentSSE();
  const url = `${API}/api/events/exp_${expId}`;
  experimentEventSource = new EventSource(url);
  experimentEventSource._expId = expId;

  experimentEventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "log" || data.type === "codex_message" || data.type === "codex_command") {
        appendLiveLog(data);
      }
      // On codex_complete or experiment_update, refresh the full detail
      if (data.type === "codex_complete" || data.type === "experiment_update") {
        if (currentDetailExp === expId) {
          refreshDetailPanel(expId);
        }
        loadExperiments();
        updateStats();
      }
    } catch (err) { /* ignore parse errors */ }
  };

  experimentEventSource.onerror = () => {
    // SSE disconnected — will auto-reconnect via EventSource spec
  };
}

function disconnectExperimentSSE() {
  if (experimentEventSource) {
    experimentEventSource.close();
    experimentEventSource = null;
  }
}

function appendLiveLog(data) {
  const logsEl = document.getElementById("detail-logs");
  if (!logsEl) return;
  // Remove empty state if present
  const emptyEl = logsEl.querySelector(".empty-state");
  if (emptyEl) emptyEl.remove();

  const msg = data.message || data.text || "";
  const level = data.level || "INFO";
  const time = data.created_at || new Date().toISOString();

  const entry = document.createElement("div");
  entry.className = `log-entry ${logEntryClass({message: msg, level})} log-live`;
  entry.innerHTML = `<span class="log-time">${formatTime(time)}</span>${esc(msg)}`;

  // Append to bottom (logs are in chronological order in the panel)
  logsEl.appendChild(entry);

  // Auto-scroll to bottom
  logsEl.scrollTop = logsEl.scrollHeight;
}

async function loadPipelineSettings() {
  try {
    const r = await fetch(`${API}/api/pipeline/settings`);
    const d = await r.json();
    const approvalEl = document.getElementById("cfg-approval");
    if (approvalEl) approvalEl.value = d.approval_enabled || "true";
    const debugEl = document.getElementById("cfg-auto-debug");
    if (debugEl) debugEl.value = d.auto_debug_enabled || "true";
  } catch (e) { void e; }
}

async function savePipelineSettings() {
  const approval = document.getElementById("cfg-approval").value;
  const autoDebug = document.getElementById("cfg-auto-debug").value;
  try {
    await fetch(`${API}/api/pipeline/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approval_enabled: approval,
        auto_debug_enabled: autoDebug
      }),
    });
    showToast("流水线设置已保存");
  } catch (e) { showToast("保存失败"); }
}

// ---------------------------------------------------------------------------
// Stage Approval
// ---------------------------------------------------------------------------
let currentApprovalStage = "";

async function approveStage(action) {
  if (!currentDetailExp) return;
  const banner = document.getElementById("approval-banner");
  const stage = banner.dataset.stage;
  const comment = document.getElementById("approval-comment").value.trim();
  
  const actionLabels = { approve: "批准", reject: "拒绝", revise: "修改重跑" };
  if (action === "reject" && !confirm(`确定拒绝并终止实验？`)) return;

  try {
    const r = await fetch(`${API}/api/experiments/${currentDetailExp}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, action, comment }),
    });
    const d = await r.json();
    showToast(d.message || `已${actionLabels[action]}`);
    document.getElementById("approval-comment").value = "";
    banner.style.display = "none";
    // Refresh
    if (action === "approve" || action === "revise") {
      startExperimentPoll();
      connectExperimentSSE(currentDetailExp);  // Real-time tracking for next stage
    }
    openExperimentDetail(currentDetailExp);
    loadExperiments();
  } catch (e) {
    showToast("审批操作失败");
    console.error("approveStage:", e);
  }
}

// Load approval stage output into inline card
async function loadApprovalOutput(expId) {
  try {
    const r = await fetch(`${API}/api/experiments/${expId}/approvals`);
    const approvals = await r.json();
    const pending = approvals.find(a => a.status === "pending");
    const el = document.getElementById(`approval-output-${expId}`);
    if (!el) return;
    if (pending && pending.stage_output) {
      el.innerHTML = `<div class="approval-output-text">${renderMarkdown(pending.stage_output.substring(0, 3500))}</div>`;
    } else {
      el.innerHTML = '<div class="approval-output-text" style="color:var(--color-text-faint)">暂无输出内容</div>';
    }
  } catch (e) { void e; }
}

// Approve/reject/revise directly from experiment card
async function approveFromCard(expId, stage, action) {
  const actionLabels = { approve: "批准", reject: "拒绝", revise: "修改重跑" };
  if (action === "reject" && !confirm(`确定拒绝并终止实验？`)) return;
  
  const commentEl = document.getElementById(`approval-comment-${expId}`);
  const comment = commentEl ? commentEl.value.trim() : "";
  
  // Disable buttons during request
  const inlineEl = document.getElementById(`approval-inline-${expId}`);
  if (inlineEl) {
    inlineEl.querySelectorAll("button").forEach(b => b.disabled = true);
  }

  try {
    const r = await fetch(`${API}/api/experiments/${expId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, action, comment }),
    });
    const d = await r.json();
    showToast(d.message || `已${actionLabels[action]}`);
    if (action === "approve" || action === "revise") {
      startExperimentPoll();
    }
    loadExperiments();
    // Also refresh detail panel if it's open for this experiment
    if (currentDetailExp === expId) {
      openExperimentDetail(expId);
    }
  } catch (e) {
    showToast("审批操作失败");
    console.error("approveFromCard:", e);
    if (inlineEl) {
      inlineEl.querySelectorAll("button").forEach(b => b.disabled = false);
    }
  }
}
