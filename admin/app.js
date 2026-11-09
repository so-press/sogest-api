// Administration des clients de l'API.
//
// Connexion : OpenID Connect, code + PKCE (S256), client public `sogest` sans
// secret. L'id_token obtenu est échangé contre un JWT sogest par
// POST /login/sso, qui sert ensuite à appeler /api-clients (ultra admin).

const CLIENT_ID = 'sogest';
const API = new URL('../', location.href); // la page est servie sur <api>/admin/
const REDIRECT_URI = location.origin + location.pathname;
const K = { jwt: 'apiadmin.jwt', user: 'apiadmin.user', pkce: 'apiadmin.pkce' };

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (d) => (d ? esc(String(d).slice(0, 16).replace('T', ' ')) : '<span class="has-text-grey-light">—</span>');

const store = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* navigation privée */ } },
  del: (k) => { try { sessionStorage.removeItem(k); } catch { /* idem */ } },
};

// ---------------------------------------------------------------------------
// OIDC / PKCE
// ---------------------------------------------------------------------------

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const aleatoire = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function discovery() {
  const cfg = await (await fetch(new URL(`login/config?clientId=${CLIENT_ID}`, API))).json();
  const authority = cfg.authority.endsWith('/') ? cfg.authority : cfg.authority + '/';
  const oidc = await (await fetch(authority + '.well-known/openid-configuration')).json();
  return { ...oidc, scope: cfg.scope || 'openid profile email' };
}

async function seConnecter() {
  const oidc = await discovery();
  const verifier = aleatoire(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = aleatoire(16);
  const nonce = aleatoire(16);
  store.set(K.pkce, JSON.stringify({ verifier, state, nonce, token_endpoint: oidc.token_endpoint }));

  const url = new URL(oidc.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: oidc.scope,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  location.assign(url);
}

function payloadJwt(jwt) {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

/** Retour du SSO : ?code=…&state=… */
async function terminerConnexion(params) {
  const pkce = JSON.parse(store.get(K.pkce) || 'null');
  store.del(K.pkce);
  history.replaceState(null, '', REDIRECT_URI);

  if (params.get('error')) throw new Error(params.get('error_description') || params.get('error'));
  if (!pkce || params.get('state') !== pkce.state) throw new Error('Réponse du SSO inattendue (state), recommencez.');

  const res = await fetch(pkce.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.get('code'),
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }),
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.id_token) throw new Error(tok.error_description || tok.error || `SSO : HTTP ${res.status}`);
  if (payloadJwt(tok.id_token).nonce !== pkce.nonce) throw new Error('id_token inattendu (nonce), recommencez.');

  const login = await fetch(new URL('login/sso', API), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: tok.id_token, client_id: CLIENT_ID }),
  });
  const session = await login.json().catch(() => ({}));
  if (!login.ok || !session.token) throw new Error(session.message || session.error || `Connexion sogest : HTTP ${login.status}`);

  store.set(K.jwt, session.token);
  store.set(K.user, JSON.stringify(session.user || {}));
}

