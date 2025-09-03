import { NextRequest, NextResponse } from "next/server";

/** -----------------------
 *  Minimal in-memory session (OK for dev; swap to Redis later)
 *  ----------------------*/
type Session = { state: string; data: Record<string, string> };
const sessions = new Map<string, Session>();
function getS(id: string): Session {
  if (!sessions.has(id)) sessions.set(id, { state: "consent", data: {} });
  return sessions.get(id)!;
}

/** -----------------------
 *  Product map (replace tcUrl values with your real ThriveCart URLs)
 *  ----------------------*/
const products = {
  kumite: {
    name: "Kumite Strategy Playbook",
    tcUrl: "https://cart.strategicrebel.com/kumite-strategy-playbook/",
    tag: "tc_kumite_core",
  },
  kata: {
    name: "Kata Mastery Blueprint",
    tcUrl: "https://shotokankaraterebel.com/coming-soon/",
    tag: "tc_kata_core",
  },
  cond: {
    name: "Dojo Conditioning 30-Day",
    tcUrl: "https://shotokankaraterebel.com/coming-soon/",
    tag: "tc_cond_core",
  },
  mind: {
    name: "Mental Dojo Journal",
    tcUrl: "https://checkout.yourdomain.com/mental-dojo",
    tag: "tc_mind_core",
  },
} as const;

type Bucket = keyof typeof products;

/** Build the ThriveCart deep link with prefill + tags */
function buildCheckoutLink(bucket: Bucket, d: Record<string, string>) {
  const p = products[bucket];
  const u = new URL(p.tcUrl);
  if (d.email) u.searchParams.set("email", d.email);
  if (d.first_name) u.searchParams.set("name", d.first_name);
  u.searchParams.set("tag", p.tag);
  u.searchParams.set("utm_source", "sensei_bot");
  u.searchParams.set("utm_campaign", "skr");
  return u.toString();
}

/** -----------------------
 *  CORS (set your live WP origin domains here)
 *  ----------------------*/
const ALLOW = [
  "https://shotokankaraterebel.com",
  "https://www.shotokankaraterebel.com",
  "http://localhost:3000", // dev preview
  "https://sensei-bot.vercel.app", // vercel preview
];
function withCORS(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", ALLOW.join(","));
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Headers", "content-type");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return res;
}
export async function OPTIONS() {
  return withCORS(new NextResponse(null, { status: 204 }));
}

/** -----------------------
 *  ✅ POST handler (unified signature + unified return)
 *  - Accepts clientState/clientData from the widget
 *  - Avoids early returns; always responds with { messages, checkoutUrl, nextState, nextData }
 *  ----------------------*/
