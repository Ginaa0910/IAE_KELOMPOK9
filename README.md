# HR Enterprise Integration (EAI) - HRIS, Attendance & Payroll

Proyek ini adalah sistem integrasi perusahaan (Enterprise Application Integration/EAI) berbasis Microservices dengan tema **HR Enterprise Integration**. Sistem ini menghubungkan tiga aplikasi bisnis berbeda (HRIS, Attendance, dan Payroll) melalui sebuah Integration Layer menggunakan **RabbitMQ** dan **Enterprise Integration Patterns (EIP)**.

Setiap aplikasi memiliki database (JSON file database) sendiri dan tidak mengakses database aplikasi lain secara langsung. Seluruh pertukaran data dilakukan melalui pesan asinkron melalui RabbitMQ.

---

## 1. Arsitektur Sistem

Sistem ini terbagi menjadi beberapa komponen utama:

```
                  +-----------------------------------+
                  |           HRIS Service            | (Port 3001)
                  +-----------------------------------+
                                    |
                       JSON: EmployeeCreated Event
                                    v
+------------+    +-----------------------------------+
| Attendance |--->|         RabbitMQ Exchange         |<---+
|  Service   |    +-----------------------------------+    |
+------------+                      |                      |
 (Port 3002)                        |                      |
     |                              v                      |
  XML Event                 +---------------+              |
                            |  Integration  |              |
                            |    Service    | (Port 3004)  |
                            +---------------+              |
                                    |                      |
                             Canonical JSON                |
                                    v                      |
                  +-----------------------------------+    |
                  |          Payroll Service          |----+ (Port 3003)
                  +-----------------------------------+
```

- **HRIS Service (Port 3001)**: Tempat mengelola data karyawan. Menggunakan format JSON. Mengirim event `EmployeeCreated`.
- **Attendance Service (Port 3002)**: Tempat mencatat presensi karyawan. Menghasilkan payload dalam format XML. Mengirim event `AttendanceSubmitted`.
- **Payroll Service (Port 3003)**: Tempat menghitung gaji karyawan berdasarkan data kehadiran yang disinkronkan. Menggunakan format JSON.
- **Integration Service (Port 3004)**: Integration layer pusat yang memantau, menerjemahkan (XML -> Canonical JSON), dan mengarahkan pesan (Routing) ke service tujuan.
- **RabbitMQ (Port 5672 / Management: 15672)**: Message Broker sebagai media komunikasi asinkron.

---

## 2. Enterprise Integration Patterns (EIP) Yang Digunakan

1. **Message Channel**: Menggunakan RabbitMQ Queue (`integration_queue`, `attendance_queue`, `payroll_queue`) untuk mentransmisikan pesan secara asinkron.
2. **Message Translator**: Diterapkan pada `integration-service/translator.js` untuk mengkonversi data presensi XML dari Attendance Service menjadi Canonical JSON.
3. **Content-Based Router**: Diterapkan pada `integration-service/router.js` untuk mengarahkan pesan berdasarkan nilai `eventType` (mengirim data karyawan ke database presensi & payroll, dan mengirim data kehadiran ke database payroll).
4. **Message Endpoint / Adapter**: Diterapkan di masing-masing service (`server.js` & `rabbit.js`) untuk menghubungkan database internal dengan message channel RabbitMQ.
5. **Canonical Data Model**: Format JSON standar yang disepakati untuk pertukaran data internal di Integration Layer:
   ```json
   {
     "employeeId": "EMP-XXXXXX",
     "employeeName": "John Doe",
     "attendanceDays": 1,
     "salary": 7500000,
     "eventType": "AttendanceSubmitted",
     "timestamp": "2026-06-05T15:20:00.000Z"
   }
   ```

---

## 3. Struktur Folder

```
uas-eai/
├── docker-compose.yml
├── openapi.yaml
├── README.md
│
├── hris-service/
│   ├── Dockerfile
│   ├── server.js
│   ├── database/
│   │   ├── db.js (JSON Database Helper)
│   │   └── db.json (Database Penyimpanan Karyawan)
│   └── public/ (Dashboard Frontend HRIS)
│
├── attendance-service/
│   ├── Dockerfile
│   ├── server.js
│   ├── database/
│   │   ├── db.js
│   │   └── db.json (Database Presensi)
│   └── public/ (Dashboard Frontend Attendance)
│
├── payroll-service/
│   ├── Dockerfile
│   ├── server.js
│   ├── database/
│   │   ├── db.js
│   │   └── db.json (Database Payroll)
│   └── public/ (Dashboard Frontend Payroll)
│
└── integration-service/
    ├── Dockerfile
    ├── server.js
    ├── rabbit.js (Konfigurasi Consumer & Publisher Broker)
    ├── router.js (Logika Routing)
    ├── translator.js (Logika Translasi XML -> JSON)
    ├── logs/
    │   └── logs.json (Penyimpanan Logs EAI)
    └── public/ (Dashboard EAI Monitoring Console)
```

