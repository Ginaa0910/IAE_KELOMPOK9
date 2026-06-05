const express = require('express');
const cors = require('cors');
const path = require('path');
const { startIntegration, logEmitter, getRabbitStatus } = require('./rabbit');
const JsonDatabase = require('./logs/db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3004;
const db = new JsonDatabase('logs.json');

// Start RabbitMQ listener / Router / Translator
startIntegration();

// API Endpoints
app.get('/logs', async (req, res) => {
  try {
    const logs = await db.find('logs');
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    rabbitmq: getRabbitStatus(),
    timestamp: new Date().toISOString()
  });
});

// SSE endpoint for realtime log streaming
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current status immediately
  res.write(`data: ${JSON.stringify({ type: 'RabbitMQStatus', description: `Status check: RabbitMQ is ${getRabbitStatus()}`, timestamp: new Date().toISOString() })}\n\n`);

  // Subscribe to logEmitter events
  const logHandler = (logItem) => {
    res.write(`data: ${JSON.stringify(logItem)}\n\n`);
  };

  logEmitter.on('log', logHandler);

  // Clean up on client disconnect
  req.on('close', () => {
    logEmitter.off('log', logHandler);
    res.end();
  });
});

app.listen(PORT, () => {
  console.log(`Integration Monitoring Service listening on port ${PORT}`);
});
