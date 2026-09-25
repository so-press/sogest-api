/**
 * Envoi d'e-mails transactionnels, indépendant du fournisseur.
 *
 * Deux fournisseurs, comme sogest (`include/brevo.inc.php`,
 * `include/mailjet.inc.php`) : **Brevo** d'abord, **Mailjet** en secours si le
 * premier refuse. Un service d'envoi peut être suspendu du jour au lendemain
 * (quota, réputation, validation de compte) ; garder le second câblé évite que
 * tout ce qui dépend de l'e-mail s'arrête avec lui.
 *
 * Les appelants n'utilisent que {@link envoyerMail} et ne savent rien du
 * fournisseur retenu — c'est la réponse qui leur dit lequel a finalement servi.
 *
 * Configuration (`.env`) :
 * - `MAIL_PROVIDER` — fournisseur essayé en premier (`brevo` | `mailjet`)
 * - `MAIL_FALLBACK` — `0` pour désactiver la bascule vers l'autre fournisseur
 * - `BREVO_API_KEY` — clé Brevo **des e-mails** (distincte de `BREVO_SMS_API_KEY`)
 * - `MAILJET_KEY`, `MAILJET_SECRET`
 * - `MAIL_FROM`, `MAIL_FROM_NAME` — expéditeur par défaut
 * - `MAIL_BCC` — copie cachée systématique (archivage), vide par défaut
 * - `MAIL_REDIRECT_TO` — garde-fou des environnements de test, cf. plus bas
 * - `MAIL_ENV` — étiquette affichée quand la redirection est active
 * - `MAIL_MAX_ATTACHMENT_MB` — taille cumulée des pièces jointes (défaut 10)
 */

const TIMEOUT_MS = 20000;
const TIMEOUT_TELECHARGEMENT_MS = 20000;

/** Fournisseur essayé en premier, `brevo` par défaut. */
export function mailProvider() {
  return (process.env.MAIL_PROVIDER || 'brevo').trim().toLowerCase();
}

/** Taille cumulée maximale des pièces jointes, en octets. */
function tailleMaxPiecesJointes() {
  const mo = parseFloat(process.env.MAIL_MAX_ATTACHMENT_MB || '10');
  return Math.round((Number.isFinite(mo) && mo > 0 ? mo : 10) * 1024 * 1024);
}

/** Adresse de redirection des environnements de test (vide = envoi réel). */
export function mailRedirection() {
  return (process.env.MAIL_REDIRECT_TO || '').trim();
}

/**
 * État de la configuration, sans jamais exposer de clé : ce qu'un outil
 * appelant peut vérifier avant de se demander pourquoi ses mails ne partent pas.
 * @returns {Object}
 */
export function mailConfig() {
  const redirection = mailRedirection();
  return {
    provider: mailProvider(),
    fallback: fallbackActif(),
    fournisseurs: {
      brevo: !!process.env.BREVO_API_KEY,
      mailjet: !!(process.env.MAILJET_KEY && process.env.MAILJET_SECRET),
    },
    from: expediteurParDefaut(),
    bcc: (process.env.MAIL_BCC || '').trim() || null,
    redirection: redirection
      ? { actif: true, vers: redirection, etiquette: etiquetteEnv() }
      : { actif: false },
    taille_max_pieces_jointes_mo: Math.round(tailleMaxPiecesJointes() / 1024 / 1024 * 10) / 10,
  };
}

function fallbackActif() {
  return !['0', 'false', 'non', 'no'].includes(String(process.env.MAIL_FALLBACK ?? '1').toLowerCase());
}

function etiquetteEnv() {
  return (process.env.MAIL_ENV || 'dev').trim();
}

function expediteurParDefaut() {
  return {
    email: (process.env.MAIL_FROM || 'sogest@sopress.com').trim(),
    nom: (process.env.MAIL_FROM_NAME || 'SOGEST').trim(),
  };
}

/* ------------------------------------------------------------ validation */

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function erreurMail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Normalise une liste de destinataires. Accepte une chaîne (« a@b.com »,
 * éventuellement séparée par des virgules), un objet `{email, nom}`, ou un
 * tableau mêlant les deux.
 * @param {string|Object|Array} valeur
 * @param {string} champ nom du champ, pour les messages d'erreur
 * @returns {{email: string, nom?: string}[]}
 */
