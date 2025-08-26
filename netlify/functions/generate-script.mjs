import * as cheerio from "cheerio";
import nodemailer from "nodemailer";

const SCRIPT_INSTRUCTIONS = (process.env.SCRIPT_INSTRUCTIONS || `
You are an Explainer Video Script Generator Expert. Follow these instructions carefully:

The generated script should follow this format only (map-style output with headings):

 HOOK (0–8s)  
Biggest pain point or striking statement.

 PROBLEM (8–18s)  
Describe the challenge clearly and simply.

 SOLUTION (18–36s)  
Introduce the brand/product as the answer. Keep it impactful.

 TRUST (36–48s)  
Show proof, industries served, case studies, or results.

 CLOSE (48–60s)  
End strong with a clear CTA.

 Keep conversational, no jargon  
 Never exceed 60 seconds  
 Must look visually structured in email  
 End with CTA
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

// ---------- Email Sender ----------
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

Now, generate a structured 60-second explainer video script in map format.
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
      "No script generated";

    // ---------- Email Template ----------
    const emailTemplate = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Email</title>
  </head>
  <body style="margin:0; padding:0; background:#f3e8ff; font-family: Arial, sans-serif; color:#111827;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:30px 0;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background:#fff; border:2px solid #8b5cf6; border-radius:12px; overflow:hidden;">
            
            <!-- Logo -->
            <tr>
              <td align="center" style="padding:25px;">
                <img src="https://beliv8motion.com/wp-content/uploads/2024/03/Logo_Animation_Website_2-2.gif" alt="Logo" width="180" />
              </td>
            </tr>

            <!-- Greeting -->
            <tr>
              <td style="padding:0 30px 25px 30px;">
                <h2 style="margin:0; font-size:22px; color:#4c1d95;">Hey ${business_name || "there"},</h2>
                <p style="margin-top:10px; font-size:15px; line-height:1.6; color:#374151;">
                  Here’s your <strong>amazing script</strong>  
                  Below it, you’ll also find some <strong>reference videos</strong> and the <strong>process we follow after the script phase</strong>.
                </p>
              </td>
            </tr>

            <!-- Script Section -->
            <tr>
              <td style="padding:25px 30px;">
                <h3 style="margin:0 0 15px; font-size:20px; color:#4c1d95;"> Your Explainer Script</h3>
                <div style="background:#f9fafb; padding:18px; border-radius:10px; font-size:14px; line-height:1.6; color:#111827; font-family:monospace; white-space:pre-wrap;">
${scriptContent}
                </div>
              </td>
            </tr>

            <!-- Reference Videos -->
            <tr>
              <td style="padding:20px 30px;">
                <h3 style="margin:0 0 18px; font-size:20px; color:#4c1d95;"> Reference Videos</h3>

                ${[
                  { title: "No Motion Design Clients? Here's How to Fix It!", url: "https://www.youtube.com/watch?v=C0L6WipiDM0" },
                  { title: "How I'd Start My Freelance Business in 2024", url: "https://www.youtube.com/watch?v=f63piAO9k1Y" },
                  { title: "How I'd Attract My Ideal Clients", url: "https://www.youtube.com/watch?v=GsiUzFcQGdo" }
                ].map(video => `
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                    <tr>
                      <td width="40%">
                        <a href="${video.url}" target="_blank">
                          <img src="https://img.youtube.com/vi/${video.url.split("v=")[1]}/0.jpg" alt="Thumbnail" style="width:100%; border-radius:10px;" />
                        </a>
                      </td>
                      <td width="60%" style="padding-left:15px; vertical-align:middle;">
                        <h4 style="margin:0 0 8px; font-size:15px; color:#111827;">${video.title}</h4>
                        <a href="${video.url}" target="_blank" style="background:#8b5cf6; color:#fff; text-decoration:none; padding:8px 14px; border-radius:6px; font-size:13px;">Watch on YouTube</a>
                      </td>
                    </tr>
                  </table>
                `).join("")}
              </td>
            </tr>

            <!-- Process Section -->
            <tr>
              <td style="padding:25px 30px; background:#f5f3ff; border-top:2px solid #8b5cf6;">
                <h3 style="margin:0 0 15px; font-size:20px; color:#4c1d95;"> Our Process</h3>
                <div style="text-align:center;">
                  <a href="https://www.youtube.com/watch?v=lA1ibjcOwTY" target="_blank">
                    <img src="https://img.youtube.com/vi/lA1ibjcOwTY/0.jpg" alt="Process Video" width="100%" style="max-width:500px; border-radius:10px;" />
                  </a>
                </div>
              </td>
            </tr>

            <!-- CTA -->
            <tr>
              <td style="padding:25px 30px;">
                <p style="font-size:15px; color:#374151; line-height:1.6;">
                  If you’re interested in taking the <strong>video production process ahead</strong>, just reply to this email. 
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
      const subject = `${business_name || "Your Brand"} | Explainer Video Script x Believit`;
      await sendEmail(email, subject, emailTemplate);
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Script generated and sent via email",
        script: scriptContent,
        scraped_data: scrapedContent,
      }),
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
