import dayjs from 'dayjs';

export function toDate(date) {
  return dayjs(date).format('YYYY-MM-DD')
}
export function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function slugify(prenom, nom) {
  const full = `${prenom} ${nom}`;
  const withoutAccents = removeAccents(full);
  return withoutAccents
    .replace(/[^a-zA-Z0-9]+/g, '-') // remplacer tout sauf lettres/chiffres par "-"
    .replace(/-+/g, '-')            // remplacer plusieurs "-" par un seul
    .replace(/^-|-$/g, '')         // retirer "-" au début ou à la fin
    .toLowerCase()
}