export function normaliserDestinataires(valeur, champ = 'to') {
  if (valeur === undefined || valeur === null || valeur === '') return [];

  const brut = Array.isArray(valeur) ? valeur : [valeur];
  const out = [];

  for (const item of brut) {
    if (typeof item === 'string') {
      // Une chaîne peut porter plusieurs adresses, comme les champs
      // `emails_dest` de sogest.
      for (const part of item.split(/[,;]/)) {
        const email = part.trim();
        if (!email) continue;
        if (!RE_EMAIL.test(email)) {
          throw erreurMail('destinataire_invalide', `Adresse invalide dans « ${champ} » : ${email}`);
        }
        out.push({ email });
      }
      continue;
    }

    if (item && typeof item === 'object') {
      const email = String(item.email || item.adresse || '').trim();
      if (!RE_EMAIL.test(email)) {
        throw erreurMail('destinataire_invalide', `Adresse invalide dans « ${champ} » : ${email || '(vide)'}`);
      }
      const nom = String(item.nom || item.name || '').trim();
      out.push(nom ? { email, nom } : { email });
      continue;
    }

    throw erreurMail('destinataire_invalide', `Destinataire illisible dans « ${champ} ».`);
  }

  return out;
}

/** `a@b.com` ou `{email, nom}` → `{email, nom}`, avec un défaut. */
function normaliserAdresse(valeur, defaut) {
  if (!valeur) return defaut;
  const [adresse] = normaliserDestinataires(valeur, 'from');
  if (!adresse) return defaut;
  return { email: adresse.email, nom: adresse.nom || defaut?.nom || adresse.email };
}

/* ------------------------------------------------------------- contenu */

