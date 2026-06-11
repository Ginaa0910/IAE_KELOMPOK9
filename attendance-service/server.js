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


const PORT = process.env.PORT || 3002;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://user:password@localhost:5672';
const PUBLISH_QUEUE = process.env.QUEUE_NAME || 'integration_queue';
const CONSUME_QUEUE = process.env.CONSUME_QUEUE || 'attendance_queue';

const db = new JsonDatabase('db.json');

let rabbitChannel = null;

// Connect to RabbitMQ and start listening to employee syncs
async function connectRabbitMQ() {
  const maxRetries = 10;
  let retries = 0;
  while (retries < maxRetries) {
    try {
      console.log(`Connecting to RabbitMQ at ${RABBITMQ_URL} (Attempt ${retries + 1}/${maxRetries})...`);
      const connection = await amqp.connect(RABBITMQ_URL);
      rabbitChannel = await connection.createChannel();
      
      // Assert publishing and consuming queues
      await rabbitChannel.assertQueue(PUBLISH_QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'integration_dlx',
          'x-dead-letter-routing-key': 'integration_dlq'
        }
      });
      await rabbitChannel.assertQueue(CONSUME_QUEUE, { durable: true });
      
      console.log(`Connected to RabbitMQ.`);
      console.log(`- Publisher queue: ${PUBLISH_QUEUE}`);
      console.log(`- Consumer queue: ${CONSUME_QUEUE}`);

      // Start consuming EmployeeCreated events from EAI
      rabbitChannel.consume(CONSUME_QUEUE, async (msg) => {
        if (msg !== null) {
          try {
            const content = JSON.parse(msg.content.toString());
            console.log(`[EAI Sync] Received event:`, content);
            
            if (content.eventType === 'EmployeeCreated') {
              const existing = await db.findOne('employees', { id: content.employeeId });
              if (!existing) {
                await db.insert('employees', {
                  id: content.employeeId,
                  name: content.employeeName
                });
                console.log(`[EAI Sync] Synced new employee: ${content.employeeName}`);
              } else {
                console.log(`[EAI Sync] Employee already exists: ${content.employeeName}`);
              }
            }
            rabbitChannel.ack(msg);
          } catch (err) {
            console.error('Error processing consumed message:', err);
            // Requeue if parsing failed
            rabbitChannel.nack(msg, false, true);
          }
        }
      });

      connection.on('error', (err) => {
        console.error('RabbitMQ connection error, reconnecting...', err);
        rabbitChannel = null;
        setTimeout(connectRabbitMQ, 5000);
      });
      connection.on('close', () => {
        console.log('RabbitMQ connection closed, reconnecting...');
        rabbitChannel = null;
        setTimeout(connectRabbitMQ, 5000);
      });
      break;
    } catch (error) {
      console.error('RabbitMQ connection failed:', error.message);
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

app.get('/attendance', async (req, res) => {
  try {
    const attendances = await db.find('attendances');
    res.json(attendances);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/attendance', async (req, res) => {
  try {
    const { employeeId, date, status } = req.body;
    if (!employeeId || !date || !status) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const employee = await db.findOne('employees', { id: employeeId });
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found locally. Please sync from HRIS.' });
    }

    const id = 'ATT-' + Math.floor(100000 + Math.random() * 900000);
    const newAttendance = {
      id,
      employeeId,
      employeeName: employee.name,
      date,
      status,
      createdAt: new Date().toISOString()
    };

    // Save to local database
    await db.insert('attendances', newAttendance);

    // Generate XML data for EAI Integration Layer
    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<attendance>
  <employeeId>${employeeId}</employeeId>
  <employeeName>${employee.name}</employeeName>
  <date>${date}</date>
  <status>${status}</status>
  <eventType>AttendanceSubmitted</eventType>
  <timestamp>${new Date().toISOString()}</timestamp>
</attendance>`;

    if (!rabbitChannel) {
      return res.status(503).json({ error: 'RabbitMQ connection not ready' });
    }

    // Publish XML message to integration queue
    rabbitChannel.sendToQueue(PUBLISH_QUEUE, Buffer.from(xmlPayload), {
      persistent: true,
      contentType: 'application/xml'
    });

    console.log(`[AttendanceSubmitted] Published XML event for employee ${employee.name}`);

    res.status(201).json({ success: true, data: newAttendance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Attendance Service listening on port ${PORT}`);
});
