@echo off
title HR Enterprise Integration - Local Starter
cls

:: ==========================================
:: CONFIGURATION
:: ==========================================
:: Jika Anda menggunakan RabbitMQ lokal (Docker atau Windows Service), biarkan default.
:: Jika menggunakan CloudAMQP, ganti URL di bawah dengan AMQP URL Anda.
set RABBITMQ_URL=amqps://uicnkrml:8AA3GpflwpbW8pROWqkmEqrxVTa2S0kS@vulture.rmq.cloudamqp.com/uicnkrml
:: ==========================================

echo ===================================================
:: Header
echo HR ENTERPRISE INTEGRATION - START ALL SERVICES
echo ===================================================
echo.
echo 1. Menginstall dependencies di setiap folder service...
echo.

echo [+] Installing dependencies for HRIS Service...
cd hris-service
call npm install --no-audit
cd ..

echo [+] Installing dependencies for Attendance Service...
cd attendance-service
call npm install --no-audit
cd ..

echo [+] Installing dependencies for Payroll Service...
cd payroll-service
call npm install --no-audit
cd ..

echo [+] Installing dependencies for Integration Service...
cd integration-service
call npm install --no-audit
cd ..

echo.
echo ===================================================
echo 2. Menjalankan semua service...
echo ===================================================
echo.

:: Menjalankan setiap service di window cmd baru
start "EAI HRIS - Port 3001" cmd /k "cd hris-service && set PORT=3001&& set RABBITMQ_URL=%RABBITMQ_URL%&& set QUEUE_NAME=integration_queue&& node server.js"
start "EAI Attendance - Port 3002" cmd /k "cd attendance-service && set PORT=3002&& set RABBITMQ_URL=%RABBITMQ_URL%&& set QUEUE_NAME=integration_queue&& node server.js"
start "EAI Payroll - Port 3003" cmd /k "cd payroll-service && set PORT=3003&& set RABBITMQ_URL=%RABBITMQ_URL%&& set QUEUE_NAME=payroll_queue&& node server.js"
start "EAI Integration - Port 3004" cmd /k "cd integration-service && set PORT=3004&& set RABBITMQ_URL=%RABBITMQ_URL%&& set QUEUE_NAME=integration_queue&& node server.js"

echo [+] Semua service berhasil diluncurkan!
echo.
echo Dashboard URLs:
echo - HRIS Service         : http://localhost:3001
echo - Attendance Service   : http://localhost:3002
echo - Payroll Service      : http://localhost:3003
echo - Integration Monitor  : http://localhost:3004
echo.
echo Pastikan broker RabbitMQ Anda (lokal atau cloud) sudah berjalan.
echo Tekan sembarang tombol untuk keluar dari installer ini...
pause > nul
