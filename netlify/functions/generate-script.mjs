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
You are a script generator for 60–90 second explainer videos.
Write in clear, human language. Vary sentence length. No corporate buzzwords. No fluff.
Structure:
1) [Hook]
2) Problem → stakes
3) Solution → how this business actually helps
4) Credibility (1–2 quick facts)
5) [CTA]
Constraints:
- 170–230 words
- Keep it specific to the business data below
- Use [ON SCREEN:] cues where helpful
Return only the script.
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
