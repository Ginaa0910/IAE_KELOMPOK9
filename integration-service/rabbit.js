const amqp = require('amqplib');
const EventEmitter = require('events');
const JsonDatabase = require('./logs/db');
const { translateXmlToCanonicalJson } = require('./translator');
const { routeMessage } = require('./router');
const { validateCanonicalMessage } = require('./canonical-schema');

// Event emitter to broadcast logs to SSE clients in server.js
class LogEmitter extends EventEmitter {}
const logEmitter = new LogEmitter();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://user:password@localhost:5672';
const CONSUME_QUEUE = process.env.QUEUE_NAME || 'integration_queue';
const DLQ_QUEUE = process.env.DLQ_QUEUE || 'integration_dlq';
const DLX_EXCHANGE = process.env.DLX_EXCHANGE || 'integration_dlx';
const MAX_RETRY_COUNT = parseInt(process.env.MAX_RETRY_COUNT || '3', 10);

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

/**
 * EIP: Dead Letter Channel
 * Sends a failed message directly to the DLQ for manual inspection.
 * @param {Buffer} msgContent - The raw message content
 * @param {object} headers - Original message headers
 * @param {string} reason - Reason for routing to DLQ
 */
async function sendToDlq(msgContent, headers, reason) {
  if (!rabbitChannel) return;
  rabbitChannel.sendToQueue(DLQ_QUEUE, msgContent, {
    persistent: true,
    headers: {
      ...headers,
      'x-dlq-reason': reason,
      'x-dlq-timestamp': new Date().toISOString()
    }
  });
  await writeLog('DLQ', `[DLQ] Message routed to Dead Letter Queue. Reason: ${reason}`);
  console.warn(`[DLQ] Message routed to '${DLQ_QUEUE}'. Reason: ${reason}`);
}

async function startIntegration() {
  const maxConnRetries = 10;
  let retries = 0;
  while (retries < maxConnRetries) {
    try {
      console.log(`EAI Integration connecting to RabbitMQ at ${RABBITMQ_URL} (Attempt ${retries + 1}/${maxConnRetries})...`);
      const connection = await amqp.connect(RABBITMQ_URL);
      rabbitChannel = await connection.createChannel();
      isConnected = true;

      // --- EIP: Dead Letter Channel Setup ---
      // 1. Declare the Dead Letter Exchange (DLX)
      await rabbitChannel.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });

      // 2. Declare the Dead Letter Queue (DLQ) and bind it to the DLX
      await rabbitChannel.assertQueue(DLQ_QUEUE, { durable: true });
      await rabbitChannel.bindQueue(DLQ_QUEUE, DLX_EXCHANGE, DLQ_QUEUE);

      // 3. Assert the main integration queue with dead-letter routing configured
      //    Messages nacked without requeue will be sent to DLX -> DLQ
      await rabbitChannel.assertQueue(CONSUME_QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': DLX_EXCHANGE,
          'x-dead-letter-routing-key': DLQ_QUEUE
        }
      });

      await writeLog('RabbitMQStatus', 'Connected to RabbitMQ broker. DLQ & DLX configured successfully.');

      // Start consuming events from the main integration queue
      rabbitChannel.consume(CONSUME_QUEUE, async (msg) => {
        if (msg === null) return;

        const rawContent = msg.content.toString();
        const msgHeaders = msg.properties.headers || {};

        // --- EIP: Retry Logic using x-death header ---
        // RabbitMQ automatically populates x-death when a message is dead-lettered.
        // We track this to enforce a max retry count before giving up.
        const deathHistory = msgHeaders['x-death'];
        const retryCount = Array.isArray(deathHistory)
          ? deathHistory.reduce((acc, d) => acc + (d.count || 0), 0)
          : 0;

        if (retryCount >= MAX_RETRY_COUNT) {
          // Max retries exceeded – send to DLQ and acknowledge (remove from queue)
          await sendToDlq(msg.content, msgHeaders, `Max retry count (${MAX_RETRY_COUNT}) exceeded`);
          rabbitChannel.ack(msg);
          return;
        }

        try {
          let payload = null;

          // Detect message format: XML or JSON
          if (rawContent.trim().startsWith('<')) {
            // XML message from Attendance Service
            await writeLog('AttendanceSubmitted', '[AttendanceSubmitted] Attendance → RabbitMQ (XML)');

            // EIP: Message Translator (XML -> Canonical JSON)
            payload = await translateXmlToCanonicalJson(rawContent);
            await writeLog('XMLTransformed', '[XMLTransformed] XML → Canonical JSON (Message Translator)');
          } else {
            // JSON message from HRIS Service
            payload = JSON.parse(rawContent);
            await writeLog('EmployeeCreated', '[EmployeeCreated] HRIS → RabbitMQ (JSON)');
          }

          // EIP: Canonical Data Model — validate before routing
          validateCanonicalMessage(payload);

          // EIP: Content-Based Router — route to correct downstream queues
          const destinations = routeMessage(payload);

          for (const dest of destinations) {
            await rabbitChannel.assertQueue(dest.queue, { durable: true });
            rabbitChannel.sendToQueue(dest.queue, Buffer.from(JSON.stringify(payload)), {
              persistent: true
            });
            await writeLog(payload.eventType, dest.log);
          }

          // Successfully processed — acknowledge the message
          rabbitChannel.ack(msg);
        } catch (error) {
          console.error('[EAI Error] Failed to process message:', error.message);
          await writeLog('IntegrationError', `[Error] Processing failed (retry ${retryCount + 1}/${MAX_RETRY_COUNT}): ${error.message}`);

          // nack without requeue -> message goes to DLX -> DLQ automatically
          // This triggers the built-in RabbitMQ dead-letter routing
          rabbitChannel.nack(msg, false, false);
        }
      });

      // Start consuming Dead Letter Queue messages for monitoring only (do not re-process)
      rabbitChannel.consume(DLQ_QUEUE, async (dlqMsg) => {
        if (dlqMsg === null) return;
        const dlqContent = dlqMsg.content.toString().substring(0, 200); // truncate for log
        await writeLog('DLQReceived', `[DLQ] Dead letter received. Preview: ${dlqContent}...`);
        // Acknowledge DLQ message (just log it, do not reprocess)
        rabbitChannel.ack(dlqMsg);
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
