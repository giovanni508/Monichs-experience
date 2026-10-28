// Il montaggio (ffmpeg): sottofotogrammi a 60 fps fusi a due a due in 30 fps con un filo di mosso,
// ridotti da 2880×1620 a 1080p (sovracampionamento), dissolvenze centrate sui cambi d'armonia della
// musica, il passaggio al nero dentro il tubo della corona, i titoli, il cartello finale sui tre
// orologi dell'epilogo sfocati e scuriti (restano tre bagliori: blu, rosso, verde).
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const BEAT = 60 / 64;
const TOTAL = 15;

// piano, punto d'attacco nel girato (s); tagli sui battiti 3, 5, 7, 9, 11, 13
const SHOTS = [
  { id: 'A', in: 0.1 },
  { id: 'B', in: 0.47 },
  { id: 'C', in: 0.26, tr: 'fadeblack' }, // dal buio del tubo della corona agli ingranaggi
  { id: 'D', in: 0.45 },
  { id: 'E', in: 0.28 },
  { id: 'F', in: 0.2 },
  { id: 'G', in: 0.15, endcard: true },
];
const CUTS = [3, 5, 7, 9, 11, 13].map((b) => b * BEAT);
const DISSOLVE = [0.4, 0.4, 0.4, 0.36, 0.36, 0.7];

export function edit({ work, lang, out }) {
  const offsets = CUTS.map((c, i) => c - DISSOLVE[i] / 2);
  const len = SHOTS.map((_, i) => {
    if (i === 0) return offsets[0] + DISSOLVE[0];
    if (i === SHOTS.length - 1) return TOTAL - offsets[i - 1];
    return offsets[i] - offsets[i - 1] + DISSOLVE[i];
  });
  const args = ['-y', '-v', 'error'];
  const f = [];
  SHOTS.forEach((s, i) => {
    args.push('-framerate', '60', '-i', path.join(work, 'piani', s.id, '%04d.jpg'));
    let chain =
      `[${i}:v]tmix=frames=2:weights='1 1',select='not(mod(n\\,2))',setpts=N/(30*TB),scale=1920:1080:flags=lanczos,` +
      `trim=start=${s.in.toFixed(4)}:duration=${len[i].toFixed(4)},setpts=PTS-STARTPTS,fps=30,format=yuv444p`;
    if (s.endcard) chain += ',gblur=sigma=26,eq=saturation=1.25,colorlevels=romax=0.36:gomax=0.36:bomax=0.44';
    f.push(`${chain}[v${i}]`);
  });
  let prev = 'v0';
  for (let i = 1; i < SHOTS.length; i++) {
    f.push(`[${prev}][v${i}]xfade=transition=${SHOTS[i].tr || 'fade'}:duration=${DISSOLVE[i - 1]}:offset=${offsets[i - 1].toFixed(4)}[x${i}]`);
    prev = `x${i}`;
  }
  // una correzione leggera su tutto il film, e l'immagine che sale dal nero
  f.push(`[${prev}]eq=contrast=1.03:saturation=1.03,fade=t=in:st=0:d=0.55,trim=duration=${TOTAL}[base]`);

  // titoli: [png, entrata, uscita (null = resta fino alla fine)]
  const T = (n) => path.join(work, 'titoli', n);
  const titles = [
    [T(`line_${lang}.png`), 0.75, 3.9],
    [T('celeste.png'), CUTS[2] + 0.18, CUTS[3] - 0.45],
    [T('sunset.png'), CUTS[3] + 0.18, CUTS[4] - 0.45],
    [T('virentia.png'), CUTS[4] + 0.18, CUTS[5] - 0.5],
    [T('card1.png'), CUTS[5] + 0.05, null],
    [T(`card2_${lang}.png`), CUTS[5] + 0.5, null],
    [T(`card3_${lang}.png`), CUTS[5] + 1.0, null],
  ];
  let cur = 'base';
  titles.forEach(([png, tin, tout], k) => {
    args.push('-loop', '1', '-framerate', '30', '-t', String(TOTAL), '-i', png);
    let c = `[${SHOTS.length + k}:v]format=rgba,fade=t=in:st=${tin.toFixed(3)}:d=0.55:alpha=1`;
    if (tout != null) c += `,fade=t=out:st=${tout.toFixed(3)}:d=0.4:alpha=1`;
    f.push(`${c}[t${k}]`);
    f.push(`[${cur}][t${k}]overlay=format=auto:eof_action=pass[o${k}]`);
    cur = `o${k}`;
  });
  f.push(`[${cur}]format=yuv420p,setsar=1[vout]`);
  args.push('-i', path.join(work, 'audio', 'mix.wav'));
  args.push('-filter_complex', f.join(';'), '-map', '[vout]', '-map', `${SHOTS.length + titles.length}:a`);
  args.push('-t', String(TOTAL), '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-level', '4.2',
    '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart', out);
  let r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg: montaggio ${lang} non riuscito`);
  // l'ultimo fotogramma, il cartello: anteprima per la pagina della campagna
  r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', '14.9', '-i', out, '-frames:v', '1', '-q:v', '2', out.replace(/\.mp4$/, '-poster.jpg')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg: anteprima non riuscita');
}
