const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const safeUrl = (u) => {
  try {
    const x = new URL(u);
    return ["https:", "http:"].includes(x.protocol) ? x.href : "#";
  } catch {
    return "#";
  }
};
const sourceLink = (u, label = "Official source") =>
  `<a class="source-link" href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
let demoMode = false,
  demoData = null;
const resultsByTab = { discover: null, speakers: null };
let tab = "discover",
  current = null,
  currentJob = null,
  isExample = false,
  saved = [],
  liveSaved = [],
  demoSaved = [];
try {
  demoSaved = JSON.parse(localStorage.getItem("aisc-demo-shortlist") || "[]");
  if (!Array.isArray(demoSaved)) demoSaved = [];
} catch {}
const key = (r) => [r.name, r.company || r.location, r.sourceUrl].join("|");
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").style.display = "block";
  setTimeout(() => ($("#toast").style.display = "none"), 2500);
}
async function saveItem(r) {
  const i = saved.findIndex((x) => key(x) === key(r));
  try {
    if (r.demo) {
      if (i < 0)
        demoSaved.push({
          ...r,
          outreachMessage: "company" in r ? outreach(r) : undefined,
          savedAt: new Date().toISOString(),
        });
      else demoSaved.splice(i, 1);
      localStorage.setItem("aisc-demo-shortlist", JSON.stringify(demoSaved));
      saved = demoSaved;
    } else {
      if (i < 0)
        await json("/api/shortlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...r,
            ...("company" in r ? { outreachMessage: outreach(r) } : {}),
          }),
        });
      else await json("/api/shortlist/" + saved[i].id, { method: "DELETE" });
      liveSaved = await json("/api/shortlist");
      saved = liveSaved;
    }
    $("#saved-count").textContent = saved.length;
    render();
    toast(i < 0 ? "Added to shortlist" : "Removed from shortlist");
  } catch (e) {
    toast(e.message);
  }
}
async function saveDraft(r) {
  const updated = { ...r, outreachMessage: $("#outreach-draft").value };
  try {
    if (r.demo) {
      const i = demoSaved.findIndex((x) => key(x) === key(r));
      if (i < 0) demoSaved.push(updated);
      else demoSaved[i] = updated;
      localStorage.setItem("aisc-demo-shortlist", JSON.stringify(demoSaved));
      saved = demoSaved;
    } else {
      await json("/api/shortlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      liveSaved = await json("/api/shortlist");
      saved = liveSaved;
    }
    r.outreachMessage = updated.outreachMessage;
    $("#saved-count").textContent = saved.length;
    render();
    $("#draft-status").textContent = "Message saved to shortlist.";
  } catch (e) {
    $("#draft-status").textContent = e.message;
  }
}
function setTab(value) {
  tab = value;
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
    b.removeAttribute("aria-current");
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
  });
  $("#research-area").hidden = tab === "saved";
  $("#url-field").hidden = tab !== "speakers";
  $("#event-url").required = tab === "speakers";
  $("#past-field").hidden = tab === "speakers";
  $("#run-button").firstChild.textContent =
    tab === "speakers" ? "Research speakers " : "Find events ";
  $("#notice").textContent = "";
  render();
}
function render() {
  if (!demoMode && tab !== "saved") current = resultsByTab[tab];
  let rows =
    tab === "saved"
      ? saved
      : current
        ? tab === "speakers"
          ? current.speakers
          : current.events
        : [];
  const q = $("#search-results").value.toLowerCase(),
    kind = $("#kind-filter").value;
  rows = rows.filter(
    (r) =>
      (kind === "All" || r.kind === kind) &&
      JSON.stringify(r).toLowerCase().includes(q),
  );
  $("#results-title").innerHTML =
    (tab === "saved" ? "Shortlist" : isExample ? "Demo results" : "Results") +
    ' <span class="count">' +
    rows.length +
    "</span>";
  $("#coverage").textContent =
    tab === "saved"
      ? demoMode
        ? "Fictional demo shortlist"
        : ""
      : isExample
        ? "Fictional demo · Illustrative events, people and companies"
        : "";
  $("#warnings").replaceChildren();
  $("#export").hidden = rows.length === 0;
  $("#search-results").disabled = !(current || tab === "saved");
  $("#kind-filter").disabled = !(current || tab === "saved");
  if (!rows.length) {
    $("#results").innerHTML =
      `<div class="empty"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18M7 14h4M7 17h7"/></svg><h3>${tab === "saved" ? "No saved prospects" : current ? "No matching results" : "No research yet"}</h3><p>${current || tab === "saved" ? "Adjust your filters or save a result." : "Find events or paste a link to get started."}</p></div>`;
    return;
  }
  const person = rows.some((r) => "company" in r);
  $("#results").innerHTML =
    `<table><colgroup><col style="width:20%"><col style="width:21%"><col style="width:29%"><col style="width:14%"><col style="width:16%"></colgroup><thead><tr><th>${person ? "Person / company" : "Event"}</th><th>${person ? "Speaking topic" : "Date / location"}</th><th>Why reach out</th><th>${person ? "Relationship" : "Participation"}</th><th></th></tr></thead><tbody>` +
    rows
      .map((r, i) => {
        const p = "company" in r;
        const isSaved = saved.some((x) => key(x) === key(r));
        return `<tr class="${p ? "person-card" : "event-card"}"><td><strong>${esc(r.name)}</strong>${r.demo ? '<span class="sub">Fictional demo</span>' : ""}<span class="sub">${esc(p ? r.company : r.location)}</span>${p ? '<span class="sub">' + esc(r.role) + "</span>" + linkedinField(r) : ""}</td><td>${esc(p ? r.topic : eventTiming(r))}</td><td><span class="reason">${esc(p ? r.whyReachOut : r.why)}</span></td><td><span class="tag ${r.kind === "Buyer" ? "buyer" : ""}">${esc(p ? r.kind : r.participation)}</span><span class="fit">${esc(r.fit)} fit</span></td><td><div class="actions"><button class="details" data-index="${i}">Details</button><button class="save" data-index="${i}" aria-label="${isSaved ? "Remove from" : "Add to"} shortlist: ${esc(r.name)}" aria-pressed="${isSaved}">${isSaved ? "✓" : "+"}</button></div></td></tr>`;
      })
      .join("") +
    "</tbody></table>";
  document
    .querySelectorAll(".details")
    .forEach((b) => (b.onclick = () => detail(rows[Number(b.dataset.index)])));
  document
    .querySelectorAll(".save")
    .forEach(
      (b) => (b.onclick = () => saveItem(rows[Number(b.dataset.index)])),
    );
  $("#export").onclick = () => exportRows(rows);
}
function eventTiming(r) {
  if (!r.startDate) return "Dates unconfirmed";
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });
  const status =
    (r.endDate || r.startDate) < today
      ? "Past event"
      : r.startDate <= today
        ? "In progress"
        : "Upcoming";
  return `${r.startDate}${r.endDate ? " to " + r.endDate : ""} · ${status}`;
}
function linkedinField(r) {
  if (r.demo)
    return '<span class="sub">LinkedIn profile: demo placeholder</span>';
  if (r.linkedin && /^https:\/\/(www\.)?linkedin\.com\/in\//.test(r.linkedin))
    return sourceLink(r.linkedin, "LinkedIn profile");
  return '<span class="sub">LinkedIn profile not verified</span>';
}
function outreach(r) {
  return (
    saved.find((x) => key(x) === key(r))?.outreachMessage ||
    r.outreachMessage ||
    `Hey ${r.name.split(" ")[0]}, saw you're speaking at ${r.eventName || "[event name]"} about ${r.topic.charAt(0).toLowerCase() + r.topic.slice(1)}. We've found a unique way to [specific outcome] by [how Pirimid does it]. We're currently piloting with [approved customer or customer type]. Would love to get your opinion on it if you're open to it.`
  );
}
function detail(r) {
  const person = "company" in r;
  $("#detail-body").innerHTML =
    `<p class="eyebrow">${r.demo ? "FICTIONAL DEMO · " : ""}${esc(person ? r.kind : r.participation)} / ${esc(r.fit)} FIT</p><h2>${esc(r.name)}</h2><p>${esc(person ? r.company + " · " + r.role : r.location + " · " + eventTiming(r))}</p><h4>${person ? "Speaking topic" : "Why it fits"}</h4><p>${esc(person ? r.topic : r.why)}</p><h4>Source evidence</h4><p>${esc(r.evidence)}</p><p>${r.demo ? "Demo URL: " + esc(r.sourceUrl) : sourceLink(r.sourceUrl)}</p>${person ? `<h4>Why reach out <small>(assessment)</small></h4><p>${esc(r.whyReachOut)}</p><h4>A question worth asking</h4><p class="question">${esc(r.question)}</p><h4>LinkedIn</h4><p>${linkedinField(r)}</p>${r.linkedinEvidenceUrl ? sourceLink(r.linkedinEvidenceUrl, "Profile match evidence") : ""}${!r.demo && !r.linkedin ? sourceLink("https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(r.name + " " + r.company), "Search LinkedIn") + '<p class="sub">Search link only. Verify the person and company.</p>' : ""}<h4>Suggested message</h4><textarea id="outreach-draft" rows="7" aria-label="Suggested outreach message">${esc(outreach(r))}</textarea><p class="sub">Draft only. Replace bracketed text with confirmed claims before sending.</p><button class="secondary" id="copy-message">Copy message</button><button class="secondary" id="save-draft">Save draft</button><p id="draft-status" role="status"></p>` : `<h4>Coverage note</h4><p>${esc(r.caveat || "Review the official source before acting.")}</p><button class="primary" id="research-this-event">Research this event</button>`}`;
  if (person) $("#save-draft").onclick = () => saveDraft(r);
  if (person)
    $("#copy-message").onclick = async () => {
      try {
        await navigator.clipboard.writeText($("#outreach-draft").value);
        toast("Message copied");
      } catch {
        $("#outreach-draft").select();
        toast("Select and copy the message");
      }
    };
  if (!person)
    $("#research-this-event").onclick = () => {
      $("#detail").close();
      setTab("speakers");
      $("#event-url").value = r.sourceUrl;
      if (r.demo) showDemo("speakers", r.sourceUrl);
      $("#event-url").focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  $("#detail").showModal();
}
function exportRows(rows) {
  rows = rows.map((r) =>
    "company" in r ? { ...r, outreachMessage: outreach(r) } : r,
  );
  const fields = [...new Set(rows.flatMap(Object.keys))];
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const csv = [fields, ...rows.map((r) => fields.map((k) => r[k]))]
    .map((r) => r.map(cell).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = isExample ? "aisc-fictional-demo.csv" : "aisc-research.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function json(url, opts) {
  const res = await fetch(url, opts);
  const d = await res.json();
  if (!res.ok) throw Error(d.error || "Request failed.");
  return d;
}
let polling = false;
async function poll(id) {
  if (polling) return;
  polling = true;
  currentJob = id;
  $("#cancel-run").hidden = false;
  $("#run-button").disabled = true;
  $("#notice").textContent = "Researching official sources…";
  try {
    for (;;) {
      const j = await json("/api/jobs/" + id);
      if (j.status !== "running") {
        if (j.status === "completed") {
          resultsByTab[j.input.mode] = j.result;
          current = j.result;
          currentJob = j.id;
          isExample = false;
          $("#notice").textContent = "Research complete.";
          render();
        } else
          $("#notice").textContent = j.error || "Research was interrupted.";
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (e) {
    $("#notice").textContent = e.message;
  } finally {
    polling = false;
    $("#cancel-run").hidden = true;
    $("#run-button").disabled = false;
    loadHistory();
  }
}
let historyLoaded = false;
async function loadHistory() {
  try {
    const jobs = await json("/api/jobs");
    $("#history").innerHTML = jobs.length
      ? jobs
          .map(
            (j, i) =>
              `<div class="history-row"><span>${esc(j.input.mode === "discover" ? "Event discovery" : "Speaker research")} · ${esc(j.input.region)} · ${esc(new Date(j.createdAt).toLocaleString())}</span><span>${j.importedSample ? "Saved sample · " : ""}${esc(j.status)} ${j.status === "completed" ? `<button class="text-button history-open" data-index="${i}">Open</button>` : ""}</span></div>`,
          )
          .join("")
      : "No runs yet.";
    document.querySelectorAll(".history-open").forEach(
      (b) =>
        (b.onclick = () => {
          const j = jobs[Number(b.dataset.index)];
          resultsByTab[j.input.mode] = j.result;
          current = j.result;
          currentJob = j.id;
          isExample = false;
          demoMode = false;
          saved = liveSaved;
          $("#load-example").textContent = "Try demo";
          $("#saved-count").textContent = saved.length;
          setTab(j.input.mode);
          $(".results-section").scrollIntoView({ behavior: "smooth" });
        }),
    );
    if (!historyLoaded) {
      historyLoaded = true;
      for (const mode of ["discover", "speakers"]) {
        const latest = jobs.find(
          (j) => j.status === "completed" && j.input.mode === mode,
        );
        if (latest && !resultsByTab[mode]) resultsByTab[mode] = latest.result;
      }
      if (!demoMode) render();
    }
    const running = jobs.find((j) => j.status === "running");
    if (running && !polling) poll(running.id);
  } catch {
    $("#history").textContent = "Research history could not be loaded.";
  }
}
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      setTab(b.dataset.tab);
      if (demoMode && tab !== "saved") {
        if (tab === "speakers" && !$("#event-url").value)
          $("#event-url").value = demoData.events[0].sourceUrl;
        showDemo(tab, $("#event-url").value.trim());
      }
    }),
);
$("#close-detail").onclick = () => $("#detail").close();
$("#search-results").oninput = render;
$("#kind-filter").onchange = render;
$("#refresh-history").onclick = loadHistory;
$("#saved-count").textContent = saved.length;
function showDemo(mode, url = "") {
  const region = $("#region").value,
    focus = $("#focus").value;
  const events = demoData.events.filter(
    (r) =>
      (region === "United States + Canada" ||
        (region === "Gulf Coast" && r.location === "Houston, TX") ||
        r.country === region) &&
      (focus === "all" || r.market === focus),
  );
  const matched = demoData.events.find((r) => r.sourceUrl === url);
  current = {
    events: mode === "discover" ? events : [],
    speakers:
      mode === "speakers"
        ? demoData.speakers.filter(
            (r) =>
              r.sourceUrl ===
              (matched?.sourceUrl || demoData.events[0].sourceUrl),
          )
        : [],
    warnings: [],
    coverage: "",
  };
  isExample = true;
  currentJob = null;
  $("#search-results").value = "";
  $("#kind-filter").value = "All";
  render();
  $("#notice").textContent =
    mode === "speakers" && !matched
      ? "Demo results use a fictional turnaround event. No website was fetched."
      : "Demo results only. No live research was run.";
}
$("#load-example").onclick = async () => {
  try {
    if (demoMode) {
      demoMode = false;
      isExample = false;
      current = null;
      saved = liveSaved;
      $("#saved-count").textContent = saved.length;
      $("#load-example").textContent = "Try demo";
      $("#service-status").textContent = "API setup required";
      setTab("discover");
      return;
    }
    demoData = await json("/static/demo.json");
    demoMode = true;
    saved = demoSaved;
    $("#saved-count").textContent = saved.length;
    $("#load-example").textContent = "Exit demo";
    $("#service-status").textContent = "Demo · fictional data";
    setTab("discover");
    showDemo("discover");
  } catch (e) {
    $("#notice").textContent = e.message;
  }
};
$("#research-form").onsubmit = async (e) => {
  e.preventDefault();
  if (demoMode) {
    showDemo(tab, $("#event-url").value.trim());
    return;
  }
  $("#notice").textContent = "";
  const payload = {
    mode: tab,
    url: $("#event-url").value.trim(),
    region: $("#region").value,
    focus:
      $("#criteria").value +
      " Focus: " +
      $("#focus").selectedOptions[0].textContent,
    includePast: $("#include-past").checked,
  };
  try {
    const j = await json("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    resultsByTab[payload.mode] = null;
    current = null;
    isExample = false;
    render();
    poll(j.id);
  } catch (e) {
    $("#notice").textContent = e.message;
  }
};
json("/api/status")
  .then((s) => {
    if (demoMode) return;
    $("#service-status").textContent = s.enabled
      ? "Research enabled"
      : "API setup required";
  })
  .catch(() => {
    $("#service-status").textContent = "Research service unavailable";
  });
loadHistory();
$("#cancel-run").onclick = async () => {
  try {
    await json("/api/jobs/" + currentJob + "/cancel", { method: "POST" });
    $("#notice").textContent = "Cancelling research…";
  } catch (e) {
    $("#notice").textContent = e.message;
  }
};
json("/api/shortlist")
  .then((rows) => {
    liveSaved = rows;
    if (!demoMode) {
      saved = liveSaved;
      $("#saved-count").textContent = saved.length;
      render();
    }
  })
  .catch(() => toast("Saved prospects could not be loaded."));
render();
