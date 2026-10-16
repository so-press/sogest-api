-- Date d'envoi d'une édition PDF sur ses aiguillages : posée par crons/editions.php de
-- SOGEST quand tous les envois ont réussi (etat done). NULL pour les éditions envoyées
-- avant cette colonne : sogest-api retrouve alors la date dans `messages`
-- (« Envoyé vers 15 serveurs sur 15 - 25 Août 13:23 »).

ALTER TABLE `editions`
  ADD COLUMN `envoye_le` datetime DEFAULT NULL;
