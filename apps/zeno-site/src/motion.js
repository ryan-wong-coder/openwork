// The full-screen film is decorative and intentionally has no user controls.
// A poster from its first frame remains only a loading/playback fallback.
const film = document.getElementById('heroFilm');
const hero = document.getElementById('download');
// Native <source media> selects one film before fetching. Only its matching
// first-frame loading poster is selected here; there is no static mode.
const narrow = matchMedia('(max-width: 700px)');
const syncPoster = () => {
  film.poster = `/assets/hero-film-v3/hero-worklife-v3${narrow.matches ? '-mobile' : ''}-poster.webp`;
};
syncPoster();
let visible = true;
function resume() {
  if (!visible || document.hidden) return;
  void film.play().catch(() => { /* Browser policy or media failure keeps its poster. */ });
}
const syncMedia = () => {
  syncPoster();
  // <source media> selects correctly at initial load, but browsers do not
  // automatically reselect it when a window crosses the breakpoint.
  film.load();
  if (visible && !document.hidden) resume();
  else film.pause();
};
narrow.addEventListener('change', syncMedia);
film.muted = true;
film.loop = true;
const observer = new IntersectionObserver(entries => {
  visible = entries[0].isIntersecting;
  if (visible) resume();
  else film.pause();
}, { threshold: .01 });
observer.observe(hero);
document.addEventListener('visibilitychange', () => { if (document.hidden) film.pause(); else resume(); });
window.addEventListener('pageshow', resume);
window.addEventListener('pagehide', event => {
  film.pause();
  if (!event.persisted) { observer.disconnect(); narrow.removeEventListener('change', syncMedia); }
});
resume();
