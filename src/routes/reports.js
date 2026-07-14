const express = require("express");
const { getPool, query } = require("../config/db");

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

    let sql = "";
    let params = [];
    let headers = [];

    if (reportType === "attendance") {
      headers = ["Date", "Student Code", "Name", "Batch ID", "Status", "Punch In", "Punch Out", "Manually Edited"];
      
      sql = `
        SELECT 
          o.date, 
          o.student_code, 
          s.name, 
          o.batch_id, 
          o.status, 
          o.punch_in, 
          o.punch_out, 
          o.manually_edited 
        FROM attendance_overrides o
        JOIN students s ON o.student_code = s.code
        WHERE 1=1
      `;
      
      if (startDate && endDate) {
        sql += ` AND o.date BETWEEN ? AND ?`;
        params.push(startDate, endDate);
      }
      
      if (batchId && batchId !== "all") {
        sql += ` AND o.batch_id = ?`;
        params.push(batchId);
      }
      
      sql += ` ORDER BY o.date DESC, s.name ASC`;
      
    } else if (reportType === "enrollment") {
      headers = ["Student Code", "Name", "Gender", "Contact", "Roll No", "Standard", "Section", "Parent Name", "Parent Mobile", "Enrolled Batches"];
      
      // We will group concat batches for the student
      sql = `
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
      
      if (batchId && batchId !== "all") {
        sql += ` AND sb.batch_id = ?`;
        params.push(batchId);
      }
      
      sql += ` GROUP BY s.code ORDER BY s.name ASC`;

    } else if (reportType === "fee") {
      headers = ["Payment Date", "Student Code", "Name", "Amount", "Payment Method", "Remarks"];
      
      sql = `
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
      
      if (startDate && endDate) {
        sql += ` AND f.payment_date BETWEEN ? AND ?`;
        params.push(startDate, endDate);
      }
      
      // Fee filtering by batch means the student must be in that batch
      if (batchId && batchId !== "all") {
        sql += ` AND EXISTS (SELECT 1 FROM student_batches sb WHERE sb.student_code = f.student_code AND sb.batch_id = ?)`;
        params.push(batchId);
      }
      
      sql += ` ORDER BY f.payment_date DESC, s.name ASC`;
      
    } else {
      return res.status(400).json({ success: false, error: "Invalid reportType" });
    }

    // Write headers
    res.write(headers.map(escapeCSV).join(",") + "\n");

    // Execute query and stream data
    // While the pool wrapper returns a promise of all rows, fetching them locally and looping through `res.write` handles formatting synchronously and pushes chunks to the client.
    const rows = await query(sql, params);
    
    for (const row of rows) {
      const values = headers.map((_h, index) => {
        // Map row values to headers sequentially based on order in SELECT
        const keys = Object.keys(row);
        return escapeCSV(row[keys[index]]);
      });
      res.write(values.join(",") + "\n");
    }

    // Close response stream
    res.end();

  } catch (error) {
    console.error("[Reports] Generation Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Failed to generate report" });
    } else {
      res.end(); // End stream if error occurs midway
    }
  }
});

module.exports = router;
