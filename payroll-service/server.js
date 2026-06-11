const express = require('express');
const cors = require('cors');
const path = require('path');
const amqp = require('amqplib');
const JsonDatabase = require('./database/db');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


const PORT = process.env.PORT || 3003;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://user:password@localhost:5672';
const CONSUME_QUEUE = process.env.QUEUE_NAME || 'payroll_queue';

const db = new JsonDatabase('db.json');

let rabbitChannel = null;

// Connect to RabbitMQ and start listening to incoming synced data
async function connectRabbitMQ() {
  const maxRetries = 10;
  let retries = 0;
  while (retries < maxRetries) {
    try {
      console.log(`Connecting to RabbitMQ at ${RABBITMQ_URL} (Attempt ${retries + 1}/${maxRetries})...`);
      const connection = await amqp.connect(RABBITMQ_URL);
      rabbitChannel = await connection.createChannel();
      
      // Assert queue
      await rabbitChannel.assertQueue(CONSUME_QUEUE, { durable: true });
      
      console.log(`Connected to RabbitMQ and listening on queue: ${CONSUME_QUEUE}`);

      // Start consuming events from Integration service (EAI Layer)
      rabbitChannel.consume(CONSUME_QUEUE, async (msg) => {
        if (msg !== null) {
          try {
            const content = JSON.parse(msg.content.toString());
            console.log(`[Payroll EAI Sync] Received event:`, content);

            if (content.eventType === 'EmployeeCreated') {
              const existing = await db.findOne('employees', { id: content.employeeId });
              if (!existing) {
                await db.insert('employees', {
                  id: content.employeeId,
                  name: content.employeeName,
                  basicSalary: Number(content.salary),
                  attendanceDays: 0
                });
                console.log(`[Payroll EAI Sync] Created employee: ${content.employeeName}`);
              } else {
                await db.update('employees', { id: content.employeeId }, {
                  basicSalary: Number(content.salary)
                });
                console.log(`[Payroll EAI Sync] Updated basic salary for employee: ${content.employeeName}`);
              }
            } else if (content.eventType === 'AttendanceSubmitted') {
              const employee = await db.findOne('employees', { id: content.employeeId });
              if (employee) {
                const currentDays = employee.attendanceDays || 0;
                const incrementalDays = Number(content.attendanceDays) || 0;
                const newDays = currentDays + incrementalDays;
                
                await db.update('employees', { id: content.employeeId }, {
                  attendanceDays: newDays
                });
                console.log(`[Payroll EAI Sync] Incremented attendance for ${employee.name}: ${currentDays} -> ${newDays}`);
              } else {
                console.warn(`[Payroll EAI Sync] Received attendance but employee ID ${content.employeeId} not found in Payroll database.`);
              }
            }

            rabbitChannel.ack(msg);
          } catch (err) {
            console.error('Error processing consumed message in Payroll:', err);
            rabbitChannel.nack(msg, false, true);
          }
        }
      });

      connection.on('error', (err) => {
        console.error('RabbitMQ connection error in Payroll, reconnecting...', err);
        rabbitChannel = null;
        setTimeout(connectRabbitMQ, 5000);
      });
      connection.on('close', () => {
        console.log('RabbitMQ connection closed in Payroll, reconnecting...');
        rabbitChannel = null;
        setTimeout(connectRabbitMQ, 5000);
      });
      break;
    } catch (error) {
      console.error('RabbitMQ connection failed in Payroll:', error.message);
      retries++;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

connectRabbitMQ();

// API Endpoints
app.get('/employees', async (req, res) => {
  try {
    const employees = await db.find('employees');
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/payroll', async (req, res) => {
  try {
    const payrolls = await db.find('payrolls');
    res.json(payrolls);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/payroll/generate', async (req, res) => {
  try {
    const employees = await db.find('employees');
    if (employees.length === 0) {
      return res.status(400).json({ error: 'Tidak ada karyawan untuk dihitung payroll-nya.' });
    }

    // ── FIX: Hapus semua record payroll lama sebelum generate baru ──
    const dbData = await db.read();
    dbData.payrolls = [];
    await db.write(dbData);

    const generatedPayrolls = [];
    const generatedAt = new Date().toISOString();

    for (const emp of employees) {
      const basicSalary = emp.basicSalary || 0;
      const attendanceDays = emp.attendanceDays || 0;

      const missedDays = Math.max(0, 20 - attendanceDays);
      const dailyRate = basicSalary / 20;
      const deduction = Math.round(missedDays * dailyRate);
      const totalSalary = Math.max(0, basicSalary - deduction);

      const id = 'PAY-' + Math.floor(100000 + Math.random() * 900000);
      const payrollRecord = {
        id,
        employeeId: emp.id,
        employeeName: emp.name,
        attendanceDays,
        basicSalary,
        deduction,
        totalSalary,
        generatedAt
      };

      await db.insert('payrolls', payrollRecord);
      generatedPayrolls.push(payrollRecord);
    }

    res.status(200).json({ success: true, payrolls: generatedPayrolls });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Payroll Service listening on port ${PORT}`);
});
