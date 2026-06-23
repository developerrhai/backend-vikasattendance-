const axios = require("axios");
const sendWhatsApp = require("./sendWhatsApp"); // ✅ FIX 1: Missing import
const { query } = require("../config/db"); // ✅ Import DB query to lookup contact info

const SMARTOFFICE_BASE   = process.env.SMARTOFFICE_BASE_URL      || "http://13.232.199.167";
const API_KEY            = process.env.SMARTOFFICE_API_KEY       || "385619062612";
const DEFAULT_SERIAL     = process.env.SMARTOFFICE_SERIAL_NUMBER || "AMDB25121401560";

let lastLogTime = null; // store last processed punch

/**
 * Returns today's date formatted as YYYY-MM-DD.
 */
function todayDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function checkNewPunches() {
  try {
    const today = todayDate();

    // ✅ FIX 2: Include required query params (FromDate, ToDate, SerialNumber)
    const url =
      `${SMARTOFFICE_BASE}/api/v2/WebAPI/GetDeviceLogs` +
      `?APIKey=${API_KEY}` +
      `&FromDate=${today}` +
      `&ToDate=${today}` +
      `&SerialNumber=${DEFAULT_SERIAL}`;

    const res = await axios.get(url, { timeout: 15000 });

    // SmartOffice returns an array directly when successful
    const logs = Array.isArray(res.data) ? res.data : (res.data?.data || []);

    for (const log of logs) {
      const logTime = log.LogDate || log.DateTime;

      // skip old logs
      if (lastLogTime && new Date(logTime) <= new Date(lastLogTime)) {
        continue;
      }

      // update last processed time
      lastLogTime = logTime;

      // Lookup student contact details in database
      try {
        const studentCode = String(log.EmployeeCode).trim();
        const students = await query(
          "SELECT name, parent_mobile, contact FROM students WHERE TRIM(code) = ?",
          [studentCode]
        );

        if (students && students.length > 0) {
          const student = students[0];
          // Populate the log object with name and contact details for sendWhatsApp
          log.EmployeeName = student.name;
          log.Mobile = student.parent_mobile || student.contact;

          // Determine punch direction (In/Out) dynamically based on punch count today
          const studentPunches = logs
            .filter((l) => String(l.EmployeeCode).trim() === studentCode)
            .sort((a, b) => {
              const dateA = new Date((a.LogDate || a.DateTime).replace(" ", "T"));
              const dateB = new Date((b.LogDate || b.DateTime).replace(" ", "T"));
              return dateA - dateB;
            });

          const punchIndex = studentPunches.findIndex(
            (l) => (l.LogDate || l.DateTime) === (log.LogDate || log.DateTime)
          );

          // Even index (0, 2, 4...) -> Entry (0), Odd index (1, 3, 5...) -> Exit (1)
          log.InOutMode = (punchIndex !== -1 && punchIndex % 2 === 0) ? 0 : 1;

          // trigger WhatsApp notification
          await sendWhatsApp(log);
        } else {
          console.log(`[Watcher] Student not found in database for code: ${studentCode}`);
        }
      } catch (dbErr) {
        console.error(`[Watcher] DB Lookup Error for code ${log.EmployeeCode}:`, dbErr.message);
      }

      // ✅ FIX 3: Small delay between WhatsApp sends to avoid rate-limiting
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (err) {
    console.log("[Watcher] Error:", err.message);
  }
}

// Run every 30 seconds (increased from 15s to reduce load)
setInterval(checkNewPunches, 30000);

// Run once on startup after a short delay
setTimeout(checkNewPunches, 5000);

console.log("[Watcher] ✅ Attendance watcher started (polling every 30s)");

module.exports = { checkNewPunches };
