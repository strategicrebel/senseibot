(() => {
  // Config from script tag
  const s = document.currentScript;
  const API = (s && s.dataset.api) || (window.__SENSEI_BOT__ && window.__SENSEI_BOT__.api);
  const BRAND = (s && s.dataset.brand) || "Shotokan Sensei-bot";
  if (!API) return console.error("[Sensei-bot] Missing data-api");

  // --- IDs & local state keys ---
  const sidKey = "skr_sid";
  const stateKey = "skr_state";
  const dataKey  = "skr_data";

  // Ensure a session id
  let sid = localStorage.getItem(sidKey);
  if (!sid) {
    sid = (crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    localStorage.setItem(sidKey, sid);
  }

  // State helpers
  function resetState() {
    localStorage.removeItem(stateKey);
    localStorage.removeItem(dataKey);
    localStorage.removeItem(sidKey); // also reset session id
    // recreate a fresh session id immediately
    const fresh = (crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    localStorage.setItem(sidKey, fresh);
  }
  function getState() {
    return {
      state: localStorage.getItem(stateKey) || null,
      data: JSON.parse(localStorage.getItem(dataKey) || "null") || null
    };
  }
  function setState(nextState, nextData) {
    if (nextState) localStorage.setItem(stateKey, nextState);
    if (nextData)  localStorage.setItem(dataKey, JSON.stringify(nextData));
  }

  // --- UI: bubble & panel ---
  const btn = document.createElement("button");
  btn.textContent = "🥋";
  Object.assign(btn.style, {
    position:"fixed", bottom:"20px", right:"20px", width:"56px", height:"56px",
    borderRadius:"50%", border:"none", background:"#000", color:"#fff",
    fontSize:"24px", cursor:"pointer", zIndex:"999999"
  });
  document.body.appendChild(btn);

  const box = document.createElement("div");
  Object.assign(box.style, {
    position:"fixed", bottom:"88px", right:"20px", width:"380px", maxWidth:"92vw",
    maxHeight:"70vh", display:"none", background:"#fff", borderRadius:"12px",
    boxShadow:"0 12px 30px rgba(0,0,0,.2)", zIndex:"999999", overflow:"hidden",
    fontFamily:"system-ui, sans-serif"
  });
  box.innerHTML = `
    <div style="background:#000;color:#fff;padding:10px 14px;font-weight:600">${BRAND}</div>
    <div id="skr-messages" style="padding:12px; height:50vh; overflow:auto;"></div>
    <form id="skr-form" style="display:flex; gap:8px; padding:12px; border-top:1px solid #eee">
      <input id="skr-input" placeholder="Type here…" style="flex:1;border:1px solid #ddd;border-radius:8px;padding:10px" />
      <button style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:10px 12px;cursor:pointer">Send</button>
    </form>`;
  document.body.appendChild(box);

  const msgs  = box.querySelector("#skr-messages");
  const input = box.querySelector("#skr-input");
  const form  = box.querySelector("#skr-form");

  // Add a message bubble
  function addMsg(from, text, buttons) {
    const wrap = document.createElement("div");
    wrap.style.margin = "8px 0";
    wrap.style.textAlign = from === "bot" ? "left" : "right";

    const bubble = document.createElement("div");
    Object.assign(bubble.style, {
      display:"inline-block", padding:"8px 12px", borderRadius:"10px",
      maxWidth:"85%", whiteSpace:"pre-wrap",
      background: from === "bot" ? "#f3f4f6" : "#2563eb",
      color:      from === "bot" ? "#111827" : "#fff"
    });
    bubble.textContent = text;
    wrap.appendChild(bubble);

    if (buttons && buttons.length) {
      const row = document.createElement("div");
      row.style.marginTop = "6px";
      buttons.forEach(label => {
        const b = document.createElement("button");
        b.textContent = label;
        Object.assign(b.style, {
          marginRight:"6px", padding:"6px 10px", border:"1px solid #ddd",
          borderRadius:"8px", background:"#fff", cursor:"pointer"
        });
        b.onclick = () => {
          if (label.toLowerCase() === "start") resetState();
          send(label);
        };
        row.appendChild(b);
      });
      wrap.appendChild(row);
    }

    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // Handle typing + Enter/Send
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const val = (input.value || "").trim();
    if (!val) return;
    send(val);
    input.value = "";
  });

  // Open/close bubble
  btn.onclick = () => {
    const open = box.style.display !== "none";
    box.style.display = open ? "none" : "block";
    if (!open && msgs.childNodes.length === 0) {
      // starting fresh → clear any old state, then init
      resetState();
      send("__INIT__"); // no client state sent on this call
    }
  };

  // Send to API
  async function send(text) {
    if (text !== "__INIT__") addMsg("user", text);

    const body = {
      sessionId: localStorage.getItem(sidKey),
      message: text
    };

    // Only attach state for non-initial messages
    if (text !== "__INIT__") {
      const { state, data } = getState();
      body.clientState = state;
      body.clientData  = data;
    }

    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (e) {
      addMsg("bot", "Connection error. Please try again.");
      return;
    }

    let dataRes;
    try {
      dataRes = await res.json();
    } catch {
      addMsg("bot", "Unexpected server response.");
      return;
    }

    (dataRes.messages || []).forEach(m => addMsg(m.from, m.text, m.buttons));

    if (dataRes.nextState || dataRes.nextData) {
      setState(dataRes.nextState, dataRes.nextData);
    }

    // Open or show checkout link if present
    if (dataRes.checkoutUrl) {
      // Attempt new tab
      try { window.open(dataRes.checkoutUrl, "_blank"); } catch {}
      // Always show a clickable link inside chat
      const wrap = document.createElement("div");
      wrap.style.textAlign = "left";
      const a = document.createElement("a");
      a.href = dataRes.checkoutUrl;
      a.target = "_blank";
      a.textContent = "👉 Click here to complete checkout";
      Object.assign(a.style, {
        display:"inline-block", marginTop:"8px", padding:"8px 12px",
        border:"1px solid #ddd", borderRadius:"8px", textDecoration:"none"
      });
      wrap.appendChild(a);
      msgs.appendChild(wrap);
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  // Optional: log load
  // console.log("[Sensei-bot] widget loaded");
})();
