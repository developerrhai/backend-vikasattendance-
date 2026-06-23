const { sendWhatsAppMessage } = require("../services/whatsappService");

/**
 * Send a WhatsApp notification for a single biometric punch event.
 * @param {Object} log  A single SmartOffice log entry
 */
async function sendWhatsApp(log) {
  try {
    const studentName = log.EmployeeName || "Student";
    const status      = log.InOutMode === 0 ? "Present" : "Exited";
    
    // Format full date time for punch time variable
    const time = new Date(log.LogDate || log.DateTime).toLocaleString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const mobile = log.Mobile || log.ContactNumber;
    if (!mobile || mobile === "91XXXXXXXXXX") {
      console.log(`[WhatsApp Watcher] Skipped ${studentName} — no valid mobile number`);
      return;
    }

    const data = await sendWhatsAppMessage(mobile, studentName, status, time);
    console.log(`[WhatsApp Watcher] ✅ Sent to ${studentName} (${mobile})`);
    return data;
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.response?.data || err.message;
    console.error(`[WhatsApp Watcher] ❌ Failed for ${log.EmployeeName || "Unknown"}:`, errorMsg);
  }
}

module.exports = sendWhatsApp;
