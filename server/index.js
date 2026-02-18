// ─────────────────────────────────────────────
//  AdReward — Servidor principal
//  Node.js + Express
// ─────────────────────────────────────────────

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────
//  BASE DE DATOS EN MEMORIA
//  En producción reemplazá esto con PostgreSQL
// ─────────────────────────────────────────────

const db = {

  // Plataformas registradas (casinos, etc.)
  platforms: {
    'demo_platform_key_123': {
      id: 'demo_platform_key_123',
      name: 'Demo Casino',
      callbackUrl: 'http://localhost:3001/reward-received',
      creditAmount: 0.20,
      currency: 'USD',
      revenueShare: 0.40,
      adrewardShare: 0.30,
      userShare: 0.30,
      bitlabsToken: '6b40c235-8f0d-45e7-a38b-4c1a84c8a09f',
      active: true,
      createdAt: new Date().toISOString()
    }
  },

  // Sesiones de anuncios (una por usuario por vez)
  sessions: {},

  // Transacciones completadas
  transactions: [],

  // Stats por plataforma
  stats: {
    'demo_platform_key_123': {
      totalSessions: 0,
      completedSessions: 0,
      totalGenerated: 0,
      totalPaidOut: 0
    }
  }
};


// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

// Genera un token seguro para identificar cada sesión
function generateSessionToken(platformKey, userId) {
  const data = `${platformKey}:${userId}:${Date.now()}`;
  return crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev_secret')
    .update(data)
    .digest('hex');
}

// Verifica la firma que manda Pollfish en el callback
function verifyPollfishSignature(params, signature) {
  const secret = process.env.POLLFISH_SECRET_KEY || 'dev_pollfish_secret';
  const dataToSign = [
    params.userId,
    params.surveyId,
    params.reward,
    secret
  ].join('');
  const expected = crypto.createHash('md5').update(dataToSign).digest('hex');
  return expected === signature;
}

// Notifica al casino que el usuario completó los anuncios
async function notifyPlatform(platform, userId, sessionToken, amountEarned) {
  try {
    const payload = {
      userId,
      sessionToken,
      creditAmount: platform.creditAmount,
      currency: platform.currency,
      adrewardVerified: true,
      timestamp: new Date().toISOString()
    };

    // Firma el callback para que el casino pueda verificar que es legítimo
    const signature = crypto
      .createHmac('sha256', platform.id)
      .update(JSON.stringify(payload))
      .digest('hex');

    const response = await fetch(platform.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AdReward-Signature': signature
      },
      body: JSON.stringify(payload)
    });

    return response.ok;
  } catch (err) {
    console.error('Error notificando plataforma:', err.message);
    return false;
  }
}


// ─────────────────────────────────────────────
//  RUTAS — WIDGET (llamadas desde el frontend)
// ─────────────────────────────────────────────

// GET /api/widget/init
// El widget llama esto al cargarse para obtener config y crear sesión
app.get('/api/widget/init', (req, res) => {
  const { platformKey, userId } = req.query;

  if (!platformKey || !userId) {
    return res.status(400).json({ error: 'platformKey y userId son requeridos' });
  }

  const platform = db.platforms[platformKey];
  if (!platform || !platform.active) {
    return res.status(404).json({ error: 'Plataforma no encontrada o inactiva' });
  }

  // Crea una sesión nueva para este usuario
  const sessionToken = generateSessionToken(platformKey, userId);
  const sessionId = uuidv4();

  db.sessions[sessionId] = {
    id: sessionId,
    sessionToken,
    platformKey,
    userId,
    status: 'pending',       // pending → completed → rewarded
    adsCompleted: 0,
    totalEarned: 0,
    createdAt: new Date().toISOString(),
    completedAt: null
  };

  // Stats
  if (!db.stats[platformKey]) {
    db.stats[platformKey] = { totalSessions: 0, completedSessions: 0, totalGenerated: 0, totalPaidOut: 0 };
  }
  db.stats[platformKey].totalSessions++;

  console.log(`[INIT] Nueva sesión para usuario ${userId} en plataforma ${platform.name}`);

  res.json({
    sessionId,
    sessionToken,
    creditAmount: platform.creditAmount,
    currency: platform.currency,
    bitlabsToken: platform.bitlabsToken || process.env.POLLFISH_API_KEY,
    requiredAds: 3,
    message: `Completá ${3} encuestas y ganá $${platform.creditAmount} ${platform.currency}`
  });
});


