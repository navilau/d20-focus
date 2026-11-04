// Hidden page that plays the chime. MV3 service workers can't play audio,
// so background.js opens this "offscreen document" and messages it.
// The chime is synthesised with Web Audio, so there's no sound file.

const NOTES = {
  // Focus over: two notes falling (time to rest).
  focus: [[784, 0], [587, 0.22]],
  // Break over: three notes rising (back to it).
  break: [[523, 0], [659, 0.16], [784, 0.32]],
};

let ctx;

function chime(kind, volume) {
  ctx ??= new AudioContext();
  const t0 = ctx.currentTime + 0.02;
  for (const [freq, at] of NOTES[kind] ?? NOTES.focus) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0 + at);
    gain.gain.linearRampToValueAtTime(0.35 * volume, t0 + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 1);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target === "offscreen" && msg.type === "chime") chime(msg.kind, msg.volume ?? 0.6);
});
