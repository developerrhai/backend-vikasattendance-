const express = require("express");
const { getPool, query } = require("../config/db");
const { fetchBiometricLogs, buildAttendanceRecords } = require("../services/smartoffice");

const router = express.Router();

/**
 * Escapes a field for CSV format.
 * If the field contains quotes, commas, or newlines, it wraps it in double quotes and escapes inner double quotes.
 */
function escapeCSV(field) {
  if (field === null || field === undefined) return "";
  const str = String(field);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/reports/download
 * Generates and streams a CSV report.
 * Query Params:
 *  - reportType: 'attendance', 'enrollment', 'fee'
 *  - startDate: YYYY-MM-DD
 *  - endDate: YYYY-MM-DD
 *  - batchId: (optional) ID of the batch to filter
 */
router.get("/download", async (req, res) => {
  const { reportType, startDate, endDate, batchId } = req.query;

  if (!reportType) {
    return res.status(400).json({ success: false, error: "reportType is required" });
  }

  try {
    // Set response headers for CSV download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${reportType}_report_${new Date().getTime()}.csv"`);

    if (reportType === "attendance") {
      const headers = ["Date", "Student Code", "Name", "Batch ID", "Status", "Punch In", "Punch Out", "Manually Edited"];
      res.write(headers.map(escapeCSV).join(",") + "\n");

      // Generate date range
      const todayStr = new Date().toISOString().split("T")[0];
      const start = startDate || todayStr;
      const end = endDate || todayStr;

      const startD = new Date(start + "T00:00:00");
      const endD = new Date(end + "T00:00:00");

      if (isNaN(startD.getTime()) || isNaN(endD.getTime())) {
        return res.status(400).json({ success: false, error: "Invalid date format" });
      }

      const diffTime = Math.abs(endD - startD);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays > 31) {
        return res.status(400).json({ success: false, error: "Date range cannot exceed 31 days" });
      }

      const dates = [];
      let current = new Date(startD);
      while (current <= endD) {
        const yyyy = current.getFullYear();
        const mm = String(current.getMonth() + 1).padStart(2, '0');
        const dd = String(current.getDate()).padStart(2, '0');
        dates.push(`${yyyy}-${mm}-${dd}`);
        current.setDate(current.getDate() + 1);
      }

      // Query students (filtered by batch if specified)
      let studentSql = "SELECT * FROM students";
      let studentParams = [];
      if (batchId && batchId !== "all") {
        studentSql = `
          SELECT s.* 
          FROM students s
          JOIN student_batches sb ON s.code = sb.student_code
          WHERE sb.batch_id = ?
        `;
        studentParams.push(batchId);
      }
      studentSql += " ORDER BY name ASC";
      const students = await query(studentSql, studentParams);

      // Query batch mappings
      const mappings = await query(
        `SELECT sb.student_code, sb.batch_id, b.name, b.start_time, b.end_time, b.late_grace_minutes 
         FROM student_batches sb
         JOIN batches b ON sb.batch_id = b.id`
      );
      
      const studentBatchesMap = new Map();
      for (const m of mappings) {
        const code = String(m.student_code).trim();
        if (!studentBatchesMap.has(code)) studentBatchesMap.set(code, []);
        studentBatchesMap.get(code).push({
          id: m.batch_id,
          name: m.name,
          start_time: m.start_time,
          end_time: m.end_time,
          late_grace_minutes: m.late_grace_minutes,
        });
      }

      // Query leaves for the date range
      const leaveRows = await query(
        "SELECT student_code, date, batch_id FROM leaves WHERE date BETWEEN ? AND ?",
        [start, end]
      );
      const leavesByDate = new Map();
      for (const r of leaveRows) {
        const dateStr = typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().split('T')[0];
        if (!leavesByDate.has(dateStr)) {
          leavesByDate.set(dateStr, new Set());
        }
        leavesByDate.get(dateStr).add(`${String(r.student_code).trim()}:${r.batch_id || "null"}`);
      }

      // Query overrides for the date range
      const overrideRows = await query(
        "SELECT * FROM attendance_overrides WHERE date BETWEEN ? AND ?",
        [start, end]
      );
      const overridesByDate = new Map();
      for (const r of overrideRows) {
        const dateStr = typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().split('T')[0];
        if (!overridesByDate.has(dateStr)) {
          overridesByDate.set(dateStr, new Map());
        }
        overridesByDate.get(dateStr).set(`${String(r.student_code).trim()}:${r.batch_id || "null"}`, r);
      }

      // Fetch biometric logs from SmartOffice for range
      let logs = [];
      try {
        logs = await fetchBiometricLogs(start, end);
      } catch (err) {
        console.warn(`[Reports] SmartOffice error (proceeding with DB data): ${err.message}`);
      }

      const logsByDate = new Map();
      for (const log of logs) {
        const logTime = log.LogDate || log.DateTime;
        if (!logTime) continue;
        const dateStr = logTime.split(" ")[0]; // YYYY-MM-DD
        if (!logsByDate.has(dateStr)) {
          logsByDate.set(dateStr, []);
        }
        logsByDate.get(dateStr).push(log);
      }

      // Generate and stream records date by date
      for (const dateStr of dates) {
        const dateLogs = logsByDate.get(dateStr) || [];
        const dateLeaveSet = leavesByDate.get(dateStr) || new Set();
        const dateOverrideMap = overridesByDate.get(dateStr) || new Map();

        const dayRecords = buildAttendanceRecords(
          students,
          dateLogs,
          dateStr,
          dateLeaveSet,
          dateOverrideMap,
          studentBatchesMap
        );

        for (const record of dayRecords) {
          // Double check batch filter at record level (especially for student defaults/general batch)
          if (batchId && batchId !== "all" && record.batch.id !== Number(batchId)) {
            continue;
          }

          const values = [
            record.date,
            record.student.code,
            record.student.name,
            record.batch.id || "General",
            record.status,
            record.punchIn || "—",
            record.punchOut || "—",
            record.manuallyEdited ? "Yes" : "No"
          ];

          res.write(values.map(escapeCSV).join(",") + "\n");
        }
      }

      res.end();

    } else if (reportType === "enrollment") {
      const headers = ["Student Code", "Name", "Gender", "Contact", "Roll No", "Standard", "Section", "Parent Name", "Parent Mobile", "Enrolled Batches"];
      res.write(headers.map(escapeCSV).join(",") + "\n");

      let sql = `
        SELECT 
          s.code, 
          s.name, 
          s.gender, 
          s.contact, 
          s.roll_no, 
          s.standard, 
          s.section, 
          s.parent_name, 
          s.parent_mobile,
          GROUP_CONCAT(b.name SEPARATOR '; ') as enrolled_batches
        FROM students s
        LEFT JOIN student_batches sb ON s.code = sb.student_code
        LEFT JOIN batches b ON sb.batch_id = b.id
        WHERE 1=1
      `;
      let params = [];

      if (batchId && batchId !== "all") {
        sql += ` AND s.code IN (SELECT student_code FROM student_batches WHERE batch_id = ?)`;
        params.push(batchId);
      }

      sql += ` GROUP BY s.code ORDER BY s.name ASC`;

      const rows = await query(sql, params);
      for (const row of rows) {
        const values = [
          row.code,
          row.name,
          row.gender,
          row.contact,
          row.roll_no,
          row.standard,
          row.section,
          row.parent_name,
          row.parent_mobile,
          row.enrolled_batches
        ];
        res.write(values.map(escapeCSV).join(",") + "\n");
      }
      res.end();

    } else if (reportType === "fee") {
      const headers = ["Payment Date", "Student Code", "Name", "Amount", "Payment Method", "Remarks"];
      res.write(headers.map(escapeCSV).join(",") + "\n");

      let sql = `
        SELECT 
          f.payment_date, 
          f.student_code, 
          s.name, 
          f.amount, 
          f.payment_method, 
          f.remarks 
        FROM fees f
        JOIN students s ON f.student_code = s.code
        WHERE 1=1
      `;
      let params = [];

      if (startDate && endDate) {
        sql += ` AND f.payment_date BETWEEN ? AND ?`;
        params.push(startDate, endDate);
      }

      if (batchId && batchId !== "all") {
        sql += ` AND EXISTS (SELECT 1 FROM student_batches sb WHERE sb.student_code = f.student_code AND sb.batch_id = ?)`;
        params.push(batchId);
      }

      sql += ` ORDER BY f.payment_date DESC, s.name ASC`;

      const rows = await query(sql, params);
      for (const row of rows) {
        const values = [
          row.payment_date,
          row.student_code,
          row.name,
          row.amount,
          row.payment_method,
          row.remarks
        ];
        res.write(values.map(escapeCSV).join(",") + "\n");
      }
      res.end();

    } else {
      return res.status(400).json({ success: false, error: "Invalid reportType" });
    }

  } catch (error) {
    console.error("[Reports] Generation Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Failed to generate report" });
    } else {
      res.end();
    }
  }
});

module.exports = router;
