# HR Enterprise Integration (EAI) — HRIS + Attendance + Payroll

Proyek **UAS Enterprise Application Integration** yang mengimplementasikan sistem integrasi HR berbasis **Microservices** dengan **RabbitMQ** sebagai message broker dan berbagai **Enterprise Integration Patterns (EIP)**.

---

## 1. Deskripsi Sistem

Sistem ini menghubungkan tiga aplikasi bisnis yang terpisah (HRIS, Attendance, dan Payroll) melalui sebuah **Integration Layer** terpusat. Setiap service memiliki database sendiri dan **tidak pernah mengakses database service lain secara langsung**. Seluruh pertukaran data dilakukan secara asinkron melalui RabbitMQ.

```
                  ┌─────────────────────────────┐
                  │       HRIS Service          │ :3001
                  │  (Manajemen Data Karyawan)  │
                  └──────────────┬──────────────┘
                                 │ JSON: EmployeeCreated
                                 ▼
┌──────────────┐    ┌────────────────────────────┐
│  Attendance  │───▶│   RabbitMQ: integration_   │
│   Service    │    │        queue               │
│   :3002      │    └────────────┬───────────────┘
└──────────────┘                 │
  XML: AttendanceSubmitted       ▼
                  ┌─────────────────────────────┐
                  │    Integration Service      │ :3004
                  │  ┌─────────────────────┐   │
                  │  │ Content-Based Router│   │
                  │  │ Message Translator  │   │
                  │  │ Dead Letter Channel │   │
                  │  └─────────────────────┘   │
                  └──┬──────────────────────┬──┘
           Canonical JSON            Canonical JSON
                     ▼                        ▼
        ┌────────────────────┐   ┌────────────────────┐
        │  attendance_queue  │   │   payroll_queue     │
        └────────┬───────────┘   └──────────┬─────────┘
                 │                          │
                 ▼                          ▼
        ┌────────────────┐        ┌─────────────────────┐
        │   Attendance   │        │   Payroll Service   │ :3003
        │   Service      │        │  (Hitung Gaji)      │
        │  (Sync Emp)    │        └─────────────────────┘
        └────────────────┘
```

---

## 2. Daftar Service & Endpoint

### 🏢 HRIS Service — `http://localhost:3001`

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/employees` | Ambil semua data karyawan |
| `POST` | `/employees` | Tambah karyawan baru |
| `POST` | `/employees/:id/publish` | Publish event EmployeeCreated ke RabbitMQ |

### 📅 Attendance Service — `http://localhost:3002`

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/employees` | Daftar karyawan tersinkronisasi |
| `GET` | `/attendance` | Riwayat semua presensi |
| `POST` | `/attendance` | Catat presensi (publish XML ke RabbitMQ) |

### 💰 Payroll Service — `http://localhost:3003`

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/employees` | Karyawan + data kehadiran di Payroll |
| `GET` | `/payroll` | Laporan slip gaji |
| `POST` | `/payroll/generate` | Generate & hitung gaji semua karyawan |

### 🔌 Integration Service — `http://localhost:3004`

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/logs` | Seluruh log aktivitas EAI |
| `GET` | `/health` | Status koneksi RabbitMQ |
| `GET` | `/events` | SSE stream log realtime |

📖 Dokumentasi lengkap: lihat [openapi.yaml](./openapi.yaml)

---

## 3. Enterprise Integration Patterns (EIP)

| # | Pattern | Implementasi |
|---|---------|-------------|
| 1 | **Message Channel** | RabbitMQ queues: `integration_queue`, `attendance_queue`, `payroll_queue`, `integration_dlq` |
| 2 | **Message Translator** | `integration-service/translator.js` — konversi XML (Attendance) → Canonical JSON |
| 3 | **Content-Based Router** | `integration-service/router.js` — routing berdasarkan `eventType` |
| 4 | **Message Endpoint** | Koneksi RabbitMQ di setiap service (`server.js`) |
| 5 | **Dead Letter Channel** | `integration_dlq` via exchange `integration_dlx` — pesan gagal setelah 3x retry |
| 6 | **Canonical Data Model** | Format JSON standar internal (lihat bagian berikut) |

---

## 4. Format Data per Service

### Format Outbound HRIS → RabbitMQ (`integration_queue`)

Format: **JSON**

```json
{
  "employeeId": "EMP-171758",
  "employeeName": "Budi Santoso",
  "salary": 8000000,
  "attendanceDays": 0,
  "eventType": "EmployeeCreated",
  "timestamp": "2026-06-05T10:00:00.000Z"
}
```

### Format Outbound Attendance → RabbitMQ (`integration_queue`)

Format: **XML** (heterogenitas format data)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<attendance>
  <employeeId>EMP-171758</employeeId>
  <employeeName>Budi Santoso</employeeName>
  <date>2026-06-05</date>
  <status>Hadir</status>
  <eventType>AttendanceSubmitted</eventType>
  <timestamp>2026-06-05T09:00:00.000Z</timestamp>
</attendance>
```

