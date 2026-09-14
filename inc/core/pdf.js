/**
 * Conversion d'un PDF en images, via le service maison
 * https://tools.sopress.dev/pdf-to-image/ — port de `pdf_pages()` (sogest,
 * include/auto/pdf.inc.php).
 *
 * Le service va chercher lui-même le PDF à l'URL fournie et met ses rendus en
 * cache : deux appels sur le même PDF renvoient la même URL d'image.
 */

const PDF_TO_IMAGE_URL = process.env.PDF_TO_IMAGE_URL || 'https://tools.sopress.dev/pdf-to-image/v2/';

/**
 * URL des pages d'un PDF rendues en image.
 *
 * @param {string} url URL publique du PDF
 * @param {{largeur?: number, timeout?: number}} [options]
 * @returns {Promise<string[]>} URLs des images, `[]` en cas d'échec
 */
export async function pdfEnImages(url, { largeur = 1000, timeout = 30000 } = {}) {
  if (!url) return [];

  const query = new URLSearchParams({ v: '1', all: 'true', pdf: url, w: String(largeur) });

  try {
    const res = await fetch(`${PDF_TO_IMAGE_URL}?${query}`, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return [];
    const { pages } = await res.json();
    return Array.isArray(pages) ? pages : [];
  } catch (err) {
    console.error(`pdfEnImages: ${err}`);
    return [];
  }
}
