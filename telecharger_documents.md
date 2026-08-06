# Téléchargement des documents

Comment un client (sogest-public, une app mobile, …) télécharge un document, et
pourquoi ça passe obligatoirement par l'API.

## Le problème

Historiquement, `GET /documents` renvoyait dans `url` l'adresse SOGEST réelle du
fichier :

| Origine | URL renvoyée |
|---|---|
| `document` | `<SOGEST_URL>/document.php?document_id=<id>` |
| `contrat`  | `<SOGEST_URL>/contrat.php?contrat_id=<id>` |
| `pige`     | `<SOGEST_URL>/action.php?w=telecharger_da&pige_id=<id>` |

Le front posait un simple lien dessus :

```html
<a :href="doc.url">Télécharger</a>
```

Ça ne pouvait pas marcher. Ces pages PHP s'authentifient via
`Authorization: Bearer <JWT sogest>` (`sogest/include/auto/auth.inc.php` →
`getJwtFromHeader()`, branché dans `User::checkVersion()`), or **une navigation
navigateur ne porte aucun en-tête `Authorization`** : le JWT vit dans le
`localStorage` et n'est injecté que par l'intercepteur axios. Le clic partait
donc en anonyme et tombait sur le login SOGEST.

Et le faire « proprement » côté navigateur (un `fetch` cross-origin avec le
header) butait sur le CORS : ajouter `Authorization` déclenche un préflight
`OPTIONS`, qui par spec ne porte pas le header — `document.php` répond alors 401
en ligne 12 et meurt **avant** son appel à `cors()` en ligne 30. Le préflight
échoue, le navigateur bloque.

## La solution : l'API relaie le fichier

Le fichier transite par l'API, qui est déjà l'origine authentifiée du front.
Aucune URL SOGEST n'est exposée au client.

```
client ──GET /documents/:origin/:id/fichier──▶  sogest-api  ──▶ SOGEST (PHP)
       Authorization: Bearer <JWT sogest>       (relaie le même JWT)
```

Serveur-à-serveur, il n'y a ni préflight ni CORS : le blocage disparaît, et le
JWT étant retransmis tel quel, SOGEST refait **son propre** contrôle de droits
en plus de celui de l'API. Les deux backends partagent le même `JWT_SECRET` :
le token signé par `routes/login.js` est directement compris par le PHP.

## Ce que renvoie l'API

Toutes les routes `/documents` renvoient désormais une `url` proxifiée :

```json
{
  "document_id": 4321,
  "document_origin": "document",
  "type": "contrat-de-travail",
  "date": "2026-03-14",
  "infos": "Avenant 2026",
  "url": "https://api.sogest…/documents/document/4321/fichier"
}
```

L'URL est absolue, construite depuis `BASE_URL` si la variable est définie,
sinon déduite de la requête en cours (en honorant `X-Forwarded-Proto` derrière
un reverse proxy). Sans ni l'un ni l'autre elle est relative
(`/documents/document/4321/fichier`), ce qui reste exploitable par un client qui
a déjà l'API pour base.

> **Définir `BASE_URL` en production** est recommandé : c'est ce qui garantit un
> `https://` correct quel que soit le montage derrière le proxy.

## La route

```
GET /documents/:origin/:id/fichier      (JWT obligatoire)
```

`origin` ∈ `document` | `contrat` | `pige`.

Enchaînement (`routes/documents.js` + `inc/systeme/documents.js`) :

1. `getDocument({origin, id, personneId: req.user.personne_id})` — ne cherche
   que dans les documents **de cette personne** (les trois sources filtrent sur
   `personne_id`). Un id qui ne lui appartient pas ressort en `404`, pas en
   `403` : on ne révèle pas l'existence de la ressource.
2. `fetchDocumentFile(document, {authorization})` reconstruit l'URL SOGEST
   depuis `DOCUMENT_SOURCES` et va chercher le binaire en retransmettant le
   header `Authorization` de l'appelant.
3. `Content-Type` et `Content-Disposition` de SOGEST sont relayés au client.

