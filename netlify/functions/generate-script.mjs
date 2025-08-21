// netlify/functions/generate-script.js
import fetch from "node-fetch";
import * as cheerio from "cheerio";

// Safe text truncation
function safe(text, max = 1000) {
  if (!text) return "";
  return String(text).replace(/\s+/g, " ").slice(0, max);
}

// Scrape a company website
async function scrapeSite(url) {
  if (!url) return { summary: "", points: [] };
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "ScriptGenBot/1.0 (+contact: web)" },
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $("title").first().text();
    const desc =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    const h1 = $("h1").first().text();
    const paragraphs = $("p")
      .slice(0, 3)
      .map((i, el) => $(el).text())
      .get()
      .join(" ");

    return {
      summary: [title, desc, h1, paragraphs].join(" ").replace(/\s+/g, " "),
      points: [title, desc, h1],
    };
  } catch (err) {
    return { summary: "", points: [] };
  }
}

// Scrape a LinkedIn page (basic — LinkedIn often blocks bots)
async function scrapeLinkedIn(url) {
  if (!url) return { summary: "", points: [] };
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "ScriptGenBot/1.0 (+contact: web)" },
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $("title").first().text();
    const desc =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    const text = [title, desc].join(" ").replace(/\s+/g, " ").slice(0, 2000);

    return { summary: text, points: [title, desc] };
  } catch (e) {
    return { summary: "", points: [] };
  }
}

// Script Instructions
const SCRIPT_INSTRUCTIONS = (process.env.SCRIPT_INSTRUCTIONS || `
You are an Explainer Video Script Generator Expert. Follow these rules carefully:

1. Structure (Max 60 Seconds)
HOOK (0–8s)
Grab attention fast with pain point or striking statement.
PROBLEM (8–18s)
State the challenge in 1–2 simple sentences.
SOLUTION (18–36s)
Introduce the brand/product as the answer. Clear + impactful.
TRUST (36–48s)
Show credibility: industries served, results, or use-cases.
CLOSE (48–60s)
Strong vision + CTA.

2. Tone & Style
Concise, clear, problem-oriented. Conversational but authoritative.
Impactful short sentences. Solution-focused. Avoid jargon.
End with CTA.

3. Key Rules
✔ Never exceed 60 seconds
✔ Always include timestamps
✔ Always start with problem → solution
✔ Keep sentences short (8–12 words)
✔ Write like explaining to a smart 12-year-old
✔ End with clear CTA
`).trim();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { business_name, email, website, linkedin, notes } = req.body || {};

    if (!business_name) {
      return res.status(400).json({ error: "Missing business_name" });
    }

    // Scrape website + LinkedIn
    const scrapedWebsite = await scrapeSite(website);
    const scrapedLinkedIn = await scrapeLinkedIn(linkedin);

    // Build profile block
    const profileBlock = `
Company Name: ${safe(business_name)}
Business Email: ${safe(email)}
Website: ${safe(website)}
LinkedIn: ${safe(linkedin)}

--- User Notes ---
${safe(notes, 2000)}

--- Website Extract ---
${safe(scrapedWebsite.summary, 2000)}

--- LinkedIn Extract ---
${safe(scrapedLinkedIn.summary, 2000)}

--- Keywords ---
${safe(
  [...scrapedWebsite.points, ...scrapedLinkedIn.points].join("; "),
  500
)}
`;

    // Final prompt
    const userPrompt = `${SCRIPT_INSTRUCTIONS}\n\nPROFILE DATA:\n${profileBlock}`;

    // Call OpenRouter
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
        messages: [
          { role: "system", content: "You are an expert video scriptwriter." },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await response.json();
    const script = data?.choices?.[0]?.message?.content || "";

    if (!script.trim()) {
      return res.status(500).json({ error: "Empty response from model", raw: data });
    }

    // Respond with JSON
    return res.status(200).json({ script });
  } catch (error) {
    console.error("Script generation failed:", error);
    return res.status(500).json({ error: error.message });
  }
}