// POST /api/widget/complete
// El widget llama esto cuando el usuario terminó todos los anuncios
// (backup por si el callback de Pollfish falla)
app.post('/api/widget/complete', (req, res) => {
  const { sessionId, sessionToken } = req.body;

  const session = db.sessions[sessionId];
  if (!session) {
    return res.status(404).json({ error: 'Sesión no encontrada' });
  }

  if (session.sessionToken !== sessionToken) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  if (session.status === 'rewarded') {
    return res.status(400).json({ error: 'Esta sesión ya fue recompensada' });
  }

  res.json({ status: 'ok', message: 'Verificando con servidor de anuncios...' });
});


// ─────────────────────────────────────────────
//  CALLBACK DE POLLFISH
//  Pollfish llama esta URL cuando el usuario
//  completa una encuesta. Se configura en el
//  dashboard de Pollfish.
// ─────────────────────────────────────────────

// GET /api/callback/pollfish
// Pollfish usa GET con query params por defecto
app.get('/api/callback/pollfish', async (req, res) => {
  const {
    uid: userId,           // ID del usuario que completó la encuesta
    survey_id: surveyId,   // ID de la encuesta
    reward_value: reward,  // Cuánto pagó esta encuesta (en centavos USD)
    signature,             // Firma de seguridad de Pollfish
    // Nuestros params custom que mandamos al configurar Pollfish
    session_id: sessionId,
    platform_key: platformKey
  } = req.query;

  console.log(`[POLLFISH CALLBACK] userId=${userId} surveyId=${surveyId} reward=${reward}`);

  // 1. Verificar firma (en producción esto es crítico para evitar fraude)
  const isValid = process.env.NODE_ENV === 'production'
    ? verifyPollfishSignature({ userId, surveyId, reward }, signature)
    : true; // En desarrollo lo salteamos

  if (!isValid) {
    console.warn('[POLLFISH] Firma inválida — posible fraude');
    return res.status(401).send('Invalid signature');
  }

  // 2. Buscar la sesión
  const session = db.sessions[sessionId];
  if (!session || session.status === 'rewarded') {
    return res.status(200).send('OK'); // Pollfish necesita 200 igual
  }

  // 3. Buscar la plataforma
  const platform = db.platforms[platformKey || session.platformKey];
  if (!platform) {
    return res.status(200).send('OK');
  }

  // 4. Sumar el reward de esta encuesta
  const rewardUSD = parseFloat(reward) / 100; // Pollfish manda en centavos
  session.adsCompleted++;
  session.totalEarned += rewardUSD;

  // 5. Si completó las encuestas requeridas, dar el crédito
  if (session.adsCompleted >= 3) {
    session.status = 'rewarded';
    session.completedAt = new Date().toISOString();

    // Guardar la transacción
    const tx = {
      id: uuidv4(),
      sessionId,
      platformKey: session.platformKey,
      userId: session.userId,
      totalGenerated: session.totalEarned,
      platformEarned: session.totalEarned * platform.revenueShare,
      adrewardEarned: session.totalEarned * platform.adrewardShare,
      userCredit: platform.creditAmount,
      timestamp: new Date().toISOString()
    };
    db.transactions.push(tx);

    // Actualizar stats
    db.stats[session.platformKey].completedSessions++;
    db.stats[session.platformKey].totalGenerated += session.totalEarned;
    db.stats[session.platformKey].totalPaidOut += platform.creditAmount;

    // Notificar al casino para que dé el crédito al usuario
    const notified = await notifyPlatform(
      platform,
      session.userId,
      session.sessionToken,
      session.totalEarned
    );

    console.log(`[REWARD] Usuario ${userId} completó sesión. Generado: $${session.totalEarned.toFixed(4)} | Notificado: ${notified}`);
  }

  // Pollfish siempre necesita un 200 OK
  res.status(200).send('OK');
});


