// netlify/functions/generate-script.mjs
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const SCRIPT_INSTRUCTIONS = (process.env.SCRIPT_INSTRUCTIONS || `
You are an Explainer Video Script Generator Expert. Follow these instructions carefully:

1. Structure (Max 60 Seconds)
HOOK (0–8s) → grab attention fast.
PROBLEM (8–18s) → describe the challenge clearly.
SOLUTION (18–36s) → introduce the product/brand.
TRUST (36–48s) → build credibility with proof or results.
CLOSE (48–60s) → strong ending with vision + CTA.

2. Tone & Style
- Concise, clear, conversational
- Short impactful sentences
- Avoid jargon, aim for clarity
- Always include timestamps
- End with a clear CTA
`).trim();

/**
 * Scrape text from a website
 */
async function scrapeWebsite(url) {
  try {
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Grab text from headings, paragraphs, and meta descriptions
    const textParts = [];
    $("h1, h2, h3, p, meta[name='description']").each((_, el) => {
      const content = $(el).text() || $(el).attr("content");
      if (content && content.trim().length > 30) {
        textParts.push(content.trim());
      }
    });

    // Limit so we don’t overload the model
    return textParts.slice(0, 30).join("\n\n");
  } catch (err) {
    return `Error scraping site: ${err.message}`;
  }
}

export async function handler(event, context) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGINS || "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { business_name, website } = body;

    // Scrape website
    let scrapedContent = "";
    if (website) {
      scrapedContent = await scrapeWebsite(website);
    }

    const prompt = `
${SCRIPT_INSTRUCTIONS}

Company Details:
- Business Name: ${business_name || "N/A"}
- Website: ${website || "N/A"}

Extracted Website Content:
${scrapedContent}

Now, generate a 60-second explainer video script that reflects the brand and offerings.
`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGINS || "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        script: data.choices?.[0]?.message?.content || "No script generated",
        scraped_data: scrapedContent,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
