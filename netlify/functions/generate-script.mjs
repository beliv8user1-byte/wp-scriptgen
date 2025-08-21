// netlify/functions/generate-script.mjs
// Minimal, production-ready function: CORS, scraping, LLM call, optional email.

import * as cheerio from "cheerio";
import nodemailer from "nodemailer";

// ===== Env =====
const OPENROUTER_API_KEY = Netlify.env.get("OPENROUTER_API_KEY");
const OPENROUTER_MODEL = Netlify.env.get("OPENROUTER_MODEL") || "qwen/qwen-2.5-7b-instruct"; // change in Netlify if you like
const ALLOWED_ORIGINS = (Netlify.env.get("ALLOWED_ORIGINS") || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Optional SMTP for emailing output
const SMTP_HOST = Netlify.env.get("SMTP_HOST");
const SMTP_PORT = Number(Netlify.env.get("SMTP_PORT") || 587);
const SMTP_SECURE = Netlify.env.get("SMTP_SECURE") === "true"; // true for 465, false for 587
const SMTP_USER = Netlify.env.get("SMTP_USER");
const SMTP_PASS = Netlify.env.get("SMTP_PASS");
const SMTP_FROM = Netlify.env.get("SMTP_FROM") || SMTP_USER;

// Your script rules. Update this to fit your brand.
const SCRIPT_INSTRUCTIONS = (Netlify.env.get("SCRIPT_INSTRUCTIONS") || `
You are a Explainor Video Script Generator Expert. You need to follow this instructions carefully

1. Structure (Max 60 Seconds)
We always follow this 5-part structure with timestamps to keep scripts concise and powerful:
HOOK (0–8s)
Grab attention fast. Start with the biggest pain point or a striking statement.
Example: “Creating videos is easy. Growing them worldwide? That’s where creators hit the wall.”
PROBLEM (8–18s)
Describe the challenge clearly and simply. One or two sentences.
Example: “Languages, captions, dubbing, multiple channels… it’s messy, expensive, and eats up your time.”
SOLUTION (18–36s)
Introduce the brand/product as the answer. Focus on clarity + impact.
Example: “That’s why we built Braiv — the all-in-one platform to translate, manage, and publish your content worldwide.”
TRUST (36–48s)
Build credibility. Use proof like results, use-cases, industries served, or notable clients (without naming if not needed).
Example: “Already trusted by creators, educators, and marketers to scale content across 29+ languages.”
CLOSE (48–60s)
End strong with vision + CTA.
Example: “Break barriers. Captivate audiences. Grow without limits. Braiv — from local to global, made simple.”

2. Tone & Style

Concise, clear, and problem-oriented (no fluff).
Conversational but authoritative (sounds like you’re guiding, not selling).
Impactful short sentences → avoids long, complex lines.
Solution-focused → not just features, but how it changes outcomes.
Subtle trust-building → never overhype, just confident.

3. Key Rules

✔ Never exceed 60 seconds
✔ Always include timestamps
✔ Always start with problem → solution
✔ Keep sentences short (ideal: 8–12 words)
✔ Avoid jargon — write like explaining to a smart 12-year-old
✔ End with a clear CTA (vision + action)
`).trim();

// ===== Helpers =====
const corsHeaders = (origin) => {
  const allowed = ALLOWED_ORIGINS.includes("*")
    ? "*"
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || "");
  return {
    "Access-Control-Allow-Origin": allowed || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
};

const safe = (v, n = 1200) => (v || "").toString().replace(/\s+/g, " ").slice(0, n);

async function scrapeSite(url) {
  if (!url) return { summary: "", points: [] };
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "ScriptGenBot/1.0 (+contact: web)" }
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $('meta[property="og:title"]').attr('content') || $('title').first().text();
    const desc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || "";
    const h1 = $('h1').first().text();
    const paragraphs = $('p').map((i, el) => $(el).text()).get().filter(Boolean).slice(0, 6).join(' ');
    const text = [title, desc, h1, paragraphs].join(' ').replace(/\s+/g, ' ').slice(0, 2000);
    const points = [];
    const kw = $('meta[name="keywords"]').attr('content');
    if (kw) kw.split(',').slice(0,5).forEach(k => points.push(k.trim()));
    return { summary: text, points };
  } catch (e) {
    return { summary: "", points: [] };
  }
}

async function emailScript(to, script, subjectBits = {}) {
  try {
    if (!SMTP_HOST || !to) return;
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
    });
    const subject = `Your video script for ${subjectBits.business_name || subjectBits.website || 'your business'}`;
    await transporter.sendMail({ from: SMTP_FROM, to, subject, text: script });
  } catch (_) { /* non-blocking */ }
}

// ===== Function handler =====
export default async (req, context) => {
  const origin = req.headers.get('origin') || '';

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST' }), {
      status: 405,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    });
  }

  try {
    const { website, linkedin, about, business_name, email } = await req.json();
    if (!OPENROUTER_API_KEY) throw new Error('Missing OPENROUTER_API_KEY');
    if (!website && !about && !linkedin) {
      return new Response(JSON.stringify({ error: 'Provide at least one of: website, linkedin, about.' }), {
        status: 400,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
      });
    }

    // Scrape website (LinkedIn is usually blocked, so we don’t scrape it)
    const scraped = await scrapeSite(website);

    const dataBlock = `Business Name: ${safe(business_name)}\n`+
      `Website: ${safe(website)}\n`+
      `LinkedIn URL: ${safe(linkedin)}\n`+
      `About (user-provided): ${safe(about, 2000)}\n`+
      `Website summary: ${safe(scraped.summary, 2000)}\n`+
      `Keywords: ${safe((scraped.points || []).join('; '), 500)}`;

    const userPrompt = `${SCRIPT_INSTRUCTIONS}\n\nDATA:\n${dataBlock}`;

    const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        // Optional attribution headers per OpenRouter guidelines
        'HTTP-Referer': 'https://your-domain.example',
        'X-Title': 'WP Script Generator'
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: 'system', content: 'You write concise, specific scripts for 60–90s explainer videos.' },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const json = await llmRes.json();
    if (!llmRes.ok) {
      return new Response(JSON.stringify({ error: json?.error || 'LLM error', details: json }), {
        status: 500,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
      });
    }

    const script = json?.choices?.[0]?.message?.content || '';

    // Fire-and-forget email if user asked for it
    if (email && script) {
      context.waitUntil(emailScript(email, script, { business_name, website }));
    }

    return new Response(JSON.stringify({ script }), {
      status: 200,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    });
  }
};


console.log("Incoming payload:", payload);

const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: OPENROUTER_MODEL,
    messages: [
      { role: "system", content: SCRIPT_INSTRUCTIONS },
      { role: "user", content: `Business: ${payload.business_name}\nWebsite: ${payload.website}\nAbout: ${payload.about}` }
    ]
  })
});

const result = await aiResponse.json();
console.log("AI raw result:", result);

const script = result?.choices?.[0]?.message?.content || "";

