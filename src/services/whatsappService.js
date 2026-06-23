const axios = require("axios");

// Retrieve variables from environment or use defaults matching the frontend
const WHATSASSURE_URL =
  process.env.WHATSASSURE_API_URL ||
  "https://crmapi.whatsassure.com//api/meta/v19.0/1167639093088437/messages";

const WHATSASSURE_TOKEN = process.env.WHATSASSURE_TOKEN || "";
const TEMPLATE_NAME = process.env.WHATSASSURE_TEMPLATE_NAME || "present";
const TEMPLATE_LANGUAGE = process.env.WHATSASSURE_TEMPLATE_LANGUAGE || "en";

/**
 * Format YYYY-MM-DD → "23 June 2026"
 */
function formatDate(dateStr) {
  if (!dateStr) return "";
  // Check if it's a simple YYYY-MM-DD date
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    try {
      const [year, month, day] = dateStr.split("-").map(Number);
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch (err) {
      return dateStr;
    }
  }
  return dateStr;
}

/**
 * Normalize phone number to E.164 (91XXXXXXXXXX for India).
 */
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return "91" + digits.slice(1);
  if (digits.length > 10) return digits; // already has country code
  return null; // invalid
}

/**
 * Format status string nicely for parent template
 */
function formatStatusText(status) {
  if (status === "Present") return "been marked Present";
  if (status === "Absent") return "been marked Absent";
  if (status === "Late") return "been marked Late";
  if (status === "On Leave") return "been marked On Leave";
  return `been marked ${status}`;
}

/**
 * Send a single WhatsApp message via Whatsassure proxy API.
 * 
 * Template:
 *   Respected Parent,
 *   {{1}} has {{2}} at Vikas Academy {{3}}.
 *   Thank you!
 * 
 * @param {string} phone 
 * @param {string} studentName 
 * @param {string} status 
 * @param {string} dateStr 
 */
async function sendWhatsAppMessage(phone, studentName, status, dateStr) {
  const token = (WHATSASSURE_TOKEN || "").trim();
  if (!token) {
    throw new Error("WHATSASSURE_TOKEN environment variable is not set.");
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new Error(`Invalid phone number format: "${phone}"`);
  }

  const formattedDate = formatDate(dateStr);
  const statusText = formatStatusText(status);

  const payload = {
    messaging_product: "whatsapp",
    to: normalizedPhone,
    type: "template",
    template: {
      name: TEMPLATE_NAME.trim(),
      language: { code: TEMPLATE_LANGUAGE.trim() },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: studentName },        // {{1}}
            { type: "text", text: statusText },          // {{2}}
            { type: "text", text: formattedDate },       // {{3}}
          ],
        },
      ],
    },
  };

  const response = await axios.post(WHATSASSURE_URL, payload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    timeout: 30000,
  });

  return response.data;
}

module.exports = {
  normalizePhone,
  formatDate,
  formatStatusText,
  sendWhatsAppMessage,
};
