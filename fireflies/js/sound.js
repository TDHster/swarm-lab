// Small WebAudio helpers shared by both pages. Browsers allow sound only after a click,
// so the audio context is created on the first press of the button.

// Turns `btn` into a sound on/off switch. `setup(audio)` runs once; voices go into audio.master.
function soundToggle(btn, setup) {
  let audio = null;
  btn.onclick = async () => {
    if (!audio) {
      audio = new AudioContext();
      audio.master = audio.createGain();
      audio.master.gain.value = 0.5;
      audio.master.connect(audio.createDynamicsCompressor()).connect(audio.destination);   // no clipping
      setup(audio);
      await audio.resume();   // some browsers start the context suspended
    } else if (audio.state === 'running') await audio.suspend();
    else await audio.resume();
    btn.textContent = audio.state === 'running' ? '🔇 Тише' : '🔊 Слушать';
  };
}
const soundOn = audio => audio && audio.state === 'running';

// Short sounds of many agents within one frame. hits: [{ at (s from now), ... }], play(hit, gain).
// Hundreds of agents can sound in one frame; only `maxVoices` of them are played, each a bit louder,
// so that the total loudness still grows with the number of hits (as the power of independent sounds).
function playHits(hits, play, maxVoices = 8) {
  if (!hits.length) return;
  const k = Math.min(hits.length, maxVoices), gain = Math.sqrt(hits.length / k);
  for (let j = 0; j < k; j++) play(hits[Math.floor(j * hits.length / k)], gain);
}

// A short click of a pure tone that fades out fast: one firefly's "chirp".
function chirp(audio, when, freq, pan, gain) {
  const osc = audio.createOscillator(), g = audio.createGain(), p = audio.createStereoPanner();
  osc.frequency.value = freq;
  p.pan.value = pan;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
  osc.connect(g).connect(p).connect(audio.master);
  osc.start(when);
  osc.stop(when + 0.07);
}

// A dull thud of filtered noise: one footstep.
let noiseBuf = null;
function thud(audio, when, pan, gain) {
  if (!noiseBuf) {
    noiseBuf = audio.createBuffer(1, Math.round(audio.sampleRate * 0.1), audio.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / d.length * 6);
  }
  const src = audio.createBufferSource(), lp = audio.createBiquadFilter(), g = audio.createGain(), p = audio.createStereoPanner();
  src.buffer = noiseBuf;
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  p.pan.value = pan;
  g.gain.value = gain;
  src.connect(lp).connect(g).connect(p).connect(audio.master);
  src.start(when);
}
