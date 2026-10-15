-- Groupes d'applications (page « Applications » de tools) : une application peut
-- être rangée dans 0, 1 ou plusieurs groupes. Les groupes se gèrent dans sogest
-- (Applications > Groupes), qui écrit directement ces tables ; sogest-api ne fait
-- que les lire (GET /groupes-applications, GET /applications).
-- Le logo d'un groupe est un fichier de sogest : uploads/files/applications_groupes/<id>/logo.*

CREATE TABLE IF NOT EXISTS `applications_groupes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nom` varchar(100) NOT NULL,
  `description` text NOT NULL,
  `ordre` int NOT NULL DEFAULT '0' COMMENT 'ordre d''affichage des onglets, croissant',
  `trash` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

-- Appartenance application <-> groupe (n-n).
CREATE TABLE IF NOT EXISTS `lien_application_groupe` (
  `application_id` int NOT NULL,
  `groupe_id` int NOT NULL,
  PRIMARY KEY (`application_id`,`groupe_id`),
  KEY `groupe_id` (`groupe_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
