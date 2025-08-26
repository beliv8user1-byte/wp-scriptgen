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
//     const emailTemplate = `
//       <div style="font-family: Arial, sans-serif; padding: 20px;">
//         <h2>Hey ${business_name || "there"}, here’s your generated explainer video script!</h2>
//         <p><strong>Website:</strong> ${website || "N/A"}</p>
//         <p><strong>LinkedIn:</strong> ${linkedin_url || "N/A"}</p>
//         <hr />
//         <pre style="white-space: pre-wrap; font-family: monospace; background:#f4f4f4; padding:10px;">
// ${scriptContent}
//         </pre>
//         <br />
//         <p>Best,<br/>Explainer Script Generator Team</p>
//       </div>
//     `;


    // ---------- Email Template ----------
const emailTemplate = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Email Template</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f3e8ff; font-family: Arial, sans-serif;">
    <!-- Wrapper -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3e8ff; padding: 30px 0;">
      <tr>
        <td align="center">
          <!-- Main Container -->
          <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border:2px solid #8b5cf6; border-radius:10px; overflow:hidden;">
            <!-- Logo -->
            <tr>
              <td align="center" style="padding:20px;">
                <img src="YOUR_LOGO_URL" alt="Logo" width="180" style="display:block; margin:auto;" />
              </td>
            </tr>
            
            <!-- Header Section -->
            <tr>
              <td style="padding: 0 30px 20px 30px; text-align:left; color:#111827;">
                <h2 style="margin:0; font-size:22px; color:#4c1d95;">Hey ${business_name || "there"},</h2>
                <p style="font-size:15px; line-height:1.6; margin-top:10px; color:#374151;">
                  Over the next few days, I’m going to send you some of our best business and freelancing tips 🚀  
                  Today, I want to share this <strong>ultimate guide</strong> that will help you find more clients and grow your business faster.
                </p>
              </td>
            </tr>

            <!-- Divider -->
            <tr>
              <td>
                <hr style="border:none; border-top:2px solid #8b5cf6; margin:0 30px;" />
              </td>
            </tr>

            <!-- Script Content -->
            <tr>
              <td style="padding:20px 30px; text-align:left; color:#111827;">
                <h3 style="margin:0 0 15px 0; font-size:20px; color:#4c1d95;">🎬 Your Explainer Video Script</h3>
                <pre style="white-space: pre-wrap; font-family: monospace; background:#f4f4f4; padding:15px; border-radius:8px;">
${scriptContent}
                </pre>
              </td>
            </tr>

            <!-- YouTube Cards Section -->
            <tr>
              <td style="padding:20px 30px; text-align:left; color:#111827;">
                <h3 style="margin:0 0 15px 0; font-size:20px; color:#4c1d95;">📺 Watch These Videos</h3>
                ${videoCardsHTML}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:20px 30px; text-align:center; background-color:#f5f3ff;">
                <p style="font-size:13px; color:#6b7280; margin:0;">
                  You are receiving this email because you signed up for updates.  
                  <br />
                  <a href="#" style="color:#8b5cf6; text-decoration:none;">Unsubscribe</a> | <a href="#" style="color:#8b5cf6; text-decoration:none;">Manage Preferences</a>
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