function seDeconnecter() {
  store.del(K.jwt);
  store.del(K.user);
  location.assign(REDIRECT_URI);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(method, path, body) {
  const res = await fetch(new URL(path, API), {
    method,
    headers: {
      Authorization: `Bearer ${store.get(K.jwt)}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || (res.status === 403 && String(data.error || '').startsWith('Unauthorized'))) {
    // JWT expiré ou invalide
    store.del(K.jwt);
    afficherLogin('Session expirée, reconnectez-vous.');
    throw new Error('session');
  }
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

let clients = [];
let courant = null; // client affiché, ou { id: null } en création

function erreur(e) {
  if (e?.message === 'session') return;
  const n = $('#app-error');
  n.querySelector('span').textContent = e?.message || String(e);
  n.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function afficherLogin(msg) {
  $('#app').hidden = true;
  $('#nav-user').hidden = true;
  $('#login').hidden = false;
  $('#login-error').hidden = !msg;
  $('#login-error').textContent = msg || '';
}

function etatTag(etat) {
  return {
    actif: '<span class="tag is-success is-light">actif</span>',
    expire: '<span class="tag is-warning is-light">expiré</span>',
    revoque: '<span class="tag is-light">révoqué</span>',
  }[etat] || esc(etat);
}

function rendreListe() {
  const f = $('#filtre').value.trim().toLowerCase();
  const visibles = clients.filter((c) => !f
    || c.nom.toLowerCase().includes(f)
    || (c.description || '').toLowerCase().includes(f)
    || c.domaines.some((d) => d.domaine.includes(f)));

  $('#liste').innerHTML = visibles.length
    ? visibles.map((c) => {
      const nbTokens = c.tokens.filter((t) => t.etat === 'actif').length;
      return `<a class="panel-block client-item ${courant?.id === c.id ? 'is-active' : ''}" data-id="${c.id}">
        <div style="width:100%">
          <div class="is-flex is-justify-content-space-between">
            <strong class="is-mono">${esc(c.nom)}</strong>
            ${c.actif ? '' : '<span class="tag is-light">inactif</span>'}
          </div>
          <div class="is-size-7 has-text-grey">
            ${nbTokens} jeton${nbTokens > 1 ? 's' : ''} actif${nbTokens > 1 ? 's' : ''} ·
            ${c.domaines.length} domaine${c.domaines.length > 1 ? 's' : ''}
          </div>
        </div>
      </a>`;
    }).join('')
    : '<div class="panel-block has-text-grey is-size-7">Aucun client.</div>';
}

function rendreDetail() {
  $('#vide').hidden = !!courant;
  $('#detail').hidden = !courant;
  if (!courant) return;

  const creation = !courant.id;
  const form = $('#form-client');
  $('#detail-titre').textContent = creation ? 'Nouveau client' : courant.nom;
  form.nom.value = courant.nom || '';
  form.description.value = courant.description || '';
  form.actif.checked = creation ? true : !!courant.actif;
  form.routes.value = (courant.scopes?.routes || []).join('\n');
  form.equipes.value = (courant.scopes?.equipes || []).join(', ');
  $('#btn-delete').hidden = creation;
  $('#btn-save').textContent = creation ? 'Créer' : 'Enregistrer';
  $('#sous-ressources').hidden = creation;
  if (creation) return;

  $('#tokens').innerHTML = courant.tokens.length
    ? courant.tokens.map((t) => `<tr class="${t.etat === 'actif' ? '' : 'has-text-grey'}">
        <td>${esc(t.libelle) || '<span class="has-text-grey-light">—</span>'}</td>
        <td class="is-mono">${esc(t.prefixe)}…</td>
        <td>${fmt(t.cree_le)}</td>
        <td>${fmt(t.expire_le && t.expire_le.slice(0, 10))}</td>
        <td>${fmt(t.dernier_usage)}</td>
        <td>${etatTag(t.etat)}</td>
        <td class="has-text-right">${t.revoque_le ? '' : `<button class="button is-small is-danger is-light" data-revoquer="${t.id}">Révoquer</button>`}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="has-text-grey">Aucun jeton.</td></tr>';

  $('#domaines').innerHTML = courant.domaines.length
    ? courant.domaines.map((d) => `<span class="tag is-info is-light is-medium is-mono">
        ${esc(d.domaine)}<button class="delete is-small" data-domaine="${d.id}" title="Retirer"></button></span>`).join('')
    : '<span class="has-text-grey is-size-7">Aucun domaine : ce client ne peut être appelé depuis un navigateur que via ALLOWED_DOMAINS.</span>';
}

function rendreHistorique(h) {
  const tokens = h.tokens.length
    ? `<ul>${h.tokens.map((t) => `<li><code>${esc(t.nom)}</code>${t.scopes ? ` <span class="has-text-grey">${esc(JSON.stringify(t.scopes))}</span>` : ''}</li>`).join('')}</ul>`
    : '<p class="has-text-grey">Aucun.</p>';
  const domaines = h.domaines.length
    ? `<div class="tags">${h.domaines.map((d) => `<span class="tag is-light is-mono">${esc(d)}</span>`).join('')}</div>`
    : '<p class="has-text-grey">Aucun.</p>';
  $('#historique').innerHTML = `<p class="mb-1"><strong>Jetons de config.json</strong></p>${tokens}
    <p class="mb-1"><strong>ALLOWED_DOMAINS</strong></p>${domaines}`;
}

async function charger(selectId = courant?.id) {
  const res = await api('GET', 'api-clients?limit=1000');
  clients = res.data || [];
  courant = selectId ? clients.find((c) => c.id === selectId) || null : courant && !courant.id ? courant : null;
  rendreListe();
  rendreDetail();
}

function lireFormulaire() {
  const form = $('#form-client');
  const routes = form.routes.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const equipes = form.equipes.value.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean).map(Number);
  const scopes = {};
  if (routes.length) scopes.routes = routes;
  if (equipes.length) scopes.equipes = equipes;
  return {
    nom: form.nom.value.trim(),
    description: form.description.value,
    actif: form.actif.checked,
    scopes: Object.keys(scopes).length ? scopes : null,
  };
}

async function avecBouton(btn, fn) {
  btn?.classList.add('is-loading');
  try {
    await fn();
    $('#app-error').hidden = true;
  } catch (e) {
    erreur(e);
  } finally {
    btn?.classList.remove('is-loading');
  }
}

function brancherEvenements() {
  $('#btn-login').addEventListener('click', () => seConnecter().catch((e) => afficherLogin(e.message)));
  $('#btn-logout').addEventListener('click', seDeconnecter);
  $('[data-close="app-error"]').addEventListener('click', () => { $('#app-error').hidden = true; });
  $('#filtre').addEventListener('input', rendreListe);

  $('#liste').addEventListener('click', (e) => {
    const a = e.target.closest('[data-id]');
    if (!a) return;
    courant = clients.find((c) => c.id === Number(a.dataset.id)) || null;
    rendreListe();
    rendreDetail();
  });

  $('#btn-new').addEventListener('click', () => {
    courant = { id: null, tokens: [], domaines: [] };
    rendreListe();
    rendreDetail();
    $('#form-client').nom.focus();
  });

  $('#btn-cancel').addEventListener('click', () => {
    courant = courant?.id ? clients.find((c) => c.id === courant.id) : null;
    rendreDetail();
  });

  $('#form-client').addEventListener('submit', (e) => {
    e.preventDefault();
    avecBouton($('#btn-save'), async () => {
      const data = lireFormulaire();
      const c = courant.id
        ? await api('PUT', `api-clients/${courant.id}`, data)
        : await api('POST', 'api-clients', data);
      await charger(c.id);
    });
  });

  $('#btn-delete').addEventListener('click', () => {
    if (!confirm(`Supprimer le client « ${courant.nom} » ? Tous ses jetons seront révoqués et ses domaines ignorés.`)) return;
    avecBouton($('#btn-delete'), async () => {
      await api('DELETE', `api-clients/${courant.id}`);
      courant = null;
      await charger(null);
    });
  });

  $('#form-token').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    avecBouton(f.querySelector('button'), async () => {
      const res = await api('POST', `api-clients/${courant.id}/tokens`, {
        libelle: f.libelle.value,
        expire_le: f.expire_le.value || null,
      });
      f.reset();
      $('#token-clair').textContent = res.token;
      $('#modal-token').classList.add('is-active');
      await charger(courant.id);
    });
  });

  $('#btn-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#token-clair').textContent);
      $('#btn-copy').textContent = 'Copié ✓';
    } catch {
      $('#btn-copy').textContent = 'Sélectionnez et copiez à la main';
    }
  });
  $('#btn-close-token').addEventListener('click', () => {
    $('#modal-token').classList.remove('is-active');
    $('#token-clair').textContent = '';
    $('#btn-copy').textContent = 'Copier';
  });

  $('#tokens').addEventListener('click', (e) => {
    const b = e.target.closest('[data-revoquer]');
    if (!b) return;
    if (!confirm('Révoquer ce jeton ? Les appels qui l\'utilisent seront refusés immédiatement.')) return;
    avecBouton(b, async () => {
      await api('DELETE', `api-clients/${courant.id}/tokens/${b.dataset.revoquer}`);
      await charger(courant.id);
    });
  });

  $('#form-domaine').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    avecBouton(f.querySelector('button'), async () => {
      await api('POST', `api-clients/${courant.id}/domaines`, { domaine: f.domaine.value });
      f.reset();
      await charger(courant.id);
    });
  });

  $('#domaines').addEventListener('click', (e) => {
    const b = e.target.closest('[data-domaine]');
    if (!b) return;
    avecBouton(null, async () => {
      await api('DELETE', `api-clients/${courant.id}/domaines/${b.dataset.domaine}`);
      await charger(courant.id);
    });
  });
}

async function demarrer() {
  brancherEvenements();

  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) {
    try {
      await terminerConnexion(params);
    } catch (e) {
      return afficherLogin(e.message);
    }
  }

  if (!store.get(K.jwt)) return afficherLogin();

  const user = JSON.parse(store.get(K.user) || '{}');
  if (!user.can?.ultraAdmin) {
    store.del(K.jwt);
    return afficherLogin(`${user.name || user.email || 'Ce compte'} n'est pas ultra admin : accès refusé.`);
  }

  $('#nav-user-name').textContent = user.name || user.email || '';
  $('#nav-user').hidden = false;
  $('#login').hidden = true;
  $('#app').hidden = false;

  try {
    const [, historique] = await Promise.all([charger(null), api('GET', 'api-clients/historique')]);
    rendreHistorique(historique);
  } catch (e) {
    erreur(e);
  }
}

demarrer();
