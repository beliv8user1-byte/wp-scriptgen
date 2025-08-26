import * as cheerio from "cheerio";
import nodemailer from "nodemailer";

/* ---------------------------- CONFIG / PROMPT ---------------------------- */
const SCRIPT_INSTRUCTIONS = (process.env.SCRIPT_INSTRUCTIONS || `
You are an Explainer Video Script Generator Expert. Return a concise, 60-second script with clearly labeled sections.
Required sections and order:
HOOK (0–8s)
PROBLEM (8–18s)
SOLUTION (18–36s)
TRUST (36–48s)
CLOSE (48–60s)

Rules:
- Conversational, no jargon
- Include timestamps
- Do not exceed 60 seconds
`).trim();

/* ------------------------------- HELPERS -------------------------------- */
function youtubeId(url = "") {
  const m =
    url.match(/(?:youtube\.com\/.*[?&]v=|youtu\.be\/)([A-Za-z0-9_-]+)/i) ||
    url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : "";
}

// Generates the left-thumb / right-copy + purple button rows
function renderVideoRows(videos = []) {
  return videos
    .map((v, i) => {
      const id = youtubeId(v.url);
      const thumb = id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : "";
      const title = v.title?.trim() || `Reference Video ${i + 1}`;
      const safeUrl = v.url || "#";
      return `
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 16px 0;">
          <tr>
            <!-- Thumbnail -->
            <td width="42%" valign="top" style="padding:0 12px 0 0;">
              <a href="${safeUrl}" target="_blank" style="text-decoration:none;">
                <img src="${thumb}" alt="Video thumbnail" width="100%" style="display:block; width:100%; max-width:240px; border-radius:12px;">
              </a>
            </td>
            <!-- Title + Button -->
            <td width="58%" valign="middle" style="padding:0 0 0 12px;">
              <h4 style="margin:0 0 10px 0; font-size:16px; line-height:1.4; color:#0f172a; font-weight:700;">
                ${title}
              </h4>
              <a href="${safeUrl}" target="_blank"
                 style="display:inline-block; padding:10px 14px; border-radius:9999px; background:#7c3aed; color:#ffffff; font-size:14px; font-weight:600; text-decoration:none;">
                Watch on YouTube
              </a>
            </td>
          </tr>
        </table>
      `;
    })
    .join("");
}

// Parse AI text into {HOOK, PROBLEM, SOLUTION, TRUST, CLOSE}
function parseScript(raw = "") {
  const sections = { HOOK: "", PROBLEM: "", SOLUTION: "", TRUST: "", CLOSE: "" };
  const rx = /(HOOK|PROBLEM|SOLUTION|TRUST|CLOSE)[^\n]*\n+([\s\S]*?)(?=\n(?:HOOK|PROBLEM|SOLUTION|TRUST|CLOSE)|$)/gi;
  let m;
  while ((m = rx.exec(raw))) {
    const key = m[1].toUpperCase();
    const val = (m[2] || "").trim();
    if (sections[key] !== undefined) sections[key] = val;
  }
  // Fallback: if parsing failed, put the whole thing into SOLUTION
  if (!sections.HOOK && !sections.PROBLEM && !sections.SOLUTION && !sections.TRUST && !sections.CLOSE) {
    sections.SOLUTION = raw.trim();
  }
  return sections;
}

