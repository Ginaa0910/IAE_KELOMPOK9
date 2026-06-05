const xml2js = require('xml2js');

/**
 * Enterprise Integration Pattern: Message Translator
 * Transforms Attendance XML to Canonical JSON Model
 * @param {string} xmlString 
 * @returns {Promise<object>} Canonical JSON
 */
async function translateXmlToCanonicalJson(xmlString) {
  return new Promise((resolve, reject) => {
    xml2js.parseString(xmlString, { explicitArray: false }, (err, result) => {
      if (err) {
        return reject(new Error('XML parsing failed: ' + err.message));
      }

      // Validate root element
      if (!result || !result.attendance) {
        return reject(new Error('Invalid XML format. Missing root element <attendance>.'));
      }

      const raw = result.attendance;
      
      // Calculate attendanceDays (1 for presence, 0 for absence/excused)
      const attendanceDays = raw.status === 'Hadir' ? 1 : 0;

      // Map to Canonical Data Model format
      const canonical = {
        employeeId: raw.employeeId,
        employeeName: raw.employeeName,
        attendanceDays: attendanceDays,
        salary: 0, // Not present in attendance data, will be updated by Payroll using basicSalary
        eventType: raw.eventType || 'AttendanceSubmitted',
        timestamp: raw.timestamp || new Date().toISOString()
      };

      resolve(canonical);
    });
  });
}

module.exports = {
  translateXmlToCanonicalJson
};
