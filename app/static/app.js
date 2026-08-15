import React, { useCallback, useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);

const PIPELINE_STATUSES = [
  "idea",
  "approved",
  "content_ready",
  "scenes_ready",
  "tts_ready",
  "music_ready",
  "images_ready",
  "rendered",
  "uploaded",
  "failed",
];

const BULK_STATUS_OPTIONS = [...PIPELINE_STATUSES];
const BEST_SHORTS_CACHE_PREFIX = "as_best_shorts_v1";
const ACTIVITY_MAX = 60;

function statusColor(status) {
  return {
    idea: "#818cf8",
    approved: "#38bdf8",
    content_ready: "#34d399",
    scenes_ready: "#a78bfa",
    tts_ready: "#fb923c",
    music_ready: "#f59e0b",
    images_ready: "#f472b6",
    rendered: "#4ade80",
    uploaded: "#a3e635",
    failed: "#f87171",
  }[status] || "var(--bs-body-color)";
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function fmtScheduleDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function api(method, path, body) {
  const options = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) options.body = JSON.stringify(body);
  const response = await fetch(`/api${path}`, options);
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(err.detail || response.statusText);
  }
  if (response.status === 204) return null;
  return response.json();
}

function badge(status) {
  return html`<span className=${`badge s-badge-${status}`}>${status.replace(/_/g, " ")}</span>`;
}

function ProjectActions({ project, onApprove, onReject, onRun, onRerender, onDelete }) {
  return html`
    <div className="d-flex gap-1 flex-wrap align-items-center" onClick=${(e) => e.stopPropagation()}>
      ${project.status === "idea"
        ? html`<button className="btn btn-sm btn-outline-primary" onClick=${() => onApprove(project.id)}>Approve</button>`
        : null}
      ${["idea", "approved"].includes(project.status)
        ? html`<button className="btn btn-sm btn-outline-warning" onClick=${() => onReject(project.id)}>Reject</button>`
        : null}
      ${project.status === "approved"
        ? html`<button className="btn btn-sm btn-outline-success" onClick=${() => onRun(project.id)}>Run</button>`
        : null}
      ${["rendered", "uploaded", "failed", "images_ready"].includes(project.status)
        ? html`<button className="btn btn-sm btn-outline-info" onClick=${() => onRerender(project.id)}>Re-render</button>`
        : null}
      <button className="btn btn-sm btn-outline-danger" onClick=${() => onDelete(project.id)}>Delete</button>
    </div>
  `;
}

function ProfilePanel({ profiles, selectedProfile, onSelectProfile, topics, currentTopicId, onTopicSelect, onAddTopic, onDeleteTopic, profileTopics }) {
  const [newTopicText, setNewTopicText] = useState("");

  const handleAddTopic = () => {
    const text = newTopicText.trim();
    if (!text || !selectedProfile) return;
    onAddTopic(text);
    setNewTopicText("");
  };

  return html`
    <div className="d-flex flex-column flex-shrink-0 border-end bg-body p-3" style=${{ width: 260 }}>
      <h6 className="text-uppercase text-muted fw-semibold mb-2">Profiles</h6>
      ${profiles.length
        ? html`
            <div className="list-group list-group-flush">
              ${profiles.map((profile) => html`
                <button
                  key=${profile.name}
                  type="button"
                  className=${`list-group-item list-group-item-action d-flex flex-column align-items-start gap-1 ${profile.name === selectedProfile ? "active" : ""}`}
                  onClick=${() => onSelectProfile(profile.name)}
                >
                  <span className="fw-semibold text-truncate w-100">${profile.name}</span>
                  <span className="d-flex gap-1 flex-wrap">
                    <span className="badge ${profile.form === "long" ? "text-bg-primary" : "text-bg-success"}">${profile.form === "long" ? "Long" : "Short"}</span>
                    ${profile.aspect !== "auto" ? html`<span className="badge text-bg-warning">${profile.aspect === "landscape" ? "Landscape" : "Portrait"}</span>` : null}
                  </span>
                  ${profile.youtube_name ? html`<span className="small text-muted text-truncate w-100">${profile.youtube_name}</span>` : null}
                </button>
              `)}
            </div>
          `
        : html`<div className="text-muted small">No profiles configured.</div>`}

      ${selectedProfile ? html`
        <div className="border-top mt-3 pt-3">
          <h6 className="text-uppercase text-muted fw-semibold mb-2">Topics (${profileTopics.length})</h6>
          <div className="list-group list-group-flush mb-2" style=${{ maxHeight: 200, overflowY: "auto" }}>
            ${profileTopics.length
              ? profileTopics.map((topic) => html`
                  <div
                    key=${topic.id}
                    className=${`list-group-item list-group-item-action d-flex align-items-center gap-2 ${topic.id === currentTopicId ? "active" : ""}`}
                    onClick=${() => onTopicSelect(topic.id, topic.topic)}
                  >
                    <span className="flex-grow-1 text-truncate" title=${topic.topic}>${topic.topic}</span>
                    <button className="btn-close btn-close-white" title="Delete" style=${{ fontSize: ".65rem" }} onClick=${(e) => {
                      e.stopPropagation();
                      onDeleteTopic(topic.id);
                    }}></button>
                  </div>
                `)
              : html`<div className="text-muted small text-center py-2">No topics for this profile.</div>`}
          </div>
          <div className="input-group input-group-sm">
            <input
              className="form-control"
              value=${newTopicText}
              placeholder="New topic..."
              onInput=${(e) => setNewTopicText(e.target.value)}
              onKeyDown=${(e) => {
                if (e.key === "Enter") handleAddTopic();
              }}
            />
            <button className="btn btn-outline-secondary" onClick=${handleAddTopic}>+</button>
          </div>
        </div>
      ` : null}
    </div>
  `;
}