Réponses : `200` + binaire · `403` (pas de JWT) · `404` (document inconnu ou pas
à l'utilisateur) · `502` (SOGEST injoignable / réponse inattendue).

### Garde-fous du relais

`fetch` est appelé en `redirect: 'manual'` et une réponse `text/html` est
rejetée en `502`. Les deux visent le même cas : `contrat.php` fait `redir()`
vers son formulaire de login quand il n'accepte pas le token — sans ces
garde-fous, l'API relaierait une page HTML de login avec un `200` et le client
téléchargerait un « PDF » qui n'en est pas un. Timeout de 30 s.

### CORS

`server.js` expose `Content-Disposition` (`exposedHeaders`). Sans ça le
navigateur masque l'en-tête au JS et le front ne peut pas récupérer le nom de
fichier renvoyé par SOGEST.

---

# Appeler l'URL depuis une app cliente

## Les trois règles

Quel que soit le framework (Vue, React, React Native, Swift, …) :

1. **Utiliser le champ `url` renvoyé par `GET /documents`** tel quel. Ne jamais
   reconstruire une URL SOGEST à la main : elles ne sont plus exposées et ne
   sont pas téléchargeables depuis un client.
2. **Poser `Authorization: Bearer <JWT sogest>`** sur la requête. C'est le même
   token que pour le reste de l'API, celui obtenu par `POST /login/sso`.
3. **Traiter la réponse comme du binaire** (`blob` / `arrayBuffer`), pas comme
   du texte ni du JSON.

Autrement dit : c'est un appel HTTP authentifié ordinaire, dont le corps se
trouve être un fichier. Tout ce qui ne permet pas de poser un en-tête est exclu
— voir les pièges en fin de section.

## 1. Récupérer la liste

```js
const { data } = await http.get('/documents')
// data.data = [{ document_id, document_origin, type, date, infos, url }, …]
```

## 2. Télécharger — web (Vue, React, vanilla)

Avec une instance axios partagée qui pose déjà le header via son intercepteur :

```js
async function telecharger(doc) {
  const res = await http.get(doc.url, { responseType: 'blob' })

  const href = URL.createObjectURL(res.data)
  const a = Object.assign(document.createElement('a'), {
    href,
    download: nomFichier(res.headers['content-disposition']),
  })
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(href)   // sinon le blob reste en mémoire jusqu'au reload
}
```

`doc.url` étant absolue, axios ignore son `baseURL` et l'utilise telle quelle :
rien à configurer de plus.

Sans axios, en `fetch` :

```js
const res = await fetch(doc.url, {
  headers: { Authorization: `Bearer ${token}` },
})
if (!res.ok) throw new Error(await res.text())

const blob = await res.blob()
const href = URL.createObjectURL(blob)
// … même suite qu'au-dessus
```

Pour **afficher** le PDF au lieu de le télécharger (visionneuse intégrée),
garder la même requête et passer le blob URL à une `<iframe>` / `<embed>` plutôt
qu'à un `<a download>`.

## 3. Télécharger — React Native

**Expo** — `downloadAsync` accepte des en-têtes, c'est le chemin le plus court :

```js
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'

const cible = FileSystem.documentDirectory + `document-${doc.document_id}.pdf`
const { status, uri } = await FileSystem.downloadAsync(doc.url, cible, {
  headers: { Authorization: `Bearer ${token}` },
})
if (status !== 200) throw new Error(`Téléchargement refusé (${status})`)

await Sharing.shareAsync(uri)   // feuille de partage / visionneuse système
```

**React Native nu** — `react-native-blob-util` :

```js
import ReactNativeBlobUtil from 'react-native-blob-util'

const res = await ReactNativeBlobUtil
  .config({ fileCache: true, appendExt: 'pdf' })
  .fetch('GET', doc.url, { Authorization: `Bearer ${token}` })

if (res.info().status !== 200) throw new Error('Téléchargement refusé')
const chemin = res.path()
```

Le token se lit dans le stockage sécurisé de l'app (`expo-secure-store`,
`react-native-keychain`, …), pas dans un `localStorage`.

## 4. Tester en ligne de commande

```bash
curl -H "Authorization: Bearer $JWT" \
     -o document.pdf \
     "https://api.sogest…/documents/document/4321/fichier"
```

Sans le header, l'API répond `403 {"error":"Unauthorized: No token received"}` :
c'est le comportement attendu, pas un bug. Avec un token statique de
`config/config.json` au lieu d'un JWT, c'est
`403 {"error":"Unauthorized: JWT required"}` — les routes `/documents` sont en
`requireAuth`, elles exigent un vrai utilisateur.

## 5. Nom du fichier

Il vient de l'en-tête `Content-Disposition` relayé depuis SOGEST (l'API l'expose
explicitement au JS via `exposedHeaders`, cf. plus haut) :

