const axios = require("axios");

/**
 * Send an SMS/RCS notification for a single biometric punch event.
 * @param {Object} log  A single SmartOffice log entry
 */
async function sendSMS(log) {
  try {
    const studentName = log.EmployeeName || "Student";
    
    // Format full date time for punch time variable: DD-MM-YYYY hh:mm A
    const d = new Date(log.LogDate || log.DateTime);
    const pad = (n) => n.toString().padStart(2, '0');
    const dd = pad(d.getDate());
    const mm = pad(d.getMonth() + 1);
    const yyyy = d.getFullYear();
    let hours = d.getHours();
    const minutes = pad(d.getMinutes());
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const time = `${dd}-${mm}-${yyyy} ${pad(hours)}:${minutes} ${ampm}`;

    // Get Mobile number and sanitize
    let mobile = log.Mobile || log.ContactNumber;
    if (!mobile || mobile === "91XXXXXXXXXX") {
      console.log(`[SMS Watcher] Skipped ${studentName} — no valid mobile number`);
      return;
    }
    // Remove any non-digit characters
    mobile = mobile.replace(/\D/g, "");
    // Keep only the last 10 digits to remove leading '0' or '91'
    if (mobile.length > 10) {
      mobile = mobile.slice(-10);
    }
    
    // SMS templates:
    // Check-in (Entry): Hi {#var#} has reached class at {#var#}. VIKAS ACADEMY
    // Check-out (Exit): Hi {#var#} has left class at {#var#}. VIKAS ACADEMY
    const isEntry = log.InOutMode === 0;
    
    let message = "";
    if (isEntry) {
      message = `Hi ${studentName} has reached class at ${time}. VIKAS ACADEMY`;
    } else {
      message = `Hi ${studentName} has left class at ${time}. VIKAS ACADEMY`;
    }

    const encodedMessage = encodeURIComponent(message);
    const apiKey = process.env.BULK_SMS_API_KEY || "5ncEAitMjeeoOujJ";
    const senderId = process.env.BULK_SMS_SENDER_ID || "VKADMY";
    
    const url = `https://bulksmsconnect.in/V2/http-api.php?apikey=${apiKey}&senderid=${senderId}&number=${mobile}&message=${encodedMessage}`;
    
    const res = await axios.get(url, { timeout: 10000 }); // 10 second timeout
    console.log(`[SMS Watcher] ✅ Sent to ${studentName} (${mobile}). API Response:`, res.data);
    return res.data;
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.response?.data || err.message;
    console.error(`[SMS Watcher] ❌ Failed for ${log.EmployeeName || "Unknown"}:`, errorMsg);
  }
}

module.exports = sendSMS;
