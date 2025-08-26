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
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${business_name || "Your Brand"} | Explainer Video Script × Beliv8</title>
</head>
<body style="margin:0; padding:0; background:#efe9ff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe9ff; padding:28px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff; border:1px solid #c7b9ff; border-radius:16px; overflow:hidden;">
          
          <!-- TOP: Logo -->
          <tr>
            <td align="center" style="padding:24px 24px 8px 24px;">
              <img src="https://beliv8motion.com/wp-content/uploads/2024/03/Logo_Animation_Website_2-2.gif" width="160" alt="Beliv8 Logo" style="display:block;">
            </td>
          </tr>

          <!-- Greeting / Intro -->
          <tr>
            <td style="padding:0 28px 20px 28px;">
              <h2 style="margin:0; font-size:22px; line-height:1.3; color:#6d28d9; font-weight:800;">
                Hey ${business_name || "there"},
              </h2>
              <p style="margin:8px 0 0 0; font-size:15px; line-height:1.6; color:#334155;">
                Here’s your <strong>amazing script</strong>. Below you’ll also find a few <strong>reference videos</strong> and the <strong>process we follow after the script phase</strong>.
              </p>
            </td>
          </tr>

          <!-- Script Map -->
          <tr>
            <td style="padding:4px 28px 24px 28px;">
              <h3 style="margin:0 0 12px 0; font-size:18px; line-height:1.3; color:#6d28d9; font-weight:800;">Your Explainer Script</h3>
              ${scriptHTML}
            </td>
          </tr>

          <!-- Reference Videos -->
          <tr>
            <td style="padding:0 28px 8px 28px;">
              <h3 style="margin:0 0 12px 0; font-size:18px; line-height:1.3; color:#6d28d9; font-weight:800;">Reference Videos</h3>
              ${renderVideoRows(reference_videos)}
            </td>
          </tr>

          <!-- Process (Mega Card) -->
          <tr>
            <td style="padding:8px 28px 24px 28px;">
              <h3 style="margin:0 0 12px 0; font-size:18px; line-height:1.3; color:#6d28d9; font-weight:800;">Our Process</h3>
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                     style="border:1px solid #eae7f9; background:#f8f7ff; border-radius:14px;">
                <tr>
                  <td style="padding:16px;">
                    <a href="${processVideoUrl}" target="_blank" style="text-decoration:none;">
                      <img src="${processThumb}" alt="Our process video" width="100%"
                           style="display:block; width:100%; border-radius:12px;">
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:6px 28px 28px 28px;">
              <p style="margin:0; font-size:15px; line-height:1.7; color:#334155;">
                Interested in taking the <strong>video production process ahead</strong>? Just reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
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