function App() {
  const initialTopicId = localStorage.getItem("as_topic_id");
  const initialTopicText = localStorage.getItem("as_topic_text");

  const [topics, setTopics] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState("");

  const [currentTopicId, setCurrentTopicId] = useState(initialTopicId || null);
  const [currentTopicText, setCurrentTopicText] = useState(initialTopicText || null);
  const [activePage, setActivePage] = useState(initialTopicId ? "dashboard" : "splash");

  const [sseLabel, setSseLabel] = useState("idle");
  const [sseMode, setSseMode] = useState("idle");
  const [comfyAvailable, setComfyAvailable] = useState(null);
  const [comfyPaused, setComfyPaused] = useState(false);
  const [comfyRestartAttempts, setComfyRestartAttempts] = useState(0);
  const [comfyMaxAttempts, setComfyMaxAttempts] = useState(5);
  const [comfyAutoRestart, setComfyAutoRestart] = useState(false);
  const [activityLog, setActivityLog] = useState([]);

  const [dashboard, setDashboard] = useState(null);
  const [queueRunning, setQueueRunning] = useState({});

  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [bulkAction, setBulkAction] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());

  const [bestShorts, setBestShorts] = useState([]);
  const [bestShortsAnalysis, setBestShortsAnalysis] = useState("");
  const [bestShortsAnalysisSource, setBestShortsAnalysisSource] = useState("AI");
  const [bestShortsLoading, setBestShortsLoading] = useState(false);
  const [bestShortsAnalyzing, setBestShortsAnalyzing] = useState(false);

  const [genOpen, setGenOpen] = useState(false);
  const [genCount, setGenCount] = useState(5);
  const [genLoading, setGenLoading] = useState(false);
  const [generatedIdeas, setGeneratedIdeas] = useState([]);
  const [genPreviewPrompt, setGenPreviewPrompt] = useState("");

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailProject, setDetailProject] = useState(null);
  const [detailEditing, setDetailEditing] = useState(false);
  const [detailForm, setDetailForm] = useState(null);
  const [detailSaving, setDetailSaving] = useState(false);

  const [previewImage, setPreviewImage] = useState(null);

  const [toastState, setToastState] = useState({ msg: "", type: "success" });

  const refreshTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const searchTimerRef = useRef(null);

  const showToast = useCallback((msg, type = "success") => {
    setToastState({ msg, type });
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastState({ msg: "", type: "success" });
    }, 2800);
  }, []);

  const bestShortsCacheKey = useCallback(() => {
    return `${BEST_SHORTS_CACHE_PREFIX}:${currentTopicId || "all"}`;
  }, [currentTopicId]);

  const saveBestShortsCache = useCallback((shorts) => {
    localStorage.setItem(bestShortsCacheKey(), JSON.stringify({
      topic_id: currentTopicId || "all",
      fetched_at: new Date().toISOString(),
      shorts,
    }));
  }, [bestShortsCacheKey, currentTopicId]);

  const readBestShortsCache = useCallback(() => {
    const raw = localStorage.getItem(bestShortsCacheKey());
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.shorts) ? parsed.shorts : [];
    } catch {
      return [];
    }
  }, [bestShortsCacheKey]);

  const bestSummary = useMemo(() => {
    const matched = bestShorts.filter((item) => item.project_id).length;
    return {
      total: bestShorts.length,
      matched,
      unmatched: bestShorts.length - matched,
    };
  }, [bestShorts]);

  const allTags = useMemo(() => {
    return [...new Set(projects.flatMap((project) => project.tags || []))].sort();
  }, [projects]);

  const selectedInView = useMemo(() => {
    return projects.filter((project) => selectedIds.has(project.id)).length;
  }, [projects, selectedIds]);

  const profileTopics = useMemo(() => {
    if (!selectedProfile) return [];
    return topics.filter((t) => t.profile === selectedProfile);
  }, [topics, selectedProfile]);

  const loadTopics = useCallback(async () => {
    let loaded = [];
    try {
      const params = new URLSearchParams();
      if (selectedProfile) params.set("profile", selectedProfile);
      const query = params.toString();
      loaded = query ? await api("GET", `/topics?${query}`) : await api("GET", "/topics");
    } catch {
      loaded = [];
    }

    setTopics(loaded);

    if (currentTopicId && !loaded.some((topic) => topic.id === currentTopicId)) {
      setCurrentTopicId(loaded.length ? loaded[0].id : null);
      setCurrentTopicText(loaded.length ? loaded[0].topic : null);
      return;
    }

    if (!currentTopicId && loaded.length) {
      setCurrentTopicId(loaded[0].id);
      setCurrentTopicText(loaded[0].topic);
      return;
    }

    if (currentTopicId) {
      const selected = loaded.find((topic) => topic.id === currentTopicId);
      setCurrentTopicText(selected?.topic || currentTopicText || "Topic selected");
    }
  }, [currentTopicId, currentTopicText, selectedProfile]);

  const loadProfiles = useCallback(async () => {
    try {
      const loaded = await api("GET", "/profiles");
      setProfiles(loaded);

      if (!loaded.length) {
        setSelectedProfile("");
        return;
      }

      if (!selectedProfile || !loaded.some((profile) => profile.name === selectedProfile)) {
        const fallback = loaded[0]?.name;
        setSelectedProfile(fallback);
      }
    } catch (e) {
      showToast(`Profiles error: ${e.message}`, "error");
    }
  }, [selectedProfile, showToast]);

  const loadDashboard = useCallback(async () => {
    if (!currentTopicId) return;
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (currentTopicId !== "all") params.set("topic_id", currentTopicId);
      if (selectedProfile) params.set("profile", selectedProfile);
      const data = await api("GET", `/dashboard?${params.toString()}`);
      setDashboard(data);
    } catch (e) {
      showToast(`Dashboard error: ${e.message}`, "error");
    }
  }, [currentTopicId, selectedProfile, showToast]);

  const loadProjects = useCallback(async () => {
    if (!currentTopicId) return;
    setProjectsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (currentTopicId !== "all") params.set("topic_id", currentTopicId);
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      const data = await api("GET", `/projects?${params.toString()}`);
      const filtered = tagFilter
        ? data.filter((project) => (project.tags || []).includes(tagFilter))
        : data;
      setProjects(filtered);
      setSelectedIds((prev) => new Set([...prev].filter((id) => filtered.some((p) => p.id === id))));
    } catch (e) {
      setProjects([]);
      setSelectedIds(new Set());
      showToast(e.message, "error");
    } finally {
      setProjectsLoading(false);
    }
  }, [currentTopicId, search, statusFilter, tagFilter, showToast]);

  const loadBestShorts = useCallback(async () => {
    if (!currentTopicId) return;
    setBestShortsLoading(true);
    setBestShortsAnalysis("");
    try {
      const params = new URLSearchParams({ max_results: "50" });
      if (currentTopicId !== "all") params.set("topic_id", currentTopicId);
      const data = await api("GET", `/dashboard/best-shorts?${params.toString()}`);
      const shorts = data.shorts || [];
      setBestShorts(shorts);
      saveBestShortsCache(shorts);
    } catch {
      const cached = readBestShortsCache();
      if (cached.length) {
        setBestShorts(cached);
        showToast("Failed to refresh shorts. Loaded cached data.", "error");
      } else {
        setBestShorts([]);
        showToast("Failed to load shorts.", "error");
      }
    } finally {
      setBestShortsLoading(false);
    }
  }, [currentTopicId, readBestShortsCache, saveBestShortsCache, showToast]);

  const openDetail = useCallback(async (id) => {
    try {
      const project = await api("GET", `/projects/${id}`);
      setDetailProject(project);
      setDetailEditing(false);
      setDetailForm(null);
      setDetailSaving(false);
      setDetailOpen(true);
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [showToast]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailProject(null);
    setDetailEditing(false);
    setDetailForm(null);
  }, []);

  const startEdit = useCallback(() => {
    if (!detailProject) return;
    const meta = detailProject.metadata || {};
    setDetailForm({
      title: detailProject.title,
      profile: detailProject.profile || "",
      tags: (detailProject.tags || []).join(", "),
      metadata: {
        summary: meta.summary ?? "",
        transcript: meta.transcript ?? "",
        narrator: meta.narrator ?? "",
        music: meta.music ?? "",
        visual_guide: meta.visual_guide ?? "",
        duration: meta.duration != null ? String(meta.duration) : "",
        word_count: meta.word_count != null ? String(meta.word_count) : "",
      },
    });
    setDetailEditing(true);
  }, [detailProject]);

  const cancelEdit = useCallback(() => {
    setDetailEditing(false);
    setDetailForm(null);
  }, []);

  const setFormField = useCallback((field, value) => {
    setDetailForm((form) => (form ? { ...form, [field]: value } : form));
  }, []);

  const setFormMeta = useCallback((field, value) => {
    setDetailForm((form) => (form ? { ...form, metadata: { ...form.metadata, [field]: value } } : form));
  }, []);

  const saveDetail = useCallback(async () => {
    if (!detailProject || !detailForm) return;
    setDetailSaving(true);
    try {
      const meta = detailForm.metadata || {};
      const tags = (detailForm.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
      const metadata = { ...(detailProject.metadata || {}) };
      if (meta.summary !== "") metadata.summary = meta.summary;
      else delete metadata.summary;
      if (meta.transcript !== "") metadata.transcript = meta.transcript;
      else delete metadata.transcript;
      if (meta.narrator !== "") metadata.narrator = meta.narrator;
      else delete metadata.narrator;
      if (meta.music !== "") metadata.music = meta.music;
      else delete metadata.music;
      if (meta.visual_guide !== "") metadata.visual_guide = meta.visual_guide;
      else delete metadata.visual_guide;
      if (meta.duration !== "") metadata.duration = Number(meta.duration);
      else delete metadata.duration;
      if (meta.word_count !== "") metadata.word_count = Number(meta.word_count);
      else delete metadata.word_count;

      const updated = await api("PATCH", `/projects/${detailProject.id}`, {
        title: detailForm.title,
        profile: detailForm.profile || undefined,
        tags,
        metadata,
      });
      setDetailProject(updated);
      setDetailEditing(false);
      setDetailForm(null);
      showToast("Project updated", "success");
      loadDashboard();
      if (activePage === "projects") loadProjects();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setDetailSaving(false);
    }
  }, [activePage, detailForm, detailProject, loadDashboard, loadProjects, showToast]);

  const refreshVisibleData = useCallback(() => {
    loadDashboard();
    if (activePage === "projects") loadProjects();
    if (detailProject?.id) openDetail(detailProject.id);
  }, [activePage, detailProject?.id, loadDashboard, loadProjects, openDetail]);

  const runQueue = useCallback(async (queue) => {
    setQueueRunning((prev) => ({ ...prev, [queue]: true }));
    try {
      const params = new URLSearchParams({ queue });
      if (currentTopicId && currentTopicId !== "all") params.set("topic_id", currentTopicId);
      const result = await api("POST", `/dashboard/run-queue?${params.toString()}`);
      if (queue === "all") {
        showToast(`${result.queued} project(s) queued for full pipeline`, "success");
      } else {
        showToast(`${result.queued} project(s) queued for ${queue.replace(/_/g, " ")}`, "success");
      }
      loadDashboard();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setQueueRunning((prev) => ({ ...prev, [queue]: false }));
    }
  }, [currentTopicId, loadDashboard, showToast]);

  const approveProject = useCallback(async (id) => {
    try {
      await api("POST", `/projects/${id}/approve`);
      showToast("Approved", "success");
      refreshVisibleData();
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [refreshVisibleData, showToast]);

  const rejectProject = useCallback(async (id) => {
    if (!window.confirm("Reject this project?")) return;
    try {
      await api("POST", `/projects/${id}/reject`);
      showToast("Rejected", "success");
      refreshVisibleData();
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [refreshVisibleData, showToast]);

  const runPipeline = useCallback(async (id) => {
    try {
      await api("POST", `/projects/${id}/run`);
      showToast("Pipeline started", "success");
      refreshVisibleData();
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [refreshVisibleData, showToast]);

  const reRender = useCallback(async (id) => {
    if (!window.confirm("Force re-render this project?")) return;
    try {
      await api("POST", `/projects/${id}/render`);
      showToast("Re-render started", "success");
      refreshVisibleData();
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [refreshVisibleData, showToast]);

  const deleteProject = useCallback(async (id) => {
    if (!window.confirm("Delete this project permanently?")) return;
    try {
      await api("DELETE", `/projects/${id}`);
      showToast("Deleted", "success");
      if (detailProject?.id === id) {
        closeDetail();
      }
      refreshVisibleData();
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [detailProject?.id, refreshVisibleData, closeDetail, showToast]);

  const uploadToYouTube = useCallback(async (id) => {
    try {
      await api("POST", `/projects/${id}/upload`);
      showToast("Upload to YouTube started", "success");
      refreshVisibleData();
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [refreshVisibleData, showToast]);

  const openProjectFolder = useCallback(async (id) => {
    try {
      await api("POST", `/projects/${id}/open-folder`);
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [showToast]);

  const setProjectStatus = useCallback(async (id, status) => {
    try {
      await api("PUT", `/projects/${id}/status`, { status });
      showToast(`Status set to ${status}`, "success");
      refreshVisibleData();
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [refreshVisibleData, showToast]);

  const rerunMusic = useCallback(async (id) => {
    try {
      await api("POST", `/projects/${id}/rerun/music`);
      showToast("Music regeneration queued", "success");
      setTimeout(() => openDetail(id), 700);
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [openDetail, showToast]);

  const rerunAllImages = useCallback(async (id) => {
    if (!window.confirm("Regenerate all scene images?")) return;
    try {
      await api("POST", `/projects/${id}/rerun/images`);
      showToast("All images queued for regeneration", "success");
      setTimeout(() => openDetail(id), 700);
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [openDetail, showToast]);

  const removeSceneImage = useCallback(async (id, sceneIndex) => {
    if (!window.confirm(`Remove the generated image for scene ${sceneIndex + 1}?`)) return;
    try {
      await api("DELETE", `/projects/${id}/scenes/${sceneIndex}/image`);
      showToast(`Scene ${sceneIndex + 1} image removed`, "success");
      openDetail(id);
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [openDetail, showToast]);

  const rerunSceneImage = useCallback(async (id, sceneIndex) => {
    try {
      await api("POST", `/projects/${id}/scenes/${sceneIndex}/rerun/image`);
      showToast(`Scene ${sceneIndex + 1} image queued`, "success");
      setTimeout(() => openDetail(id), 700);
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [openDetail, showToast]);

  const addTopic = useCallback(async (text) => {
    const topicText = (text || "").trim();
    if (!topicText) return;
    try {
      const created = await api("POST", "/topics", { topic: topicText, profile: selectedProfile || "default" });
      setTopics((prev) => [...prev, created]);
      setCurrentTopicId(created.id);
      setCurrentTopicText(created.topic);
      showToast("Topic created", "success");
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [selectedProfile, showToast]);

  const recoverFailed = useCallback(async () => {
    if (!window.confirm("Recover all failed projects? This will reset image/music stage failures back to their original status.")) return;
    try {
      const result = await api("POST", "/projects/recover");
      if (result.count > 0) {
        showToast(`Recovered ${result.count} project(s)`, "success");
      } else {
        showToast("No projects matched recovery criteria", "success");
      }
      refreshVisibleData();
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [refreshVisibleData, showToast]);

  const resumeComfyQueues = useCallback(async () => {
    try {
      const result = await api("POST", "/dashboard/resume-queues");
      if (result.resumed.length > 0) {
        showToast(`Resumed ${result.resumed.length} queue(s)`, "success");
      } else {
        showToast("No queues were paused", "success");
      }
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [showToast]);

  const restartComfy = useCallback(async () => {
    if (!window.confirm("Restart ComfyUI? This will temporarily pause all ComfyUI-dependent queues.")) return;
    try {
      const result = await api("POST", "/dashboard/restart-comfy");
      showToast(result.message || "Restart command sent", "success");
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [showToast]);

  const loadComfyStatus = useCallback(async () => {
    try {
      const status = await api("GET", "/dashboard/comfy-status");
      setComfyAvailable(status.available);
      setComfyPaused(!status.available);
      setComfyRestartAttempts(status.restart_attempts || 0);
      setComfyMaxAttempts(status.max_restart_attempts || 5);
      setComfyAutoRestart(status.auto_restart_enabled || false);
    } catch {
      // Non-critical — status will be updated via SSE
    }
  }, []);

  const deleteTopic = useCallback(async (id) => {
    const topic = topics.find((item) => item.id === id);
    if (!window.confirm(`Delete topic \"${topic?.topic || ""}\"? This fails if it has projects.`)) return;
    try {
      await api("DELETE", `/topics/${id}`);
      setTopics((prev) => prev.filter((item) => item.id !== id));
      if (currentTopicId === id) {
        const remaining = topics.filter((item) => item.id !== id);
        setCurrentTopicId(remaining.length ? remaining[0].id : null);
        setCurrentTopicText(remaining.length ? remaining[0].topic : null);
      }
      showToast("Topic deleted", "success");
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [currentTopicId, showToast, topics]);

  const submitGenerate = useCallback(async () => {
    if (!currentTopicId || currentTopicId === "all") return;
    setGenLoading(true);
    setGeneratedIdeas([]);
    try {
      const ideas = await api("POST", "/ideas/generate", {
        topic_id: currentTopicId,
        count: genCount,
        profile: selectedProfile || undefined,
      });
      setGeneratedIdeas(ideas);
      showToast(`${ideas.length} ideas generated`, "success");
      loadDashboard();
      if (activePage === "projects") loadProjects();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setGenLoading(false);
    }
  }, [activePage, currentTopicId, genCount, loadDashboard, loadProjects, selectedProfile, showToast]);

  const analyzeBestShorts = useCallback(async () => {
    const shorts = bestShorts.length ? bestShorts : readBestShortsCache();
    if (!shorts.length) {
      showToast("Fetch data first so Analyze has content", "error");
      return;
    }

    setBestShortsAnalyzing(true);
    try {
      const payload = {
        shorts: shorts.slice(0, 25).map((item) => ({
          title: item.title || "Untitled short",
          views: Number(item.views || 0),
        })),
      };
      const response = await api("POST", "/dashboard/best-shorts/analyze", payload);
      if (!response?.analysis) throw new Error("No analysis response");
      setBestShortsAnalysis(response.analysis);
      setBestShortsAnalysisSource("AI");
    } catch {
      const sorted = [...shorts].sort((a, b) => (b.views || 0) - (a.views || 0));
      const top = sorted.slice(0, Math.min(5, sorted.length));
      const totalViews = sorted.reduce((sum, item) => sum + Number(item.views || 0), 0);
      const avgViews = Math.round(totalViews / sorted.length);
      const matched = sorted.filter((item) => item.project_id).length;
      const localSummary = [
        `Total shorts: ${sorted.length}`,
        `Average views: ${avgViews.toLocaleString()}`,
        `Matched to project: ${matched}/${sorted.length}`,
        "",
        "Top performers:",
        ...top.map((item, idx) => `${idx + 1}. ${item.title || "Untitled short"} (${Number(item.views || 0).toLocaleString()} views)`),
      ].join("\n");
      setBestShortsAnalysis(localSummary);
      setBestShortsAnalysisSource("Local summary");
      showToast("AI analysis unavailable. Showing local summary.", "error");
    } finally {
      setBestShortsAnalyzing(false);
    }
  }, [bestShorts, readBestShortsCache, showToast]);

  const applyBulkAction = useCallback(async () => {
    const ids = projects.map((project) => project.id).filter((id) => selectedIds.has(id));
    if (!bulkAction) {
      showToast("Select a bulk action first", "error");
      return;
    }
    if (!ids.length) {
      showToast("Select at least one project", "error");
      return;
    }

    if (bulkAction === "delete") {
      if (!window.confirm(`Delete ${ids.length} selected project(s)?`)) return;
      const results = await Promise.allSettled(ids.map((id) => api("DELETE", `/projects/${id}`)));
      const failed = results.filter((result) => result.status === "rejected").length;
      const success = results.length - failed;
      showToast(failed ? `Deleted ${success}. Failed ${failed}.` : `Deleted ${success} project(s)`, failed ? "error" : "success");
    }

    if (bulkAction === "status") {
      const statusPrompt = window.prompt(
        `Set status for ${ids.length} project(s):\n${BULK_STATUS_OPTIONS.join(", ")}`,
        statusFilter && BULK_STATUS_OPTIONS.includes(statusFilter) ? statusFilter : BULK_STATUS_OPTIONS[0],
      );
      if (statusPrompt == null) return;
      const nextStatus = statusPrompt.trim();
      if (!BULK_STATUS_OPTIONS.includes(nextStatus)) {
        showToast("Invalid status", "error");
        return;
      }
      const results = await Promise.allSettled(ids.map((id) => api("PUT", `/projects/${id}/status`, { status: nextStatus })));
      const failed = results.filter((result) => result.status === "rejected").length;
      const success = results.length - failed;
      showToast(
        failed ? `Updated ${success}. Failed ${failed}.` : `Updated ${success} project(s) to ${nextStatus}`,
        failed ? "error" : "success",
      );
    }

    setSelectedIds(new Set());
    loadProjects();
    loadDashboard();
  }, [bulkAction, loadDashboard, loadProjects, projects, selectedIds, showToast, statusFilter]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    loadComfyStatus();
  }, [loadComfyStatus]);

  useEffect(() => {
    if (currentTopicId) {
      localStorage.setItem("as_topic_id", currentTopicId);
    } else {
      localStorage.removeItem("as_topic_id");
    }

    if (currentTopicText) {
      localStorage.setItem("as_topic_text", currentTopicText);
    } else {
      localStorage.removeItem("as_topic_text");
    }
  }, [currentTopicId, currentTopicText]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (genOpen) {
        setGenOpen(false);
        setGenPreviewPrompt("");
      }
      else if (previewImage) {
        setPreviewImage(null);
      }
      else if (detailOpen) {
        closeDetail();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [detailOpen, closeDetail, genOpen]);

  useEffect(() => {
    if (!genOpen || !currentTopicId) return;
    setGenPreviewPrompt("");
    const params = new URLSearchParams({ topic_id: currentTopicId, count: String(genCount) });
    if (selectedProfile) params.set("profile", selectedProfile);
    api("GET", `/ideas/preview?${params.toString()}`)
      .then((data) => setGenPreviewPrompt(data.prompt))
      .catch(() => setGenPreviewPrompt(""));
  }, [genOpen, currentTopicId, genCount, selectedProfile]);

  useEffect(() => {
    if (!currentTopicId) {
      setActivePage("splash");
      return;
    }
    if (activePage === "splash") setActivePage("dashboard");
  }, [activePage, currentTopicId]);

  useEffect(() => {
    if (!currentTopicId || activePage !== "dashboard") return;
    loadDashboard();
    loadComfyStatus();
  }, [activePage, currentTopicId, loadDashboard, loadComfyStatus]);

  useEffect(() => {
    if (!currentTopicId || activePage !== "projects") return;
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      loadProjects();
    }, 280);
    return () => clearTimeout(searchTimerRef.current);
  }, [activePage, currentTopicId, loadProjects, search, statusFilter, tagFilter]);

  useEffect(() => {
    if (!currentTopicId || activePage !== "best-shorts") return;
    setBestShorts(readBestShortsCache());
    setBestShortsAnalysis("");
  }, [activePage, currentTopicId, readBestShortsCache]);

  useEffect(() => {
    if (!currentTopicId) return undefined;

    let source = null;
    let retryTimer = null;

    const connect = () => {
      source = new EventSource("/api/events");

      source.onopen = () => {
        setSseMode("idle");
        setSseLabel("connected");
      };

      source.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        if (data.type === "status") {
          const active = Number(data.active || 0);
          setSseMode(active > 0 ? "running" : "idle");
          setSseLabel(active > 0 ? `running (${active})` : "idle");
          return;
        }

        if (data.type === "activity") {
          setActivityLog((prev) => {
            const next = [
              {
                ts: data.ts ? new Date(data.ts * 1000) : new Date(),
                msg: data.msg || "",
                level: data.level || "info",
                project_id: data.project_id || null,
              },
              ...prev,
            ];
            return next.slice(0, ACTIVITY_MAX);
          });
          return;
        }

        if (data.type === "comfy_status") {
          setComfyAvailable(data.available);
          setComfyPaused(!data.available);
          if (data.attempt !== undefined) {
            setComfyRestartAttempts(data.attempt);
          }
          return;
        }

        if (data.type === "project_update") {
          clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = setTimeout(() => {
            loadDashboard();
            if (activePage === "projects") loadProjects();
            if (detailProject?.id === data.project_id) openDetail(data.project_id);
          }, 600);
        }
      };

      source.onerror = () => {
        setSseMode("error");
        setSseLabel("disconnected");
        source.close();
        retryTimer = setTimeout(connect, 4000);
      };
    };

    connect();

    return () => {
      clearTimeout(retryTimer);
      if (source) source.close();
    };
  }, [activePage, currentTopicId, detailProject?.id, loadDashboard, loadProjects, openDetail]);

  const queueLabels = {
    text_queue: "Text / LLM",
    tts_queue: "TTS Audio",
    music_queue: "Music",
    image_queue: "Images",
    render_queue: "Render",
  };

  const queueCounts = dashboard?.queue_counts || {};
  const statusCounts = dashboard?.status_counts || {};
  const schedule = dashboard?.scheduler || {};
  const totalPending = Object.keys(queueLabels).reduce((sum, key) => sum + Number(queueCounts[key] ?? 0), 0);

  const hasTopic = Boolean(currentTopicId);
  const canGenerate = hasTopic && currentTopicId !== "all";

  const currentProfileIdeate = useMemo(() => {
    const profile = profiles.find((p) => p.name === selectedProfile);
    return profile?.prompts_ideate || "";
  }, [profiles, selectedProfile]);

  const currentProfileScript = useMemo(() => {
    const profile = profiles.find((p) => p.name === selectedProfile);
    return profile?.prompts_script || "";
  }, [profiles, selectedProfile]);

  const detailMeta = detailProject?.metadata || {};
  const scenes = detailMeta.scenes || [];

  const sseDotColor = sseMode === "running" ? "var(--bs-success)" : sseMode === "error" ? "var(--bs-danger)" : "var(--bs-secondary)";

  return html`
    <div>
      <nav className="navbar navbar-expand bg-body border-bottom sticky-top px-3 py-0" style=${{ height: 52 }}>
        <span className="navbar-brand fw-bold mb-0"><span className="text-primary">siren</span></span>

        <div className="navbar-nav flex-row gap-1 me-auto">
          <button className=${`btn btn-sm ${activePage === "dashboard" ? "btn-primary" : "btn-outline-secondary"}`} onClick=${() => hasTopic ? setActivePage("dashboard") : showToast("Select a topic first", "error")}>Dashboard</button>
          <button className=${`btn btn-sm ${activePage === "best-shorts" ? "btn-primary" : "btn-outline-secondary"}`} onClick=${() => hasTopic ? setActivePage("best-shorts") : showToast("Select a topic first", "error")}>Best Shorts</button>
          <button className=${`btn btn-sm ${activePage === "projects" ? "btn-primary" : "btn-outline-secondary"}`} onClick=${() => hasTopic ? setActivePage("projects") : showToast("Select a topic first", "error")}>Projects</button>
        </div>

        <div className="d-flex align-items-center gap-2 ms-3" title="Pipeline status">
          <span className="d-inline-block rounded-circle" style=${{ width: 8, height: 8, backgroundColor: sseDotColor }}></span>
          <span className="small text-muted text-nowrap">${sseLabel}</span>
        </div>
        ${comfyAvailable !== null
          ? html`
              <div className="d-flex align-items-center gap-2 border rounded px-2 py-1 ms-3 bg-body" style=${{ borderColor: comfyAvailable ? "var(--bs-success)" : "var(--bs-danger) !important" }} title=${comfyAvailable
                ? "ComfyUI is available"
                : `ComfyUI is unavailable — auto-restart attempts: ${comfyRestartAttempts}/${comfyMaxAttempts}`}
              >
                <span className="d-inline-block rounded-circle" style=${{ width: 8, height: 8, backgroundColor: comfyAvailable ? "var(--bs-success)" : "var(--bs-danger)" }}></span>
                <span className=${`small text-nowrap ${comfyAvailable ? "text-muted" : "text-danger"}`}>${comfyAvailable ? "ComfyUI" : "ComfyUI down"}</span>
                ${comfyPaused
                  ? html`
                      <span className="badge text-bg-secondary font-monospace" title=${`Auto-restart: ${comfyRestartAttempts}/${comfyMaxAttempts}`}>${comfyRestartAttempts}/${comfyMaxAttempts}</span>
                      <button className="btn btn-sm btn-outline-primary" onClick=${restartComfy}>Restart ComfyUI</button>
                    `
                  : null}
              </div>
            `
          : null}
      </nav>

      <div className="d-flex">
        <${ProfilePanel} profiles=${profiles} selectedProfile=${selectedProfile} onSelectProfile=${setSelectedProfile} topics=${topics} currentTopicId=${currentTopicId} onTopicSelect=${(id, text) => { setCurrentTopicId(id); setCurrentTopicText(text); }} onAddTopic=${addTopic} onDeleteTopic=${deleteTopic} profileTopics=${profileTopics} />
        <main className="flex-grow-1 p-3" style=${{ maxWidth: 1400 }}>
        <div className=${`${activePage === "splash" ? "d-block" : "d-none"}`}>
          <div className="d-flex flex-column align-items-center justify-content-center text-center gap-3 py-5">
            <div className="fs-1 opacity-75">[ ]</div>
            <div className="h5 fw-semibold mb-0">No topic selected</div>
            <div className="text-muted">Choose or create a topic workspace using the dropdown in the nav bar.</div>
          </div>
        </div>

        <div className=${`${activePage === "dashboard" ? "d-block" : "d-none"}`}>
          <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-3">
            <h2 className="h6 text-uppercase text-muted fw-semibold mb-0">${selectedProfile || "default"} · ${currentTopicText || "this topic"}</h2>
            <button className="btn btn-primary btn-sm" disabled=${!canGenerate} onClick=${() => {
              setGeneratedIdeas([]);
              setGenCount(5);
              setGenOpen(true);
            }}>Generate Ideas</button>
          </div>

          <div className="d-flex flex-wrap gap-3 mb-3 align-items-center">
            <div className="d-flex flex-column align-items-center px-3 py-2 border rounded bg-body" style=${{ minWidth: 80 }}><span className="fs-4 fw-bold">${dashboard?.total ?? "-"}</span><span className="small text-muted text-uppercase">Total</span></div>
            <div className="d-flex flex-column align-items-center px-3 py-2 border rounded bg-body" style=${{ minWidth: 80 }}><span className="fs-4 fw-bold text-success">${statusCounts.rendered ?? "-"}</span><span className="small text-muted text-uppercase">Rendered</span></div>
            <div className="d-flex flex-column align-items-center px-3 py-2 border rounded bg-body" style=${{ minWidth: 80 }}><span className="fs-4 fw-bold text-danger">${statusCounts.failed ?? "-"}</span><span className="small text-muted text-uppercase">Failed</span></div>
            ${statusCounts.failed > 0
              ? html`<button className="btn btn-sm btn-outline-danger" onClick=${recoverFailed}>Recover Failed</button>`
              : null}
            <div className="d-flex flex-column align-items-center px-3 py-2 border rounded bg-body" style=${{ minWidth: 80 }}><span className="fs-4 fw-bold" style=${{ color: "#818cf8" }}>${statusCounts.idea ?? "-"}</span><span className="small text-muted text-uppercase">Ideas</span></div>
          </div>

          <h2 className="h6 text-uppercase text-muted fw-semibold mb-3">Upload Schedule</h2>
          <div className="border rounded p-3 mb-3 bg-body">
            <div className="d-flex justify-content-end mb-2">
              <span className=${`badge ${schedule.enabled ? "text-bg-success" : "text-bg-secondary"}`}>${schedule.enabled ? "Enabled" : "Disabled"}</span>
            </div>
            <div className="d-flex gap-2 mb-2">
              <span className="small text-uppercase text-muted fw-semibold" style=${{ width: 92 }}>Cron</span>
              <span className="font-monospace">${schedule.upload_rendered_cron || "-"}</span>
            </div>
            <div className="d-flex gap-2 mb-2 align-items-center">
              <span className="small text-uppercase text-muted fw-semibold" style=${{ width: 92 }}>Next runs</span>
              <span className="d-flex flex-wrap gap-2">
                ${Array.isArray(schedule.next_runs) && schedule.next_runs.length
                  ? schedule.next_runs.map((item) => html`<span className="badge text-bg-secondary" key=${item}>${fmtScheduleDate(item)}</span>`)
                  : html`<span className="text-muted">No upcoming times</span>`}
              </span>
            </div>
            ${schedule.parse_error ? html`<div className="text-warning small">${schedule.parse_error}</div>` : null}
          </div>

          ${currentProfileScript ? html`
          <h2 className="h6 text-uppercase text-muted fw-semibold mb-3">Script Prompt</h2>
          <div className="border rounded p-3 mb-3 bg-body">
            <div className="d-flex gap-2">
              <span className="small text-uppercase text-muted fw-semibold" style=${{ width: 92 }}>Strategy</span>
              <span className="s-pre">${currentProfileScript}</span>
            </div>
          </div>
          ` : null}

          <h2 className="h6 text-uppercase text-muted fw-semibold mb-3">Pipeline</h2>
          <div className="d-flex overflow-auto mb-3">
            ${PIPELINE_STATUSES.map((status, idx) => html`
              <div key=${status} className=${`flex-fill text-center border p-2 bg-body ${idx === 0 ? "rounded-start" : ""} ${idx === PIPELINE_STATUSES.length - 1 ? "rounded-end" : ""}`} style=${{ minWidth: 90, borderTop: `3px solid ${statusColor(status)}` }}>
                <div className="fs-4 fw-bold" style=${{ color: statusColor(status) }}>${statusCounts[status] ?? 0}</div>
                <div className="small text-muted text-nowrap text-truncate">${status.replace(/_/g, " ")}</div>
              </div>
            `)}
          </div>

          <h2 className="h6 text-uppercase text-muted fw-semibold mb-3">Batch Queues</h2>
          <div className="row g-2 mb-3 row-cols-2 row-cols-md-5">
            ${Object.entries(queueLabels).map(([key, label]) => {
              const count = Number(queueCounts[key] ?? 0);
              return html`
                <div className="col" key=${key}>
                  <div className="border rounded p-3 d-flex flex-column bg-body h-100 gap-1">
                    <div className="small text-muted text-uppercase fw-semibold">${label}</div>
                    <div className="fs-3 fw-bold">${count}</div>
                    <div className="small text-muted">pending</div>
                    <button className="btn btn-sm btn-outline-success mt-auto align-self-start" disabled=${count === 0 || queueRunning[key]} onClick=${() => runQueue(key)}>Run</button>
                  </div>
                </div>
              `;
            })}
            <div className="col">
              <div className="border rounded p-3 d-flex flex-column bg-body h-100 gap-1">
                <div className="small text-muted text-uppercase fw-semibold">Full Pipeline</div>
                <div className="fs-3 fw-bold">${totalPending}</div>
                <div className="small text-muted">projects ready</div>
                <button className="btn btn-sm btn-outline-success mt-auto align-self-start" disabled=${totalPending === 0 || queueRunning.all} onClick=${() => runQueue("all")}>Run All</button>
              </div>
            </div>
          </div>

          <h2 className="h6 text-uppercase text-muted fw-semibold mb-3">Activity</h2>
          <div className="border rounded bg-body p-1 overflow-auto mb-3" style=${{ maxHeight: 240 }}>
            ${activityLog.length
              ? activityLog.map((entry, index) => html`
                  <div key=${`${entry.ts.toISOString()}-${index}`} className=${`d-flex gap-2 px-2 py-1 rounded align-items-baseline ${entry.level === "success" ? "text-success" : entry.level === "error" ? "text-danger" : entry.level === "warning" ? "text-warning" : ""}`}>
                    <span className="small text-muted font-monospace text-nowrap" style=${{ minWidth: "8ch" }}>${entry.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className="flex-grow-1">${entry.msg}</span>
                    ${entry.project_id ? html`<span className="small font-monospace text-muted bg-body border rounded px-1 text-nowrap" title=${entry.project_id}>${entry.project_id.slice(0, 8)}</span>` : null}
                  </div>
                `)
              : html`<div className="text-muted small text-center py-2">Waiting for activity...</div>`}
          </div>
        </div>

        <div className=${`${activePage === "best-shorts" ? "d-block" : "d-none"}`}>
          <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-3">
            <div>
              <h2 className="h6 text-uppercase text-muted fw-semibold mb-1">Best Performing Shorts</h2>
              <p className="text-muted mb-0" style=${{ maxWidth: 720 }}>Top YouTube Shorts sorted by views and matched against uploaded projects.</p>
            </div>
          </div>

          <div className="d-flex flex-wrap gap-3 mb-3 align-items-center">
            <button className="btn btn-outline-secondary btn-sm" onClick=${loadBestShorts} disabled=${bestShortsLoading}>${bestShortsLoading ? "Loading..." : "Fetch data"}</button>
            <button className="btn btn-outline-secondary btn-sm" onClick=${analyzeBestShorts} disabled=${bestShortsAnalyzing}>${bestShortsAnalyzing ? "Analyzing..." : "Analyze"}</button>
            <div className="d-flex flex-column align-items-center px-3 py-2 border rounded bg-body" style=${{ minWidth: 80 }}><span className="fs-4 fw-bold">${bestSummary.total || "-"}</span><span className="small text-muted text-uppercase">Rows</span></div>
            <div className="d-flex flex-column align-items-center px-3 py-2 border rounded bg-body" style=${{ minWidth: 80 }}><span className="fs-4 fw-bold text-success">${bestSummary.matched || "-"}</span><span className="small text-muted text-uppercase">Matched</span></div>
            <div className="d-flex flex-column align-items-center px-3 py-2 border rounded bg-body" style=${{ minWidth: 80 }}><span className="fs-4 fw-bold text-warning">${bestSummary.unmatched || "-"}</span><span className="small text-muted text-uppercase">Unmatched</span></div>
          </div>

          ${bestShortsAnalysis
            ? html`
                <div className="border rounded border-start border-4 border-primary p-3 mb-3 bg-body">
                  <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                    <span className="small text-muted text-uppercase fw-semibold">Shorts Analysis</span>
                    <span className="badge text-bg-primary">${bestShortsAnalysisSource}</span>
                  </div>
                  <div className="s-pre">${bestShortsAnalysis}</div>
                </div>
              `
            : null}

          ${!bestShorts.length
            ? html`<div className="text-muted text-center py-5">Click Fetch data to fetch the latest data from YouTube Studio.</div>`
            : html`
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="text-muted small text-uppercase">
                      <tr>
                        <th className="text-nowrap">#</th>
                        <th>Title</th>
                        <th className="text-nowrap">Views</th>
                        <th>Project</th>
                        <th>Status</th>
                        <th className="text-nowrap">Created</th>
                        <th>Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${bestShorts.map((item, index) => html`
                        <tr key=${`${item.title}-${index}`} className=${item.project_id ? "cursor-pointer" : ""} onClick=${() => item.project_id ? openDetail(item.project_id) : null}>
                          <td className="text-nowrap">${index + 1}</td>
                          <td className="text-truncate fw-medium" style=${{ maxWidth: 380 }}>${item.title || "Untitled short"}</td>
                          <td className="text-nowrap">${Number(item.views || 0).toLocaleString()}</td>
                          <td className="text-truncate" style=${{ maxWidth: 380 }}>${item.project_id ? item.project_id.slice(0, 8) : html`<span className="text-muted">Not matched</span>`}</td>
                          <td>${item.status ? badge(item.status) : html`<span className="text-muted">-</span>`}</td>
                          <td className="small text-muted text-nowrap">${fmtDate(item.created_at)}</td>
                          <td className="text-nowrap" onClick=${(e) => e.stopPropagation()}>
                            ${item.url ? html`<a className="btn btn-sm btn-link p-0" href=${item.url} target="_blank" rel="noreferrer">Open</a>` : html`<span className="text-muted">-</span>`}
                          </td>
                        </tr>
                      `)}
                    </tbody>
                  </table>
                </div>
              `}
        </div>

        <div className=${`${activePage === "projects" ? "d-block" : "d-none"}`}>
          <div className="d-flex gap-2 mb-3 align-items-center flex-wrap">
            <input className="form-control form-control-sm flex-grow-1" style=${{ minWidth: 180 }} type="search" placeholder="Search by title..." value=${search} onInput=${(e) => setSearch(e.target.value)} />
            <select className="form-select form-select-sm w-auto" value=${tagFilter} onChange=${(e) => setTagFilter(e.target.value)}>
              <option value="">All tags</option>
              ${allTags.map((tag) => html`<option key=${tag} value=${tag}>${tag}</option>`)}
            </select>
            <select className="form-select form-select-sm w-auto" value=${statusFilter} onChange=${(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              ${PIPELINE_STATUSES.map((status) => html`<option key=${status} value=${status}>${status}</option>`)}
            </select>
            <select className="form-select form-select-sm w-auto" style=${{ minWidth: 170 }} value=${bulkAction} onChange=${(e) => setBulkAction(e.target.value)}>
              <option value="">Bulk action...</option>
              <option value="delete">Bulk delete</option>
              <option value="status">Bulk status update</option>
            </select>
            <button className="btn btn-sm btn-outline-secondary" disabled=${selectedInView === 0 || !bulkAction} onClick=${applyBulkAction}>Apply</button>
            <span className="small text-muted text-nowrap">${selectedInView} selected</span>
          </div>

          ${projectsLoading
            ? html`<div className="text-muted text-center py-5">Loading...</div>`
            : !projects.length
            ? html`<div className="text-muted text-center py-5">No projects yet. Generate ideas to get started.</div>`
            : html`
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="text-muted small text-uppercase">
                      <tr>
                        <th className="text-center" style=${{ width: 42 }}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked=${projects.length > 0 && selectedInView === projects.length}
                            onChange=${(e) => {
                              if (e.target.checked) {
                                setSelectedIds(new Set(projects.map((project) => project.id)));
                              } else {
                                setSelectedIds(new Set());
                              }
                            }}
                            aria-label="Select all projects"
                          />
                        </th>
                        <th>Title</th>
                        <th>Profile</th>
                        <th>Status</th>
                        <th>Tags</th>
                        <th class="text-nowrap">Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${projects.map((project) => html`
                        <tr key=${project.id} className=${`${selectedIds.has(project.id) ? "table-primary" : ""} ${project.status ? "cursor-pointer" : ""}`} onClick=${() => openDetail(project.id)}>
                          <td className="text-center" onClick=${(e) => e.stopPropagation()}>
                            <input
                              className="form-check-input"
                              type="checkbox"
                              checked=${selectedIds.has(project.id)}
                              onChange=${(e) => {
                                const next = new Set(selectedIds);
                                if (e.target.checked) next.add(project.id);
                                else next.delete(project.id);
                                setSelectedIds(next);
                              }}
                              aria-label=${`Select ${project.title}`}
                            />
                          </td>
                          <td className="text-truncate fw-medium" style=${{ maxWidth: 380 }}>${project.title}</td>
                          <td className="text-truncate" style=${{ maxWidth: 380 }}>${project.profile || "-"}</td>
                          <td>${badge(project.status)}</td>
                          <td className="d-flex gap-1 flex-wrap">
                            ${(project.tags || []).length
                              ? project.tags.map((tag) => html`<span key=${tag} className="badge text-bg-primary">${tag}</span>`)
                              : html`<span className="text-muted">-</span>`}
                          </td>
                          <td className="small text-muted text-nowrap">${fmtDate(project.created_at)}</td>
                          <td>
                            <${ProjectActions}
                              project=${project}
                              onApprove=${approveProject}
                              onReject=${rejectProject}
                              onRun=${runPipeline}
                              onRerender=${reRender}
                              onDelete=${deleteProject}
                            />
                          </td>
                        </tr>
                      `)}
                    </tbody>
                  </table>
                </div>
              `}
        </div>
      </main>
      </div>

      <div className=${`modal ${genOpen ? "d-block" : "d-none"}`} tabIndex="-1" style=${{ backgroundColor: "rgba(0,0,0,.6)" }}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Generate Ideas</h5>
              <button className="btn-close" aria-label="Close" onClick=${() => setGenOpen(false)}></button>
            </div>
            <div className="modal-body">
              <div className="text-muted small mb-3">${canGenerate ? `Topic: ${currentTopicText}` : "Select a topic first"}</div>

              ${generatedIdeas.length === 0
                ? html`
                    <div className="text-primary small fw-medium mb-3">${selectedProfile || "default"}</div>
                    <div className="mb-3">
                      <label className="form-label small text-muted">Full Prompt</label>
                      <div className="border rounded p-2 bg-body-tertiary s-pre small">${genPreviewPrompt || "Loading..."}</div>
                    </div>
                    <div className="mb-3">
                      <label className="form-label small text-muted">How many ideas?</label>
                      <div className="d-flex gap-2">
                        ${[3, 5, 8, 10].map((count) => html`
                          <button key=${count} type="button" className=${`btn flex-fill ${genCount === count ? "btn-primary" : "btn-outline-primary"}`} onClick=${() => setGenCount(count)}>${count}</button>
                        `)}
                      </div>
                    </div>
                  `
                : null}

              ${generatedIdeas.length > 0
                ? html`
                    <div className="text-success small mb-2">${generatedIdeas.length} idea(s) created</div>
                    <div className="d-flex flex-column gap-2 mt-3">
                      ${generatedIdeas.map((idea) => html`
                        <div key=${idea.id} className="border rounded p-2 bg-body">
                          <div className="fw-medium">${idea.title}</div>
                          ${idea.metadata?.summary ? html`<div className="small text-muted">${idea.metadata.summary}</div>` : null}
                        </div>
                      `)}
                    </div>
                  `
                : null}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline-secondary" onClick=${() => setGenOpen(false)} disabled=${genLoading}>Cancel</button>
              ${generatedIdeas.length
                ? html`<button className="btn btn-primary" onClick=${() => setGenOpen(false)}>Done</button>`
                : html`<button className="btn btn-primary" onClick=${submitGenerate} disabled=${genLoading || !canGenerate}>${genLoading ? "Generating..." : "Generate"}</button>`}
            </div>
          </div>
        </div>
      </div>

      ${detailOpen && detailProject
        ? html`
            <div className="position-fixed top-0 end-0 bottom-0 bg-body overflow-auto p-4 shadow-lg z-3" style=${{ width: "min(1200px, 95vw)" }}>
              <div className="d-flex align-items-start gap-3 mb-3">
                <div className="flex-grow-1" style=${{ minWidth: 0 }}>
                  ${detailEditing && detailForm
                    ? html`
                        <input className="form-control fw-semibold mb-2" value=${detailForm.title} placeholder="Project title" onInput=${(e) => setFormField("title", e.target.value)} />
                        <input className="form-control form-control-sm" value=${detailForm.profile} list="detail-profile-options" placeholder="Profile" onInput=${(e) => setFormField("profile", e.target.value)} />
                        <datalist id="detail-profile-options">
                          ${profiles.map((p) => html`<option key=${p.name} value=${p.name}></option>`)}
                        </datalist>
                      `
                    : html`
                        <div className="h5 fw-semibold mb-1">${detailProject.title || "Project"}</div>
                        <div className="small text-muted">
                          ${badge(detailProject.status)} <span className="mx-1">·</span> ${detailProject.profile || "default"} <span className="mx-1">·</span> ${detailProject.id} <span className="mx-1">·</span> ${fmtDate(detailProject.created_at)}
                        </div>
                      `}
                </div>
                <button className="btn-close" aria-label="Close" onClick=${closeDetail}></button>
              </div>

              <div className="d-flex gap-2 flex-wrap mb-3 align-items-center">
                ${detailProject.status === "idea" ? html`<button className="btn btn-sm btn-outline-primary" onClick=${() => approveProject(detailProject.id)}>Approve</button>` : null}
                ${["idea", "approved"].includes(detailProject.status) ? html`<button className="btn btn-sm btn-outline-warning" onClick=${() => rejectProject(detailProject.id)}>Reject</button>` : null}
                ${detailProject.status === "approved" ? html`<button className="btn btn-sm btn-outline-success" onClick=${() => runPipeline(detailProject.id)}>Run Pipeline</button>` : null}
                ${["rendered", "failed", "images_ready"].includes(detailProject.status)
                  ? html`<button className="btn btn-sm btn-outline-info" onClick=${() => reRender(detailProject.id)}>Re-render</button>`
                  : null}
                ${detailProject.status === "rendered"
                  ? html`<button className="btn btn-sm btn-outline-success" onClick=${() => uploadToYouTube(detailProject.id)}>Upload to YouTube</button>`
                  : null}
                <button className="btn btn-sm btn-outline-secondary" onClick=${() => openProjectFolder(detailProject.id)}>Open Folder</button>
                <select className="form-select form-select-sm w-auto" value=${detailProject.status} onChange=${(e) => setProjectStatus(detailProject.id, e.target.value)}>
                  ${PIPELINE_STATUSES.map((status) => html`<option key=${status} value=${status}>${status.replace(/_/g, " ")}</option>`)}
                </select>
                ${detailEditing
                  ? html`
                      <button className="btn btn-sm btn-outline-success" onClick=${saveDetail} disabled=${detailSaving}>${detailSaving ? "Saving..." : "Save"}</button>
                      <button className="btn btn-sm btn-outline-secondary" onClick=${cancelEdit} disabled=${detailSaving}>Cancel</button>
                    `
                  : html`<button className="btn btn-sm btn-outline-secondary" onClick=${startEdit}>Edit</button>`}
                <button className="btn btn-sm btn-outline-danger" onClick=${() => deleteProject(detailProject.id)}>Delete</button>
              </div>

              ${detailMeta.video_path
                ? html`
                    <div className="mb-3">
                      <div className="small text-uppercase text-muted fw-semibold mb-2">Preview</div>
                      <div className="border rounded overflow-hidden bg-black">
                        <video className="w-100 d-block" style=${{ maxHeight: 320 }} controls preload="metadata" src=${`/api/projects/${detailProject.id}/video/${encodeURIComponent(detailMeta.video_path.replace(/\\/g, "/").split("/").pop())}`}></video>
                      </div>
                    </div>
                  `
                : null}

              ${detailMeta.error
                ? html`
                    <div className="mb-3">
                      <div className="small text-uppercase text-muted fw-semibold mb-2">Error</div>
                      <div className="border border-danger bg-danger-subtle text-danger rounded p-2 s-pre small">${String(detailMeta.error)}</div>
                    </div>
                  `
                : null}

              <div className="mb-3">
                <div className="small text-uppercase text-muted fw-semibold mb-2">Metadata</div>
                ${detailEditing && detailForm
                  ? html`
                      <div className="d-flex flex-column gap-2">
                        <div>
                          <label className="edit-label form-label small text-uppercase text-muted fw-semibold mb-1">Summary</label>
                          <textarea className="form-control" rows=${3} value=${detailForm.metadata.summary} onInput=${(e) => setFormMeta("summary", e.target.value)}></textarea>
                        </div>
                        <div>
                          <label className="form-label small text-uppercase text-muted fw-semibold mb-1">Transcript</label>
                          <textarea className="form-control" rows=${5} value=${detailForm.metadata.transcript} onInput=${(e) => setFormMeta("transcript", e.target.value)}></textarea>
                        </div>
                        <div>
                          <label className="form-label small text-uppercase text-muted fw-semibold mb-1">Narrator</label>
                          <input className="form-control" value=${detailForm.metadata.narrator} onInput=${(e) => setFormMeta("narrator", e.target.value)} />
                        </div>
                        <div>
                          <label className="form-label small text-uppercase text-muted fw-semibold mb-1">Music prompt</label>
                          <textarea className="form-control" rows=${3} value=${detailForm.metadata.music} onInput=${(e) => setFormMeta("music", e.target.value)}></textarea>
                        </div>
                        <div>
                          <label className="form-label small text-uppercase text-muted fw-semibold mb-1">Visual guide</label>
                          <textarea className="form-control" rows=${4} value=${detailForm.metadata.visual_guide} onInput=${(e) => setFormMeta("visual_guide", e.target.value)}></textarea>
                        </div>
                        <div className="row g-2">
                          <div className="col-6">
                            <label className="form-label small text-uppercase text-muted fw-semibold mb-1">Duration (seconds)</label>
                            <input className="form-control" type="number" value=${detailForm.metadata.duration} onInput=${(e) => setFormMeta("duration", e.target.value)} />
                          </div>
                          <div className="col-6">
                            <label className="form-label small text-uppercase text-muted fw-semibold mb-1">Word count</label>
                            <input className="form-control" type="number" value=${detailForm.metadata.word_count} onInput=${(e) => setFormMeta("word_count", e.target.value)} />
                          </div>
                        </div>
                      </div>
                    `
                  : html`
                      <div className="row g-2">
                        ${Object.entries({
                          Summary: detailMeta.summary,
                          Transcript: detailMeta.transcript,
                          Narrator: detailMeta.narrator,
                          "Music prompt": detailMeta.music,
                          "Visual guide": detailMeta.visual_guide,
                          Duration: detailMeta.duration != null ? `${detailMeta.duration}s` : null,
                          "Word count": detailMeta.word_count,
                        })
                          .filter((entry) => entry[1] != null && String(entry[1]).trim() !== "")
                          .map(([key, value]) => html`
                            <div key=${key} className="col-md-6">
                              <div className="border rounded p-2 bg-body h-100">
                                <div className="small text-muted mb-1">${key}</div>
                                <div className="font-monospace small s-pre text-break">${String(value)}</div>
                              </div>
                            </div>
                          `)}
                      </div>
                    `}
              </div>

              ${(detailProject.tags || []).length || detailEditing
                ? html`
                    <div className="mb-3">
                      <div className="small text-uppercase text-muted fw-semibold mb-2">Tags</div>
                      ${detailEditing && detailForm
                        ? html`<input className="form-control" value=${detailForm.tags} placeholder="Comma separated" onInput=${(e) => setFormField("tags", e.target.value)} />`
                        : html`
                            <div className="d-flex gap-1 flex-wrap">
                              ${detailProject.tags.map((tag) => html`<span key=${tag} className="badge text-bg-primary">${tag}</span>`)}
                            </div>
                          `}
                    </div>
                  `
                : null}

              ${detailMeta.music_path
                ? html`
                    <div className="mb-3">
                      <div className="small text-uppercase text-muted fw-semibold mb-1">Background Music</div>
                      <div className="mt-2">
                        <audio className="w-100" controls preload="none" src=${`/api/projects/${detailProject.id}/audio/${encodeURIComponent(detailMeta.music_path.replace(/\\/g, "/").split("/").pop())}`}></audio>
                      </div>
                      <div className="mt-2">
                        <button className="btn btn-sm btn-outline-warning" onClick=${() => rerunMusic(detailProject.id)}>Regenerate Music</button>
                      </div>
                    </div>
                  `
                : null}

              ${scenes.length
                ? html`
                    <div className="mb-3">
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <span className="small text-uppercase text-muted fw-semibold">Scenes (${scenes.length})</span>
                        <span className="d-flex gap-1">
                          <button className="btn btn-sm btn-outline-warning" onClick=${() => rerunAllImages(detailProject.id)}>All Images</button>
                        </span>
                      </div>
                      <div className="d-flex flex-column gap-2">
                        ${scenes.map((scene, index) => {
                          const imageFile = scene.image_path ? scene.image_path.replace(/\\/g, "/").split("/").pop() : null;
                          const audioFile = scene.audio_path ? scene.audio_path.replace(/\\/g, "/").split("/").pop() : null;
                          return html`
                            <div key=${index} className="border rounded p-2 d-flex gap-2 align-items-start bg-body">
                              ${imageFile
                                ? html` <div className="flex-shrink-0 rounded overflow-hidden cursor-pointer" style=${{ width: 72 }} onClick=${() => setPreviewImage(`/api/projects/${detailProject.id}/image/${encodeURIComponent(imageFile)}`)}>
                                      <img loading="lazy" className="d-block rounded" style=${{ width: 72, height: "auto" }} src=${`/api/projects/${detailProject.id}/image/${encodeURIComponent(imageFile)}`} alt=${`Scene ${index + 1}`} />
                                    </div>
                                  `
                                : null}
                              <div className="flex-grow-1" style=${{ minWidth: 0 }}>
                                <div className="small text-uppercase text-muted fw-semibold mb-1">Scene ${index + 1}${scene.duration != null ? ` · ${scene.duration}s` : ""}</div>
                                <div className="mb-1">${scene.voiceover || ""}</div>
                                ${scene.image_prompt ? html`<div className="small text-muted fst-italic mb-1">${scene.image_prompt}</div>` : null}
                                ${audioFile
                                  ? html`
                                      <div className="mt-1">
                                        <audio className="w-100" style=${{ height: 28 }} controls preload="none" src=${`/api/projects/${detailProject.id}/audio/${encodeURIComponent(audioFile)}`}></audio>
                                      </div>
                                    `
                                  : null}
                                <div className="d-flex gap-2 flex-wrap mt-2">
                                  <button className="btn btn-sm btn-outline-warning" onClick=${() => rerunSceneImage(detailProject.id, index)}>Image</button>
                                  ${imageFile
                                    ? html`<button className="btn btn-sm btn-outline-danger" title="Remove generated image" onClick=${() => removeSceneImage(detailProject.id, index)}>Remove</button>`
                                    : null}
                                </div>
                              </div>
                            </div>
                          `;
                        })}
                      </div>
                    </div>
                  `
                : null}
            </div>
          `
        : null}

      ${previewImage
        ? html`
            <div className="position-fixed top-0 start-0 w-100 h-100 bg-black d-flex align-items-center justify-content-center cursor-pointer" style=${{ zIndex: 1040 }} onClick=${() => setPreviewImage(null)}>
              <img src=${previewImage} alt="Preview" className="rounded" style=${{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain" }} />
            </div>
          `
        : null}

      <div className=${`toast align-items-center text-bg-${toastState.type === "error" ? "danger" : "success"} border-0 position-fixed bottom-0 start-50 translate-middle-x mb-3 ${toastState.msg ? "show" : "d-none"}`} role="alert" style=${{ zIndex: 1080 }}>
        <div className="d-flex">
          <div className="toast-body">${toastState.msg}</div>
        </div>
      </div>
    </div>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
