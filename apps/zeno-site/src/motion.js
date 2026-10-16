import { motionAssets } from './motion-config.js';

const stage = document.getElementById('mascotStage');
const film = document.getElementById('mascotFilm');
const greet = document.getElementById('greetMascot');
const pause = document.getElementById('pauseMotion');
const brandDetails = document.getElementById('brandFilmDetails');
const brandFilm = document.getElementById('logoFilm');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const dark = matchMedia('(prefers-color-scheme: dark)');
const connection = navigator.connection;
const clips = [motionAssets.welcome, motionAssets.nod].filter(Boolean);
let nextClip = 0;
let observed = false;
let inView = false;
let intent = 0;
let pausedByUser = false;

function stop({ user = false } = {}) {
  intent += 1;
  film.pause();
  if (user) pausedByUser = true;
  if (!user) stage.classList.remove('is-playing');
  // Preserve the focused pause button until focus moves away.
  if (!user && document.activeElement !== pause) pause.hidden = true;
  pause.textContent = user ? '继续动画' : '播放动画';
}
async function play({ automatic = false, resume = false } = {}) {
  if (!clips.length || document.hidden || !inView) return;
  if (automatic && (reduced.matches || connection?.saveData || pausedByUser)) return;
  const request = ++intent;
  const themedClips = dark.matches ? [motionAssets.welcomeDark, motionAssets.nodDark].filter(Boolean) : clips;
  if (!themedClips.length) return;
  if (!resume) {
    film.src = themedClips[nextClip % themedClips.length];
    nextClip += 1;
    film.currentTime = 0;
  }
  try {
    await film.play();
    if (request !== intent) return;
    stage.classList.add('is-playing');
    pause.hidden = false;
    pause.textContent = '暂停动画';
    pausedByUser = false;
  } catch {
    if (request === intent) stop();
  }
}
greet.hidden = !clips.length;
brandDetails.hidden = !motionAssets.logo;
greet.addEventListener('click', () => { void play(); });
pause.addEventListener('click', () => {
  if (film.paused && stage.classList.contains('is-playing') && !film.ended) void play({ resume: true });
  else if (film.paused || !stage.classList.contains('is-playing')) void play();
  else stop({ user: true });
});
pause.addEventListener('blur', () => { if (film.paused && !stage.classList.contains('is-playing')) pause.hidden = true; });
film.addEventListener('ended', () => stop());
film.addEventListener('error', () => stop());
reduced.addEventListener('change', () => { if (reduced.matches) { stop(); brandFilm.pause(); } });
dark.addEventListener('change', () => stop());
document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); brandFilm.pause(); } });
const observer = new IntersectionObserver(entries => {
  inView = entries[0].isIntersecting;
  if (!inView) stop();
  else if (!observed) { observed = true; void play({ automatic: true }); }
}, { threshold: .25 });
observer.observe(stage);
brandDetails.addEventListener('toggle', () => {
  if (!brandDetails.open) { brandFilm.pause(); return; }
  if (!brandFilm.src && motionAssets.logo) brandFilm.src = motionAssets.logo;
});
window.addEventListener('pagehide', () => { stop(); brandFilm.pause(); observer.disconnect(); });
