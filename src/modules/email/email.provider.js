const net = require("net");
const tls = require("tls");

function isMockDelivery() {
  return process.env.NODE_ENV === "test" || process.env.EMAIL_MOCK_DELIVERY === "true";
}

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  return error;
}

function encodeHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function buildRawEmail(message, config) {
  const fromName = config.fromName || config.from_name || "Afresh";
  const fromAddress = config.fromAddress || config.from_address || config.fromEmail || config.from_email;
  const to = Array.isArray(message.to) ? message.to.join(", ") : message.to;
  return [
    `From: ${encodeHeader(fromName)} <${encodeHeader(fromAddress)}>`,
    `To: ${encodeHeader(to)}`,
    `Subject: ${encodeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    String(message.html || message.body || "").replace(/\n/g, "\r\n"),
  ].join("\r\n");
}

async function sendPostmark(config, credentials, message) {
  const token = credentials.apiKey || process.env.POSTMARK_SERVER_TOKEN;
  if (!token) {
    throw createHttpError(400, "Postmark server token is required.", "EMAIL_CONFIGURATION_INVALID");
  }
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-postmark-server-token": token,
    },
    body: JSON.stringify({
      From: `${config.fromName || config.from_name || "Afresh"} <${config.fromAddress || config.from_address}>`,
      To: Array.isArray(message.to) ? message.to.join(",") : message.to,
      Subject: message.subject,
      HtmlBody: message.html || message.body,
      TextBody: message.text || String(message.body || "").replace(/<[^>]*>/g, ""),
      MessageStream: config.messageStream || config.message_stream || "outbound",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ErrorCode) {
    throw createHttpError(502, payload.Message || "Postmark email delivery failed.", "EMAIL_DELIVERY_FAILED");
  }
  return { messageId: payload.MessageID || payload.MessageId || null, responseCode: response.status };
}

function createSocket(config) {
  const host = config.smtpHost || config.smtp_host || config.host;
  const port = Number(config.smtpPort || config.smtp_port || config.port || 587);
  const encryption = String(config.encryptionType || config.encryption_type || "").toLowerCase();
  if (!host || !port) {
    throw createHttpError(400, "SMTP host and port are required.", "EMAIL_CONFIGURATION_INVALID");
  }
  return encryption === "ssl" || encryption === "tls" || port === 465
    ? tls.connect({ host, port, servername: host, rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" })
    : net.connect({ host, port });
}

function waitForLine(socket, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(createHttpError(504, "SMTP server timed out.", "EMAIL_PROVIDER_TIMEOUT")), timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    }
    function onData(chunk) {
      const text = chunk.toString("utf8");
      if (/^\d{3}[ -]/m.test(text)) {
        cleanup();
        resolve(text);
      }
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function command(socket, line, expected = /^[23]/) {
  socket.write(`${line}\r\n`);
  const response = await waitForLine(socket);
  if (!expected.test(response)) {
    throw createHttpError(502, `SMTP command failed: ${response.trim()}`, "EMAIL_DELIVERY_FAILED");
  }
  return response;
}

async function maybeStartTls(socket, config) {
  const encryption = String(config.encryptionType || config.encryption_type || "").toLowerCase();
  if (encryption !== "starttls") {
    return socket;
  }
  await command(socket, "STARTTLS");
  return tls.connect({
    socket,
    servername: config.smtpHost || config.smtp_host || config.host,
    rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
  });
}

async function sendSmtp(config, credentials, message) {
  const username = config.smtpUsername || config.smtp_username || config.username;
  const password = credentials.smtpPassword || process.env.SMTP_PASSWORD;
  let socket = createSocket(config);
  try {
    await waitForLine(socket);
    await command(socket, `EHLO ${process.env.SMTP_HELO_HOST || "afresh.local"}`);
    socket = await maybeStartTls(socket, config);
    if (socket.encrypted) {
      await command(socket, `EHLO ${process.env.SMTP_HELO_HOST || "afresh.local"}`);
    }
    if (username && password) {
      await command(socket, `AUTH PLAIN ${Buffer.from(`\0${username}\0${password}`).toString("base64")}`);
    }
    const from = config.fromAddress || config.from_address || config.fromEmail || config.from_email;
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    await command(socket, `MAIL FROM:<${from}>`);
    for (const recipient of recipients) {
      await command(socket, `RCPT TO:<${recipient}>`);
    }
    await command(socket, "DATA", /^3/);
    socket.write(`${buildRawEmail(message, config)}\r\n.\r\n`);
    await waitForLine(socket);
    await command(socket, "QUIT", /^[23]/).catch(() => null);
    return { messageId: `smtp-${Date.now()}`, responseCode: 250 };
  } finally {
    socket.destroy();
  }
}

async function sendEmail(config, credentials, message) {
  if (isMockDelivery()) {
    return { messageId: `mock-email-${Date.now()}`, responseCode: 200 };
  }
  const provider = String(config.provider || config.emailProvider || "smtp").toLowerCase();
  if (provider === "postmark") {
    return sendPostmark(config, credentials, message);
  }
  return sendSmtp(config, credentials, message);
}

async function checkStatus(config, credentials) {
  if (!config.isEnabled && !config.is_enabled) {
    return { status: "disabled", message: "Email sending is disabled." };
  }
  if (isMockDelivery()) {
    return { status: "operational", message: "Email provider is reachable." };
  }
  if (String(config.provider || "smtp").toLowerCase() === "postmark") {
    const token = credentials.apiKey || process.env.POSTMARK_SERVER_TOKEN;
    if (!token) {
      return { status: "failed", message: "Postmark server token is missing." };
    }
    return { status: "operational", message: "Postmark is configured." };
  }
  const socket = createSocket(config);
  try {
    await waitForLine(socket, 8000);
    return { status: "operational", message: "SMTP server accepted the connection." };
  } catch (error) {
    return { status: "failed", message: error.publicMessage || error.message };
  } finally {
    socket.destroy();
  }
}

module.exports = { checkStatus, sendEmail };