function echapper(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function nl2br(str) {
  return String(str).replace(/(\r\n|\n\r|\n|\r)/g, '<br />$1');
}

function sansBalises(str) {
  return String(str).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
}

/**
 * Résout le corps du message en ses deux versions.
 *
 * `html` et `texte` sont pris tels quels. À défaut, `message` est interprété
 * comme sogest : s'il contient des balises c'est du HTML (et la version texte
 * est obtenue en les retirant), sinon c'est du texte (et la version HTML est
 * obtenue en échappant et en gardant les retours à la ligne).
 *
 * @param {{html?: string, texte?: string, message?: string}} data
 * @returns {{html: string|null, texte: string|null}}
 */
export function resoudreContenu({ html = null, texte = null, message = null }) {
  if (html || texte) {
    return {
      html: html || null,
      texte: texte || (html ? sansBalises(html) : null),
    };
  }

  if (!message) {
    throw erreurMail('contenu_manquant', 'Il faut fournir `html`, `texte` ou `message`.');
  }

  const estHtml = message.includes('<') && message.includes('>');
  return estHtml
    ? { html: nl2br(message), texte: sansBalises(message) }
    : { html: nl2br(echapper(message)), texte: message };
}

/* --------------------------------------------------------- pièces jointes */

/**
 * Prépare les pièces jointes, toujours en base64 — y compris celles fournies
 * par URL, téléchargées ici plutôt que déléguées au fournisseur : Mailjet ne
 * sait pas le faire, et le faire nous-mêmes garantit le même résultat et les
 * mêmes limites quel que soit celui qui envoie.
 *
 * Accepte `{contenu, nom, type}` (base64) ou `{url, nom?, type?}`.
 *
 * @param {Array} pieces
 * @returns {Promise<{nom: string, type: string, contenu: string, octets: number}[]>}
 */
export async function preparerPiecesJointes(pieces) {
  if (!pieces) return [];
  const liste = Array.isArray(pieces) ? pieces : [pieces];
  const out = [];
  let total = 0;
  const max = tailleMaxPiecesJointes();

  for (const item of liste) {
    const piece = typeof item === 'string' ? { url: item } : item;
    if (!piece || typeof piece !== 'object') {
      throw erreurMail('piece_jointe_invalide', 'Pièce jointe illisible : attendu un objet ou une URL.');
    }

    let preparee;
    if (piece.contenu || piece.content) {
      const contenu = String(piece.contenu || piece.content);
      const nom = String(piece.nom || piece.name || '').trim();
      if (!nom) {
        throw erreurMail('piece_jointe_invalide', 'Le champ `nom` est obligatoire pour une pièce jointe fournie en base64.');
      }
      if (!/^[A-Za-z0-9+/=\s]+$/.test(contenu)) {
        throw erreurMail('piece_jointe_invalide', `La pièce jointe « ${nom} » n'est pas du base64 valide.`);
      }
      const octets = Buffer.from(contenu, 'base64').length;
      preparee = { nom, type: piece.type || typeMime(nom), contenu: contenu.replace(/\s+/g, ''), octets };
    } else if (piece.url) {
      preparee = await telechargerPieceJointe(String(piece.url), piece.nom || piece.name, piece.type, max - total);
    } else {
      throw erreurMail('piece_jointe_invalide', 'Pièce jointe sans `contenu` ni `url`.');
    }

    total += preparee.octets;
    if (total > max) {
      throw erreurMail('pieces_jointes_trop_lourdes',
        `Les pièces jointes dépassent ${Math.round(max / 1024 / 1024)} Mo.`);
    }
    out.push(preparee);
  }

  return out;
}

async function telechargerPieceJointe(url, nom, type, octetsRestants) {
  if (!/^https?:\/\//i.test(url)) {
    throw erreurMail('piece_jointe_invalide', `URL de pièce jointe invalide : ${url}`);
  }

  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_TELECHARGEMENT_MS) });
  } catch (err) {
    throw erreurMail('piece_jointe_injoignable', `Téléchargement impossible (${url}) : ${err.message}`);
  }
  if (!res.ok) {
    throw erreurMail('piece_jointe_injoignable', `Téléchargement impossible (${url}) : HTTP ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > Math.max(octetsRestants, 0)) {
    throw erreurMail('pieces_jointes_trop_lourdes',
      `La pièce jointe ${url} dépasse la taille autorisée pour cet envoi.`);
  }

  const nomFinal = (nom || decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'piece-jointe').trim();
  return {
    nom: nomFinal,
    type: type || res.headers.get('content-type')?.split(';')[0] || typeMime(nomFinal),
    contenu: buffer.toString('base64'),
    octets: buffer.length,
  };
}

const TYPES_MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', csv: 'text/csv',
  txt: 'text/plain', html: 'text/html', htm: 'text/html', json: 'application/json',
  zip: 'application/zip', xml: 'application/xml', ics: 'text/calendar',
  doc: 'application/msword', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function typeMime(nom) {
  const ext = String(nom).split('.').pop().toLowerCase();
  return TYPES_MIME[ext] || 'application/octet-stream';
}

/* ----------------------------------------------------------- redirection */

/**
 * Garde-fou des environnements de test : quand `MAIL_REDIRECT_TO` est posée,
 * tout part vers cette seule adresse, le sujet est préfixé et un bandeau
 * rappelle les destinataires réels — même principe que `brevo_env()` dans
 * sogest, pour qu'un outil en développement n'écrive jamais à de vraies
 * personnes.
 *
 * @param {Object} mail
 * @returns {{mail: Object, redirection: Object}}
 */
export function appliquerRedirection(mail) {
  const vers = mailRedirection();
  if (!vers) return { mail, redirection: { actif: false } };

  const reels = {
    to: mail.to.map((d) => d.email),
    cc: mail.cc.map((d) => d.email),
    bcc: mail.bcc.map((d) => d.email),
  };

  const etiquette = etiquetteEnv();
  const listeReels = [...reels.to, ...reels.cc, ...reels.bcc].join(', ') || '(aucun)';
  const bandeau =
    `<div style="background:#c00;color:#fff;padding:1rem;font-family:sans-serif">` +
    `${echapper(etiquette)} — ce message aurait été envoyé à : ${echapper(listeReels)}</div>`;

  return {
    mail: {
      ...mail,
      to: [{ email: vers }],
      cc: [],
      bcc: [],
      sujet: `[${etiquette}] ${mail.sujet}`,
      html: mail.html ? bandeau + mail.html : bandeau,
      texte: mail.texte ? `[${etiquette}] destinataires réels : ${listeReels}\n\n${mail.texte}` : null,
    },
    redirection: { actif: true, vers, etiquette, destinataires_reels: reels },
  };
}

/* ---------------------------------------------------------------- envoi */

/**
 * Prépare un envoi : valide et normalise tout, sans rien envoyer. C'est ce que
 * renvoie `simuler`, et ce que les fournisseurs reçoivent ensuite.
 *
 * @param {Object} data corps de la demande d'envoi
 * @returns {Promise<{mail: Object, redirection: Object}>}
 * @throws {Error} `err.code` porte un code stable (`destinataire_manquant`…)
 */
export async function preparerMail(data = {}) {
  const to = normaliserDestinataires(data.to, 'to');
  const cc = normaliserDestinataires(data.cc, 'cc');
  const bccDemande = normaliserDestinataires(data.bcc, 'bcc');

  if (!to.length) {
    throw erreurMail('destinataire_manquant', 'Il faut au moins un destinataire dans `to`.');
  }

  const sujet = String(data.sujet ?? data.subject ?? '').trim();
  if (!sujet) {
    throw erreurMail('sujet_manquant', 'Le champ `sujet` est obligatoire.');
  }

  const { html, texte } = resoudreContenu({
    html: data.html,
    texte: data.texte ?? data.text,
    message: data.message,
  });

  const from = normaliserAdresse(data.from, expediteurParDefaut());
  if (data.from_nom || data.from_name) from.nom = String(data.from_nom || data.from_name).trim();

  const replyTo = normaliserAdresse(data.reply_to ?? data.replyTo, from);
  if (data.reply_to_nom) replyTo.nom = String(data.reply_to_nom).trim();

  // Copie cachée d'archivage, ajoutée à celles demandées (cf. le bcc que sogest
  // pose en production).
  const bccArchive = normaliserDestinataires(process.env.MAIL_BCC || '', 'MAIL_BCC');
  const bcc = [...bccDemande, ...bccArchive];

  const pieces_jointes = await preparerPiecesJointes(data.pieces_jointes ?? data.attachments);

  return appliquerRedirection({
    from, reply_to: replyTo, to, cc, bcc, sujet, html, texte,
    pieces_jointes,
    entetes: data.entetes ?? data.headers ?? null,
  });
}

/**
 * Envoie un e-mail transactionnel.
 *
 * Le fournisseur configuré est essayé en premier ; s'il refuse, l'autre prend
 * le relais (sauf `MAIL_FALLBACK=0`, ou `provider` imposé par l'appelant). La
 * réponse raconte chaque tentative : c'est elle qui permet de savoir *comment*
 * l'envoi s'est déroulé, et pas seulement s'il a réussi.
 *
 * @param {Object} data corps de la demande d'envoi
 * @param {{simuler?: boolean}} [options] `simuler` valide tout sans rien envoyer
 * @returns {Promise<Object>} compte rendu d'envoi
 */
export async function envoyerMail(data = {}, { simuler = false } = {}) {
  const debut = Date.now();
  const { mail, redirection } = await preparerMail(data);

  const resume = {
    from: mail.from,
    reply_to: mail.reply_to,
    to: mail.to.map((d) => d.email),
    cc: mail.cc.map((d) => d.email),
    bcc: mail.bcc.map((d) => d.email),
    sujet: mail.sujet,
    pieces_jointes: mail.pieces_jointes.map((p) => ({ nom: p.nom, type: p.type, octets: p.octets })),
    format: mail.html ? (mail.texte ? 'html+texte' : 'html') : 'texte',
  };

  if (simuler) {
    return {
      ok: true, simule: true, provider: null, tentatives: [],
      redirection, mail: resume, duree_ms: Date.now() - debut,
    };
  }

  const impose = (data.provider || '').trim().toLowerCase();
  if (impose && !['brevo', 'mailjet'].includes(impose)) {
    throw erreurMail('provider_inconnu', `Fournisseur inconnu : ${impose}`);
  }

  const principal = impose || mailProvider();
  const ordre = impose || !fallbackActif()
    ? [principal]
    : [principal, principal === 'brevo' ? 'mailjet' : 'brevo'];

  const tentatives = [];
  for (const provider of ordre) {
    const t0 = Date.now();
    let resultat;
    try {
      resultat = provider === 'mailjet' ? await envoyerMailjet(mail) : await envoyerBrevo(mail);
    } catch (err) {
      resultat = { ok: false, erreur: 'exception', detail: err.message };
    }
    const tentative = { provider, ...resultat, duree_ms: Date.now() - t0 };
    tentatives.push(tentative);

    if (tentative.ok) {
      return {
        ok: true, simule: false, provider,
        message_id: tentative.message_id ?? null,
        tentatives, redirection, mail: resume,
        duree_ms: Date.now() - debut,
      };
    }
    console.error(`[mail] ${provider} : ${tentative.erreur} ${tentative.detail || ''}`);
  }

  return {
    ok: false, simule: false, provider: null,
    erreur: tentatives[tentatives.length - 1]?.erreur || 'envoi_impossible',
    tentatives, redirection, mail: resume,
    duree_ms: Date.now() - debut,
  };
}

/* ---------------------------------------------------------------- Brevo */

async function envoyerBrevo(mail) {
  const cle = process.env.BREVO_API_KEY;
  if (!cle) return { ok: false, erreur: 'non_configure', detail: 'BREVO_API_KEY absente' };

  const corps = {
    sender: { email: mail.from.email, name: mail.from.nom || mail.from.email },
    to: mail.to.map(adresseBrevo),
    subject: mail.sujet,
    replyTo: { email: mail.reply_to.email, name: mail.reply_to.nom || mail.reply_to.email },
    // Courrier de service : le suivi d'ouverture et de clic n'a pas lieu d'être.
    headers: { 'X-Mailin-track': '0', 'X-Mailin-track-click': '0', 'X-Mailin-track-open': '0', ...(mail.entetes || {}) },
  };
  if (mail.html) corps.htmlContent = mail.html;
  if (mail.texte) corps.textContent = mail.texte;
  if (mail.cc.length) corps.cc = mail.cc.map(adresseBrevo);
  if (mail.bcc.length) corps.bcc = mail.bcc.map(adresseBrevo);
  if (mail.pieces_jointes.length) {
    corps.attachment = mail.pieces_jointes.map((p) => ({ name: p.nom, content: p.contenu }));
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': cle, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const texte = await res.text();
  if (!res.ok) {
    return { ok: false, erreur: 'refus_fournisseur', statut: res.status, detail: texte.slice(0, 300) };
  }

  let message_id = null;
  try { message_id = JSON.parse(texte)?.messageId ?? null; } catch { /* réponse sans corps JSON */ }
  return { ok: true, statut: res.status, message_id };
}

const adresseBrevo = (d) => (d.nom ? { email: d.email, name: d.nom } : { email: d.email });

/* -------------------------------------------------------------- Mailjet */

async function envoyerMailjet(mail) {
  const { MAILJET_KEY: cle, MAILJET_SECRET: secret } = process.env;
  if (!cle || !secret) return { ok: false, erreur: 'non_configure', detail: 'MAILJET_KEY / MAILJET_SECRET absentes' };

  const message = {
    From: { Email: mail.from.email, Name: mail.from.nom || mail.from.email },
    To: mail.to.map(adresseMailjet),
    Subject: mail.sujet,
    ReplyTo: { Email: mail.reply_to.email, Name: mail.reply_to.nom || mail.reply_to.email },
  };
  if (mail.html) message.HTMLPart = mail.html;
  if (mail.texte) message.TextPart = mail.texte;
  if (mail.cc.length) message.Cc = mail.cc.map(adresseMailjet);
  if (mail.bcc.length) message.Bcc = mail.bcc.map(adresseMailjet);
  if (mail.entetes) message.Headers = mail.entetes;
  if (mail.pieces_jointes.length) {
    message.Attachments = mail.pieces_jointes.map((p) => ({
      ContentType: p.type, Filename: p.nom, Base64Content: p.contenu,
    }));
  }

  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${cle}:${secret}`).toString('base64'),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ Messages: [message] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const texte = await res.text();
  if (!res.ok) {
    return { ok: false, erreur: 'refus_fournisseur', statut: res.status, detail: texte.slice(0, 300) };
  }

  // Mailjet répond 200 même quand le message est rejeté : c'est le `Status` de
  // chaque message qui fait foi, pas le code HTTP.
  let reponse = null;
  try { reponse = JSON.parse(texte); } catch { /* corps illisible */ }
  const premier = reponse?.Messages?.[0];
  if (premier?.Status !== 'success') {
    return { ok: false, erreur: 'refus_fournisseur', statut: res.status, detail: texte.slice(0, 300) };
  }

  return { ok: true, statut: res.status, message_id: premier?.To?.[0]?.MessageUUID ?? null };
}

const adresseMailjet = (d) => (d.nom ? { Email: d.email, Name: d.nom } : { Email: d.email });
