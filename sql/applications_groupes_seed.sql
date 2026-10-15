-- Rangement initial des applications en groupes thématiques (page « Applications » de tools).
-- À jouer après applications_groupes.sql. Les applications sont retrouvées par leur nom (les ids
-- peuvent différer d'un environnement à l'autre) et le script peut être rejoué sans doublon.
-- Une application peut figurer dans plusieurs groupes (ici : les Synology).

INSERT INTO `applications_groupes` (`nom`, `description`, `ordre`)
SELECT v.nom, v.description, v.ordre FROM (
  SELECT 'Gestion & administration' AS nom, 'Outils internes de gestion : paie, piges, espace salarié.' AS description, 1 AS ordre
  UNION ALL SELECT 'Abonnements & boutique', 'Abonnés, ventes en ligne et comptes clients.', 2
  UNION ALL SELECT 'Fabrication & production', 'Du maquettage à l\'édition : magazines, serveurs de maquettes et de vidéos.', 3
  UNION ALL SELECT 'Réseaux sociaux & diffusion', 'Préparer, tester et mesurer la diffusion sur les réseaux sociaux.', 4
  UNION ALL SELECT 'Collaboration & communication', 'Échanges internes et vitrine de SO PRESS.', 5
  UNION ALL SELECT 'Technique & développement', 'Code, dépôts et serveurs.', 6
) AS v
WHERE NOT EXISTS (SELECT 1 FROM `applications_groupes` g WHERE g.`nom` = v.`nom` AND g.`trash` = 0);

INSERT IGNORE INTO `lien_application_groupe` (`application_id`, `groupe_id`)
SELECT a.`id`, g.`id`
FROM (
  SELECT 'SOGEST' AS app, 'Gestion & administration' AS groupe
  UNION ALL SELECT 'Espace salarié', 'Gestion & administration'
  UNION ALL SELECT 'Aboweb', 'Abonnements & boutique'
  UNION ALL SELECT 'Oubli du mot de passe', 'Abonnements & boutique'
  UNION ALL SELECT 'Backoffice Immanens', 'Fabrication & production'
  UNION ALL SELECT 'Synology Maquettes', 'Fabrication & production'
  UNION ALL SELECT 'Synology Vidéos', 'Fabrication & production'
  UNION ALL SELECT 'Partages', 'Réseaux sociaux & diffusion'
  UNION ALL SELECT 'Facebook Open Graph', 'Réseaux sociaux & diffusion'
  UNION ALL SELECT 'Générateur SO PRESS', 'Réseaux sociaux & diffusion'
  UNION ALL SELECT 'Talk SO PRESS', 'Collaboration & communication'
  UNION ALL SELECT 'Portail', 'Collaboration & communication'
  UNION ALL SELECT 'Gitlab', 'Technique & développement'
  UNION ALL SELECT 'Synology Maquettes', 'Technique & développement'
  UNION ALL SELECT 'Synology Vidéos', 'Technique & développement'
) AS m
JOIN `applications` a ON a.`nom` = m.`app`
JOIN `applications_groupes` g ON g.`nom` = m.`groupe` AND g.`trash` = 0;