export async function POST(req: NextRequest) {
  // 1) Read request body (now includes client-provided state)
  const { sessionId, message, clientState, clientData } = await req.json();

  // 2) Use client state if provided; otherwise fall back to in-memory (dev)
  const s: Session = clientState
    ? { state: String(clientState), data: (clientData as any) || {} }
    : getS(String(sessionId));

  const m = (message || "").trim();
  const out: Array<{ from: "bot" | "user"; text: string; buttons?: string[] }> = [];
  let checkoutUrl: string | undefined;

  // 3) Initial greeting shortcut
  if (m === "__INIT__") {
    // hard reset the server-side session for this visitor
    s.state = "consent";
    s.data  = {};
  
    const res = NextResponse.json({
      messages: [
        {
          from: "bot",
          text:
            "👋 Welcome to Shotokan Karate Rebel. I’m your digital sensei. Want help pinpointing what’s holding you back—and the fastest way to fix it?",
          buttons: ["Yes", "Not now"],
        },
      ],
      checkoutUrl: undefined,
      nextState: s.state, // "consent"
      nextData: s.data,   // {}
    });
    return withCORS(res);
  }

  // 4) FSM
  switch (s.state) {
    case "consent": {
      if (/^yes$/i.test(m)) {
        s.state = "goal";
        out.push({
          from: "bot",
          text: "In the next 90 days, what result do you want most?",
          buttons: [
            "Win more kumite exchanges",
            "Ace my next grading (kata)",
            "Get fitter & more flexible",
            "Stay calm & confident",
          ],
        });
      } else {
        s.state = "freebie";
        out.push({
          from: "bot",
          text: "No worries. Want the Kumite Cheatsheet (10 quick wins)?",
          buttons: ["Yes, send it", "Maybe later"],
        });
      }
      break;
    }

    case "goal": {
      s.data.goal = m;
      // bucket selection
      if (/kumite/i.test(m)) s.data.bucket = "kumite";
      else if (/kata/i.test(m)) s.data.bucket = "kata";
      else if (/fit|flex/i.test(m)) s.data.bucket = "cond";
      else s.data.bucket = "mind";

      s.state = "pain";
      out.push({
        from: "bot",
        text: "What’s the #1 frustration right now?",
        buttons:
          s.data.bucket === "kumite"
            ? ["Can’t close distance", "I get countered", "Freeze under pressure"]
            : s.data.bucket === "kata"
            ? ["Timing/flow", "Hip drive & stances", "Nerves on grading"]
            : s.data.bucket === "cond"
            ? ["Gas out", "Stiff hips/hamstrings", "No plan"]
            : ["Anxiety", "Motivation dips", "Focus drift"],
      });
      break;
    }

    case "pain": {
      s.data.pain = m;
      s.state = "years";
      out.push({
        from: "bot",
        text: "How many years have you trained?",
        buttons: ["<1", "1–3", "3–5", "5+"],
      });
      break;
    }

    case "years": {
      s.data.years = m;
      s.state = "email";
      out.push({
        from: "bot",
        text: `Got it. With ${m} years aiming to "${s.data.goal}", your main blocker is "${s.data.pain}". More reps won’t fix it. You need strategy + the right drills.\nWhat’s your email so I can send your tailored plan?`,
      });
      break;
    }

    case "email": {
      // basic validation
      if (!/\S+@\S+\.\S+/.test(m)) {
        out.push({ from: "bot", text: "Please enter a valid email (e.g. name@example.com)" });
        break;
      }
      s.data.email = m;
      s.state = "prescribe";

      if (s.data.bucket === "kumite") {
        out.push({
          from: "bot",
          text:
            "I recommend the **Kumite Strategy Playbook** (PDF + videos):\n• 3 distance-closing patterns that avoid counter-gyaku\n• Rhythm breaks to create openings\n• Sen-no-sen / go-no-sen timing with examples\n• 10-minute footwork & reaction sessions\nReady to start? £27. Instant access.",
          buttons: ["Yes, start now", "What’s inside?"],
        });
      } else if (s.data.bucket === "kata") {
        out.push({
          from: "bot",
          text:
            "I recommend the **Kata Mastery Blueprint** (checklists, rhythm drills, visual cues). Ready to start? £27.",
          buttons: ["Yes, start now", "What’s inside?"],
        });
      } else if (s.data.bucket === "cond") {
        out.push({
          from: "bot",
          text:
            "I recommend the **Dojo Conditioning 30-Day Plan** (short sessions for gas tank & mobility). Ready to start? £27.",
          buttons: ["Yes, start now", "What’s inside?"],
        });
      } else {
        out.push({
          from: "bot",
          text:
            "I recommend the **Mental Dojo Journal System** (focus, calm, confidence protocols). Ready to start? £27.",
          buttons: ["Yes, start now", "What’s inside?"],
        });
      }
      // TODO: upsert to ESP here (ConvertKit/AC) using s.data
      break;
    }

    case "prescribe": {
      if (/start now|^yes$/i.test(m)) {
        s.state = "checkout";
        const bucket = (s.data.bucket || "kumite") as Bucket;
        checkoutUrl = buildCheckoutLink(bucket, s.data);
        out.push({ from: "bot", text: "Opening checkout…" });
      } else {
        out.push({
          from: "bot",
          text:
            "Here’s what you’ll get: 6 core modules, 6 short videos, drills & a printable plan. Ready?",
          buttons: ["Yes, start now", "Maybe later"],
        });
      }
      break;
    }

    case "freebie": {
      if (/yes/i.test(m)) {
        s.state = "freebie_email";
        out.push({ from: "bot", text: "Great—what’s your email?" });
      } else {
        out.push({ from: "bot", text: "All good. Come back anytime. 👊" });
      }
      break;
    }

    case "freebie_email": {
      if (!/\S+@\S+\.\S+/.test(m)) {
        out.push({ from: "bot", text: "Please enter a valid email." });
        break;
      }
      s.data.email = m;
      s.state = "end";
      out.push({ from: "bot", text: "Done—check your inbox in a minute. Oss!" });
      // TODO: send cheatsheet via ESP
      break;
    }

    default: {
      s.state = "consent";
      out.push({
        from: "bot",
        text: "Tap a button or say 'start' to begin again.",
        buttons: ["Start"],
      });
    }
  }

  // 5) Unified response (NO early returns inside switch)
  const res = NextResponse.json({
    messages: out,
    checkoutUrl,      // string | undefined
    nextState: s.state,
    nextData: s.data,
  });
  return withCORS(res);
}
