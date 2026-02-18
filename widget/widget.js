// ─────────────────────────────────────────────
//  AdReward Widget v1.0
//  Este archivo se sirve desde el servidor AdReward
//  El casino lo pega con un <script> tag
// ─────────────────────────────────────────────

(function() {
  'use strict';

  // ─── Leer configuración del script tag
  const scriptTag = document.currentScript || (function() {
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  const CONFIG = {
    platformKey:  scriptTag.getAttribute('data-key'),
    creditAmount: scriptTag.getAttribute('data-credit-amount') || '0.20',
    currency:     scriptTag.getAttribute('data-currency') || 'USD',
    callbackUrl:  scriptTag.getAttribute('data-callback'),
    // Primero usar data-server-url si está, sino derivar del src
    serverUrl:    scriptTag.getAttribute('data-server-url') ||
                  scriptTag.src.replace('/widget.js', '').replace(/\/$/, ''),
    userId:       null,
    sessionId:    null,
    sessionToken: null,
    bitlabsToken: null
  };

  // ─── Estado interno
  let state = {
    initialized: false,
    adsCompleted: 0,
    requiredAds: 3,
    pollfishReady: false
  };

  // ─────────────────────────────────────────────
  //  ESTILOS DEL WIDGET
  // ─────────────────────────────────────────────

  function injectStyles() {
    const css = `
      #adreward-widget {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
      }

      #adreward-btn {
        background: #C8FF00;
        color: #080A0F;
        border: none;
        padding: 14px 22px;
        border-radius: 50px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 24px rgba(200,255,0,0.35);
        transition: all 0.2s;
        white-space: nowrap;
      }

      #adreward-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 32px rgba(200,255,0,0.45);
      }

      #adreward-btn .ar-pulse {
        width: 8px;
        height: 8px;
        background: #080A0F;
        border-radius: 50%;
        animation: ar-pulse 2s infinite;
      }

      @keyframes ar-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.7); }
      }

      #adreward-modal-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.75);
        backdrop-filter: blur(4px);
        z-index: 100000;
        align-items: center;
        justify-content: center;
      }

      #adreward-modal-overlay.open {
        display: flex;
      }

      #adreward-modal {
        background: #0E1118;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 20px;
        padding: 40px;
        max-width: 480px;
        width: 90%;
        position: relative;
        animation: ar-slideUp 0.3s ease;
      }

      @keyframes ar-slideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }

      #adreward-modal .ar-close {
        position: absolute;
        top: 16px; right: 16px;
        background: none;
        border: none;
        color: #7A8099;
        font-size: 20px;
        cursor: pointer;
        width: 32px; height: 32px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 50%;
        transition: background 0.2s;
      }

      #adreward-modal .ar-close:hover { background: rgba(255,255,255,0.06); }

      #adreward-modal .ar-logo {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #C8FF00;
        margin-bottom: 24px;
      }

      #adreward-modal h2 {
        color: #F0F2F7;
        font-size: 22px;
        font-weight: 700;
        margin-bottom: 10px;
        line-height: 1.2;
      }

      #adreward-modal .ar-sub {
        color: #7A8099;
        font-size: 14px;
        margin-bottom: 28px;
        line-height: 1.6;
      }

      #adreward-modal .ar-credit-badge {
        background: rgba(200,255,0,0.1);
        border: 1px solid rgba(200,255,0,0.2);
        border-radius: 12px;
        padding: 20px 24px;
        margin-bottom: 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .ar-credit-badge .ar-amount {
        font-size: 32px;
        font-weight: 800;
        color: #C8FF00;
        letter-spacing: -0.03em;
      }

      .ar-credit-badge .ar-label {
        font-size: 12px;
        color: #7A8099;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .ar-credit-badge .ar-steps {
        text-align: right;
      }

      .ar-credit-badge .ar-steps-num {
        font-size: 14px;
        color: #F0F2F7;
        font-weight: 600;
      }

      #adreward-modal .ar-progress {
        display: flex;
        gap: 6px;
        margin-bottom: 28px;
      }

      .ar-progress-dot {
        flex: 1;
        height: 4px;
        background: rgba(255,255,255,0.08);
        border-radius: 2px;
        transition: background 0.4s;
      }

      .ar-progress-dot.done { background: #C8FF00; }
      .ar-progress-dot.active {
        background: rgba(200,255,0,0.4);
        animation: ar-blink 1s infinite;
      }

      @keyframes ar-blink {
        0%, 100% { opacity: 1; } 50% { opacity: 0.5; }
      }

      #adreward-start-btn {
        width: 100%;
        background: #C8FF00;
        color: #080A0F;
        border: none;
        padding: 16px;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
        letter-spacing: 0.02em;
      }

      #adreward-start-btn:hover {
        background: #d4ff1a;
        transform: translateY(-1px);
        box-shadow: 0 8px 24px rgba(200,255,0,0.3);
      }

      #adreward-start-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      #adreward-modal .ar-disclaimer {
        text-align: center;
        font-size: 11px;
        color: rgba(122,128,153,0.6);
        margin-top: 14px;
      }

      /* Estado de éxito */
      #adreward-success {
        display: none;
        text-align: center;
        padding: 20px 0;
      }

      #adreward-success .ar-check {
        font-size: 48px;
        margin-bottom: 16px;
      }

      #adreward-success h3 {
        color: #F0F2F7;
        font-size: 20px;
        font-weight: 700;
        margin-bottom: 8px;
      }

      #adreward-success p {
        color: #7A8099;
        font-size: 14px;
      }
    `;

    const style = document.createElement('style');
    style.id = 'adreward-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────
  //  RENDERIZAR WIDGET
  // ─────────────────────────────────────────────

  function renderWidget() {
    // Botón flotante
    const widget = document.createElement('div');
    widget.id = 'adreward-widget';
    widget.innerHTML = `
      <button id="adreward-btn">
        <span class="ar-pulse"></span>
        Gan&#225; ${CONFIG.currency} ${CONFIG.creditAmount} gratis
      </button>
    `;

    // Modal
    const overlay = document.createElement('div');
    overlay.id = 'adreward-modal-overlay';
    overlay.innerHTML = `
      <div id="adreward-modal">
        <button class="ar-close" id="adreward-close">&#x2715;</button>
        <div class="ar-logo">AdReward</div>

        <!-- Vista principal -->
        <div id="adreward-main">
          <h2>Gan&#225; cr&#233;ditos gratis mirando anuncios</h2>
          <p class="ar-sub">Complet&#225; ${state.requiredAds} encuestas cortas y recib&#237;s cr&#233;dito instant&#225;neo en tu cuenta. Sin dep&#243;sito, sin tarjeta.</p>

          <div class="ar-credit-badge">
            <div>
              <div class="ar-amount">${CONFIG.currency} ${CONFIG.creditAmount}</div>
              <div class="ar-label">Cr&#233;dito a recibir</div>
            </div>
            <div class="ar-steps">
              <div class="ar-steps-num" id="ar-progress-text">0 / ${state.requiredAds} completadas</div>
              <div class="ar-label">encuestas</div>
            </div>
          </div>

          <div class="ar-progress" id="ar-progress-bar">
            ${Array(state.requiredAds).fill(0).map((_, i) =>
              `<div class="ar-progress-dot" id="ar-dot-${i}"></div>`
            ).join('')}
          </div>

          <button id="adreward-start-btn">Empezar y ganar &#8594;</button>
          <p class="ar-disclaimer">Powered by AdReward &middot; Las encuestas duran 1-2 min cada una</p>
        </div>

        <!-- Vista de éxito -->
        <div id="adreward-success">
          <div class="ar-check">&#9989;</div>
          <h3>&#161;Cr&#233;dito acreditado!</h3>
          <p>${CONFIG.currency} ${CONFIG.creditAmount} fueron a&#241;adidos a tu cuenta.</p>
        </div>
      </div>
    `;

    document.body.appendChild(widget);
    document.body.appendChild(overlay);

    // Event listeners
    document.getElementById('adreward-btn').addEventListener('click', openModal);
    document.getElementById('adreward-close').addEventListener('click', closeModal);
    document.getElementById('adreward-start-btn').addEventListener('click', startAds);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeModal();
    });
  }

  function openModal() {
    document.getElementById('adreward-modal-overlay').classList.add('open');
  }

  function closeModal() {
    document.getElementById('adreward-modal-overlay').classList.remove('open');
  }

  // ─────────────────────────────────────────────
  //  LÓGICA DE ADS
  // ─────────────────────────────────────────────

  function startAds() {
    if (!CONFIG.userId) {
      console.error('[AdReward] userId no seteado. Llamá AdReward.setUser(id) primero.');
      return;
    }

    const btn = document.getElementById('adreward-start-btn');
    btn.textContent = 'Cargando encuesta...';
    btn.disabled = true;

    // Inicializar sesión en el servidor
    initSession().then(() => {
      loadPollfish();
    }).catch(err => {
      console.error('[AdReward] Error iniciando sesión:', err);
      btn.textContent = 'Error, intentá de nuevo';
      btn.disabled = false;
    });
  }

  async function initSession() {
    const url = `${CONFIG.serverUrl}/api/widget/init?platformKey=${CONFIG.platformKey}&userId=${CONFIG.userId}`;
    const res = await fetch(url, {
      headers: {
        'ngrok-skip-browser-warning': 'true'
      }
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    CONFIG.sessionId    = data.sessionId;
    CONFIG.sessionToken = data.sessionToken;
    CONFIG.bitlabsToken = data.bitlabsToken;
    CONFIG.cpxAppId     = data.cpxAppId;
    state.requiredAds   = data.requiredAds || 3;

    // Actualizar UI con datos del servidor
    document.getElementById('ar-progress-text').textContent = `0 / ${state.requiredAds} completadas`;
    updateProgressBar();

    return data;
  }

  // ─── Cargar BitLabs Offer Wall
  function loadPollfish() {

    // Ocultar contenido del modal y mostrar iframe de BitLabs
    document.getElementById('adreward-main').style.display = 'none';

    // Contenedor del iframe
    const iframeWrap = document.createElement('div');
    iframeWrap.id = 'ar-bitlabs-wrap';
    iframeWrap.style.cssText = 'width:100%;height:500px;border-radius:12px;overflow:hidden;position:relative;';

    // Spinner de carga
    iframeWrap.innerHTML = `
      <div id="ar-iframe-loader" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#080A0F;border-radius:12px;gap:16px;">
        <div style="width:36px;height:36px;border:3px solid rgba(200,255,0,0.15);border-top-color:#C8FF00;border-radius:50%;animation:ar-spin 0.8s linear infinite;"></div>
        <span style="color:#7A8099;font-size:13px;">Cargando encuestas...</span>
      </div>
      <style>@keyframes ar-spin{to{transform:rotate(360deg)}}</style>
    `;

    // URL del Offer Wall de CPX Research
    const cpxUrl = `https://offers.cpx-research.com/index.php?app_id=${CONFIG.cpxAppId}&ext_user_id=${encodeURIComponent(CONFIG.userId)}&subid_1=${CONFIG.sessionId}&subid_2=${CONFIG.platformKey}`;

    const iframe = document.createElement('iframe');
    iframe.src = cpxUrl;
    iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:12px;display:none;';
    iframe.onload = function() {
      const loader = document.getElementById('ar-iframe-loader');
      if (loader) loader.style.display = 'none';
      iframe.style.display = 'block';
      console.log('[AdReward] CPX Research cargado');
    };

    iframeWrap.appendChild(iframe);

    // Botón manual por si postMessage no llega
    const doneBtn = document.createElement('button');
    doneBtn.innerHTML = '&#10003; Ya complet&#233; las encuestas';
    doneBtn.style.cssText = 'width:100%;margin-top:12px;background:rgba(200,255,0,0.1);border:1px solid rgba(200,255,0,0.25);color:#C8FF00;padding:14px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s;';
    doneBtn.onmouseover = () => doneBtn.style.background = 'rgba(200,255,0,0.18)';
    doneBtn.onmouseout  = () => doneBtn.style.background = 'rgba(200,255,0,0.1)';
    doneBtn.onclick     = () => showSuccess();

    const modal = document.getElementById('adreward-modal');
    modal.appendChild(iframeWrap);
    modal.appendChild(doneBtn);

    // Escuchar postMessage de BitLabs
    window.addEventListener('message', function(event) {
      if (!event.data) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data.type === 'survey_completed' || data.action === 'survey_completed') {
          console.log('[AdReward] Encuesta completada via postMessage');
          state.adsCompleted++;
          updateProgressBar();
          if (state.adsCompleted >= state.requiredAds) showSuccess();
        }
      } catch(e) {}
    });
  }

  function onSurveyCompleted(data) {
    state.adsCompleted++;
    updateProgressBar();
    if (state.adsCompleted >= state.requiredAds) showSuccess();
  }

  function onPollfishReady() {}
  function onSurveyNotAvailable() {}
  function onUserRejected() {}

  function updateProgressBar() {
    for (let i = 0; i < state.requiredAds; i++) {
      const dot = document.getElementById(`ar-dot-${i}`);
      if (!dot) continue;
      if (i < state.adsCompleted) {
        dot.className = 'ar-progress-dot done';
      } else if (i === state.adsCompleted) {
        dot.className = 'ar-progress-dot active';
      } else {
        dot.className = 'ar-progress-dot';
      }
    }
    const txt = document.getElementById('ar-progress-text');
    if (txt) txt.textContent = `${state.adsCompleted} / ${state.requiredAds} completadas`;
  }

  function showSuccess() {
    document.getElementById('adreward-main').style.display = 'none';
    document.getElementById('adreward-success').style.display = 'block';

    // Ocultar el botón flotante porque ya cobró
    const btn = document.getElementById('adreward-btn');
    if (btn) btn.style.display = 'none';

    // Emitir evento para que el casino pueda reaccionar
    const event = new CustomEvent('adreward:completed', {
      detail: {
        userId: CONFIG.userId,
        creditAmount: CONFIG.creditAmount,
        currency: CONFIG.currency
      }
    });
    document.dispatchEvent(event);

    // Cerrar modal después de 4 segundos
    setTimeout(closeModal, 4000);
  }


  // ─────────────────────────────────────────────
  //  API PÚBLICA
  //  El casino usa esto para configurar el widget
  // ─────────────────────────────────────────────

  window.AdReward = {

    // El casino llama esto cuando sabe quién es el usuario
    // Ejemplo: AdReward.setUser('user_123')
    setUser: function(userId) {
      CONFIG.userId = String(userId);
      console.log('[AdReward] Usuario seteado:', userId);
    },

    // Abrir el modal manualmente desde el casino
    open: function() {
      if (!CONFIG.userId) {
        console.warn('[AdReward] Llamá setUser() antes de open()');
        return;
      }
      openModal();
    },

    // Escuchar cuando el usuario completa y recibe crédito
    onComplete: function(callback) {
      document.addEventListener('adreward:completed', function(e) {
        callback(e.detail);
      });
    },

    // Obtener estado actual
    getStatus: function() {
      return {
        userId: CONFIG.userId,
        adsCompleted: state.adsCompleted,
        requiredAds: state.requiredAds,
        sessionId: CONFIG.sessionId
      };
    }
  };


  // ─────────────────────────────────────────────
  //  INIT
  // ─────────────────────────────────────────────

  function init() {
    if (!CONFIG.platformKey) {
      console.error('[AdReward] data-key es requerido en el script tag');
      return;
    }

    injectStyles();
    renderWidget();
    console.log('[AdReward] Widget inicializado para plataforma:', CONFIG.platformKey);
  }

  // Esperar a que el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