function renderScriptMap(sections) {
  // compact, minimal, consistent spacing — email-safe table layout
  const row = (emoji, title, time, copy) => `
    <tr>
      <td style="padding:12px 0; border-top:1px solid #eae7f9;">
        <div style="font-size:15px; font-weight:700; color:#7c3aed; margin:0 0 6px 0;">
          ${emoji} ${title} <span style="font-weight:500; color:#6b7280;">(${time})</span>
        </div>
        <div style="font-size:14px; line-height:1.6; color:#0f172a; margin:0;">${copy}</div>
      </td>
    </tr>
  `;

  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
           style="background:#f8f7ff; border:1px solid #eae7f9; border-radius:12px; padding:16px;">
      ${row(" ","HOOK","0–8s",sections.HOOK || "—")}
      ${row(" ","PROBLEM","8–18s",sections.PROBLEM || "—")}
      ${row(" ","SOLUTION","18–36s",sections.SOLUTION || "—")}
      ${row(" ","TRUST","36–48s",sections.TRUST || "—")}
      ${row(" ","CLOSE","48–60s",sections.CLOSE || "—")}
    </table>
  `;
}

// Basic site text scrape (for better prompting)
async function scrapeWebsite(url) {
  try {
    const res = await fetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);
    const textParts = [];
    $("h1, h2, h3, p, meta[name='description']").each((_, el) => {
      const content = $(el).text() || $(el).attr("content");
      if (content && content.trim().length > 30) textParts.push(content.trim());
    });
    return textParts.slice(0, 30).join("\n\n");
  } catch (err) {
    return `Error scraping site: ${err.message}`;
  }
}

// Gmail SMTP
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
    from: `"Explainer Script Generator" <${process.env.GMAIL_EMAIL}>`,
    to,
    subject,
    html: htmlContent,
  });
}

/* ------------------------------- HANDLER -------------------------------- */
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

    // Allow passing custom reference videos: [{title, url}]
    const reference_videos = Array.isArray(body.reference_videos) && body.reference_videos.length
      ? body.reference_videos
      : [
          { url: "https://www.youtube.com/watch?v=C0L6WipiDM0" },
          { url: "https://www.youtube.com/watch?v=f63piAO9k1Y" },
          { url: "https://www.youtube.com/watch?v=GsiUzFcQGdo" },
        ];

    // Process video (mega card)
    const processVideoUrl = body.process_video_url || "https://www.youtube.com/watch?v=lA1ibjcOwTY";
    const processId = youtubeId(processVideoUrl);
    const processThumb = processId ? `https://img.youtube.com/vi/${processId}/hqdefault.jpg` : "";

    let scrapedContent = "";
    if (website) scrapedContent = await scrapeWebsite(website);

    const prompt = `
${SCRIPT_INSTRUCTIONS}

Company Details:
- Business Name: ${business_name || "N/A"}
- Website: ${website || "N/A"}
- LinkedIn: ${linkedin_url || "N/A"}

Extracted Website Content:
${scrapedContent}

Now, generate a structured 60-second explainer video script using the required section headings exactly.
`;

    // Generate script
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const scriptRaw =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.delta?.content ||
      "";

    const scriptSections = parseScript(scriptRaw);
    const scriptHTML = renderScriptMap(scriptSections);

    /* --------------------------- EMAIL TEMPLATE --------------------------- */
    const emailHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Motion Hatch Email</title>
  <style>
    body {
      font-family: Roboto, Arial, sans-serif;
      font-size: 16px;
      line-height: 28px;
      color: #000;
      margin: 0;
      padding: 0;
      background: #f8f8f8;
    }
    .container {
      width: 100%;
      max-width: 600px;
      margin: 20px auto;
      background: #fff;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 0 10px rgba(0,0,0,0.05);
    }
    h1, h2, h3 {
      margin: 16px 0 8px;
    }
    a {
      color: #0B83FF;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .button {
      display: inline-block;
      background: #2BD5D4;
      color: #fff !important;
      padding: 12px 20px;
      border-radius: 6px;
      text-decoration: none;
      margin: 12px 0;
      font-weight: bold;
    }
    .footer {
      font-size: 13px;
      color: #666;
      text-align: center;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Hey Ab!</h1>
    <p>Over the next few days, I'm going to send you some of our best content and free resources. Enjoy!</p>
    <p>Today, I want to share the most helpful YouTube videos I've created to help you attract more clients.</p>
    <p><strong>Bookmark this email so you can come back to it!</strong></p>

    <h2>🎥 My Ultimate Guide to Getting Hired</h2>
    <p><a href="https://youtu.be/Xebd2eBWCSU" class="button">Watch on YouTube</a></p>

    <h2>No Motion Design Clients? Here's How to Fix It!</h2>
    <p><a href="https://youtu.be/Xebd2eBWCSU" class="button">Watch on YouTube</a></p>

    <h2>How I'd Start My Freelance Business in 2024</h2>
    <p><a href="https://youtu.be/M4UJw4V0iN8" class="button">Watch on YouTube</a></p>

    <h2>How I'd Get Direct Clients Starting From 0</h2>
    <p><a href="https://youtu.be/iXUVuzDDE7g" class="button">Watch on YouTube</a></p>

    <h2>How I’d Attract My Ideal Clients (without losing my current ones)</h2>
    <p><a href="https://youtu.be/KY2PD7jU0Sg" class="button">Watch on YouTube</a></p>

    <h2>How to Price Your Motion Design Work in 2024</h2>
    <p><a href="https://youtu.be/FId64n_zAXg" class="button">Watch on YouTube</a></p>

    <p>If you have any questions or need any help, just reply to this email. I’d love to help you with your motion design business!</p>

    <p>– Hayley</p>

    <p>P.S. Looking for more? Visit my <a href="https://www.youtube.com/motionhatch">YouTube channel</a> or explore:</p>
    <ul>
      <li><a href="https://motionhatch.com/client-quest">Join Client Quest – get regular high-paying clients</a></li>
      <li><a href="https://motionhatch.com/balanced-business-bootcamp">Balanced Business Bootcamp – 12 months of mentorship</a></li>
      <li><a href="https://calendly.com/motionhatch/private-coaching">Work with me 1-1</a></li>
      <li><a href="https://motionhatch.notion.site/Newsletter-Sponsorship">Sponsor this newsletter</a></li>
    </ul>

    <div class="footer">
      Motion Hatch, 27 Old Gloucester Street, London, WC1N 3AX<br>
      <a href="#">Unsubscribe</a>
    </div>
  </div>
</body>
</html>

`;

    // Send Email
    if (email) {
      const subject = `${business_name || "Your Brand"} | Explainer Video Script × Beliv8`;
      await sendEmail(email, subject, emailHTML);
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGINS || "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Script generated and sent via email",
        script: scriptRaw,
        parsed_sections: scriptSections,
        scraped_data: scrapedContent,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
