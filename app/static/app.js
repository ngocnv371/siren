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
  "media_ready",
  "clips_ready",
  "rendered",
  "uploaded",
  "failed",
];

const BULK_STATUS_OPTIONS = [...PIPELINE_STATUSES];
const BEST_SHORTS_CACHE_PREFIX = "as_best_shorts_v1";
const ACTIVITY_MAX = 60;

function statusColor(status) {
  return {
    idea: "var(--s-idea)",
    approved: "var(--s-approved)",
    content_ready: "var(--s-content_ready)",
    scenes_ready: "var(--s-scenes_ready)",
    tts_ready: "var(--s-tts_ready)",
    music_ready: "var(--s-music_ready)",
    images_ready: "var(--s-images_ready)",
    media_ready: "var(--s-media_ready)",
    clips_ready: "var(--s-clips_ready)",
    rendered: "var(--s-rendered)",
    uploaded: "var(--s-uploaded)",
    failed: "var(--s-failed)",
  }[status] || "var(--text)";
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
  return html`<span className=${`badge badge-${status}`}>${status.replace(/_/g, " ")}</span>`;
}

function ProjectActions({ project, onApprove, onReject, onRun, onRerender, onDelete }) {
  return html`
    <div className="td-actions" onClick=${(e) => e.stopPropagation()}>
      ${project.status === "idea"
        ? html`<button className="btn-sm approve" onClick=${() => onApprove(project.id)}>Approve</button>`
        : null}
      ${["idea", "approved"].includes(project.status)
        ? html`<button className="btn-sm reject" onClick=${() => onReject(project.id)}>Reject</button>`
        : null}
      ${project.status === "approved"
        ? html`<button className="btn-sm run" onClick=${() => onRun(project.id)}>Run</button>`
        : null}
      ${["rendered", "uploaded", "failed", "media_ready", "images_ready", "clips_ready"].includes(project.status)
        ? html`<button className="btn-sm rerender" onClick=${() => onRerender(project.id)}>Re-render</button>`
        : null}
      <button className="btn-sm delete" onClick=${() => onDelete(project.id)}>Delete</button>
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
    <div className="profile-sidebar">
      <div className="profile-sidebar-header">
        <div className="profile-sidebar-title">Profiles</div>
      </div>
      ${profiles.length
        ? html`
            <div className="profile-list">
              ${profiles.map((profile) => html`
                <div
                  key=${profile.name}
                  className=${`profile-card ${profile.name === selectedProfile ? "is-selected" : ""}`}
                  onClick=${() => onSelectProfile(profile.name)}
                >
                  <div className="profile-card-info">
                    <span className="profile-card-name">${profile.name}</span>
                    ${profile.youtube_name ? html`<span className="profile-card-subtitle">${profile.youtube_name}</span>` : null}
                  </div>
                </div>
              `)}
            </div>
          `
        : html`<div className="profile-panel-empty">No profiles configured.</div>`}

      ${selectedProfile ? html`
        <div className="topics-sidebar-section">
          <div className="topics-sidebar-header">
            <div className="topics-sidebar-title">Topics (${profileTopics.length})</div>
          </div>
          <div className="topics-sidebar-list">
            ${profileTopics.length
              ? profileTopics.map((topic) => html`
                  <div
                    key=${topic.id}
                    className=${`topic-sidebar-item ${topic.id === currentTopicId ? "is-selected" : ""}`}
                    onClick=${() => onTopicSelect(topic.id, topic.topic)}
                  >
                    <span className="topic-sidebar-text" title=${topic.topic}>${topic.topic}</span>
                    <button className="topic-sidebar-del" title="Delete" onClick=${(e) => {
                      e.stopPropagation();
                      onDeleteTopic(topic.id);
                    }}>x</button>
                  </div>
                `)
              : html`<div className="topic-sidebar-empty">No topics for this profile.</div>`}
          </div>
          <div className="topic-sidebar-add">
            <input
              className="topic-sidebar-input"
              value=${newTopicText}
              placeholder="New topic..."
              onInput=${(e) => setNewTopicText(e.target.value)}
              onKeyDown=${(e) => {
                if (e.key === "Enter") handleAddTopic();
              }}
            />
            <button className="topic-sidebar-btn" onClick=${handleAddTopic}>+</button>
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
      setDetailOpen(true);
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [showToast]);

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
        setDetailOpen(false);
        setDetailProject(null);
      }
      refreshVisibleData();
    } catch (e) {
      showToast(e.message, "error");
    }
  }, [detailProject?.id, refreshVisibleData, showToast]);

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
      else if (detailOpen) {
        setDetailOpen(false);
        setDetailProject(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [detailOpen, genOpen]);

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
  }, [activePage, currentTopicId, loadDashboard]);

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

  const detailMeta = detailProject?.metadata || {};
  const scenes = detailMeta.scenes || [];

  return html`
    <div>
      <nav>
        <div className="brand"><span>siren</span></div>

        <div className="nav-tabs">
          <button className=${`nav-tab ${activePage === "dashboard" ? "active" : ""}`} onClick=${() => hasTopic ? setActivePage("dashboard") : showToast("Select a topic first", "error")}>Dashboard</button>
          <button className=${`nav-tab ${activePage === "best-shorts" ? "active" : ""}`} onClick=${() => hasTopic ? setActivePage("best-shorts") : showToast("Select a topic first", "error")}>Best Shorts</button>
          <button className=${`nav-tab ${activePage === "projects" ? "active" : ""}`} onClick=${() => hasTopic ? setActivePage("projects") : showToast("Select a topic first", "error")}>Projects</button>
        </div>

        <div className="nav-spacer"></div>
        <div className="sse-indicator" title="Pipeline status">
          <div className=${`sse-dot ${sseMode}`}></div>
          <span className="sse-label">${sseLabel}</span>
        </div>
      </nav>

      <div className="page-layout">
        <${ProfilePanel} profiles=${profiles} selectedProfile=${selectedProfile} onSelectProfile=${setSelectedProfile} topics=${topics} currentTopicId=${currentTopicId} onTopicSelect=${(id, text) => { setCurrentTopicId(id); setCurrentTopicText(text); }} onAddTopic=${addTopic} onDeleteTopic=${deleteTopic} profileTopics=${profileTopics} />
        <main>
        <div className=${`page ${activePage === "splash" ? "active" : ""}`}>
          <div className="splash">
            <div className="splash-icon">[ ]</div>
            <div className="splash-title">No topic selected</div>
            <div className="splash-sub">Choose or create a topic workspace using the dropdown in the nav bar.</div>
          </div>
        </div>

        <div className=${`page ${activePage === "dashboard" ? "active" : ""}`}>
          <div className="section-header">
            <div>
              <h2>${selectedProfile || "default"} · ${currentTopicText || "this topic"}</h2>
            </div>
            <button className="btn-generate" disabled=${!canGenerate} onClick=${() => {
              setGeneratedIdeas([]);
              setGenCount(5);
              setGenOpen(true);
            }}>Generate Ideas</button>
          </div>

          <div className="summary-row">
            <div className="summary-chip"><div className="num">${dashboard?.total ?? "-"}</div><div className="lbl">Total</div></div>
            <div className="summary-chip"><div className="num" style=${{ color: "var(--success)" }}>${statusCounts.rendered ?? "-"}</div><div className="lbl">Rendered</div></div>
            <div className="summary-chip"><div className="num" style=${{ color: "var(--danger)" }}>${statusCounts.failed ?? "-"}</div><div className="lbl">Failed</div></div>
            <div className="summary-chip"><div className="num" style=${{ color: "var(--s-idea)" }}>${statusCounts.idea ?? "-"}</div><div className="lbl">Ideas</div></div>
          </div>

          <h2>Upload Schedule</h2>
          <div className="schedule-card">
            <div className="schedule-header">
              <span className=${`schedule-state ${schedule.enabled ? "is-on" : "is-off"}`}>${schedule.enabled ? "Enabled" : "Disabled"}</span>
            </div>
            <div className="schedule-row">
              <span className="schedule-label">Cron</span>
              <span className="schedule-value">${schedule.upload_rendered_cron || "-"}</span>
            </div>
            <div className="schedule-row">
              <span className="schedule-label">Next runs</span>
              <span className="schedule-runs">
                ${Array.isArray(schedule.next_runs) && schedule.next_runs.length
                  ? schedule.next_runs.map((item) => html`<span className="schedule-pill" key=${item}>${fmtScheduleDate(item)}</span>`)
                  : html`<span className="text-muted">No upcoming times</span>`}
              </span>
            </div>
            ${schedule.parse_error ? html`<div className="schedule-error">${schedule.parse_error}</div>` : null}
          </div>

          <h2>Pipeline</h2>
          <div className="pipeline">
            ${PIPELINE_STATUSES.map((status) => html`
              <div key=${status} className="pipeline-step" style=${{ borderTop: `3px solid ${statusColor(status)}` }}>
                <div className="step-count" style=${{ color: statusColor(status) }}>${statusCounts[status] ?? 0}</div>
                <div className="step-label">${status.replace(/_/g, " ")}</div>
              </div>
            `)}
          </div>

          <h2>Batch Queues</h2>
          <div className="grid-5">
            ${Object.entries(queueLabels).map(([key, label]) => {
              const count = Number(queueCounts[key] ?? 0);
              return html`
                <div className="queue-card" key=${key}>
                  <div className="queue-name">${label}</div>
                  <div className="queue-count">${count}</div>
                  <div className="queue-label">pending</div>
                  <button className="queue-run" disabled=${count === 0 || queueRunning[key]} onClick=${() => runQueue(key)}>Run</button>
                </div>
              `;
            })}
            <div className="queue-card">
              <div className="queue-name">Full Pipeline</div>
              <div className="queue-count">${totalPending}</div>
              <div className="queue-label">projects ready</div>
              <button className="queue-run" disabled=${totalPending === 0 || queueRunning.all} onClick=${() => runQueue("all")}>Run All</button>
            </div>
          </div>

          <h2>Activity</h2>
          <div className="activity-log">
            ${activityLog.length
              ? activityLog.map((entry, index) => html`
                  <div key=${`${entry.ts.toISOString()}-${index}`} className=${`activity-entry level-${entry.level}`}>
                    <span className="activity-time">${entry.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className="activity-msg">${entry.msg}</span>
                    ${entry.project_id ? html`<span className="activity-pid" title=${entry.project_id}>${entry.project_id.slice(0, 8)}</span>` : null}
                  </div>
                `)
              : html`<div className="activity-empty">Waiting for activity...</div>`}
          </div>
        </div>

        <div className=${`page ${activePage === "best-shorts" ? "active" : ""}`}>
          <div className="section-header">
            <div>
              <h2>Best Performing Shorts</h2>
              <p className="section-sub">Top YouTube Shorts sorted by views and matched against uploaded projects.</p>
            </div>
          </div>

          <div className="summary-row best-shorts-summary">
            <button className="btn-secondary" onClick=${loadBestShorts} disabled=${bestShortsLoading}>${bestShortsLoading ? "Loading..." : "Fetch data"}</button>
            <button className="btn-secondary" onClick=${analyzeBestShorts} disabled=${bestShortsAnalyzing}>${bestShortsAnalyzing ? "Analyzing..." : "Analyze"}</button>
            <div className="summary-chip"><div className="num">${bestSummary.total || "-"}</div><div className="lbl">Rows</div></div>
            <div className="summary-chip"><div className="num" style=${{ color: "var(--success)" }}>${bestSummary.matched || "-"}</div><div className="lbl">Matched</div></div>
            <div className="summary-chip"><div className="num" style=${{ color: "var(--warning)" }}>${bestSummary.unmatched || "-"}</div><div className="lbl">Unmatched</div></div>
          </div>

          ${bestShortsAnalysis
            ? html`
                <div className="best-shorts-analysis">
                  <div className="best-shorts-analysis-head">
                    <div className="best-shorts-analysis-title">Shorts Analysis</div>
                    <div className="best-shorts-analysis-badge">${bestShortsAnalysisSource}</div>
                  </div>
                  <div className="best-shorts-analysis-body">${bestShortsAnalysis}</div>
                </div>
              `
            : null}

          ${!bestShorts.length
            ? html`<div className="empty">Click Fetch data to fetch the latest data from YouTube Studio.</div>`
            : html`
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Title</th>
                      <th>Views</th>
                      <th>Project</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${bestShorts.map((item, index) => html`
                      <tr key=${`${item.title}-${index}`} onClick=${() => item.project_id ? openDetail(item.project_id) : null}>
                        <td className="td-rank">${index + 1}</td>
                        <td className="td-title">${item.title || "Untitled short"}</td>
                        <td className="td-views">${Number(item.views || 0).toLocaleString()}</td>
                        <td className="td-title">${item.project_id ? item.project_id.slice(0, 8) : html`<span className="text-muted">Not matched</span>`}</td>
                        <td>${item.status ? badge(item.status) : html`<span className="text-muted">-</span>`}</td>
                        <td className="td-date">${fmtDate(item.created_at)}</td>
                        <td className="td-link" onClick=${(e) => e.stopPropagation()}>
                          ${item.url ? html`<a className="table-link" href=${item.url} target="_blank" rel="noreferrer">Open</a>` : html`<span className="text-muted">-</span>`}
                        </td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              `}
        </div>

        <div className=${`page ${activePage === "projects" ? "active" : ""}`}>
          <div className="toolbar">
            <input className="search-input" type="search" placeholder="Search by title..." value=${search} onInput=${(e) => setSearch(e.target.value)} />
            <select className="select-filter" value=${tagFilter} onChange=${(e) => setTagFilter(e.target.value)}>
              <option value="">All tags</option>
              ${allTags.map((tag) => html`<option key=${tag} value=${tag}>${tag}</option>`)}
            </select>
            <select className="select-filter" value=${statusFilter} onChange=${(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              ${PIPELINE_STATUSES.map((status) => html`<option key=${status} value=${status}>${status}</option>`)}
            </select>
            <select className="select-filter bulk-action-select" value=${bulkAction} onChange=${(e) => setBulkAction(e.target.value)}>
              <option value="">Bulk action...</option>
              <option value="delete">Bulk delete</option>
              <option value="status">Bulk status update</option>
            </select>
            <button className="btn-sm" disabled=${selectedInView === 0 || !bulkAction} onClick=${applyBulkAction}>Apply</button>
            <span className="bulk-selected-count">${selectedInView} selected</span>
          </div>

          ${projectsLoading
            ? html`<div className="empty">Loading...</div>`
            : !projects.length
            ? html`<div className="empty">No projects yet. Generate ideas to get started.</div>`
            : html`
                <table>
                  <thead>
                    <tr>
                      <th className="th-check">
                        <input
                          className="header-check"
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
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${projects.map((project) => html`
                      <tr key=${project.id} className=${selectedIds.has(project.id) ? "is-selected" : ""} onClick=${() => openDetail(project.id)}>
                        <td className="td-check" onClick=${(e) => e.stopPropagation()}>
                          <input
                            className="row-check"
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
                        <td className="td-title">${project.title}</td>
                        <td className="td-title">${project.profile || "-"}</td>
                        <td>${badge(project.status)}</td>
                        <td className="td-tags">
                          ${(project.tags || []).length
                            ? project.tags.map((tag) => html`<span key=${tag} className="tag">${tag}</span>`)
                            : html`<span className="text-muted">-</span>`}
                        </td>
                        <td className="td-date">${fmtDate(project.created_at)}</td>
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
              `}
        </div>
      </main>

      <div className=${`modal-overlay ${genOpen ? "open" : ""}`}>
        <div className="modal">
          <button className="modal-close" onClick=${() => setGenOpen(false)}>x</button>
          <div className="modal-title">Generate Ideas</div>
          <div className="modal-sub">${canGenerate ? `Topic: ${currentTopicText}` : "Select a topic first"}</div>

          ${generatedIdeas.length === 0
            ? html`
                <div style=${{ fontSize: ".78rem", color: "var(--primary)", marginBottom: ".75rem", fontWeight: 500 }}>
                  ${selectedProfile || "default"}
                </div>
                <div className="form-field">
                  <label className="form-label">Full Prompt</label>
                  <div className="ideate-prompt-text">${genPreviewPrompt || "Loading..."}</div>
                </div>
                <div className="form-field">
                  <label className="form-label">How many ideas?</label>
                  <div className="count-options">
                    ${[3, 5, 8, 10].map((count) => html`
                      <div key=${count} className=${`count-option ${genCount === count ? "selected" : ""}`} onClick=${() => setGenCount(count)}>${count}</div>
                    `)}
                  </div>
                </div>
              `
            : null}

          ${generatedIdeas.length > 0
            ? html`
                <div style=${{ fontSize: ".8rem", color: "var(--success)", marginBottom: ".5rem" }}>
                  ${generatedIdeas.length} idea(s) created
                </div>
                <div className="generated-list">
                  ${generatedIdeas.map((idea) => html`
                    <div key=${idea.id} className="gen-item">
                      <div className="gen-title">${idea.title}</div>
                      ${idea.metadata?.summary ? html`<div className="gen-summary">${idea.metadata.summary}</div>` : null}
                    </div>
                  `)}
                </div>
              `
            : null}

          <div className="modal-actions">
            <button className="btn-secondary" onClick=${() => setGenOpen(false)} disabled=${genLoading}>Cancel</button>
            ${generatedIdeas.length
              ? html`<button className="btn-primary" onClick=${() => setGenOpen(false)}>Done</button>`
              : html`<button className="btn-primary" onClick=${submitGenerate} disabled=${genLoading || !canGenerate}>${genLoading ? "Generating..." : "Generate"}</button>`}
          </div>
        </div>
      </div>

      <div className=${`detail-overlay ${detailOpen ? "open" : ""}`} onClick=${() => {
        setDetailOpen(false);
        setDetailProject(null);
      }}></div>
      <div className=${`detail-panel ${detailOpen ? "open" : ""}`}>
        <div className="detail-header">
          <div className="detail-header-info">
            <div className="detail-title">${detailProject?.title || "Project"}</div>
            <div className="detail-meta">
              ${detailProject ? html`${badge(detailProject.status)} · <span className="text-muted">${detailProject.profile || "default"}</span> · <span className="text-muted">${detailProject.id}</span> · ${fmtDate(detailProject.created_at)}` : ""}
            </div>
          </div>
          <button className="detail-close" onClick=${() => {
            setDetailOpen(false);
            setDetailProject(null);
          }}>x</button>
        </div>

        ${detailProject
          ? html`
              <div className="detail-actions">
                ${detailProject.status === "idea" ? html`<button className="btn-sm approve" onClick=${() => approveProject(detailProject.id)}>Approve</button>` : null}
                ${["idea", "approved"].includes(detailProject.status) ? html`<button className="btn-sm reject" onClick=${() => rejectProject(detailProject.id)}>Reject</button>` : null}
                ${detailProject.status === "approved" ? html`<button className="btn-sm run" onClick=${() => runPipeline(detailProject.id)}>Run Pipeline</button>` : null}
                ${["rendered", "failed", "media_ready", "images_ready", "clips_ready"].includes(detailProject.status)
                  ? html`<button className="btn-sm rerender" onClick=${() => reRender(detailProject.id)}>Re-render</button>`
                  : null}
                ${detailProject.status === "rendered"
                  ? html`<button className="btn-sm upload" onClick=${() => uploadToYouTube(detailProject.id)}>Upload to YouTube</button>`
                  : null}
                <button className="btn-sm" onClick=${() => openProjectFolder(detailProject.id)}>Open Folder</button>
                <select className="select-filter status-jump" value=${detailProject.status} onChange=${(e) => setProjectStatus(detailProject.id, e.target.value)}>
                  ${PIPELINE_STATUSES.map((status) => html`<option key=${status} value=${status}>${status.replace(/_/g, " ")}</option>`)}
                </select>
                <button className="btn-sm delete" onClick=${() => deleteProject(detailProject.id)}>Delete</button>
              </div>

              ${detailMeta.video_path
                ? html`
                    <div className="detail-section">
                      <div className="detail-section-title">Preview</div>
                      <div className="video-preview">
                        <video controls preload="metadata" src=${`/api/projects/${detailProject.id}/video/${encodeURIComponent(detailMeta.video_path.replace(/\\/g, "/").split("/").pop())}`}></video>
                      </div>
                    </div>
                  `
                : null}

              <div className="detail-section">
                <div className="detail-section-title">Metadata</div>
                <div className="meta-grid">
                  ${Object.entries({
                    Summary: detailMeta.summary,
                    Transcript: detailMeta.transcript,
                    Narrator: detailMeta.narrator,
                    "Music prompt": detailMeta.music,
                    "Visual guide": detailMeta.visual_guide,
                    Duration: detailMeta.duration != null ? `${detailMeta.duration}s` : null,
                    "Word count": detailMeta.word_count,
                    Error: detailMeta.error,
                  })
                    .filter((entry) => entry[1] != null && String(entry[1]).trim() !== "")
                    .map(([key, value]) => html`
                      <div key=${key} className=${`meta-item ${key === "Error" ? "meta-item-error" : ""}`}>
                        <div className="meta-key">${key}</div>
                        <div className="meta-val pre">${String(value)}</div>
                      </div>
                    `)}
                </div>
              </div>

              ${(detailProject.tags || []).length
                ? html`
                    <div className="detail-section">
                      <div className="detail-section-title">Tags</div>
                      <div className="td-tags">
                        ${detailProject.tags.map((tag) => html`<span key=${tag} className="tag">${tag}</span>`)}
                      </div>
                    </div>
                  `
                : null}

              ${scenes.length
                ? html`
                    <div className="detail-section">
                      <div className="detail-section-title-row">
                        <span className="detail-section-title">Scenes (${scenes.length})</span>
                        <span className="section-title-actions">
                          <button className="btn-sm rerun-asset" onClick=${() => rerunAllImages(detailProject.id)}>All Images</button>
                        </span>
                      </div>
                      <div className="scenes-list">
                        ${scenes.map((scene, index) => {
                          const imageFile = scene.image_path ? scene.image_path.replace(/\\/g, "/").split("/").pop() : null;
                          const audioFile = scene.audio_path ? scene.audio_path.replace(/\\/g, "/").split("/").pop() : null;
                          return html`
                            <div key=${index} className="scene-card">
                              ${imageFile
                                ? html`
                                    <div className="scene-thumb">
                                      <img loading="lazy" src=${`/api/projects/${detailProject.id}/image/${encodeURIComponent(imageFile)}`} alt=${`Scene ${index + 1}`} />
                                    </div>
                                  `
                                : null}
                              <div className="scene-body">
                                <div className="scene-num">Scene ${index + 1}${scene.duration != null ? ` · ${scene.duration}s` : ""}</div>
                                <div className="scene-voiceover">${scene.voiceover || ""}</div>
                                ${scene.image_prompt ? html`<div className="scene-prompt">${scene.image_prompt}</div>` : null}
                                ${audioFile
                                  ? html`
                                      <div className="scene-audio">
                                        <audio controls preload="none" src=${`/api/projects/${detailProject.id}/audio/${encodeURIComponent(audioFile)}`}></audio>
                                      </div>
                                    `
                                  : null}
                                <div className="scene-rerun-actions">
                                  <button className="btn-sm rerun-asset" onClick=${() => rerunSceneImage(detailProject.id, index)}>Image</button>
                                </div>
                              </div>
                            </div>
                          `;
                        })}
                      </div>
                    </div>
                  `
                : null}

              ${detailMeta.music_path
                ? html`
                    <div className="detail-section">
                      <div className="detail-section-title">Background Music</div>
                      <div className="music-audio">
                        <audio
                          controls
                          preload="none"
                          src=${`/api/projects/${detailProject.id}/audio/${encodeURIComponent(detailMeta.music_path.replace(/\\/g, "/").split("/").pop())}`}
                        ></audio>
                      </div>
                      <div style=${{ marginTop: ".4rem" }}>
                        <button className="btn-sm rerun-asset" onClick=${() => rerunMusic(detailProject.id)}>Regenerate Music</button>
                      </div>
                    </div>
                  `
                : null}
            `
          : html`<div className="empty">No content yet.</div>`}
        </main>
      </div>

      <div id="toast" className=${toastState.msg ? `show ${toastState.type}` : ""}>${toastState.msg}</div>
    </div>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
