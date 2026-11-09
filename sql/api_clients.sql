-- Clients de l'API (applications qui appellent sogest-api avec un jeton
-- applicatif), gérés depuis la page /admin/ (routes /api-clients).
--
-- S'ajoutent au comportement historique sans le remplacer : les jetons de
-- `config/config.json → tokens` et les origines de `ALLOWED_DOMAINS` restent
-- acceptés tels quels.

CREATE TABLE IF NOT EXISTS `api_clients` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nom` varchar(100) NOT NULL COMMENT 'identifiant lisible, équivalent du nom de jeton dans config.json',
  `description` text,
  `actif` tinyint(1) NOT NULL DEFAULT '1' COMMENT 'inactif : ses jetons et ses domaines sont ignorés',
  `scopes` text COMMENT 'JSON {routes:[…], equipes:[…]}, même sens que tokenScopes dans config.json ; NULL = non restreint',
  `cree_le` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cree_par` int DEFAULT NULL,
  `modifie_le` datetime DEFAULT NULL,
  `trash` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `nom` (`nom`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Jetons d'un client. Seul le haché SHA-256 est stocké : le jeton en clair
-- n'est montré qu'une fois, à sa création.
CREATE TABLE IF NOT EXISTS `api_clients_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_id` int NOT NULL,
  `libelle` varchar(100) NOT NULL DEFAULT '',
  `token_hash` char(64) NOT NULL,
  `prefixe` varchar(16) NOT NULL COMMENT 'début du jeton, pour le reconnaître',
  `cree_le` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cree_par` int DEFAULT NULL,
  `expire_le` datetime DEFAULT NULL,
  `dernier_usage` datetime DEFAULT NULL,
  `revoque_le` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `client_id` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Origines CORS autorisées pour un client, même syntaxe qu'une entrée de
-- ALLOWED_DOMAINS : `host`, `host:port` ou `*.domaine`.
CREATE TABLE IF NOT EXISTS `api_clients_domaines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_id` int NOT NULL,
  `domaine` varchar(255) NOT NULL,
  `cree_le` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `client_domaine` (`client_id`,`domaine`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
