/* ============================================================
   MediAssist — front-end (vanilla JS + Flask backend)
   ============================================================ */
(function () {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const avatarUrl = (window.MEDIASSIST_URLS && window.MEDIASSIST_URLS.avatar) || "";

  /* ---------- Element refs ---------- */
  const app = $("#app");
  const chatScroll = $("#chatScroll");
  const messages = $("#messages");
  const welcome = $("#welcome");
  const input = $("#composerInput");
  const sendBtn = $("#sendBtn");
  const convTitle = $("#convTitle");
  const chatList = $("#chatList");
  const attachments = $("#attachments");
  const fileInput = $("#fileInput");
  const toastEl = $("#toast");
  
  // Stop generation animation state.
  let isAnimatingResponse = false;
  let stopAnimationRequested = false;
  const originalSendButtonHtml = sendBtn.innerHTML;
  const originalSendButtonAria = sendBtn.getAttribute("aria-label") || "Send message";
  const originalSendButtonTitle = sendBtn.title || "Send";

  /* ---------- State ---------- */
  const state = {
    conversations: [],
    activeId: null,
    pendingFiles: [],
    reports: [],
  };

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-show"), 2600);
  }

  /* ---------- Sidebar collapse / mobile drawer ---------- */
  $("#collapseBtn").addEventListener("click", () => app.classList.toggle("is-collapsed"));
  $("#menuToggle").addEventListener("click", () => app.classList.add("nav-open"));
  $("#scrim").addEventListener("click", () => app.classList.remove("nav-open"));

  /* ---------- View switching ---------- */
  function showView(view) {
    $$(".view").forEach((v) => {
      const isActive = v.id === `view-${view}`;
      v.classList.toggle("is-active", isActive);
      v.hidden = !isActive;
    });
    $$(".nav__item[data-view]").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.view === view)
    );
    app.classList.remove("nav-open");
    if (view === "reports") renderReports();
    if (view === "dashboard" && window.MediAssist && typeof window.MediAssist.refreshDashboard === "function") {
      window.MediAssist.refreshDashboard();
    }
  }
  $$(".nav__item[data-view]").forEach((btn) =>
    btn.addEventListener("click", () => showView(btn.dataset.view))
  );

  /* ---------- Theme toggle ---------- */
  function setTheme(dark) {
    document.documentElement.classList.toggle("theme-dark", dark);
    document.documentElement.classList.toggle("theme-light", !dark);
    const sw = $("#darkSwitch");
    if (sw) {
      sw.classList.toggle("is-on", dark);
      sw.setAttribute("aria-checked", String(dark));
    }
  }
  $("#themeToggle").addEventListener("click", () =>
    setTheme(!document.documentElement.classList.contains("theme-dark"))
  );
  $("#darkSwitch").addEventListener("click", () =>
    setTheme(!document.documentElement.classList.contains("theme-dark"))
  );
  $$(".switch:not(#darkSwitch)").forEach((sw) =>
    sw.addEventListener("click", () => {
      const on = sw.classList.toggle("is-on");
      sw.setAttribute("aria-checked", String(on));
    })
  );

  /* ---------- New chat ---------- */
  function newChat() {
    state.activeId = null;
    messages.innerHTML = "";
    messages.style.display = "none";
    welcome.style.display = "flex";
    convTitle.textContent = "New conversation";
    renderChatList();
    showView("chat");
    input.focus();
  }
  $("#newChatBtn").addEventListener("click", newChat);
  $("#headerNewChat").addEventListener("click", newChat);
  $("#startConversation").addEventListener("click", () => {
    welcome.style.display = "none";
    messages.style.display = "flex";
    input.focus();
  });

  // Share conversation button wiring: add click handler that shares or copies the conversation.
  // Uses native share if available, otherwise falls back to clipboard.
  const shareBtn = $("#shareConversationBtn");
  if (shareBtn) shareBtn.addEventListener("click", shareConversation);

  /**
   * Helper: strip HTML tags from a string by using a temporary DOM node.
   * @param {string} html
   * @returns {string}
   */
  function stripHtml(html) {
    const d = document.createElement("div");
    d.innerHTML = html || "";
    return d.innerText || "";
  }

  /**
   * Share the active conversation.
   * Builds a plain-text representation and uses navigator.share() when supported,
   * otherwise copies the text to the clipboard. Shows a success toast on completion.
   */
  async function shareConversation() {
    const conv = getActiveConversation();
    if (!conv || !conv.messages || conv.messages.length === 0) {
      toast("No conversation to share.");
      return;
    }

    // Build plain-text conversation.
    let text = "";
    conv.messages.forEach((m) => {
      const who = m.role === "user" ? "You:" : "MediAssist:";
      const content = m.text || (m.html ? stripHtml(m.html) : "");
      text += `${who}\n${content}\n\n`;
    });

    // Try native share first.
    if (navigator.share) {
      try {
        await navigator.share({ title: "MediAssist conversation", text });
        toast("Conversation shared");
        return;
      } catch (err) {
        // If native share fails or is dismissed, fall back to clipboard.
      }
    }

    // Fallback: copy to clipboard using Clipboard API.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        toast("Conversation copied");
        return;
      } catch (err) {
        console.error(err);
        toast("Failed to copy conversation");
        return;
      }
    }

    // Last resort: show the text in a prompt so the user can copy it manually.
    try {
      window.prompt("Copy conversation:", text);
    } catch (err) {
      toast("Unable to share conversation");
    }
  }

  /* ---------- Feature cards prefill ---------- */
  $$(".feature-card").forEach((card) =>
    card.addEventListener("click", () => {
      const prompt = card.dataset.prompt || "";
      if (prompt.includes("previous conversations")) {
        showView("chat");
      }
      welcome.style.display = "none";
      messages.style.display = "flex";
      input.value = prompt;
      autoGrow();
      input.focus();
    })
  );

  /* ---------- Composer: auto-grow ---------- */
  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 180) + "px";
  }
  input.addEventListener("input", autoGrow);

  /* ---------- Composer: Enter to send, Shift+Enter newline, IME-safe ---------- */
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (e.nativeEvent && e.nativeEvent.isComposing) return;
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener("click", send);

  /* ---------- Voice input (Web Speech API) ---------- */
  const voiceBtn = $("#voiceBtn");
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isListening = false;
  let voicePrefix = "";

  function setVoiceRecordingState(active) {
    voiceBtn.classList.toggle("recording", active);
    voiceBtn.setAttribute("aria-label", active ? "Stop voice input" : "Voice input");
    voiceBtn.title = active ? "Stop listening" : "Voice input";
  }

  function stopListening() {
    isListening = false;
    if (recognition) {
      try {
        recognition.stop();
      } catch (err) {
        /* already stopped */
      }
    }
    setVoiceRecordingState(false);
  }

  function startListening() {
    voicePrefix = input.value;
    try {
      recognition.start();
      isListening = true;
      setVoiceRecordingState(true);
    } catch (err) {
      if (err.name === "InvalidStateError") {
        recognition.stop();
        setTimeout(startListening, 120);
      } else {
        toast("Could not start voice recognition.");
      }
    }
  }

  function toggleVoiceInput() {
    if (!recognition) {
      toast("Voice input is not supported in this browser.");
      return;
    }
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }

  if (!SpeechRecognition) {
    voiceBtn.addEventListener("click", () => {
      toast("Voice input is not supported in this browser.");
    });
  } else {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || navigator.language || "en-US";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          voicePrefix += transcript;
        } else {
          interim += transcript;
        }
      }
      input.value = voicePrefix + interim;
      autoGrow();
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast("Microphone permission denied.");
        stopListening();
        return;
      }
      if (event.error === "no-speech") {
        toast("No speech detected.");
        return;
      }
      if (event.error === "aborted") return;
      toast("Voice recognition error. Please try again.");
      stopListening();
    };

    recognition.onend = () => {
      if (isListening) {
        try {
          recognition.start();
        } catch (err) {
          stopListening();
        }
      } else {
        setVoiceRecordingState(false);
      }
    };

    voiceBtn.addEventListener("click", toggleVoiceInput);
  }

  /* ---------- Attachments ---------- */
  $("#attachBtn").addEventListener("click", () => fileInput.click());

  function addPendingFiles(fileList) {
    Array.from(fileList).forEach((f) =>
      state.pendingFiles.push({ name: f.name, size: humanSize(f.size), file: f })
    );
    renderPending();
  }

  function renderPending() {
    attachments.hidden = state.pendingFiles.length === 0;
    attachments.innerHTML = state.pendingFiles
      .map(
        (f, i) => `
      <span class="attach-chip">
        ${fileIconSvg()}
        <span>${escapeHtml(f.name)}</span>
        <button data-remove="${i}" aria-label="Remove ${escapeHtml(f.name)}">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </span>`
      )
      .join("");
    $$("[data-remove]", attachments).forEach((btn) =>
      btn.addEventListener("click", () => {
        state.pendingFiles.splice(Number(btn.dataset.remove), 1);
        renderPending();
      })
    );
  }

  /* ---------- Flask: upload report ---------- */
  async function uploadReportFile(file, options = {}) {
    const { showInChat = true, addToReports = true, showProgress = true } = options;

    if (showProgress) {
      uploadProgress.hidden = false;
      $("#uploadFileName").textContent = file.name;
      progressBar.style.width = "40%";
      $("#uploadPct").textContent = "Uploading…";
    }

    const formData = new FormData();
    formData.append("report", file);

    try {
      const response = await fetch("/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (showProgress) {
        progressBar.style.width = "100%";
        $("#uploadPct").textContent = "100%";
        setTimeout(() => {
          uploadProgress.hidden = true;
        }, 400);
      }

      if (addToReports) {
        // Refresh reports from server so IDs and metadata match DB
        try {
          const rres = await fetch('/api/reports');
          const rjson = await rres.json();
          state.reports = (rjson.reports || []).map(r => ({
            id: r.id,
            name: r.filename,
            filename: r.filename,
            filesize: 0,
            date: new Date(r.upload_date).toLocaleDateString(),
            time: new Date(r.upload_date).toLocaleTimeString(),
            uploadedAt: r.upload_date,
            type: r.report_type || determineReportType(r.filename),
            analysis: r.analysis,
            status: "ready",
            favorite: false,
            fileUrl: `/api/reports/${r.id}/download`,
          }));
          renderReports();
          document.dispatchEvent(new CustomEvent("dashboard:reportsUpdated", { detail: { reportCount: state.reports.length } }));
        } catch (err) {
          console.error('Failed to refresh reports', err);
        }
      }

      if (showInChat) {
        welcome.style.display = "none";
        messages.style.display = "flex";
        showView("chat");

        if (!state.activeId) {
          createConversation("Report: " + file.name);
        }

        appendMessage({
          role: "user",
          text: "Uploaded report: " + file.name,
          files: [{ name: file.name, size: humanSize(file.size) }],
        });
        appendMessage({ role: "ai", text: data.reply });
        updateConversationPreview("Report analysis");
        scrollToBottom();
        toast("Report uploaded successfully");
      }

      return data.reply;
    } catch (error) {
      console.error(error);
      if (showProgress) uploadProgress.hidden = true;
      toast("Upload failed.");
      throw error;
    }
  }

  /* ---------- Send message (Flask /chat + /upload) ---------- */
  async function send() {
    // If typing animation is currently active, Stop should end the frontend animation.
    if (isAnimatingResponse) {
      stopAnimationRequested = true;
      return;
    }
    const text = input.value.trim();
    if (!text && state.pendingFiles.length === 0) return;

    welcome.style.display = "none";
    messages.style.display = "flex";

    if (!state.activeId) createConversation(text || "Shared a report");

    const pending = state.pendingFiles.slice();
    const fileMeta = pending.map((f) => ({ name: f.name, size: f.size }));

    appendMessage({ role: "user", text, files: fileMeta.length ? fileMeta : undefined });
    if (text) {
      document.dispatchEvent(new CustomEvent("dashboard:chatMessageAdded", { detail: { text } }));
    }
    input.value = "";
    autoGrow();
    state.pendingFiles = [];
    renderPending();

    const typingEl = appendTyping();
    scrollToBottom();
    sendBtn.disabled = true;

    try {
      let lastUploadReply = "";

      for (const pf of pending) {
        lastUploadReply = await uploadReportFile(pf.file, {
          showInChat: false,
          addToReports: true,
          showProgress: false,
        });
      }

      if (text) {
        const response = await fetch("/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        const data = await response.json();
        typingEl.remove();
        await appendAiMessageAnimated({ role: "ai", text: data.reply });
        updateConversationPreview(text);
      } else if (pending.length > 0) {
        typingEl.remove();
        appendMessage({ role: "ai", text: lastUploadReply });
        updateConversationPreview("Report analysis");
      } else {
        typingEl.remove();
      }

      scrollToBottom();
    } catch (error) {
      console.error(error);
      typingEl.remove();
      appendMessage({
        role: "ai",
        text: "Failed to connect to MediAssist. Please try again.",
      });
      scrollToBottom();
    } finally {
      sendBtn.disabled = false;
    }
  }

  // New helper: switch send button appearance while animation is active.
  function setStopButtonMode(active) {
    if (active) {
      sendBtn.textContent = "Stop";
      sendBtn.setAttribute("aria-label", "Stop generating");
      sendBtn.title = "Stop generating";
      sendBtn.disabled = false;
    } else {
      sendBtn.innerHTML = originalSendButtonHtml;
      sendBtn.setAttribute("aria-label", originalSendButtonAria);
      sendBtn.title = originalSendButtonTitle;
      sendBtn.disabled = false;
    }
  }

  /* ---------- Message rendering ---------- */
  function getActiveConversation() {
    return state.conversations.find((c) => c.id === state.activeId);
  }

  // Change: render assistant replies as Markdown while keeping user messages plain text.
  function renderMessageBody(role, text, html) {
    if (html) return html;
    if (!text) return "";

    if (role === "ai" && window.marked && typeof window.marked.parse === "function") {
      return window.marked.parse(text, { breaks: true });
    }

    return `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`;
  }

  const copyIconSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7h8M8 12h8M8 17h5"/><path d="M19 3h-8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z"/></svg>';

  // New helper: copy assistant response text without HTML tags.
  function copyAiResponseText(button) {
    const bubble = button.closest(".msg__bubble");
    const contentEl = bubble?.querySelector(".msg__content");
    if (!contentEl || !navigator.clipboard) {
      toast("Copy not supported in this browser.");
      return;
    }

    const text = contentEl.innerText.trim();
    if (!text) {
      toast("No response text to copy.");
      return;
    }

    navigator.clipboard
      .writeText(text)
      .then(() => {
        const originalHtml = button.innerHTML;
        button.textContent = "✓ Copied"; // show confirmation
        button.classList.add("is-copied");
        button.disabled = true;
        setTimeout(() => {
          button.innerHTML = originalHtml;
          button.classList.remove("is-copied");
          button.disabled = false;
        }, 2000);
      })
      .catch(() => {
        toast("Unable to copy response.");
      });
  }

  // New helper: stable message IDs for regenerate tracking.
  let messageCounter = 0;
  function createMessageId() {
    messageCounter += 1;
    return `msg-${Date.now()}-${messageCounter}`;
  }

  // New helper: find the prior user prompt before an AI response.
  function getPreviousUserTextAtIndex(messages, aiIndex) {
    for (let i = aiIndex - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") return messages[i].text;
    }
    return null;
  }

  // New helper: regenerate an AI response for the prior user message.
  async function handleRegenerateResponse(button) {
    const msgEl = button.closest(".msg");
    const conv = getActiveConversation();
    if (!msgEl || !conv) return;

    const messageId = msgEl.dataset.messageId;
    const msgIndex = conv.messages.findIndex((m) => m.id === messageId);
    if (msgIndex < 0) return;

    const userText = getPreviousUserTextAtIndex(conv.messages, msgIndex);
    if (!userText) {
      toast("No previous user message available to regenerate.");
      return;
    }

    const insertBeforeEl = msgEl.nextElementSibling;
    msgEl.remove();
    conv.messages.splice(msgIndex, 1);

    const typingEl = appendTyping(insertBeforeEl);
    scrollToBottom();

    try {
      const response = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText }),
      });
      const data = await response.json();
      typingEl.remove();
      await appendAiMessageAnimated(
        { role: "ai", text: data.reply },
        { insertBeforeEl, insertIndex: msgIndex }
      );
    } catch (error) {
      console.error(error);
      typingEl.remove();
      appendMessage({ role: "ai", text: "Failed to regenerate response. Please try again." });
    }
  }

  // New feedback storage constants and helpers.
  const FEEDBACK_STORAGE_KEY = "medassist-ai-feedback";

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function getFeedbackKey(role, text) {
    if (role !== "ai" || !text) return null;
    return `ai-feedback-${hashCode(text)}`;
  }

  function loadFeedbackStore() {
    try {
      return JSON.parse(localStorage.getItem(FEEDBACK_STORAGE_KEY) || "{}") || {};
    } catch (err) {
      return {};
    }
  }

  function saveFeedbackStore(store) {
    try {
      localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(store));
    } catch (err) {
      /* ignore storage errors */
    }
  }

  function getStoredFeedback(key) {
    if (!key) return null;
    return loadFeedbackStore()[key] || null;
  }

  function setStoredFeedback(key, value) {
    if (!key) return;
    const store = loadFeedbackStore();
    if (value) {
      store[key] = value;
    } else {
      delete store[key];
    }
    saveFeedbackStore(store);
  }

  function renderFeedbackButtons(role, feedback) {
    if (role !== "ai") return "";
    return `
      <div class="msg__feedback" role="group" aria-label="Assistant feedback">
        <button class="msg__feedback-btn msg__feedback-btn--helpful" type="button" data-feedback="helpful" aria-pressed="${feedback === "helpful"}">👍 Helpful</button>
        <button class="msg__feedback-btn msg__feedback-btn--not-helpful" type="button" data-feedback="not_helpful" aria-pressed="${feedback === "not_helpful"}">👎 Not Helpful</button>
      </div>
    `;
  }

  function applyFeedbackSelection(container, rating) {
    const buttons = container.querySelectorAll(".msg__feedback-btn");
    buttons.forEach((btn) => {
      const isSelected = btn.dataset.feedback === rating;
      btn.classList.toggle("is-selected", isSelected);
      btn.setAttribute("aria-pressed", String(isSelected));
    });
  }

  function attachFeedbackControls(container, key) {
    if (!key) return;
    const feedbackEl = container.querySelector(".msg__feedback");
    if (!feedbackEl) return;

    const stored = getStoredFeedback(key);
    if (stored) {
      applyFeedbackSelection(container, stored);
    }

    feedbackEl.addEventListener("click", (event) => {
      const btn = event.target.closest(".msg__feedback-btn");
      if (!btn) return;
      const rating = btn.dataset.feedback;
      if (!rating) return;
      setStoredFeedback(key, rating);
      applyFeedbackSelection(container, rating);
    });
  }

  // Append a message object to the DOM and conversation store.
  // `message` is an object: { role, text, html, files, id }
  function appendMessage(message, options = {}) {
    const { role, text, html, files } = message || {};
    const el = document.createElement("div");
    el.className = `msg msg--${role}`;

    const avatar =
      role === "ai"
        ? `<div class="msg__avatar msg__avatar--ai" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v8M8 12h8"/><rect x="3" y="4" width="18" height="16" rx="4"/></svg></div>`
        : `<div class="msg__avatar" aria-hidden="true"><img src="${avatarUrl}" alt="" width="36" height="36"/></div>`;

    // Render body (AI uses Markdown)
    const body = renderMessageBody(role, text, html);

    const fileChips = (files || [])
      .map((f) =>
        `<span class="msg__file">${fileIconSvg()} ${escapeHtml(f.name)} <span class="muted">· ${f.size || ""}</span></span>`
      )
      .join("");

    // Ensure message has an id for later reference
    const messageId = message.id || createMessageId();
    if (!message.id) message.id = messageId;
    el.dataset.messageId = messageId;

    const feedbackKey = getFeedbackKey(role, text);
    const copyButton =
      role === "ai"
        ? `<button class="msg__copy-btn" type="button" aria-label="Copy assistant response">${copyIconSvg}</button>`
        : "";
    const feedbackButtons = role === "ai" ? renderFeedbackButtons(role, getStoredFeedback(feedbackKey)) : "";
    const regenerateButton =
      role === "ai"
        ? `<button class="msg__regenerate-btn" type="button" aria-label="Regenerate assistant response">Regenerate</button>`
        : "";

    el.innerHTML = `${avatar}<div class="msg__bubble"><div class="msg__content">${body}</div>${fileChips}${copyButton}${feedbackButtons}${regenerateButton}</div>`;
    messages.appendChild(el);

    if (!options.restore) {
      const conv = getActiveConversation();
      if (conv) {
        if (!conv.messages) conv.messages = [];
        conv.messages.push({ role, text, html, files: files ? files.map((f) => ({ ...f })) : undefined, id: messageId });
      }
    }

    // Wire copy & regenerate buttons
    $$(".msg__copy-btn", el).forEach((btn) => btn.addEventListener("click", () => copyAiResponseText(btn)));
    $$(".msg__regenerate-btn", el).forEach((btn) => btn.addEventListener("click", () => handleRegenerateResponse(btn)));

    // Attach feedback controls
    attachFeedbackControls(el, feedbackKey);

    // If this is a user message (and not restoring), show an Edit button for the most recent user message.
    if (role === "user" && !options.restore) {
      // Remove other edit buttons so only the latest user message has it
      $$(".msg__edit-btn").forEach((b) => b.remove());

      // Create Edit button and append to this bubble
      const bubble = el.querySelector(".msg__bubble");
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "msg__action msg__edit-btn";
      editBtn.setAttribute("aria-label", "Edit message");
      editBtn.textContent = "Edit";
      bubble.appendChild(editBtn);

      // Edit handler: put message back into composer, remove this user message and the following assistant reply from DOM and conversation history.
      editBtn.addEventListener("click", () => {
        const conv = getActiveConversation();
        // Put text back into input for editing
        input.value = text || "";
        autoGrow();
        input.focus();

        // Remove this user message from DOM and conversation array
        const msgEl = el;
        const nextEl = msgEl.nextElementSibling;
        msgEl.remove();

        if (conv && conv.messages) {
          const idx = conv.messages.findIndex((m) => m.id === messageId);
          if (idx !== -1) {
            // Remove this user message
            conv.messages.splice(idx, 1);
            // If the next stored message is an AI reply, remove it as well
            if (conv.messages[idx] && conv.messages[idx].role === "ai") {
              conv.messages.splice(idx, 1);
            }
          }
        }

        // Remove the assistant reply DOM node if it immediately follows the removed user message
        if (nextEl && nextEl.classList.contains("msg--ai")) {
          nextEl.remove();
        }
      });
    }

    scrollToBottom();
  }

  // Change: create animated AI response text after backend returns full content.
  async function appendAiMessageAnimated({ role, text, html, files }, options = {}) {
    const el = document.createElement("div");
    el.className = `msg msg--${role}`;

    const avatar =
      role === "ai"
        ? `<div class="msg__avatar msg__avatar--ai" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v8M8 12h8"/><rect x="3" y="4" width="18" height="16" rx="4"/></svg></div>`
        : `<div class="msg__avatar" aria-hidden="true"><img src="${avatarUrl}" alt="" width="36" height="36"/></div>`;

    const previousId = options.message?.id;
    const messageId = previousId || createMessageId();
    if (options.message && !options.message.id) options.message.id = messageId;
    el.dataset.messageId = messageId;

    const bubble = document.createElement("div");
    bubble.className = "msg__bubble msg__bubble--animated";
    const feedbackKey = getFeedbackKey(role, text);
    const regenerateButton =
      role === "ai"
        ? `<button class="msg__regenerate-btn" type="button" aria-label="Regenerate assistant response">Regenerate</button>`
        : "";
    bubble.innerHTML = `
      <div class="msg__content">
        <div class="animated-wrapper">
          <span class="animated-text"></span>
          <span class="typing-cursor">|</span>
        </div>
      </div>
      <button class="msg__copy-btn" type="button" aria-label="Copy assistant response" disabled>${copyIconSvg}</button>
      ${renderFeedbackButtons(role, getStoredFeedback(feedbackKey))}
      ${regenerateButton}
    `;

    el.innerHTML = `${avatar}`;
    el.appendChild(bubble);
    if (options.insertBeforeEl) {
      messages.insertBefore(el, options.insertBeforeEl);
    } else {
      messages.appendChild(el);
    }

    const copyBtn = bubble.querySelector(".msg__copy-btn");

    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        copyAiResponseText(copyBtn);
      });
    }
    $$(".msg__regenerate-btn", bubble).forEach((btn) =>
      btn.addEventListener("click", () => {
        handleRegenerateResponse(btn);
      })
    );

    attachFeedbackControls(bubble, feedbackKey);

    const conv = getActiveConversation();
    if (conv) {
      if (!conv.messages) conv.messages = [];
      const messageObject = { role, text, html, files: files ? files.map((f) => ({ ...f })) : undefined, id: messageId };
      if (typeof options.insertIndex === "number") {
        conv.messages.splice(options.insertIndex, 0, messageObject);
      } else {
        conv.messages.push(messageObject);
      }
    }

    // Animate text progressively word-by-word and allow stop to preserve partial output.
    isAnimatingResponse = true;
    stopAnimationRequested = false;
    setStopButtonMode(true);
    const stoppedEarly = await animateText(bubble.querySelector(".animated-text"), text);

    bubble.querySelector(".typing-cursor").remove();

    // Preserve Markdown formatting after animation finishes.
    if (!stoppedEarly) {
      const markdownHtml = renderMessageBody(role, text, html);
      bubble.querySelector(".msg__content").innerHTML = markdownHtml;
    }

    if (copyBtn) {
      copyBtn.disabled = false;
    }

    if (files && files.length) {
      const fileChips = files
        .map(
          (f) =>
            `<span class="msg__file">${fileIconSvg()} ${escapeHtml(f.name)} <span class="muted">· ${f.size || ""}</span></span>`
        )
        .join("");
      bubble.insertAdjacentHTML("beforeend", fileChips);
    }

    const actions =
      role === "ai"
        ? `<div class="msg__actions">
             <button class="msg__action" data-act="copy">Copy</button>
           </div>`
        : "";
    bubble.insertAdjacentHTML("beforeend", actions);

    $$(".msg__action", bubble).forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.act === "copy") {
          navigator.clipboard?.writeText(bubble.innerText);
          toast("Copied to clipboard");
        }
      })
    );

    isAnimatingResponse = false;
    stopAnimationRequested = false;
    setStopButtonMode(false);
    scrollToBottom();
    return el;
  }

  // Change: helper to animate content and auto-scroll while typing.
  function animateText(el, fullText) {
    return new Promise((resolve) => {
      const words = fullText.split(/(\s+)/);
      let idx = 0;
      function step() {
        if (stopAnimationRequested) {
          resolve(true);
          return;
        }
        if (idx >= words.length) {
          resolve(false);
          return;
        }
        el.textContent += words[idx];
        idx += 1;
        scrollToBottom();
        setTimeout(step, 35 + Math.random() * 40);
      }
      step();
    });
  }

  function appendTyping(insertBeforeEl) {
    const el = document.createElement("div");
    el.className = "msg msg--ai";
    el.innerHTML = `
      <div class="msg__avatar msg__avatar--ai" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v8M8 12h8"/><rect x="3" y="4" width="18" height="16" rx="4"/></svg></div>
      <div class="msg__bubble">
        <span class="typing">MediAssist is thinking
          <span class="typing__dots"><span></span><span></span><span></span></span>
        </span>
      </div>`;
    if (insertBeforeEl) {
      messages.insertBefore(el, insertBeforeEl);
    } else {
      messages.appendChild(el);
    }
    return el;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatScroll.scrollTop = chatScroll.scrollHeight;
    });
  }

  /* ---------- Conversations ---------- */
  function createConversation(firstText) {
    const id = "c" + Date.now();
    const title = firstText.length > 34 ? firstText.slice(0, 34) + "…" : firstText;
    state.conversations.unshift({
      id,
      title,
      preview: firstText,
      date: "Just now",
      messages: [],
    });
    state.activeId = id;
    convTitle.textContent = title;
    renderChatList();
  }

  function updateConversationPreview(text) {
    const c = state.conversations.find((conv) => conv.id === state.activeId);
    if (c) {
      c.preview = text;
      renderChatList();
    }
  }

  function openConversation(id) {
    const c = state.conversations.find((conv) => conv.id === id);
    if (!c) return;
    state.activeId = id;
    convTitle.textContent = c.title;
    welcome.style.display = "none";
    messages.style.display = "flex";
    messages.innerHTML = "";
    (c.messages || []).forEach((m) => appendMessage(m, { restore: true }));
    renderChatList();
    showView("chat");
    scrollToBottom();
  }

  function renderChatList() {
    if (state.conversations.length === 0) {
      chatList.innerHTML = `<div class="chat-list__item" style="color:var(--text-2);cursor:default">No conversations yet</div>`;
      return;
    }
    chatList.innerHTML = state.conversations
      .map(
        (c) => `
      <button class="chat-list__item ${c.id === state.activeId ? "is-active" : ""}" data-id="${c.id}">
        <span class="chat-list__title">${escapeHtml(c.title)}</span>
        <span class="chat-list__preview">${escapeHtml(c.preview)} · ${c.date}</span>
      </button>`
      )
      .join("");
    $$(".chat-list__item[data-id]", chatList).forEach((btn) =>
      btn.addEventListener("click", () => openConversation(btn.dataset.id))
    );
  }

  /* ---------- Reports view ---------- */
  const dropzone = $("#dropzone");
  const reportGrid = $("#reportGrid");
  const reportsEmpty = $("#reportsEmpty");
  const uploadProgress = $("#uploadProgress");
  const progressBar = $("#progressBar");

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-drag");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-drag");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length) uploadReportFile(files[0]);
  });

  fileInput.addEventListener("change", (e) => {
    const onReports = $("#view-reports").classList.contains("is-active");
    if (onReports && e.target.files.length) {
      uploadReportFile(e.target.files[0]);
    } else if (e.target.files.length) {
      addPendingFiles(e.target.files);
    }
    fileInput.value = "";
  });

  function renderReports(filter = "") {
    const q = filter.toLowerCase();
    const items = state.reports.filter((r) => {
      return (
        r.name.toLowerCase().includes(q) || (r.type || "").toLowerCase().includes(q) || (r.analysis || "").toLowerCase().includes(q)
      );
    });
    reportsEmpty.hidden = items.length !== 0;
    reportGrid.innerHTML = items
      .map(
        (r, i) => `
      <article class="report-card" data-id="${r.id}" style="animation-delay:${i * 0.04}s">
        <div class="report-card__top">
          <span class="report-card__icon">${fileIconSvg(20)}</span>
          <div style="min-width:0">
            <div class="report-card__name">${escapeHtml(r.name)}</div>
            <div class="report-card__type">${escapeHtml(r.type || determineReportType(r.name))}</div>
          </div>
        </div>
        <div class="report-card__meta">
          <span class="report-card__date">${escapeHtml(r.date || "")} ${escapeHtml(r.time || "")}</span>
          ${healthStatusChip(determineHealthStatus(r.analysis))}
        </div>
        <div class="report-card__summary"><div class="muted">${escapeHtml((r.analysis || "").slice(0, 180))}${(r.analysis||"").length>180? '…':''}</div></div>
        <div class="report-card__meta" style="margin-top:8px;">
          <span class="report-card__size">${humanSize(r.filesize)}</span>
          <span style="flex:1"></span>
          <button class="icon-btn report-fav" data-fav-id="${r.id}" title="Toggle favorite">${r.favorite? '★':'☆'}</button>
        </div>
        <div class="report-card__actions">
          <button class="btn btn--ghost" data-preview-id="${r.id}">Preview</button>
          <button class="btn btn--ghost" data-download-id="${r.id}">Download</button>
          <button class="btn btn--ghost btn--danger" data-delete-id="${r.id}">Delete</button>
        </div>
      </article>`
      )
      .join("");

    // Wire actions: preview, download, delete, favorite
    $$('[data-preview-id]', reportGrid).forEach((btn) => btn.addEventListener('click', () => openReportModal(btn.dataset.previewId)));
    $$('[data-download-id]', reportGrid).forEach((btn) => btn.addEventListener('click', () => downloadReport(btn.dataset.downloadId)));
    $$('[data-delete-id]', reportGrid).forEach((btn) => btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteId;
      if (!confirm('Delete this report?')) return;
      try {
        const res = await fetch(`/api/reports/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        // Remove from local state and refresh UI
        state.reports = state.reports.filter(r => String(r.id) !== String(id));
        renderReports($('#reportSearch').value || '');
        document.dispatchEvent(new CustomEvent('dashboard:reportsUpdated', { detail: { reportCount: state.reports.length } }));
        toast('Report deleted');
      } catch (err) {
        console.error(err);
        toast('Failed to delete report');
      }
    }));
    $$('[data-fav-id]', reportGrid).forEach((btn) => btn.addEventListener('click', () => toggleFavorite(btn.dataset.favId)));
  }

  $("#reportSearch").addEventListener("input", (e) => renderReports(e.target.value));

  function statusChip(status) {
    if (status === "processing") return `<span class="chip chip--processing">Processing</span>`;
    if (status === "review") return `<span class="chip chip--warn">Needs review</span>`;
    return `<span class="chip chip--ok">Ready</span>`;
  }

  /* ---------- Report modal ---------- */
  const modal = $("#reportModal");
  /**
   * Open the report preview modal for a given report id.
   * Shows filename, upload date/time, detected type, AI summary and previews image/pdf when available.
   * @param {string} id
   */
  function openReportModal(id) {
    const report = state.reports.find((r) => r.id === id);
    if (!report) return;
    $("#modalTitle").textContent = report.filename || report.name || "Report preview";
    const status = determineHealthStatus(report.analysis);
    const previewHtmlParts = [];
    previewHtmlParts.push(`<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:12px"><div><strong>${escapeHtml(report.filename)}</strong><div class="muted" style="margin-top:6px">${escapeHtml(report.type || determineReportType(report.filename))} · ${escapeHtml(report.date || "")} ${escapeHtml(report.time || "")}</div></div><div>${healthStatusChip(status)}</div></div>`);

    // If session has an object URL for the raw file, show preview based on extension
    if (report.fileUrl) {
      const ext = (report.filename || "").split('.').pop().toLowerCase();
      if (["png", "jpg", "jpeg", "gif"].includes(ext)) {
        previewHtmlParts.push(`<div style="text-align:center;margin-bottom:12px"><img src="${report.fileUrl}" alt="${escapeHtml(report.filename)}" style="max-width:100%;border-radius:8px;"/></div>`);
      } else if (ext === "pdf") {
        previewHtmlParts.push(`<div style="height:420px;overflow:auto"><embed src="${report.fileUrl}" type="application/pdf" width="100%" height="420px"/></div>`);
      }
    }

    if (report.analysis) {
      previewHtmlParts.push(`<h4>AI summary</h4><div class="msg__summary">${escapeHtml(report.analysis).replace(/\n/g, "<br/>")}</div>`);
    } else {
      previewHtmlParts.push(`<p class="muted">No analysis available for this report.</p>`);
    }

    // Download / Favorite / Delete controls inside modal footer
    previewHtmlParts.push(`<div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn--ghost" id="modalDownload">Download</button><button class="btn btn--ghost" id="modalFavorite">${report.favorite ? 'Unfavorite' : 'Favorite'}</button><button class="btn btn--ghost btn--danger" id="modalDelete">Delete</button></div>`);

    $("#modalBody").innerHTML = previewHtmlParts.join("");
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");

    // Wire modal buttons
    const modalDownload = $("#modalDownload");
    if (modalDownload) modalDownload.addEventListener("click", () => downloadReport(id));
    const modalFav = $("#modalFavorite");
    if (modalFav) modalFav.addEventListener("click", () => { toggleFavorite(id); closeModal(); });
    const modalDel = $("#modalDelete");
    if (modalDel) modalDel.addEventListener("click", async () => { await deleteReport(id); closeModal(); });
  }
  $$("[data-close]", modal).forEach((el) => el.addEventListener("click", closeModal));
  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      app.classList.remove("nav-open");
    }
  });

  /**
   * Download the original uploaded file for the report if available in this session.
   * If not available, informs the user that download isn't present.
   * @param {string} id
   */
  function downloadReport(id) {
    const report = state.reports.find((r) => r.id === id);
    if (!report) return;
    if (report.fileUrl) {
      const a = document.createElement("a");
      a.href = report.fileUrl;
      a.download = report.filename || report.name || "report";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast("Download started");
    } else {
      // fallback: hit server download endpoint
      const a = document.createElement("a");
      a.href = `/api/reports/${id}/download`;
      a.download = report.filename || report.name || "report";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast("Download started");
    }
  }

  /**
   * Delete a report by id. Removes from UI, revokes any object URLs, and updates localStorage.
   * @param {string} id
   */
  async function deleteReport(id) {
    const idx = state.reports.findIndex((r) => String(r.id) === String(id));
    if (idx === -1) return;
    const rep = state.reports[idx];
    // If report exists on server (has numeric id), call API
    try {
      if (rep && rep.id && String(rep.id).match(/^\d+$/)) {
        const res = await fetch(`/api/reports/${rep.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
      }
    } catch (err) {
      console.error('deleteReport API failed', err);
      toast('Failed to delete report on server');
      return;
    }

    // Revoke object URL if any
    if (rep && rep.fileUrl) {
      try {
        URL.revokeObjectURL(rep.fileUrl);
      } catch (e) {
        /* ignore */
      }
    }
    state.reports.splice(idx, 1);
    saveReportsToStorage();
    renderReports($("#reportSearch").value || "");
    renderSavedReports();
    document.dispatchEvent(new CustomEvent('dashboard:reportsUpdated', { detail: { reportCount: state.reports.length } }));
    toast("Report deleted");
  }

  /**
   * Toggle favorite status for a report and persist to localStorage.
   * @param {string} id
   */
  function toggleFavorite(id) {
    const rep = state.reports.find((r) => String(r.id) === String(id));
    if (!rep) return;
    const newFav = !Boolean(rep.favorite);
    // Call server API if report has numeric ID
    (async () => {
      try {
        if (rep && rep.id && String(rep.id).match(/^\d+$/)) {
          const res = await fetch(`/api/reports/${rep.id}/favorite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favorite: newFav }),
          });
          if (!res.ok) throw new Error('Favorite failed');
        }
        rep.favorite = newFav;
        saveReportsToStorage();
        renderReports($("#reportSearch").value || "");
        renderSavedReports();
      } catch (err) {
        console.error('toggleFavorite failed', err);
        toast('Failed to update favorite');
      }
    })();
  }

  /**
   * Render the Saved Reports view based on favorites stored in state.reports.
   */
  function renderSavedReports() {
    const savedPanel = document.querySelector('#view-saved .panel-scroll');
    if (!savedPanel) return;
    const saved = state.reports.filter((r) => r.favorite);
    const container = saved.length
      ? saved
          .map(
            (r) => `
      <article class="report-card" data-id="${r.id}">
        <div class="report-card__top">
          <span class="report-card__icon">${fileIconSvg(20)}</span>
          <div style="min-width:0">
            <div class="report-card__name">${escapeHtml(r.name)}</div>
            <div class="report-card__type">${escapeHtml(r.type)}</div>
          </div>
        </div>
        <div class="report-card__meta">
          <span class="report-card__date">${escapeHtml(r.date || "")} ${escapeHtml(r.time || "")}</span>
          ${healthStatusChip(determineHealthStatus(r.analysis))}
        </div>
        <div class="report-card__actions">
          <button class="btn btn--ghost" data-preview-id="${r.id}">Preview</button>
          <button class="btn btn--ghost" data-download-id="${r.id}">Download</button>
        </div>
      </article>`
          )
          .join("")
      : `<div class="empty"><div class="empty__art"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></div><h3>No saved reports</h3><p class="muted">Favorite a report to keep it here.</p></div>`;
    // Replace the content area inside saved panel after the heading
    const existing = savedPanel.querySelector('.saved-grid');
    if (existing) existing.remove();
    const wrapper = document.createElement('div');
    wrapper.className = 'saved-grid';
    wrapper.innerHTML = container;
    savedPanel.appendChild(wrapper);

    // Wire preview & download buttons
    $$('[data-preview-id]', wrapper).forEach((btn) => btn.addEventListener('click', () => openReportModal(btn.dataset.previewId)));
    $$('[data-download-id]', wrapper).forEach((btn) => btn.addEventListener('click', () => downloadReport(btn.dataset.downloadId)));
  }

  /* ---------- Helpers ---------- */
  function escapeHtml(str = "") {
    return str.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function humanSize(bytes) {
    if (!bytes) return "";
    const kb = bytes / 1024;
    return kb > 1024 ? (kb / 1024).toFixed(1) + " MB" : Math.round(kb) + " KB";
  }
  // LocalStorage key for persisting report metadata
  const REPORTS_STORAGE_KEY = "medassist-reports-v1";

  /**
   * Save report metadata to localStorage (serializes only safe fields).
   * Comments: This excludes session-only fields like file blobs or object URLs.
   */
  function saveReportsToStorage() {
    try {
      const serializable = state.reports.map((r) => {
        const { fileUrl, _fileBlob, _temp, ...rest } = r;
        return rest;
      });
      localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(serializable));
    } catch (err) {
      console.error("saveReportsToStorage:", err);
    }
  }

  /**
   * Load persisted reports from localStorage into `state.reports`.
   * Comments: restores metadata and favorite flags but not raw file data.
   */
  function loadReportsFromStorage() {
    try {
      const raw = JSON.parse(localStorage.getItem(REPORTS_STORAGE_KEY) || "[]");
      if (Array.isArray(raw)) {
        state.reports = raw.map((r) => ({ ...r }));
      } else {
        state.reports = [];
      }
    } catch (err) {
      state.reports = [];
    }
  }

  /**
   * Map filename heuristics to one of the target report types.
   * Returns 'Blood Test', 'CBC', 'MRI', 'X-Ray', 'Prescription', 'Medical Certificate', or 'Other'.
   */
  function determineReportType(name) {
    if (!name) return "Other";
    const n = name.toLowerCase();
    if (n.includes("cbc") || n.includes("complete blood") || n.includes("hemoglobin")) return "CBC";
    if (n.includes("mri")) return "MRI";
    if (n.includes("x-ray") || n.includes("xray") || n.includes("radiograph") || n.includes("ct")) return "X-Ray";
    if (n.includes("prescription") || n.includes("rx")) return "Prescription";
    if (n.includes("certificate") || n.includes("fit note") || n.includes("medical certificate")) return "Medical Certificate";
    if (n.includes("blood") || n.includes("lipid") || n.includes("cholesterol") || n.includes("glucose") || n.includes("metabolic")) return "Blood Test";
    return "Other";
  }

  /**
   * Determine a health status from the AI summary text using simple keyword heuristics.
   * Returns 'Healthy', 'Needs Attention', or 'Doctor Recommended'.
   */
  function determineHealthStatus(summary) {
    if (!summary) return "Healthy";
    const s = summary.toLowerCase();
    if (s.includes("critical") || s.includes("emergency") || s.includes("immediate")) return "Doctor Recommended";
    if (s.includes("elevated") || s.includes("high") || s.includes("low") || s.includes("abnormal") || s.includes("concern") || s.includes("recommend further")) return "Needs Attention";
    return "Healthy";
  }

  /**
   * Render a small status chip for the given health status.
   */
  function healthStatusChip(status) {
    if (status === "Doctor Recommended") return `<span class="chip chip--warn">Doctor Recommended</span>`;
    if (status === "Needs Attention") return `<span class="chip chip--warn">Needs Attention</span>`;
    return `<span class="chip chip--ok">Healthy</span>`;
  }
  function guessType(name) {
    const ext = name.split(".").pop().toLowerCase();
    if (ext === "pdf") return "PDF Document";
    if (["png", "jpg", "jpeg"].includes(ext)) return "Scan / Image";
    return "Document";
  }
  function fileIconSvg(size = 16) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;
  }

  /* ---------- Global API (Flask compatibility) ---------- */
  window.sendMessage = async function sendMessage() {
    const composerInput = document.getElementById("composerInput");
    if (!composerInput) {
      alert("Input box not found!");
      return;
    }
    if (composerInput.value.trim() === "" && state.pendingFiles.length === 0) {
      alert("Please enter a message.");
      return;
    }
    await send();
  };

  window.uploadReport = async function uploadReport() {
    const inputEl = document.getElementById("fileInput");
    const file = inputEl && inputEl.files && inputEl.files[0];
    if (!file) {
      alert("Please select a report first.");
      return;
    }
    try {
      await uploadReportFile(file);
      inputEl.value = "";
    } catch (error) {
      alert("Upload failed.");
    }
  };

  /* ---------- Init ---------- */
  setTheme(true);
  renderChatList();
  // Attempt to load reports from server first, fall back to localStorage
  async function fetchReportsFromServer() {
    try {
      const res = await fetch('/api/reports');
      if (!res.ok) throw new Error('no server');
      const json = await res.json();
      state.reports = (json.reports || []).map(r => ({
        id: r.id,
        name: r.filename,
        filename: r.filename,
        filesize: 0,
        date: new Date(r.upload_date).toLocaleDateString(),
        time: new Date(r.upload_date).toLocaleTimeString(),
        uploadedAt: r.upload_date,
        type: r.report_type || determineReportType(r.filename),
        analysis: r.analysis,
        status: 'ready',
        favorite: false,
        fileUrl: `/api/reports/${r.id}/download`,
      }));
      renderReports();
      renderSavedReports();
      return true;
    } catch (err) {
      console.warn('Could not fetch reports from server, falling back to localStorage', err);
      return false;
    }
  }

  (async () => {
    const ok = await fetchReportsFromServer();
    if (!ok) {
      loadReportsFromStorage();
      renderReports();
      renderSavedReports();
    }
  })();
  messages.style.display = "none";
  window.MediAssistApp = window.MediAssistApp || {};
  window.MediAssistApp.getReports = () => state.reports;

  showView("chat");
})();