---

## 4. Cara Menjalankan Sistem

Pastikan Anda telah menginstal **Docker** dan **Docker Compose** di komputer Anda.

1. Buka terminal pada folder root proyek.
2. Jalankan perintah berikut untuk membuat container dan menjalankan seluruh service:
   ```bash
   docker compose up --build
   ```
3. Tunggu hingga RabbitMQ siap (healthcheck sukses) dan semua service Express berjalan.
4. Buka browser dan Anda dapat mengakses dashboard masing-masing service:
   - **HRIS Service**: [http://localhost:3001](http://localhost:3001)
   - **Attendance Service**: [http://localhost:3002](http://localhost:3002)
   - **Payroll Service**: [http://localhost:3003](http://localhost:3003)
   - **Integration Monitoring**: [http://localhost:3004](http://localhost:3004)
   - **RabbitMQ Management**: [http://localhost:15672](http://localhost:15672) (Username: `user`, Password: `password`)

---

## 5. Panduan Demo Skenario End-to-End

Ikuti langkah-langkah berikut untuk menguji seluruh alur integrasi:

### Langkah 1: Tambah & Publish Karyawan Baru
1. Buka **HRIS Service** ([http://localhost:3001](http://localhost:3001)).
2. Isi form **Tambah Karyawan Baru** (contoh: Nama: `Budi Santoso`, Jabatan: `Software Engineer`, Gaji Pokok: `8000000`).
3. Klik tombol **Tambah Karyawan**. Data akan tersimpan di database lokal HRIS sebagai **Draft**.
4. Cari Budi Santoso di tabel, lalu klik tombol **Publish Event**.
5. Buka **Integration Service** ([http://localhost:3004](http://localhost:3004)), Anda akan melihat log realtime berikut muncul:
   - `[EmployeeCreated] HRIS -> RabbitMQ`
   - `[EmployeeCreated] RabbitMQ -> Attendance`
   - `[EmployeeCreated] RabbitMQ -> Payroll`

### Langkah 2: Lakukan Presensi Karyawan
1. Buka **Attendance Service** ([http://localhost:3002](http://localhost:3002)).
2. Karyawan `Budi Santoso` kini telah otomatis disinkronkan dan muncul di dropdown form presensi.
3. Pilih `Budi Santoso`, tentukan tanggal, pilih status kehadiran `Hadir` (Present), lalu klik **Submit Attendance**.
4. Sistem akan membuat data XML secara otomatis dan mengirimkannya ke RabbitMQ.
5. Periksa log pada **Integration Service**, Anda akan melihat proses EAI berjalan secara realtime:
   - `[AttendanceSubmitted] Attendance -> RabbitMQ` (Menerima XML)
   - `[XMLTransformed] XML -> Canonical JSON` (Translasi Data)
   - `[PayrollGenerated] Integration -> Payroll` (Routing pesan Canonical JSON ke Payroll)

### Langkah 3: Periksa Tracker Kehadiran & Generate Payroll
1. Buka **Payroll Service** ([http://localhost:3003](http://localhost:3003)).
2. Di tabel kiri **Data Kehadiran Karyawan**, Anda dapat melihat data Budi Santoso tersinkronisasi dengan jumlah Kehadiran: `1 / 20 Hari`. (Setiap presensi dengan status "Hadir" yang disubmit akan menambah angka ini).
3. Ulangi Langkah 2 beberapa kali jika ingin menambah hari hadir.
4. Klik tombol **Generate Payroll Baru** di bagian kanan atas statistik.
5. Payroll Service akan secara otomatis memproses gaji Budi Santoso dengan aturan bisnis:
   - Gaji penuh jika kehadiran = 20 hari.
   - Potongan gaji dihitung prorata jika kehadiran < 20 hari: `Potongan = (20 - Kehadiran) * (Gaji Pokok / 20)`.
6. Hasil slip gaji terhitung akan tersimpan dan langsung ditampilkan pada tabel **Laporan Payroll Terhitung** beserta pembaruan kartu metrik **Total Pengeluaran Gaji**.