// ─────────────────────────────────────────────
//  RUTAS — DASHBOARD / ADMIN
// ─────────────────────────────────────────────

// GET /api/admin/stats/:platformKey
// El casino puede ver sus propias stats
app.get('/api/admin/stats/:platformKey', (req, res) => {
  const { platformKey } = req.params;
  const platform = db.platforms[platformKey];

  if (!platform) {
    return res.status(404).json({ error: 'Plataforma no encontrada' });
  }

  const stats = db.stats[platformKey] || {};
  const recentTx = db.transactions
    .filter(tx => tx.platformKey === platformKey)
    .slice(-20)
    .reverse();

  res.json({
    platform: {
      name: platform.name,
      creditAmount: platform.creditAmount,
      currency: platform.currency
    },
    stats: {
      totalSessions: stats.totalSessions || 0,
      completedSessions: stats.completedSessions || 0,
      conversionRate: stats.totalSessions
        ? ((stats.completedSessions / stats.totalSessions) * 100).toFixed(1) + '%'
        : '0%',
      totalGenerated: '$' + (stats.totalGenerated || 0).toFixed(4),
      yourEarnings: '$' + ((stats.totalGenerated || 0) * platform.revenueShare).toFixed(4),
      totalPaidToUsers: '$' + (stats.totalPaidOut || 0).toFixed(2)
    },
    recentTransactions: recentTx
  });
});

// POST /api/admin/platform/register
// Registrar una nueva plataforma (casino)
app.post('/api/admin/platform/register', (req, res) => {
  const { name, callbackUrl, creditAmount, currency } = req.body;

  if (!name || !callbackUrl) {
    return res.status(400).json({ error: 'name y callbackUrl son requeridos' });
  }

  const platformKey = 'pk_' + crypto.randomBytes(16).toString('hex');

  db.platforms[platformKey] = {
    id: platformKey,
    name,
    callbackUrl,
    creditAmount: creditAmount || 0.20,
    currency: currency || 'USD',
    revenueShare: 0.40,
    adrewardShare: 0.30,
    userShare: 0.30,
    active: true,
    createdAt: new Date().toISOString()
  };

  db.stats[platformKey] = {
    totalSessions: 0,
    completedSessions: 0,
    totalGenerated: 0,
    totalPaidOut: 0
  };

  console.log(`[REGISTER] Nueva plataforma: ${name} | Key: ${platformKey}`);

  res.json({
    message: 'Plataforma registrada exitosamente',
    platformKey,
    embedCode: generateEmbedCode(platformKey, creditAmount || 0.20, currency || 'USD', callbackUrl)
  });
});

// Helper para generar el embed code
function generateEmbedCode(platformKey, creditAmount, currency, callbackUrl) {
  return `<script
  src="${process.env.SERVER_URL || 'https://tuservidor.com'}/widget.js"
  data-key="${platformKey}"
  data-credit-amount="${creditAmount}"
  data-currency="${currency}"
  data-callback="${callbackUrl}"
  async
></script>`;
}


// ─────────────────────────────────────────────
//  SERVIR EL WIDGET JS
// ─────────────────────────────────────────────

app.get('/widget.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(path.join(__dirname, '..', 'widget', 'widget.js'));
});

// Servir el dashboard de demo
app.use('/dashboard', express.static(path.join(__dirname, '..', 'dashboard')));

// Servir landing page pública
app.use(express.static(path.join(__dirname, '..', 'public')));


// ─────────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    platforms: Object.keys(db.platforms).length,
    sessions: Object.keys(db.sessions).length,
    transactions: db.transactions.length
  });
});


// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════╗
  ║       AdReward Server v1.0        ║
  ║  Running on http://localhost:${PORT}  ║
  ╚═══════════════════════════════════╝

  Endpoints disponibles:
  → GET  /api/widget/init          (widget)
  → POST /api/widget/complete      (widget)
  → GET  /api/callback/pollfish    (pollfish callback)
  → GET  /api/admin/stats/:key     (dashboard)
  → POST /api/admin/platform/register
  → GET  /widget.js                (embed script)
  → GET  /health
  `);
});

module.exports = app;
