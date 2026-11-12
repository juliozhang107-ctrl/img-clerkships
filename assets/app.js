(function () {
  "use strict";

  var ENDPOINT = (window.SITE_CONFIG && window.SITE_CONFIG.FEEDBACK_ENDPOINT) || "";
  var STORE_KEY = "clerkship-votes-v1";
  var ALERT_KEY = "clerkship-alerts-v1";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var LETTERS = "ABCDEFGHIJKLMNOP";
  var REPORT_FIELDS = [
    ["closed", "It no longer accepts international students"],
    ["link", "The link is broken or wrong"],
    ["step", "USMLE Step 1 or Step 2"],
    ["english", "English test"],
    ["life_support", "BLS / ACLS"],
    ["fee", "Application fee"],
    ["tuition", "Tuition"],
    ["other", "Something else"]
  ];

  var data = { meta: {}, programs: [] };
  var votes = loadVotes();
  var alerts = loadAlerts(); // program ids this reader asked email alerts for
  var lastEmail = "";       // kept for this visit only, to fill in the next sign-up
  var flowOpen = false;
  var pending = {}; // program ids with a "Yes" answer on its way to the inbox

  // ---------- small helpers ----------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") node.className = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return node;
  }
  function $(id) { return document.getElementById(id); }
  function svg(tag, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }
  function money(v) { return v === null || v === undefined ? null : "$" + Number(v).toLocaleString("en-US"); }
  function monthLabel(ym) {
    var m = /^(\d{4})-(\d{2})/.exec(ym || "");
    return m ? MONTHS[Number(m[2]) - 1] + " " + m[1] : "";
  }
  function dateLabel(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? Number(m[3]) + " " + MONTHS[Number(m[2]) - 1].slice(0, 3) + " " + m[1] : "";
  }
  function loadVotes() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE_KEY));
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }
  function saveVote(id, kind) {
    var d = new Date(), pad = function (n) { return (n < 10 ? "0" : "") + n; };
    votes[id] = { vote: kind, at: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) }; // the reader's own date
    try { localStorage.setItem(STORE_KEY, JSON.stringify(votes)); } catch (e) { /* private mode: keep in memory only */ }
  }
  function loadAlerts() {
    try {
      var v = JSON.parse(localStorage.getItem(ALERT_KEY));
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }
  function hintEnter() {
    return el("span", { class: "hint" }, ["press ", el("strong", { text: "Enter ↵" })]);
  }

  // ---------- sending feedback ----------
  function send(payload) {
    if (!ENDPOINT) return Promise.reject(new Error("The feedback inbox is not connected yet. Please try again later."));
    payload.data_version = data.meta.data_version || "";
    return fetch(ENDPOINT, {
      method: "POST",
      // text/plain keeps this a "simple" request, which Google Apps Script accepts without a preflight
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error("The message could not be sent. Please try again.");
      return res.json().catch(function () { return null; });
    }).then(function (body) {
      // only a clear "ok" from the inbox counts as recorded
      if (!body || body.ok !== true) throw new Error((body && body.error) || "The message could not be confirmed. Please try again.");
      return body;
    }, function (err) {
      if (err instanceof TypeError) throw new Error("No connection to the feedback inbox. Please check your internet and try again.");
      throw err;
    });
  }

  // ---------- full-screen question flow (one question at a time) ----------
  // opts: { context, steps: [{ key, type: "multi"|"text"|"long"|"url"|"email", title, desc, required, choices, placeholder }],
  //         values (answers to start with), onSubmit(values) -> Promise, doneTitle, doneText, onDone(), opener }
  function openFlow(opts) {
    var steps = opts.steps, values = opts.values || {}, index = 0, finished = false, sending = false, closed = false, notified = false, current = null;
    var fill = el("div");
    var stage = el("div", { class: "flow-stage" });
    var trap = el("input", { name: "website", tabindex: "-1", autocomplete: "off" });
    var up = el("button", { type: "button", "aria-label": "Previous question", text: "▲" });
    var down = el("button", { type: "button", "aria-label": "Next question", text: "▼" });
    var closeBtn = el("button", { type: "button", class: "flow-close", "aria-label": "Close", text: "×" });
    var overlay = el("div", { class: "flow", role: "dialog", "aria-modal": "true", "aria-label": opts.context }, [
      el("div", { class: "flow-progress" }, [fill]),
      el("div", { class: "flow-top" }, [el("p", { class: "flow-context", text: opts.context }), closeBtn]),
      stage,
      el("div", { class: "hp", "aria-hidden": "true" }, [trap]),
      el("div", { class: "flow-nav" }, [up, down])
    ]);

    function notify() {
      if (finished && !notified && opts.onDone) { notified = true; opts.onDone(); }
    }
    // fromBack is true when the browser's Back button closed the flow
    function close(fromBack) {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("popstate", onBack);
      overlay.remove();
      document.body.style.overflow = "";
      flowOpen = false;
      if (fromBack !== true && history.state && history.state.flow) history.back();
      notify();
      if (opts.opener && opts.opener.focus && document.contains(opts.opener)) opts.opener.focus();
    }
    function onBack() { close(true); }

    function validate(step, value) {
      if (step.type === "multi") return step.required && !value.length ? "Please choose at least one." : "";
      if (!value) return step.required ? "Please fill this in." : "";
      if (step.type === "url" && !/^https?:\/\/\S+\.\S+$/i.test(value)) return "That link does not look right. It should start with https:// and have no spaces.";
      if (step.type === "email" && !/^\S+@\S+\.\S+$/.test(value)) return "That email does not look right.";
      return "";
    }

    function show(n) {
      index = n;
      var step = steps[n], last = n === steps.length - 1;
      var err = el("p", { class: "q-err", role: "alert" });
      var okBtn = el("button", { type: "button", class: "ok", text: last ? "Submit" : "OK" });
      var body = el("div", { class: "q-body" });
      var read, focusTarget;

      if (step.type === "multi") {
        var picked = (values[step.key] || []).slice();
        var buttons = step.choices.map(function (c, i) {
          var b = el("button", { type: "button", class: "choice", role: "checkbox", "aria-checked": picked.indexOf(c[0]) > -1 ? "true" : "false" }, [
            el("span", { class: "key", "aria-hidden": "true", text: LETTERS[i] }), el("span", { text: c[1] }), el("span", { class: "tick", "aria-hidden": "true", text: "✓" })
          ]);
          b.addEventListener("click", function () { toggle(i); });
          return b;
        });
        var toggle = function (i) {
          var id = step.choices[i][0], at = picked.indexOf(id), b = buttons[i];
          if (at > -1) picked.splice(at, 1); else picked.push(id);
          b.setAttribute("aria-checked", at > -1 ? "false" : "true");
          b.classList.remove("blink"); void b.offsetWidth; b.classList.add("blink");
          err.textContent = "";
        };
        body.appendChild(el("p", { class: "q-pick", text: "Choose as many as you like" }));
        body.appendChild(el("div", { class: "q-choices", role: "group", "aria-label": step.title }, buttons));
        read = function () { return picked.slice(); };
        focusTarget = null; // keep focus on the question itself; the letter keys do the picking
        current = { letters: toggle, count: buttons.length };
      } else {
        var input = step.type === "long"
          ? el("textarea", { class: "q-input", rows: "1", maxlength: "2000", placeholder: step.placeholder || "Type your answer here...", "aria-label": step.title })
          : el("input", { class: "q-input", type: step.type === "text" ? "text" : step.type, maxlength: step.type === "text" ? "200" : "500", placeholder: step.placeholder || "Type your answer here...", "aria-label": step.title, autocomplete: step.type === "email" ? "email" : "off" });
        input.value = values[step.key] || "";
        input.addEventListener("input", function () {
          err.textContent = "";
          if (step.type === "long") { input.style.height = "auto"; input.style.height = input.scrollHeight + "px"; }
        });
        body.appendChild(input);
        if (step.type === "long") body.appendChild(el("p", { class: "q-sub" }, [el("strong", { text: "Shift ⇧ + Enter ↵" }), " to make a line break"]));
        read = function () { return input.value.trim(); };
        focusTarget = input;
        current = { letters: null };
      }

      current.read = read;
      current.next = function () {
        if (sending) return; // one press, one message
        var value = read(), problem = validate(step, value);
        if (problem) { err.textContent = problem; return; }
        values[step.key] = value;
        if (!last) { show(n + 1); return; }
        sending = true; okBtn.disabled = true; okBtn.textContent = "Sending…"; err.textContent = "";
        values.website = trap.value;
        opts.onSubmit(values).then(function () {
          sending = false; finished = true;
          if (closed) notify(); else done();
        }, function (e) {
          sending = false; okBtn.disabled = false; okBtn.textContent = "Submit"; err.textContent = e.message;
        });
      };
      okBtn.addEventListener("click", current.next);

      stage.textContent = "";
      var question = el("div", { class: "q", tabindex: "-1" }, [
        el("div", { class: "q-head" }, [
          el("span", { class: "q-num", "aria-hidden": "true", text: (n + 1) + " →" }),
          el("div", null, [
            el("h2", { class: "q-title", "aria-label": "Question " + (n + 1) + " of " + steps.length + ": " + step.title + (step.required ? " (required)" : ""), text: step.title + (step.required ? " *" : "") }),
            step.desc ? el("p", { class: "q-desc", text: step.desc }) : null
          ])
        ]),
        body, el("div", null, [err]),
        el("div", { class: "q-actions" }, [okBtn, hintEnter()])
      ]);
      stage.appendChild(question);
      if (!focusTarget) focusTarget = question;
      fill.style.width = Math.round((n / steps.length) * 100) + "%";
      up.disabled = n === 0; down.disabled = false;
      down.setAttribute("aria-label", last ? "Submit" : "Next question");
      if (step.type === "long" && focusTarget.value) { focusTarget.style.height = focusTarget.scrollHeight + "px"; }
      focusTarget.focus({ preventScroll: true });
      stage.scrollTop = 0; // always start at the question, also on short screens
    }

    function done() {
      current = { letters: null, next: close };
      var btn = el("button", { type: "button", class: "ok", text: "Close" });
      btn.addEventListener("click", close);
      stage.textContent = "";
      stage.appendChild(el("div", { class: "q q-done" }, [
        el("h2", { class: "q-title", text: opts.doneTitle }),
        el("p", { class: "q-desc", text: opts.doneText }),
        el("div", { class: "q-actions" }, [btn, hintEnter()])
      ]));
      fill.style.width = "100%";
      up.disabled = true; down.disabled = true;
      btn.focus();
    }

    function onKey(ev) {
      var typing = /^(INPUT|TEXTAREA)$/.test(ev.target.tagName);
      if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
        if (ev.target === closeBtn || ev.target === up || ev.target === down) return;
        ev.preventDefault(); current.next(); return;
      }
      if (ev.key === "Tab") {
        var items = overlay.querySelectorAll("button:not([disabled]), input:not([tabindex='-1']), textarea");
        var first = items[0], lastItem = items[items.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); lastItem.focus(); }
        else if (!ev.shiftKey && document.activeElement === lastItem) { ev.preventDefault(); first.focus(); }
        return;
      }
      if (!typing && current.letters && ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        var i = LETTERS.indexOf(ev.key.toUpperCase());
        if (i > -1 && i < current.count) { ev.preventDefault(); current.letters(i); }
      }
    }

    closeBtn.addEventListener("click", close);
    up.addEventListener("click", function () {
      if (index === 0 || finished || sending) return;
      values[steps[index].key] = current.read(); // keep what was typed, even if not confirmed with OK
      show(index - 1);
    });
    down.addEventListener("click", function () { if (!finished) current.next(); });
    // the browser's Back button closes the flow instead of leaving the page
    window.addEventListener("popstate", onBack);
    history.pushState({ flow: true }, "");
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    flowOpen = true;
    show(0);
  }

  var EMAIL_STEP = { key: "contact", type: "email", title: "Your email", desc: "Optional. We only use it if we need to ask you about this message. It is never published.", placeholder: "name@example.com" };

  function reportFlow(p, opener, onDone) {
    openFlow({
      context: p.name,
      opener: opener,
      steps: [
        { key: "fields", type: "multi", required: true, title: "What is not correct?", choices: REPORT_FIELDS },
        { key: "details", type: "long", title: "What is the correct information?", desc: "Optional. For example: the application fee is now $350." },
        { key: "source_url", type: "url", title: "Do you have a link that shows it?", desc: "Optional. A page on the program's own website is best.", placeholder: "https://" },
        EMAIL_STEP
      ],
      onSubmit: function (v) {
        return send({ type: "report", program_id: p.id, program_name: p.name, fields: v.fields, details: v.details, source_url: v.source_url, contact: v.contact, website: v.website });
      },
      doneTitle: "Thank you.",
      doneText: "Your report was recorded. It will be compared with the official program page.",
      onDone: onDone
    });
  }

  function suggestFlow(opener) {
    openFlow({
      context: "Suggest a program",
      opener: opener,
      steps: [
        { key: "program_name", type: "text", required: true, title: "Which program or institution is missing?" },
        { key: "place", type: "text", title: "Where is it?", desc: "Optional. City and state." },
        { key: "source_url", type: "url", required: true, title: "Link to the official program page", desc: "This is what lets us verify it.", placeholder: "https://" },
        { key: "details", type: "long", title: "What do you know about it?", desc: "Optional. Who can apply, exams required, fees, how you found out." },
        EMAIL_STEP
      ],
      onSubmit: function (v) {
        return send({ type: "suggest", program_name: v.program_name, place: v.place, source_url: v.source_url, details: v.details, contact: v.contact, website: v.website });
      },
      doneTitle: "Thank you.",
      doneText: "Your suggestion was recorded. It will be checked against the official program page.",
      onDone: function () { $("suggest-msg").textContent = "Your suggestion was recorded. Thank you."; }
    });
  }

  // ---------- email alerts for one entry ----------
  function alertFlow(p, opener, onDone) {
    openFlow({
      context: p.name,
      opener: opener,
      values: { contact: lastEmail },
      steps: [
        { key: "contact", type: "email", required: true, title: "Your email", desc: "We will email you when this entry changes or applications open. It is free. Your email is used only for these alerts and is never published.", placeholder: "name@example.com" }
      ],
      onSubmit: function (v) {
        return send({ type: "alert", program_id: p.id, program_name: p.name, contact: v.contact, website: v.website }).then(function (r) { lastEmail = v.contact; return r; });
      },
      doneTitle: "You are on the list.",
      doneText: "We will email you when the entry for " + p.name + " changes or applications open.",
      onDone: onDone
    });
  }
  function alertBar(p) {
    var box = el("div", { class: "alert" });
    if (alerts[p.id]) {
      box.appendChild(el("p", { class: "alert-on", role: "status", tabindex: "-1", text: "You will get an email when this entry changes or applications open." }));
      return box;
    }
    var label = "Email me when this entry changes or applications open";
    var btn = el("button", { type: "button", class: "choice", "aria-label": label + ": " + p.name, text: label });
    btn.addEventListener("click", function () {
      alertFlow(p, btn, function () {
        alerts[p.id] = true;
        try { localStorage.setItem(ALERT_KEY, JSON.stringify(alerts)); } catch (e) { /* private mode: keep in memory only */ }
        var node = document.getElementById("p-" + p.id), old = node && node.querySelector(".alert");
        if (!old) return;
        var fresh = alertBar(p);
        node.replaceChild(fresh, old);
        fresh.firstChild.focus({ preventScroll: true });
      });
    });
    box.appendChild(btn);
    return box;
  }

  // ---------- program row ----------
  function fact(label, value, cls, small) {
    var dd = el("dd", { class: cls || "", text: value });
    if (small) dd.appendChild(el("small", { text: small }));
    return el("div", null, [el("dt", { text: label }), dd]);
  }
  // status is "required", "not_required" (the official page says so) or "not_reported" (the page is silent)
  function reqFact(label, status, detail) {
    if (status === "required") return fact(label, "Required", "req", detail ? "TOEFL iBT minimum " + detail : null);
    if (status === "not_required") return fact(label, "Not required", "free");
    return fact(label, "Not reported", "na");
  }
  function moneyFact(label, v) {
    var m = money(v);
    if (m === null) return fact(label, "Not reported", "na");
    return fact(label, v === 0 ? "None" : m, v === 0 ? "free" : "");
  }

  function row(p) {
    var typeLabel = p.type === "hospital" ? "Hospital-based" : "Medical school-based";
    var node = el("article", { class: "row", id: "p-" + p.id }, [
      el("h3", { text: p.name }),
      el("p", { class: "place", text: p.city + ", " + p.state_name + " · " + typeLabel }),
      el("a", { class: "official", href: p.url, target: "_blank", rel: "noopener noreferrer", "aria-label": "Official page of " + p.name, text: "Official page" })
    ]);
    if (p.review) node.appendChild(el("p", { class: "flag", text: "Being re-checked" + (p.review.reason ? ": " + p.review.reason : "") }));
    if (p.notes) node.appendChild(el("p", { class: "note", text: p.notes }));
    node.appendChild(el("dl", { class: "facts" }, [
      reqFact("USMLE Step 1", p.step1),
      reqFact("USMLE Step 2", p.step2),
      reqFact("English test", p.english_test.status, p.english_test.detail),
      reqFact("BLS / ACLS", p.life_support),
      moneyFact("Application fee", p.application_fee_usd),
      moneyFact("Tuition, 4 weeks", p.tuition_4wk_usd),
      fact("Also on VSLO", p.vslo ? "Yes" : "No", "")
    ]));
    node.appendChild(voteBar(p));
    node.appendChild(alertBar(p));
    return node;
  }

  function choiceButton(label, pressed, name) {
    return el("button", { type: "button", class: "choice", "aria-pressed": pressed ? "true" : "false", "aria-label": name }, [
      el("span", { text: label }), el("span", { class: "tick", "aria-hidden": "true", text: "✓" })
    ]);
  }

  // Rebuild the "Is this entry correct?" block of one row, wherever that row is now on the page
  function redrawVote(p, text, isError) {
    var node = document.getElementById("p-" + p.id);
    var old = node && node.querySelector(".vote");
    if (!old) return;
    var hadFocus = old.contains(document.activeElement) || document.activeElement === document.body;
    var fresh = voteBar(p), msg = fresh.querySelector(".msg");
    msg.textContent = text; msg.className = isError ? "msg err" : "msg";
    node.replaceChild(fresh, old);
    if (hadFocus && !flowOpen) msg.focus({ preventScroll: true });
  }

  function voteBar(p) {
    var mine = votes[p.id];
    if (!mine || (mine.vote !== "confirm" && mine.vote !== "report")) mine = null;
    var metaText = "Checked against the official page in " + monthLabel(p.verified) + ".";
    if (p.confirmations > 0) metaText += " Confirmed by " + p.confirmations + (p.confirmations === 1 ? " reader." : " readers.");

    var msg = el("p", { class: "msg", role: "status", "aria-live": "polite", tabindex: "-1" });
    var yes = choiceButton("Yes", mine && mine.vote === "confirm", "Yes, the entry for " + p.name + " is correct");
    var no = choiceButton("No", mine && mine.vote === "report", "No, something is not correct in the entry for " + p.name);
    var box = el("div", { class: "vote" }, [
      el("p", { class: "ask", text: "Is this entry correct?" }),
      el("div", { class: "choices" }, [yes, no]),
      msg,
      el("p", { class: "meta", text: metaText })
    ]);

    if (mine) {
      var when = dateLabel(mine.at) ? " on " + dateLabel(mine.at) : "";
      msg.textContent = mine.vote === "confirm" ? "You confirmed this entry" + when + ". Thank you." : "You reported a problem" + when + ". Thank you, it will be checked.";
      if (mine.vote === "confirm") yes.disabled = true;
    }
    if (pending[p.id]) { yes.disabled = true; msg.textContent = "Sending…"; }

    yes.addEventListener("click", function () {
      if (pending[p.id]) return;
      pending[p.id] = true;
      yes.disabled = true; msg.className = "msg"; msg.textContent = "Sending…";
      send({ type: "confirm", program_id: p.id, program_name: p.name }).then(function () {
        delete pending[p.id];
        saveVote(p.id, "confirm");
        redrawVote(p, "Thank you. Your confirmation was recorded.", false);
      }).catch(function (err) {
        delete pending[p.id];
        redrawVote(p, err.message, true);
      });
    });

    no.addEventListener("click", function () {
      reportFlow(p, no, function () {
        saveVote(p.id, "report");
        redrawVote(p, "Thank you. Your report was recorded and will be checked against the official page.", false);
      });
    });
    return box;
  }

  // ---------- list, filters, summary ----------
  // lower case, no accents, no punctuation, so "Children’s" and "childrens" compare equal
  function plain(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  // every word typed must start a word of the name, city or state, or be the state's two-letter code
  function matches(p) {
    var words = plain(p.name + " " + p.city + " " + p.state_name).split(" ");
    var tokens = plain($("q").value).split(" ").filter(Boolean);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i], hit = t === p.state.toLowerCase();
      for (var j = 0; j < words.length && !hit; j++) hit = words[j].indexOf(t) === 0;
      if (!hit) return false;
    }
    if ($("state").value && p.state !== $("state").value) return false;
    if ($("f-step1").checked && p.step1 === "required") return false;
    if ($("f-english").checked && p.english_test.status === "required") return false;
    if ($("f-tuition").checked && p.tuition_4wk_usd !== 0) return false;
    return true;
  }
  function byNumber(key) {
    return function (a, b) {
      var x = a[key], y = b[key];
      if (x === null && y === null) return a.name.localeCompare(b.name);
      if (x === null) return 1;
      if (y === null) return -1;
      return x - y || a.name.localeCompare(b.name);
    };
  }
  function render() {
    var rows = data.programs.filter(matches);
    var sort = $("sort").value;
    if (sort === "tuition") rows.sort(byNumber("tuition_4wk_usd"));
    else if (sort === "fee") rows.sort(byNumber("application_fee_usd"));
    else if (sort === "state") rows.sort(function (a, b) { return a.state_name.localeCompare(b.state_name) || a.name.localeCompare(b.name); });
    else rows.sort(function (a, b) { return a.name.localeCompare(b.name); });

    var list = $("list");
    list.textContent = "";
    rows.forEach(function (p) { list.appendChild(row(p)); });
    $("empty").hidden = rows.length > 0;
    $("count").textContent = rows.length === data.programs.length
      ? "Showing all " + rows.length + " programs"
      : "Showing " + rows.length + " of " + data.programs.length + " programs";
    paintMap();
  }

  // ---------- map of the United States ----------
  var mapData = null, hovered = "";
  function countIn(code) { return data.programs.filter(function (p) { return p.state === code; }).length; }
  function buildMap(m) {
    mapData = m;
    var root = svg("svg", { viewBox: m.viewBox, role: "img", "aria-label": "Map of the United States. States with programs on the list are shown in white." });
    var hits = svg("g", {});
    Object.keys(m.states).forEach(function (code) {
      var n = countIn(code);
      root.appendChild(svg("path", { d: m.states[code].d, class: n ? "st has" : "st", "data-code": code }));
      if (n) hits.appendChild(svg("circle", { cx: m.states[code].c[0], cy: m.states[code].c[1], r: 15, class: "hit", "data-code": code }));
    });
    root.appendChild(hits); // larger targets, so small states can be picked too
    function codeOf(ev) { return (ev.target.getAttribute && ev.target.getAttribute("data-code")) || ""; }
    root.addEventListener("mouseover", function (ev) { hovered = codeOf(ev); paintMap(); });
    root.addEventListener("mouseleave", function () { hovered = ""; paintMap(); });
    root.addEventListener("click", function (ev) {
      var code = codeOf(ev);
      if (!code || !countIn(code)) return;
      pickState($("state").value === code ? "" : code);
    });
    $("map").appendChild(root);
    paintMap();
  }
  function pickState(code) {
    $("state").value = code;
    render();
    var box = $("programs").getBoundingClientRect();
    if (code && (box.top > window.innerHeight * 0.6 || box.bottom < 0)) $("programs").scrollIntoView();
  }
  function paintMap() {
    if (!mapData) return;
    var chosen = $("state").value, note = $("map-note");
    Array.prototype.forEach.call($("map").querySelectorAll(".st"), function (node) {
      node.classList.toggle("sel", node.getAttribute("data-code") === chosen);
    });
    var code = hovered || chosen;
    note.textContent = "";
    if (!code) { note.textContent = "States in white have programs. Select one to see them."; return; }
    var n = countIn(code), name = mapData.states[code].n;
    note.appendChild(document.createTextNode(name + ": " + (n ? n + (n === 1 ? " program" : " programs") : "no program on the list") + (chosen === code ? ", shown in the list. " : ". ")));
    if (chosen) {
      var all = el("button", { type: "button", text: "Show all states" });
      all.addEventListener("click", function () { hovered = ""; pickState(""); });
      note.appendChild(all);
    }
  }
  function renderSummary() {
    var ps = data.programs, states = {};
    ps.forEach(function (p) { states[p.state] = p.state_name; });
    $("summary").textContent = ps.length + " programs in " + Object.keys(states).length + " states. Last full check: " + monthLabel(data.meta.last_full_verification) + ".";

    var sel = $("state");
    Object.keys(states).sort(function (a, b) { return states[a].localeCompare(states[b]); }).forEach(function (code) {
      sel.appendChild(el("option", { value: code, text: states[code] }));
    });

    var foot = "Data version " + (dateLabel(data.meta.data_version) || "") + ".";
    if (data.meta.last_weekly_check) foot += " Reader reports last reviewed on " + dateLabel(data.meta.last_weekly_check) + ".";
    $("foot-meta").textContent = foot;
  }
  function renderChanges(items) {
    var box = $("changes");
    box.textContent = "";
    var byId = {};
    data.programs.forEach(function (p) { byId[p.id] = p; });
    items.slice(0, 15).forEach(function (c) {
      var body = el("span");
      if (c.program_id && byId[c.program_id]) {
        body.appendChild(el("a", { href: "#p-" + c.program_id, text: byId[c.program_id].name }));
        body.appendChild(document.createTextNode(": "));
      }
      body.appendChild(document.createTextNode(c.summary || ""));
      if (c.source_url && /^https:\/\//.test(c.source_url)) {
        body.appendChild(document.createTextNode(" "));
        body.appendChild(el("a", { href: c.source_url, target: "_blank", rel: "noopener noreferrer", text: "Source" }));
      }
      box.appendChild(el("li", null, [el("time", { datetime: c.date, text: dateLabel(c.date) }), body]));
    });
  }

  // ---------- start ----------
  function getJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
  }
  function toPrograms() {
    $("programs").scrollIntoView();
    $("list-title").focus({ preventScroll: true }); // so the next Tab continues from the list
  }

  ["q", "state", "sort", "f-step1", "f-english", "f-tuition"].forEach(function (id) {
    $(id).addEventListener(id === "q" ? "input" : "change", render);
  });
  $("start").addEventListener("click", toPrograms);
  $("suggest-open").addEventListener("click", function () { $("suggest-msg").textContent = ""; suggestFlow($("suggest-open")); });
  // On the welcome screen, Enter moves on to the list
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" || flowOpen || window.scrollY > 80) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    toPrograms();
  });

  if (history.state && history.state.flow) history.replaceState(null, ""); // left over from a reload inside a flow

  getJSON("data/programs.json").then(function (d) {
    data = d;
    renderSummary();
    render();
    if (location.hash.indexOf("#p-") === 0) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
    getJSON("data/us-map.json").then(buildMap).catch(function () { $("map").parentNode.hidden = true; }); // the page works without the map
    return getJSON("data/changelog.json").then(renderChanges).catch(function () { /* changelog is optional */ });
  }).catch(function () {
    $("count").textContent = "The list could not be loaded. Please refresh the page.";
  });
})();
