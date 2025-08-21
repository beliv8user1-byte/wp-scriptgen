// netlify/functions/generate-script.js
const fetch = require("node-fetch");
const cheerio = require("cheerio");

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
    console.error("scrapeSite failed:", err.message);
    return { summary: "", points: [] };
  }
}

// Scrape LinkedIn (basic — LinkedIn often blocks bots)
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
    console.error("scrapeLinkedIn failed:", e.message);
    return { summary: "", points: [] };
  }
}

// Instructions
const SCRIPT_INSTRUCTIONS = (process.env.SCRIPT_INSTRUCTIONS || `
You are an Explainer Video Script Generator Expert. Follow these rules carefully:

HOOK (0–8s)
Grab attention fast.
PROBLEM (8–18s)
State the challenge simply.
SOLUTION (18–36s)
Introduce the brand/product as the answer.
TRUST (36–48s)
Show credibility.
CLOSE (48–60s)
Vision + CTA.

Rules:
- Max 60 seconds
- Always include timestamps
- Short sentences
- Conversational but authoritative
- End with CTA
`).trim();

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { business_name, email, website, linkedin, notes } = body;

    if (!business_name) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing business_name" }) };
    }

    const scrapedWebsite = await scrapeSite(website);
    const scrapedLinkedIn = await scrapeLinkedIn(linkedin);

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

    const userPrompt = `${SCRIPT_INSTRUCTIONS}\n\nPROFILE DATA:\n${profileBlock}`;

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
      console.error("OpenRouter empty response:", data);
      return { statusCode: 500, body: JSON.stringify({ error: "Empty response from model", raw: data }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ script }),
    };
  } catch (error) {
    console.error("Handler failed:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
