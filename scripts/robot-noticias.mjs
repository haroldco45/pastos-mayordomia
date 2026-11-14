// Robot de noticias de El Mayordomo — Vibras Positivas HM
// Cada 30 minutos (GitHub Actions) trae noticias reales del campo colombiano
// y las guarda en data/noticias.json. La app las lee directo de GitHub.
import { writeFile, readFile } from 'node:fs/promises';

const CONSULTAS = [
  ['ganadería Colombia', 'Ganadería'],
  ['ICA vacunación aftosa', 'Vacunación'],
  ['ICA sanidad animal bovinos', 'Sanidad'],
  ['precio del ganado en pie', 'Precios'],
  ['precio de la leche al productor Colombia', 'Leche'],
  ['Fedegán', 'Fedegán'],
  ['ganaderos Bajo Cauca Antioquia', 'Región'],
  ['pastos forrajes ganadería', 'Pastos'],
  ['IDEAM lluvias sector agropecuario', 'Clima']
];

const UA = 'Mozilla/5.0 (compatible; ElMayordomo/1.0; +https://pastos-mayordomia.netlify.app)';
const limpiar = s => (s || '')
  .replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1] : ''; };

async function traer(url, ms = 15000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.text();
}

function parsear(xml, tema, origen) {
  return xml.split(/<item>/i).slice(1).map(b => {
    const it = b.split(/<\/item>/i)[0];
    let link = limpiar(tag(it, 'link'));
    const real = link.match(/[?&]url=([^&]+)/);
    if (real) link = decodeURIComponent(real[1]);
    const img = limpiar(tag(it, 'News:Image')) || (it.match(/<media:content[^>]+url="([^"]+)"/i) || [])[1] || '';
    let titulo = limpiar(tag(it, 'title'));
    let medio = limpiar(tag(it, 'News:Source')) || limpiar(tag(it, 'source'));
    if (!medio && / - [^-]+$/.test(titulo)) medio = titulo.split(' - ').pop();
    if (origen === 'Google News' && medio) titulo = titulo.replace(new RegExp(' - ' + medio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '');
    const resumen = origen === 'Google News' ? '' : limpiar(tag(it, 'description')).slice(0, 260);
    return {
      titulo, resumen, link,
      medio: medio || origen,
      fecha: new Date(limpiar(tag(it, 'pubDate')) || Date.now()).toISOString(),
      imagen: img ? img.replace(/&amp;/g, '&') : '',
      tema
    };
  }).filter(n => n.titulo && n.link);
}

// Foto real de la noticia: lee la og:image de la página del medio
async function fotoDe(url) {
  if (!url || /news\.google\.com/.test(url)) return '';
  try {
    const html = (await traer(url, 8000)).slice(0, 200000);
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    if (!m) return '';
    const u = new URL(m[1].replace(/&amp;/g, '&'), url).href;
    return u.startsWith('https://') ? u : '';
  } catch { return ''; }
}

async function main() {
  const todas = [];
  for (const [q, tema] of CONSULTAS) {
    const e = encodeURIComponent(q);
    try { todas.push(...parsear(await traer(`https://www.bing.com/news/search?q=${e}&format=rss&setlang=es-CO&cc=CO`), tema, 'Bing')); }
    catch (err) { console.log('Bing falló:', q, err.message); }
    try { todas.push(...parsear(await traer(`https://news.google.com/rss/search?q=${e}+when:14d&hl=es-419&gl=CO&ceid=CO:es-419`), tema, 'Google News')); }
    catch (err) { console.log('Google falló:', q, err.message); }
  }

  let previas = [];
  try { previas = JSON.parse(await readFile('data/noticias.json', 'utf8')).noticias || []; } catch {}

  const hace60 = Date.now() - 60 * 864e5;
  const vistos = new Set();
  const unicas = [...todas, ...previas]
    .filter(n => new Date(n.fecha).getTime() > hace60)
    .sort((a, b) => (b.imagen ? 1 : 0) - (a.imagen ? 1 : 0))
    .filter(n => {
      const k = n.titulo.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '').slice(0, 60);
      if (vistos.has(k)) return false; vistos.add(k); return true;
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, 90);

  // Buscar foto real para las más recientes que no tienen
  let buscadas = 0;
  for (const n of unicas) {
    if (n.imagen || n.sinFoto || buscadas >= 25) continue;
    buscadas++;
    n.imagen = await fotoDe(n.link);
    if (!n.imagen) n.sinFoto = true;
  }

  await writeFile('data/noticias.json', JSON.stringify({ actualizado: new Date().toISOString(), total: unicas.length, noticias: unicas }, null, 2));
  console.log('Noticias guardadas:', unicas.length, '· con foto:', unicas.filter(n => n.imagen).length);
}
main();