```js
function nomFichier(contentDisposition, defaut = 'document.pdf') {
  const m = (contentDisposition || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
  return m ? decodeURIComponent(m[1]) : defaut
}
```

Prévoir toujours le repli : si un jour l'en-tête manque, mieux vaut un nom
générique qu'un fichier sans extension que l'OS ne sait pas ouvrir.

## 6. Gérer les erreurs

En `responseType: 'blob'`, **une erreur revient aussi en blob** : le corps JSON
`{error, message}` n'est pas lisible directement. Il faut le relire en texte :

```js
try {
  const res = await http.get(doc.url, { responseType: 'blob' })
  // …
} catch (e) {
  const blob = e.response?.data
  const texte = blob instanceof Blob ? await blob.text() : ''
  const { error } = texte ? JSON.parse(texte) : {}
  // 403 → JWT absent, invalide ou expiré : relancer le SSO
  // 404 → document inexistant ou n'appartenant pas à l'utilisateur
  // 502 → SOGEST injoignable, réessayer plus tard
}
```

Attention : `authMiddleware` renvoie **`403` et jamais `401`**, y compris pour un
token expiré. Un client qui ne déclenche sa reconnexion que sur `401` ne se
reconnectera donc jamais. Le JWT expirant au bout de `JWT_EXPIRATION` (7 jours
par défaut), un `403` sur un téléchargement n'est pas une anomalie : c'est le
signal de repasser par `/login`.

## 7. Ce qu'il ne faut pas faire

| ❌ | Pourquoi |
|---|---|
| `<a href="doc.url">`, `window.open(doc.url)`, `<iframe src="doc.url">` | Une navigation ne porte aucun en-tête `Authorization` → `403`. C'est précisément le bug que ce proxy corrige. |
| Mettre le JWT en query string (`?token=…`) | Non supporté par l'API, et un token en URL finit dans les logs serveur, l'historique et le `Referer`. |
| Reconstruire une URL `document.php` / `contrat.php` | Le client ne peut pas les authentifier, et elles ne sont plus renvoyées. |
| Garder le blob en cache entre deux sessions | Le contrôle de droits est refait à chaque appel côté API **et** côté SOGEST ; un cache local le court-circuite. |

> ⚠️ **Le `<a :href="doc.url">` de `sogest-public/src/views/userDocuments.vue`
> doit être remplacé par le code de la section 2.** Tel quel, il pointe
> maintenant sur l'API sans en-tête d'authentification et reçoit un `403`.

---

# Reste à corriger côté SOGEST

Trois points relevés en auditant `d:\web\sogest`, indépendants de ce proxy mais
qui le concernent :

1. **`action.php?w=telecharger_da&pige_id=N` n'a aucun contrôle d'accès.**
   Ni `action.php` ni `actions/telecharger_da.php` ne vérifient quoi que ce
   soit : n'importe qui, non authentifié, télécharge la DA de n'importe quelle
   pige en itérant sur l'id. L'API vérifie l'appartenance avant de relayer, donc
   le proxy est sûr — mais l'URL SOGEST reste exposée en direct. À corriger dans
   le PHP (`personneCanAccess`).

2. **`uploads/documents/` est servi en clair.** Aucun `.htaccess` dans
   `uploads/`, aucune règle à la racine — `<SOGEST_URL>/uploads/documents/<personne_id>/<nom>`
   sert le PDF sans contrôle. C'est d'ailleurs par cette URL HTTP que
   `document.php` lit le fichier (lignes 17-18). Tout le contrôle d'accès de
   `document.php` se contourne dès qu'on devine le nom. À fermer
   (`Deny from all`) + lecture par `file_get_contents(CHEMIN_SITE.'uploads/…')`.

3. **`cors()` est appelé trop tard dans `document.php`** (ligne 30, après les
   `httpError`) et pas du tout dans `contrat.php` / `action.php`. Sans
   importance tant que seule l'API les appelle, à déplacer en tête de fichier si
   un jour un navigateur doit les atteindre directement.

# Fichiers concernés

- `routes/documents.js` — la route `/:origin/:id/fichier`
- `inc/systeme/documents.js` — `DOCUMENT_SOURCES`, `apiBaseUrl()`,
  `documentFileUrl()`, `fetchDocumentFile()`, et `url` proxifiée dans
  `getDocumentsForPersonne()`
- `server.js` — `exposedHeaders: ['Content-Disposition']`
