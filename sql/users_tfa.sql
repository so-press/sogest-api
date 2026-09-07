-- Authentification forte (2FA) des comptes sogest.
--
-- Le matériel secret (secret TOTP, codes de secours, jetons d'appareil) ne vit
-- QUE dans ces tables et ne sort jamais de sogest-api : le SSO ne fait que
-- présenter les écrans et appeler /users/{id}/tfa/*. Rien n'est stocké dans
-- `links`, dont le contenu est republié à plat par l'API et par sogest.

-- État 2FA d'un compte : une ligne par utilisateur enrôlé.
CREATE TABLE IF NOT EXISTS `users_tfa` (
  `user_id` int NOT NULL,
  `methode` enum('app','sms') NOT NULL COMMENT 'facteur choisi à l''enrôlement',
  `secret` varbinary(512) DEFAULT NULL COMMENT 'secret TOTP chiffré AES-256-GCM (méthode app uniquement)',
  `enrole_le` datetime DEFAULT NULL COMMENT 'NULL tant que l''enrôlement n''est pas confirmé par un premier code valide',
  `dernier_pas` bigint DEFAULT NULL COMMENT 'dernier pas TOTP consommé — interdit le rejeu d''un code encore dans sa fenêtre',
  `derniere_verif` datetime DEFAULT NULL,
  `echecs` smallint NOT NULL DEFAULT '0' COMMENT 'échecs consécutifs depuis la dernière réussite',
  `bloque_jusqua` datetime DEFAULT NULL COMMENT 'verrou temporaire après trop d''échecs',
  `telephone` varchar(30) DEFAULT NULL COMMENT 'numéro utilisé pour la 2FA, saisi à l''enrôlement quand le profil n''en porte pas ; recopié dans users.telephone une fois vérifié',
  `sms_code_hash` char(64) DEFAULT NULL COMMENT 'sha256 du code SMS en cours (méthode sms)',
  `sms_expire_le` datetime DEFAULT NULL,
  `sms_envoye_le` datetime DEFAULT NULL COMMENT 'sert à espacer deux envois',
  `creation` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modification` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

-- Codes de secours à usage unique, remis une seule fois à l'enrôlement.
-- Stockés hachés : un accès en lecture à la base ne permet pas de s'en servir.
CREATE TABLE IF NOT EXISTS `users_tfa_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `code_hash` char(64) NOT NULL COMMENT 'sha256 du code normalisé',
  `utilise_le` datetime DEFAULT NULL COMMENT 'NULL tant que le code n''a pas servi',
  `creation` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_code` (`user_id`,`code_hash`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

-- Appareils de confiance : 30 jours sans redemander de code.
-- Le cookie posé par le SSO porte le jeton en clair, la base n'en garde que le
-- hachage — un accès en lecture à la base ne permet donc pas de forger un
-- appareil de confiance (la faille du dispositif précédent, où le cookie ne
-- contenait que l'id utilisateur en clair).
CREATE TABLE IF NOT EXISTS `users_tfa_appareils` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token_hash` char(64) NOT NULL COMMENT 'sha256 du jeton porté par le cookie',
  `libelle` varchar(255) DEFAULT NULL COMMENT 'user-agent abrégé, pour que l''utilisateur reconnaisse l''appareil',
  `ip` varchar(45) DEFAULT NULL,
  `creation` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expire_le` datetime NOT NULL,
  `derniere_utilisation` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `user_id` (`user_id`),
  KEY `expire_le` (`expire_le`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

-- Reprise des exemptions posées sous le dispositif précédent : les comptes
-- portant un link `no_tfa` gardent leur dérogation, désormais exprimée dans le
-- réglage à trois états `tfa` ('oui' / 'non' / absent = suit l'option globale).
-- L'exemption reste sans effet sur un ultra admin, pour qui la 2FA est due
-- quoi qu'il arrive.
INSERT INTO `links` (`table`, `cle`, `champ`, `valeur`, `libelle`)
SELECT 'users', `l`.`cle`, 'tfa', 'non', ''
  FROM `links` `l`
 WHERE `l`.`table` = 'users' AND `l`.`champ` = 'no_tfa' AND `l`.`valeur` NOT IN ('', '0')
ON DUPLICATE KEY UPDATE `valeur` = `links`.`valeur`;
