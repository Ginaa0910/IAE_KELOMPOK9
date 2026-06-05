/**
 * Enterprise Integration Pattern: Content-Based Router
 * Evaluates message contents (eventType) and determines destination queues.
 * @param {object} payload 
 * @returns {Array<{queue: string, log: string}>} Array of routing destinations
 */
function routeMessage(payload) {
  const destinations = [];

  if (payload.eventType === 'EmployeeCreated') {
    destinations.push({
      queue: 'attendance_queue',
      log: '[EmployeeCreated] RabbitMQ -> Attendance'
    });
    destinations.push({
      queue: 'payroll_queue',
      log: '[EmployeeCreated] RabbitMQ -> Payroll'
    });
  } else if (payload.eventType === 'AttendanceSubmitted') {
    destinations.push({
      queue: 'payroll_queue',
      log: '[PayrollGenerated] Integration -> Payroll'
    });
  }

  return destinations;
}

module.exports = {
  routeMessage
};