### Format Internal Canonical Data Model (CDM)

Setelah Integration Service memproses semua pesan (baik JSON maupun XML), pesan dikonversi ke format **Canonical JSON** ini sebelum diteruskan ke downstream queue:

```json
{
  "employeeId": "EMP-171758",
  "employeeName": "Budi Santoso",
  "attendanceDays": 1,
  "salary": 0,
  "eventType": "AttendanceSubmitted",
  "timestamp": "2026-06-05T09:00:00.000Z"
}
```

> **Keterangan field:**
> - `attendanceDays`: `1` jika status Hadir, `0` jika Sakit/Izin/Alpa
> - `salary`: diisi dari HRIS untuk `EmployeeCreated`, `0` untuk `AttendanceSubmitted`
> - `eventType`: menentukan routing tujuan di Content-Based Router

### Transformasi XML → JSON (Before & After)

**SEBELUM (XML dari Attendance Service):**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<attendance>
  <employeeId>EMP-171758</employeeId>
  <employeeName>Budi Santoso</employeeName>
  <date>2026-06-05</date>
  <status>Hadir</status>
  <eventType>AttendanceSubmitted</eventType>
  <timestamp>2026-06-05T09:00:00.000Z</timestamp>
</attendance>
```

**SESUDAH (Canonical JSON dari Integration Service):**
```json
{
  "employeeId": "EMP-171758",
  "employeeName": "Budi Santoso",
  "attendanceDays": 1,
  "salary": 0,
  "eventType": "AttendanceSubmitted",
  "timestamp": "2026-06-05T09:00:00.000Z"
}
```

---

## 5. RabbitMQ Queue Architecture

| Queue | Producer | Consumer | Keterangan |
|-------|----------|----------|-----------|
| `integration_queue` | HRIS, Attendance | Integration Service | Queue utama EAI. Dikonfigurasi dengan DLX. |
| `attendance_queue` | Integration Service | Attendance Service | Terima event EmployeeCreated untuk sync |
| `payroll_queue` | Integration Service | Payroll Service | Terima EmployeeCreated & AttendanceSubmitted |
| `integration_dlq` | Integration Service (auto via DLX) | Integration Service (monitor only) | Dead Letter Queue untuk pesan gagal |

### Dead Letter Queue (DLQ) Flow

```
integration_queue
       │
       │ (nack setelah retry ke-3)
       ▼
integration_dlx (Dead Letter Exchange)
       │
       ▼
integration_dlq (Dead Letter Queue)
       │
       ▼
  [LOG: DLQReceived] — dicatat di logs, tidak diproses ulang
```

---

## 6. Cara Menjalankan Sistem

### Prasyarat
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) sudah terinstall dan berjalan.

### Langkah-langkah

```bash
# 1. Clone repository
git clone <url-repository>
cd TUBES-EAI-2026

# 2. (Opsional) Sesuaikan environment variables
# Buka file .env dan ubah kredensial jika diperlukan
# Default: RABBITMQ_USER=user, RABBITMQ_PASS=password

# 3. Build dan jalankan semua service
docker compose up --build

