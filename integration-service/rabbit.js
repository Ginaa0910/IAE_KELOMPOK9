const amqp = require('amqplib');
const EventEmitter = require('events');
const JsonDatabase = require('./logs/db');
const { translateXmlToCanonicalJson } = require('./translator');
const { routeMessage } = require('./router');

// Event emitter to broadcast logs to SSE clients in server.js
class LogEmitter extends EventEmitter {}
const logEmitter = new LogEmitter();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://user:password@localhost:5672';
const CONSUME_QUEUE = process.env.QUEUE_NAME || 'integration_queue';

const db = new JsonDatabase('logs.json');
let rabbitChannel = null;
let isConnected = false;

// Helper to write logs
async function writeLog(type, description) {
  const newLog = {
    id: 'LOG-' + Math.floor(100000 + Math.random() * 900000),
    type,
    description,
    timestamp: new Date().toISOString()
  };
  await db.insert('logs', newLog);
  logEmitter.emit('log', newLog);
  console.log(`[EAI Monitor] ${description}`);
}

async function startIntegration() {
  const maxRetries = 10;
  let retries = 0;
  while (retries < maxRetries) {
    try {
      console.log(`EAI Integration connecting to RabbitMQ at ${RABBITMQ_URL} (Attempt ${retries + 1}/${maxRetries})...`);
      const connection = await amqp.connect(RABBITMQ_URL);
      rabbitChannel = await connection.createChannel();
      isConnected = true;
      
      // Assert the main integration consumer queue
      await rabbitChannel.assertQueue(CONSUME_QUEUE, { durable: true });
      
      await writeLog('RabbitMQStatus', 'Connected to RabbitMQ broker successfully.');

      // Start consuming events
      rabbitChannel.consume(CONSUME_QUEUE, async (msg) => {
        if (msg !== null) {
          const rawContent = msg.content.toString();
          
          try {
            let payload = null;
            
            // Check message content: XML or JSON
            if (rawContent.trim().startsWith('<')) {
              // XML message (Message Endpoint / Adapter)
              await writeLog('AttendanceSubmitted', '[AttendanceSubmitted] Attendance → RabbitMQ');
              
              // EIP: Message Translator (XML -> Canonical JSON)
              payload = await translateXmlToCanonicalJson(rawContent);
              await writeLog('XMLTransformed', '[XMLTransformed] XML → Canonical JSON');
            } else {
              // JSON message (Message Endpoint / Adapter)
              payload = JSON.parse(rawContent);
              await writeLog('EmployeeCreated', '[EmployeeCreated] HRIS → RabbitMQ');
            }

            // EIP: Content-Based Router
            const destinations = routeMessage(payload);
            
            for (const dest of destinations) {
              // Assert the destination queue is ready
              await rabbitChannel.assertQueue(dest.queue, { durable: true });
              
              // Publish the payload (using Canonical JSON structure)
              rabbitChannel.sendToQueue(dest.queue, Buffer.from(JSON.stringify(payload)), {
                persistent: true
              });
              
              await writeLog(payload.eventType, dest.log);
            }

            // Acknowledge receipt
            rabbitChannel.ack(msg);
          } catch (error) {
            console.error('[EAI Error] Failed to process message:', error);
            await writeLog('IntegrationError', `Error: ${error.message}`);
            // Reject message without requeuing if it's unparseable/corrupt
            rabbitChannel.nack(msg, false, false);
          }
        }
      });

      connection.on('error', async (err) => {
        console.error('RabbitMQ EAI Connection error, reconnecting...', err);
        rabbitChannel = null;
        isConnected = false;
        await writeLog('RabbitMQStatus', 'RabbitMQ connection error. Reconnecting...');
        setTimeout(startIntegration, 5000);
      });
      connection.on('close', async () => {
        console.log('RabbitMQ EAI Connection closed, reconnecting...');
        rabbitChannel = null;
        isConnected = false;
        await writeLog('RabbitMQStatus', 'RabbitMQ connection closed. Reconnecting...');
        setTimeout(startIntegration, 5000);
      });
      break;
    } catch (error) {
      console.error('RabbitMQ EAI connection failed:', error.message);
      retries++;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

function getRabbitStatus() {
  return isConnected ? 'Connected' : 'Disconnected';
}

module.exports = {
  startIntegration,
  logEmitter,
  getRabbitStatus
};
