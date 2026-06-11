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


const PORT = process.env.PORT || 3001;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://user:password@localhost:5672';
const QUEUE_NAME = process.env.QUEUE_NAME || 'integration_queue';

const db = new JsonDatabase('db.json');

// RabbitMQ connection helper
let rabbitChannel = null;

async function connectRabbitMQ() {
  const maxRetries = 10;
  let retries = 0;
  while (retries < maxRetries) {
    try {
      console.log(`Connecting to RabbitMQ at ${RABBITMQ_URL} (Attempt ${retries + 1}/${maxRetries})...`);
      const connection = await amqp.connect(RABBITMQ_URL);
      rabbitChannel = await connection.createChannel();
      await rabbitChannel.assertQueue(QUEUE_NAME, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'integration_dlx',
          'x-dead-letter-routing-key': 'integration_dlq'
        }
      });
      console.log('Connected to RabbitMQ and asserted queue:', QUEUE_NAME);
      
      connection.on('error', (err) => {
        console.error('RabbitMQ Connection error, reconnecting...', err);
        rabbitChannel = null;
        setTimeout(connectRabbitMQ, 5000);
      });
      connection.on('close', () => {
        console.log('RabbitMQ Connection closed, reconnecting...');
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

app.post('/employees', async (req, res) => {
  try {
    const { name, email, role, basicSalary } = req.body;
    if (!name || !email || !role || !basicSalary) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const id = 'EMP-' + Math.floor(100000 + Math.random() * 900000);
    const newEmployee = {
      id,
      name,
      email,
      role,
      basicSalary: Number(basicSalary),
      published: false,
      createdAt: new Date().toISOString()
    };
    await db.insert('employees', newEmployee);
    res.status(201).json(newEmployee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/employees/:id/publish', async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await db.findOne('employees', { id });
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (!rabbitChannel) {
      return res.status(503).json({ error: 'RabbitMQ connection not ready' });
    }

    const payload = {
      employeeId: employee.id,
      employeeName: employee.name,
      salary: Number(employee.basicSalary),
      attendanceDays: 0,
      eventType: 'EmployeeCreated',
      timestamp: new Date().toISOString()
    };

    // Publish event to RabbitMQ
    rabbitChannel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(payload)), {
      persistent: true
    });

    console.log(`[EmployeeCreated] Published event for ${employee.name}`);

    // Update published status in database
    await db.update('employees', { id }, { published: true });

    res.json({ success: true, message: `Employee event published: ${employee.name}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`HRIS Service listening on port ${PORT}`);
});
