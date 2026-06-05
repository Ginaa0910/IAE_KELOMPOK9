document.addEventListener('DOMContentLoaded', () => {
  // --- CONFIGURATION ---
  const host = window.location.hostname;
  const currentPort = window.location.port;

  const HRIS_API = `http://${host}:3001`;
  const ATTENDANCE_API = `http://${host}:3002`;
  const PAYROLL_API = `http://${host}:3003`;
  const INTEGRATION_API = `http://${host}:3004`;

  // --- UI ELEMENTS ---
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  const loadedPortBadge = document.getElementById('loaded-port-badge');
  const rabbitDot = document.getElementById('rabbitmq-dot');
  const rabbitLabel = document.getElementById('rabbitmq-label');
  const toast = document.getElementById('toast');

  // HRIS elements
  const hrisForm = document.getElementById('add-employee-form');
  const hrisTableBody = document.getElementById('employee-table-body');
  const hrisCountBadge = document.getElementById('employee-count');

  // Attendance elements
  const attendanceForm = document.getElementById('attendance-form');
  const attendanceEmployeeSelect = document.getElementById('employee-select');
  const attendanceTableBody = document.getElementById('attendance-table-body');
  const attendanceCountBadge = document.getElementById('attendance-count');
  const attendanceDateInput = document.getElementById('attendance-date');

  // Payroll elements
  const payrollGenerateBtn = document.getElementById('generate-payroll-btn');
  const payrollTrackerTableBody = document.getElementById('tracker-table-body');
  const payrollHistoryTableBody = document.getElementById('payroll-table-body');
  const payrollTotalEmployees = document.getElementById('total-employees');
  const payrollTotalExpense = document.getElementById('total-expense');
  const payrollCountBadge = document.getElementById('payroll-count');

  // Integration elements
  const logConsole = document.getElementById('log-console');
  const clearConsoleBtn = document.getElementById('clear-console-btn');
  const totalEventsEl = document.getElementById('total-events-count');
  const totalTranslationsEl = document.getElementById('total-translations-count');
  const totalRoutingsEl = document.getElementById('total-routings-count');
  const filterButtons = document.querySelectorAll('.filter-tab-btn');

  // State variables
  let allLogs = [];
  let currentFilter = 'all';

  // --- TAB NAVIGATION SYSTEM ---
  // Detect active tab from port
  let activeTab = 'hris'; // default
  if (currentPort === '3002') activeTab = 'attendance';
  else if (currentPort === '3003') activeTab = 'payroll';
  else if (currentPort === '3004') activeTab = 'integration';

  loadedPortBadge.textContent = `Server Port: ${currentPort || 'Static'}`;

  // Function to switch tabs
  function switchTab(tabId) {
    activeTab = tabId;

    // Toggle nav items
    navItems.forEach(item => {
      if (item.getAttribute('data-tab') === tabId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Toggle tab panes
    tabContents.forEach(content => {
      if (content.id === `tab-${tabId}`) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });

    // Trigger tab-specific loading
    loadTabContent(tabId);
  }

  // Bind navigation click listeners
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // Init switch
  switchTab(activeTab);

  // Load appropriate data based on tab
  function loadTabContent(tabId) {
    if (tabId === 'hris') {
      loadHrisEmployees();
    } else if (tabId === 'attendance') {
      // Set attendance default date to today
      const today = new Date().toISOString().split('T')[0];
      attendanceDateInput.value = today;
      loadAttendanceEmployeesDropdown();
      loadAttendanceRecords();
    } else if (tabId === 'payroll') {
      loadPayrollData();
    } else if (tabId === 'integration') {
      loadIntegrationLogs();
    }
  }

  // Helper to load all dashboard tabs (triggered on real-time EAI events to stay in sync)
  function reloadAllData() {
    loadHrisEmployees();
    loadAttendanceEmployeesDropdown();
    loadAttendanceRecords();
    loadPayrollData();
    loadIntegrationLogs();
  }

  // --- 1. HRIS LOGIC ---
  async function loadHrisEmployees() {
    try {
      const res = await fetch(`${HRIS_API}/employees`);
      if (!res.ok) throw new Error('Gagal mengambil data karyawan HRIS');
      const employees = await res.json();
      renderHrisEmployees(employees);
    } catch (err) {
      console.error(err);
      hrisTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">
            <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger)"></i>
            <p>Gagal memuat: ${err.message}</p>
          </td>
        </tr>
      `;
    }
  }

  function renderHrisEmployees(employees) {
    hrisCountBadge.textContent = `${employees.length} Karyawan`;
    if (employees.length === 0) {
      hrisTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">
            <i class="fa-solid fa-folder-open"></i>
            <p>Belum ada karyawan. Tambahkan karyawan baru melalui form di samping.</p>
          </td>
        </tr>
      `;
      return;
    }

    // Sort: newest first
    employees.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    hrisTableBody.innerHTML = employees.map(emp => {
      const salaryFormatted = formatIDR(emp.basicSalary);
      const statusBadge = emp.published
        ? `<span class="badge badge-published"><i class="fa-solid fa-circle-check"></i> Published</span>`
        : `<span class="badge badge-draft"><i class="fa-solid fa-circle-pause"></i> Draft</span>`;

      const actionButton = emp.published
        ? `<button class="btn btn-success btn-icon-only" disabled title="Sudah dipublikasi ke EAI">
             <i class="fa-solid fa-cloud-arrow-up"></i> Sent
           </button>`
        : `<button class="btn btn-primary btn-icon-only publish-btn" data-id="${emp.id}" title="Publish Employee Event ke RabbitMQ">
             <i class="fa-solid fa-paper-plane"></i> Publish Event
           </button>`;

      return `
        <tr>
          <td style="font-weight: 600; color: var(--primary);">${emp.id}</td>
          <td>${emp.name}</td>
          <td style="font-size: 0.9rem; color: var(--text-muted);">${emp.email}</td>
          <td>${emp.role}</td>
          <td>${salaryFormatted}</td>
          <td>${statusBadge}</td>
          <td>${actionButton}</td>
        </tr>
      `;
    }).join('');

    // Attach publish listeners
    document.querySelectorAll('#employee-table-body .publish-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        publishHrisEmployee(btn.getAttribute('data-id'), btn);
      });
    });
  }

  async function publishHrisEmployee(id, btn) {
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

    try {
      const response = await fetch(`${HRIS_API}/employees/${id}/publish`, {
        method: 'POST'
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Gagal mempublikasikan event');
      }
      const result = await response.json();
      showToast(result.message, 'success');
      loadHrisEmployees();
    } catch (error) {
      showToast(error.message, 'error');
      btn.disabled = false;
      btn.innerHTML = originalHTML;
    }
  }

  hrisForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('employee-name').value;
    const email = document.getElementById('employee-email').value;
    const role = document.getElementById('employee-role').value;
    const basicSalary = document.getElementById('employee-salary').value;

    const btn = hrisForm.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

    try {
      const response = await fetch(`${HRIS_API}/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, role, basicSalary })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Gagal menambahkan karyawan');
      }

      showToast('Karyawan berhasil ditambahkan sebagai Draft!', 'success');
      hrisForm.reset();
      loadHrisEmployees();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

  // --- 2. ATTENDANCE LOGIC ---
  async function loadAttendanceEmployeesDropdown() {
    try {
      const response = await fetch(`${ATTENDANCE_API}/employees`);
      if (!response.ok) throw new Error('Gagal memuat data karyawan presensi');
      const employees = await response.json();

      if (employees.length === 0) {
        attendanceEmployeeSelect.innerHTML = `<option value="" disabled selected>Belum ada karyawan. Publish dari HRIS terlebih dahulu.</option>`;
        return;
      }

      attendanceEmployeeSelect.innerHTML = `
        <option value="" disabled selected>Pilih Karyawan...</option>
        ${employees.map(emp => `<option value="${emp.id}">${emp.name} (${emp.id})</option>`).join('')}
      `;
    } catch (error) {
      console.error(error);
      attendanceEmployeeSelect.innerHTML = `<option value="" disabled selected>Terjadi kesalahan memuat data.</option>`;
    }
  }

  async function loadAttendanceRecords() {
    try {
      const response = await fetch(`${ATTENDANCE_API}/attendance`);
      if (!response.ok) throw new Error('Gagal memuat riwayat presensi');
      const attendances = await response.json();
      renderAttendanceRecords(attendances);
    } catch (error) {
      console.error(error);
      attendanceTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state">
            <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger)"></i>
            <p>Gagal memuat: ${error.message}</p>
          </td>
        </tr>
      `;
    }
  }

  function renderAttendanceRecords(attendances) {
    attendanceCountBadge.textContent = `${attendances.length} Rekor`;
    if (attendances.length === 0) {
      attendanceTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state">
            <i class="fa-solid fa-folder-open"></i>
            <p>Belum ada riwayat presensi yang tercatat.</p>
          </td>
        </tr>
      `;
      return;
    }

    // Sort: newest first
    attendances.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    attendanceTableBody.innerHTML = attendances.map(att => {
      let statusClass = 'hadir';
      if (att.status === 'Sakit') statusClass = 'sakit';
      if (att.status === 'Izin') statusClass = 'izin';
      if (att.status === 'Alpa') statusClass = 'alpa';

      const formattedDate = new Date(att.date).toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      return `
        <tr>
          <td style="font-weight: 600; color: var(--primary);">${att.id}</td>
          <td style="font-weight: 500;">${att.employeeId}</td>
          <td>${att.employeeName}</td>
          <td>${formattedDate}</td>
          <td><span class="badge badge-${statusClass}">${att.status}</span></td>
          <td><span class="badge badge-synced"><i class="fa-solid fa-cloud-arrow-up"></i> Sent to RabbitMQ</span></td>
        </tr>
      `;
    }).join('');
  }

  attendanceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const employeeId = attendanceEmployeeSelect.value;
    const date = attendanceDateInput.value;
    const status = document.getElementById('attendance-status').value;

    if (!employeeId || !date || !status) {
      showToast('Harap isi semua input!', 'error');
      return;
    }

    const btn = attendanceForm.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';

    try {
      const response = await fetch(`${ATTENDANCE_API}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, date, status })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Gagal menyimpan presensi');
      }

      showToast('Presensi berhasil disubmit dan event XML dipublikasikan ke EAI!', 'success');
      attendanceForm.reset();
      const today = new Date().toISOString().split('T')[0];
      attendanceDateInput.value = today; // Reset date to today
      loadAttendanceRecords();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

  // --- 3. PAYROLL LOGIC ---
  async function loadPayrollData() {
    try {
      await Promise.all([
        loadPayrollTracker(),
        loadPayrollHistory()
      ]);
    } catch (error) {
      console.error('Error loading payroll tab content:', error);
    }
  }

  async function loadPayrollTracker() {
    try {
      const response = await fetch(`${PAYROLL_API}/employees`);
      if (!response.ok) throw new Error('Gagal memuat tracker kehadiran payroll');
      const employees = await response.json();
      payrollTotalEmployees.textContent = `${employees.length} Karyawan`;
      renderPayrollTracker(employees);
    } catch (err) {
      console.error(err);
      payrollTrackerTableBody.innerHTML = `
        <tr>
          <td colspan="4" class="empty-state">
            <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger)"></i>
            <p>Gagal memuat: ${err.message}</p>
          </td>
        </tr>
      `;
    }
  }

  function renderPayrollTracker(employees) {
    if (employees.length === 0) {
      payrollTrackerTableBody.innerHTML = `
        <tr>
          <td colspan="4" class="empty-state">
            <i class="fa-solid fa-user-slash"></i>
            <p>Belum ada data karyawan. Sinkronkan dari HRIS via EAI terlebih dahulu.</p>
          </td>
        </tr>
      `;
      return;
    }

    payrollTrackerTableBody.innerHTML = employees.map(emp => {
      const salaryFormatted = formatIDR(emp.basicSalary);
      const days = emp.attendanceDays || 0;
      
      let colorClass = 'style="color: var(--danger); font-weight: bold;"';
      if (days >= 20) colorClass = 'style="color: var(--success); font-weight: bold;"';
      else if (days >= 15) colorClass = 'style="color: var(--warning); font-weight: bold;"';

      return `
        <tr>
          <td style="font-weight: 600; color: var(--primary);">${emp.id}</td>
          <td>${emp.name}</td>
          <td ${colorClass}>${days} / 20 Hari</td>
          <td>${salaryFormatted}</td>
        </tr>
      `;
    }).join('');
  }

  async function loadPayrollHistory() {
    try {
      const response = await fetch(`${PAYROLL_API}/payroll`);
      if (!response.ok) throw new Error('Gagal memuat riwayat payroll');
      const payrolls = await response.json();
      payrollCountBadge.textContent = `${payrolls.length} Slip`;

      const totalOutflow = payrolls.reduce((sum, pay) => sum + (pay.totalSalary || 0), 0);
      payrollTotalExpense.textContent = formatIDR(totalOutflow);

      renderPayrollHistoryTable(payrolls);
    } catch (err) {
      console.error(err);
      payrollHistoryTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state">
            <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger)"></i>
            <p>Gagal memuat: ${err.message}</p>
          </td>
        </tr>
      `;
    }
  }

  function renderPayrollHistoryTable(payrolls) {
    if (payrolls.length === 0) {
      payrollHistoryTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state">
            <i class="fa-solid fa-calculator"></i>
            <p>Belum ada data payroll terhitung. Klik "Generate Payroll Baru" untuk menghitung.</p>
          </td>
        </tr>
      `;
      return;
    }

    payrolls.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));

    payrollHistoryTableBody.innerHTML = payrolls.map(pay => {
      const formattedDate = new Date(pay.generatedAt).toLocaleString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <tr>
          <td style="font-weight: 600; color: var(--primary);">${pay.id}</td>
          <td>${pay.employeeId}</td>
          <td style="font-weight: 500;">${pay.employeeName}</td>
          <td><span style="font-weight: 600;">${pay.attendanceDays} Hari</span></td>
          <td>${formatIDR(pay.basicSalary)}</td>
          <td style="color: var(--danger);">${formatIDR(pay.deduction)}</td>
          <td style="color: var(--success); font-weight: bold;">${formatIDR(pay.totalSalary)}</td>
          <td style="font-size: 0.85rem; color: var(--text-muted);">${formattedDate}</td>
        </tr>
      `;
    }).join('');
  }

  payrollGenerateBtn.addEventListener('click', async () => {
    const originalHTML = payrollGenerateBtn.innerHTML;
    payrollGenerateBtn.disabled = true;
    payrollGenerateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menghitung...';

    try {
      const response = await fetch(`${PAYROLL_API}/payroll/generate`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Gagal menghitung payroll');
      }

      showToast('Perhitungan payroll berhasil dijalankan untuk seluruh karyawan!', 'success');
      await loadPayrollData();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      payrollGenerateBtn.disabled = false;
      payrollGenerateBtn.innerHTML = originalHTML;
    }
  });

  // --- 4. INTEGRATION MONITOR & SSE STREAM LOGIC ---
  async function loadIntegrationLogs() {
    try {
      const response = await fetch(`${INTEGRATION_API}/logs`);
      if (!response.ok) throw new Error('Gagal memuat log integrasi EAI');
      allLogs = await response.json();
      allLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      renderIntegrationLogs();
      updateIntegrationMetrics();
    } catch (error) {
      console.error(error);
      logConsole.innerHTML = `<div class="log-line text-error"><span class="log-message">Failed to load log history: ${error.message}</span></div>`;
    }
  }

  function renderIntegrationLogs() {
    logConsole.innerHTML = '';
    const filtered = allLogs.filter(log => {
      if (currentFilter === 'all') return true;
      return log.type === currentFilter;
    });

    if (filtered.length === 0) {
      logConsole.innerHTML = `<div class="log-line" style="color: var(--text-muted);"><span class="log-message">Console is empty. Listening for incoming enterprise integration events...</span></div>`;
      return;
    }

    filtered.forEach(log => {
      const line = createLogLineElement(log);
      logConsole.appendChild(line);
    });

    scrollToConsoleBottom();
  }

  function appendLogLine(log) {
    if (logConsole.children.length === 1 && logConsole.children[0].style.color === 'var(--text-muted)') {
      logConsole.innerHTML = '';
    }

    if (currentFilter === 'all' || log.type === currentFilter) {
      const line = createLogLineElement(log);
      logConsole.appendChild(line);
      scrollToConsoleBottom();
    }
  }

  function createLogLineElement(log) {
    const el = document.createElement('div');
    el.className = 'log-line';

    const formattedTime = new Date(log.timestamp).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });

    const isError = log.type.toLowerCase().includes('error');
    const tagClass = isError ? 'tag-error' : `tag-${log.type.toLowerCase()}`;
    const typeLabel = isError ? 'Error' : log.type;

    el.innerHTML = `
      <span class="log-time">[${formattedTime}]</span>
      <span class="log-tag ${tagClass}">${typeLabel}</span>
      <span class="log-message">${escapeHtml(log.description)}</span>
    `;

    return el;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updateIntegrationMetrics() {
    totalEventsEl.textContent = `${allLogs.length} Event`;
    
    const translations = allLogs.filter(log => log.type === 'XMLTransformed').length;
    totalTranslationsEl.textContent = `${translations} Translasi`;

    const routings = allLogs.filter(log => 
      log.description.includes('-> Attendance') || 
      log.description.includes('-> Payroll')
    ).length;
    totalRoutingsEl.textContent = `${routings} Routing`;
  }

  // Set up filters
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-filter');
      renderIntegrationLogs();
    });
  });

  clearConsoleBtn.addEventListener('click', () => {
    allLogs = [];
    renderIntegrationLogs();
    updateIntegrationMetrics();
  });

  function scrollToConsoleBottom() {
    logConsole.scrollTop = logConsole.scrollHeight;
  }

  // SSE setup
  function setupEaiSSE() {
    console.log('Establishing SSE connection to EAI event stream...');
    const eventSource = new EventSource(`${INTEGRATION_API}/events`);

    eventSource.onmessage = (event) => {
      try {
        const newLog = JSON.parse(event.data);
        console.log('SSE log received:', newLog);

        if (newLog.type === 'RabbitMQStatus') {
          updateRabbitStatus(newLog.description);
        }

        if (newLog.id) {
          // Prevent duplicates
          if (!allLogs.some(log => log.id === newLog.id)) {
            allLogs.push(newLog);
            appendLogLine(newLog);
            updateIntegrationMetrics();

            // Dynamic live sync: update other tabs' data immediately when events stream through EAI
            reloadAllData();
          }
        }
      } catch (err) {
        console.error('Failed to parse SSE data:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE connection lost. Reconnecting...', err);
      updateRabbitStatus('Status check: RabbitMQ is Disconnected');
    };
  }

  // Health checking
  async function checkIntegrationHealth() {
    try {
      const response = await fetch(`${INTEGRATION_API}/health`);
      if (!response.ok) throw new Error('Unhealthy');
      const data = await response.json();
      updateRabbitStatus(`Status check: RabbitMQ is ${data.rabbitmq}`);
    } catch (error) {
      updateRabbitStatus('Status check: RabbitMQ is Disconnected');
    }
  }

  function updateRabbitStatus(statusText) {
    rabbitLabel.textContent = statusText;
    if (statusText.toLowerCase().includes('connected') && !statusText.toLowerCase().includes('disconnected') && !statusText.toLowerCase().includes('error')) {
      rabbitDot.className = 'status-dot connected';
    } else {
      rabbitDot.className = 'status-dot disconnected';
    }
  }

  // Start real-time connections
  setupEaiSSE();
  checkIntegrationHealth();
  setInterval(checkIntegrationHealth, 10000);

  // --- GENERAL UTILITIES ---
  function formatIDR(amount) {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(amount);
  }

  function showToast(message, type = 'success') {
    toast.className = `toast ${type}`;
    const icon = type === 'success' 
      ? '<i class="fa-solid fa-circle-check"></i>' 
      : '<i class="fa-solid fa-circle-exclamation"></i>';
      
    toast.innerHTML = `${icon} <span>${message}</span>`;
    toast.classList.remove('hidden');

    setTimeout(() => {
      toast.classList.add('hidden');
    }, 4000);
  }
});
