-- Éditions PDF créées par sogest-api (POST /editions/diffusion), à la demande de
-- So Librairie (bouton « Diffuser l'édition PDF »). SOGEST les envoie sur les FTP
-- de leurs aiguillages comme les autres, mais n'en génère jamais les pages : elles
-- vivent dans So Librairie, vers qui « Voir les pages » renvoie.
--   origine     'sogest-api' pour ces éditions, NULL pour celles saisies dans SOGEST
--   pdf_source  URL de téléchargement du PDF (lien présigné, durée limitée) : SOGEST
--               le rapatrie au premier besoin (get_edition_file), puis le garde comme
--               un PDF déposé à la main (uploads/editions/{id}.pdf, puis S3)
--   solib_url   page du magazine dans So Librairie (cible de « Voir les pages »)

ALTER TABLE `editions`
  ADD COLUMN `origine` varchar(20) DEFAULT NULL,
  ADD COLUMN `pdf_source` text DEFAULT NULL,
  ADD COLUMN `solib_url` varchar(255) DEFAULT NULL;