# 4. Tunggu hingga semua service siap (±30 detik pertama untuk RabbitMQ)
```

### Akses Dashboard

| Service | URL | Kredensial |
|---------|-----|-----------|
| HRIS Service | http://localhost:3001 | — |
| Attendance Service | http://localhost:3002 | — |
| Payroll Service | http://localhost:3003 | — |
| Integration Monitor | http://localhost:3004 | — |
| RabbitMQ Management | http://localhost:15672 | `user` / `password` |

---

## 7. Panduan Demo Skenario End-to-End

### Langkah 1: Tambah & Publish Karyawan Baru

1. Buka **HRIS Service** → http://localhost:3001
2. Isi form **Tambah Karyawan Baru** (Nama, Email, Jabatan, Gaji Pokok)
3. Klik **Tambah Karyawan** — data tersimpan sebagai Draft
4. Klik **Publish Event** pada baris karyawan tersebut
5. Buka **Integration Monitor** → http://localhost:3004
   - Log: `[EmployeeCreated] HRIS → RabbitMQ (JSON)` ✅
   - Log: `[EmployeeCreated] RabbitMQ → Attendance` ✅
   - Log: `[EmployeeCreated] RabbitMQ → Payroll` ✅

### Langkah 2: Catat Presensi

1. Buka **Attendance Service** → http://localhost:3002
2. Karyawan sudah tersinkronisasi dan muncul di dropdown
3. Pilih karyawan, tanggal, dan status `Hadir` → Submit
4. Cek **Integration Monitor**:
   - Log: `[AttendanceSubmitted] Attendance → RabbitMQ (XML)` ✅
   - Log: `[XMLTransformed] XML → Canonical JSON (Message Translator)` ✅
   - Log: `[AttendanceSubmitted] Integration → Payroll` ✅

### Langkah 3: Generate Payroll

1. Buka **Payroll Service** → http://localhost:3003
2. Lihat data kehadiran karyawan (misal: 18/20 hari)
3. Klik **Generate Payroll Baru**
4. Sistem menghitung: `Potongan = (20 - 18) × (Gaji/20)`, lalu tampilkan slip gaji

---

## 8. Environment Variables

Semua konfigurasi dikelola melalui file `.env` di root proyek (jangan commit file ini ke Git!).

| Variable | Default | Keterangan |
|----------|---------|-----------|
| `RABBITMQ_USER` | `user` | Username RabbitMQ |
| `RABBITMQ_PASS` | `password` | Password RabbitMQ |
| `HRIS_PORT` | `3001` | Port HRIS Service |
| `ATTENDANCE_PORT` | `3002` | Port Attendance Service |
| `PAYROLL_PORT` | `3003` | Port Payroll Service |
| `INTEGRATION_PORT` | `3004` | Port Integration Service |
| `DLQ_QUEUE` | `integration_dlq` | Nama Dead Letter Queue |
| `DLX_EXCHANGE` | `integration_dlx` | Nama Dead Letter Exchange |
| `MAX_RETRY_COUNT` | `3` | Maksimum retry sebelum ke DLQ |

---

## 9. Struktur Folder

```
TUBES-EAI-2026/
├── .env                    # Environment variables (jangan di-commit!)
├── .gitignore
├── docker-compose.yml      # Orkestrasi semua container
├── openapi.yaml            # Dokumentasi API lengkap (OpenAPI 3.0.3)
├── README.md
│
├── hris-service/           # Port 3001
│   ├── Dockerfile
│   ├── server.js           # API + RabbitMQ publisher
│   ├── package.json
│   ├── database/
│   │   ├── db.js           # JSON database helper
│   │   └── db.json         # Penyimpanan data karyawan
│   └── public/             # Frontend dashboard HRIS
│
├── attendance-service/     # Port 3002
│   ├── Dockerfile
│   ├── server.js           # API + XML publisher + consumer
│   ├── package.json
│   ├── database/
│   │   ├── db.js
│   │   └── db.json         # Penyimpanan data presensi
│   └── public/             # Frontend dashboard Attendance
│
├── payroll-service/        # Port 3003
│   ├── Dockerfile
│   ├── server.js           # API + payroll calculator + consumer
│   ├── package.json
│   ├── database/
│   │   ├── db.js
│   │   └── db.json         # Penyimpanan data payroll
│   └── public/             # Frontend dashboard Payroll
│
└── integration-service/    # Port 3004
    ├── Dockerfile
    ├── server.js            # API (logs, health, SSE)
    ├── rabbit.js            # Consumer utama + DLQ setup
    ├── router.js            # EIP: Content-Based Router
    ├── translator.js        # EIP: Message Translator (XML→JSON)
    ├── package.json
    ├── logs/
    │   ├── db.js
    │   └── logs.json        # Log aktivitas EAI
    └── public/              # Frontend dashboard Integration Monitor
```
