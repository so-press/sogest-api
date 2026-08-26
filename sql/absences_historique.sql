-- Historique des actions sur les absences (pose / modification / suppression).
-- Table dédiée : elle survit à la suppression de l'absence d'origine.
CREATE TABLE IF NOT EXISTS `absences_historique` (
  `id` int NOT NULL AUTO_INCREMENT,
  `action` enum('create','update','delete') NOT NULL,
  `absence_id` int NOT NULL COMMENT 'id de l''absence concernée (peut ne plus exister)',
  `user_id` int NOT NULL COMMENT 'utilisateur à qui appartient l''absence',
  `auteur_id` int DEFAULT NULL COMMENT 'utilisateur ayant effectué l''action',
  `auteur` varchar(100) DEFAULT NULL COMMENT 'nom complet de l''auteur au moment de l''action',
  `date` date DEFAULT NULL COMMENT 'date de l''absence après action (avant action pour un delete)',
  `type` varchar(50) DEFAULT NULL,
  `valeur` float DEFAULT NULL,
  `avant` longtext COMMENT 'JSON de l''absence avant action (NULL pour un create)',
  `apres` longtext COMMENT 'JSON de l''absence après action (NULL pour un delete)',
  `ip` varchar(45) DEFAULT NULL,
  `dateheure` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `absence_id` (`absence_id`),
  KEY `user_id` (`user_id`),
  KEY `dateheure` (`dateheure`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
