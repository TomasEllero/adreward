# AdReward — Rewarded Ads Infrastructure

Widget embebible que permite a casinos y plataformas dar créditos a usuarios a cambio de completar encuestas.

## Deploy en Railway

1. Crear cuenta en https://railway.app
2. New Project → Deploy from GitHub repo
3. Seleccionar este repo
4. Agregar variables de entorno:
   - `POLLFISH_API_KEY` → tu BitLabs App Token
   - `POLLFISH_SECRET_KEY` → tu BitLabs Secret Key
   - `JWT_SECRET` → string random largo
   - `NODE_ENV` → production
5. Deploy automático

Tu servidor estará en: `https://tu-proyecto.up.railway.app`

## Desarrollo local

```bash
cd server
npm install
cp .env.example .env
# Editar .env con tus keys
npm start
```

El servidor corre en `http://localhost:3000`

---

## 2. Configurar Pollfish

1. Ir a https://dashboard.pollfish.com
2. Crear cuenta como **Publisher**
3. Crear una nueva App → Web Plugin
4. Copiar el **API Key** y el **Secret Key**
5. Pegarlo en `.env`:
   ```
   POLLFISH_API_KEY=xxxxxxxxxxxx
   POLLFISH_SECRET_KEY=xxxxxxxxxxxx
   ```
6. En Pollfish dashboard, configurar el **Callback URL**:
   ```
   https://tuservidor.com/api/callback/pollfish
   ```
   Con estos custom params:
   ```
   session_id=%custom_param_1%
   platform_key=%custom_param_2%
   ```

---

## 3. Registrar un casino cliente

```bash
curl -X POST http://localhost:3000/api/admin/platform/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MiCasino",
    "callbackUrl": "https://micasino.com/api/adreward-callback",
    "creditAmount": 0.20,
    "currency": "USD"
  }'
```

Respuesta:
```json
{
  "message": "Plataforma registrada exitosamente",
  "platformKey": "pk_abc123...",
  "embedCode": "<script src='...'></script>"
}
```

---

## 4. Integración del lado del casino

El casino pega esto antes del `</body>`:

```html
<script
  src="https://tuservidor.com/widget.js"
  data-key="pk_abc123..."
  data-credit-amount="0.20"
  data-currency="USD"
  async
></script>
```

Y en su JavaScript, cuando el usuario inicia sesión:

```javascript
// Decirle al widget quién es el usuario
AdReward.setUser('user_id_del_casino');

// Escuchar cuando completa y debe recibir crédito
document.addEventListener('adreward:completed', (e) => {
  const { userId, creditAmount, currency } = e.detail;
  // Acreditar en el sistema del casino
  api.addCredits(userId, creditAmount);
});
```

---

## 5. Callback que recibe el casino (servidor)

Cuando el usuario completa los anuncios, AdReward llama automáticamente al casino:

```javascript
// Express ejemplo en el casino
app.post('/api/adreward-callback', (req, res) => {
  const signature = req.headers['x-adreward-signature'];
  const { userId, creditAmount, currency, adrewardVerified } = req.body;

  // Verificar firma (opcional pero recomendado)
  const expected = crypto
    .createHmac('sha256', 'TU_PLATFORM_KEY')
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expected) {
    return res.status(401).json({ error: 'Firma inválida' });
  }

  // Dar el crédito al usuario en tu base de datos
  db.users.addCredits(userId, creditAmount, currency);

  res.json({ ok: true });
});
```

---

## 6. Dashboard

Abrir `http://localhost:3000/dashboard`

Ingresar la Platform Key del casino para ver:
- Sesiones totales / completadas / tasa de conversión
- Ganancias acumuladas
- Últimas transacciones
- Embed code listo para copiar

Para demo usar: `demo_platform_key_123`

---

## 7. Endpoints disponibles

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/widget/init` | Inicializar sesión (widget) |
| POST | `/api/widget/complete` | Marcar sesión completa (widget) |
| GET | `/api/callback/pollfish` | Callback de Pollfish |
| GET | `/api/admin/stats/:key` | Stats de una plataforma |
| POST | `/api/admin/platform/register` | Registrar nueva plataforma |
| GET | `/widget.js` | Servir el widget |
| GET | `/health` | Health check |

---

## 8. Siguientes pasos para producción

- [ ] Reemplazar DB en memoria por **PostgreSQL** (usar Prisma o pg)
- [ ] Agregar autenticación al endpoint de registro de plataformas
- [ ] Agregar rate limiting (express-rate-limit)
- [ ] Deploy en Railway, Render, o VPS
- [ ] Configurar HTTPS (obligatorio para Pollfish)
- [ ] Testear callback de Pollfish con ngrok en desarrollo
- [ ] Agregar más redes de ads (Adjoe, Offertoro)

---

## Testing rápido con ngrok

Para probar el callback de Pollfish en local:

```bash
# En una terminal
npm run dev

# En otra terminal
ngrok http 3000

# Usar la URL de ngrok en Pollfish dashboard:
# https://xxxx.ngrok.io/api/callback/pollfish
```
