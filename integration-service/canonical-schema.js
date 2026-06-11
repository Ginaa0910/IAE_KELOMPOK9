/**
 * ============================================================
 * CANONICAL DATA MODEL (CDM)
 * Enterprise Application Integration — HR Enterprise System
 * ============================================================
 *
 * Ini adalah format pesan STANDAR INTERNAL yang digunakan oleh
 * Integration Service saat mem-forward pesan ke semua downstream
 * service (attendance_queue, payroll_queue).
 *
 * Semua pesan yang masuk ke `integration_queue` — baik dalam
 * format JSON (dari HRIS) maupun XML (dari Attendance Service) —
 * WAJIB dikonversi ke format CDM ini sebelum diteruskan.
 *
 * EIP Pattern: Canonical Data Model
 * Referensi: https://www.enterpriseintegrationpatterns.com/patterns/messaging/CanonicalDataModel.html
 */

/**
 * @typedef {Object} CanonicalMessage
 * @property {string}  employeeId     - ID unik karyawan (format: EMP-XXXXXX)
 * @property {string}  employeeName   - Nama lengkap karyawan
 * @property {number}  attendanceDays - Jumlah hari hadir yang ditambahkan pada event ini.
 *                                      Bernilai 1 jika status 'Hadir', 0 jika Sakit/Izin/Alpa.
 *                                      Untuk event EmployeeCreated, nilainya selalu 0.
 * @property {number}  salary         - Gaji pokok karyawan (Rupiah).
 *                                      Diisi untuk event EmployeeCreated; 0 untuk AttendanceSubmitted.
 * @property {string}  eventType      - Tipe event. Menentukan routing di Content-Based Router.
 *                                      Nilai valid: 'EmployeeCreated' | 'AttendanceSubmitted'
 * @property {string}  timestamp      - Waktu event dibuat (ISO 8601 format)
 */

/**
 * Contoh Canonical Message untuk event EmployeeCreated:
 *
 * {
 *   "employeeId":     "EMP-171758",
 *   "employeeName":   "Budi Santoso",
 *   "attendanceDays": 0,
 *   "salary":         8000000,
 *   "eventType":      "EmployeeCreated",
 *   "timestamp":      "2026-06-05T10:00:00.000Z"
 * }
 *
 * Contoh Canonical Message untuk event AttendanceSubmitted
 * (hasil transformasi dari XML ke JSON oleh Message Translator):
 *
 * {
 *   "employeeId":     "EMP-171758",
 *   "employeeName":   "Budi Santoso",
 *   "attendanceDays": 1,
 *   "salary":         0,
 *   "eventType":      "AttendanceSubmitted",
 *   "timestamp":      "2026-06-05T09:00:00.000Z"
 * }
 */

/**
 * Validates that a message conforms to the Canonical Data Model.
 * Throws an Error if validation fails.
 *
 * @param {object} msg - The message object to validate
 * @returns {boolean} true if valid
 */
function validateCanonicalMessage(msg) {
  const requiredFields = ['employeeId', 'employeeName', 'eventType', 'timestamp'];
  for (const field of requiredFields) {
    if (msg[field] === undefined || msg[field] === null || msg[field] === '') {
      throw new Error(`[CDM Validation] Missing required field: '${field}'`);
    }
  }

  const validEventTypes = ['EmployeeCreated', 'AttendanceSubmitted'];
  if (!validEventTypes.includes(msg.eventType)) {
    throw new Error(`[CDM Validation] Invalid eventType: '${msg.eventType}'. Must be one of: ${validEventTypes.join(', ')}`);
  }

  if (typeof msg.attendanceDays !== 'number') {
    throw new Error(`[CDM Validation] 'attendanceDays' must be a number, got: ${typeof msg.attendanceDays}`);
  }

  if (typeof msg.salary !== 'number') {
    throw new Error(`[CDM Validation] 'salary' must be a number, got: ${typeof msg.salary}`);
  }

  return true;
}

module.exports = { validateCanonicalMessage };
