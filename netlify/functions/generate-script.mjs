import * as cheerio from "cheerio";
import nodemailer from "nodemailer";

const SCRIPT_INSTRUCTIONS = (process.env.SCRIPT_INSTRUCTIONS || `
You are an Explainer Video Script Generator Expert. Follow these instructions carefully:

The generated script should follow this format only

HOOK (0–8s)
Grab attention fast. Start with the biggest pain point or a striking statement.

PROBLEM (8–18s)
Describe the challenge clearly and simply. One or two sentences.

SOLUTION (18–36s)
Introduce the brand/product as the answer. Focus on clarity + impact.

TRUST (36–48s)
Build credibility. Use proof like results, use-cases, industries served, or notable clients.

CLOSE (48–60s)
End strong with vision + CTA.

✔ Never exceed 60 seconds
✔ Always include timestamps
✔ Write conversational, no jargon
✔ End with clear CTA
`).trim();

// ---------- Scraping Function ----------
async function scrapeWebsite(url) {
  try {
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const textParts = [];
    $("h1, h2, h3, p, meta[name='description']").each((_, el) => {
      const content = $(el).text() || $(el).attr("content");
      if (content && content.trim().length > 30) {
        textParts.push(content.trim());
      }
    });

    return textParts.slice(0, 30).join("\n\n");
  } catch (err) {
    return `Error scraping site: ${err.message}`;
  }
}

// ---------- Email Sender (Hostinger SMTP) ----------
async function sendEmail(to, subject, htmlContent) {
  const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_EMAIL,
    pass: process.env.GMAIL_PASSWORD,
  },
});

  await transporter.sendMail({
    from: `"Explainer Script Generator" <${process.env.HOSTINGER_EMAIL}>`,
    to,
    subject,
    html: htmlContent,
  });
}

// ---------- Netlify Function ----------
export async function handler(event) {
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
    const { business_name, website, linkedin_url, email } = body;

    let scrapedContent = "";
    if (website) {
      scrapedContent = await scrapeWebsite(website);
    }

    const prompt = `
${SCRIPT_INSTRUCTIONS}

Company Details:
- Business Name: ${business_name || "N/A"}
- Website: ${website || "N/A"}
- LinkedIn: ${linkedin_url || "N/A"}

Extracted Website Content:
${scrapedContent}

Now, generate a 60-second explainer video script that reflects the brand and offerings.
`;

    // Call OpenRouter API
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
    const scriptContent =
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.delta?.content ||
      "No script generated";

    // Email Template
    const emailTemplate = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Hey ${business_name || "there"}, here’s your generated explainer video script!</h2>
        <p><strong>Website:</strong> ${website || "N/A"}</p>
        <p><strong>LinkedIn:</strong> ${linkedin_url || "N/A"}</p>
        <hr />
        <pre style="white-space: pre-wrap; font-family: monospace; background:#f4f4f4; padding:10px;">
${scriptContent}
        </pre>
        <br />
        <p>Best,<br/>Explainer Script Generator Team</p>
      </div>
    `;

    // Send Email via GMAIL
    if (email) {
      await sendEmail(email, "Your Explainer Video Script", emailTemplate);
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGINS || "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Script generated and sent via email",
        script: scriptContent,
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
