// netlify/functions/generate-script.mjs

const SCRIPT_INSTRUCTIONS = (process.env.SCRIPT_INSTRUCTIONS || `
You are an Explainer Video Script Generator Expert. Follow these rules carefully: 1. Structure (Max 60 Seconds) HOOK (0–8s) Grab attention fast with pain point or striking statement. PROBLEM (8–18s) State the challenge in 1–2 simple sentences. SOLUTION (18–36s) Introduce the brand/product as the answer. Clear + impactful. TRUST (36–48s) Show credibility: industries served, results, or use-cases. CLOSE (48–60s) Strong vision + CTA. 2. Tone & Style Concise, clear, problem-oriented. Conversational but authoritative. Impactful short sentences. Solution-focused. Avoid jargon. End with CTA. 3. Key Rules ✔ Never exceed 60 seconds ✔ Always include timestamps ✔ Always start with problem → solution ✔ Keep sentences short (8–12 words) ✔ Write like explaining to a smart 12-year-old ✔ End with clear CTA
`).trim();

/**
 * Netlify Function Entry
 */
export async function handler(event, context) {
  // Handle preflight (CORS)
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

  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { business_name, website, about } = body;

    const prompt = `
${SCRIPT_INSTRUCTIONS}

Company Details:
- Business Name: ${business_name || "N/A"}
- Website: ${website || "N/A"}
- About: ${about || "N/A"}

Generate a 60-second explainer video script.
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

    if (!data || !data.choices || data.choices.length === 0) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Empty response from OpenRouter" }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGINS || "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ script: data.choices[0].message.content }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
