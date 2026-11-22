// Small WebAudio helpers shared by the three pages. Browsers allow sound only after a click,
// so the audio context is created on the first press of the button.

// Turns `btn` into a sound on/off switch. `setup(audio)` builds the voices once; they go into audio.master.
// Returns a function that tells whether the sound is playing now.
function soundToggle(btn, setup) {
  let audio = null;
  btn.onclick = async () => {
    if (!audio) {
      audio = new AudioContext();
      audio.master = audio.createGain();
      audio.master.gain.value = 0.3;
      audio.master.connect(audio.createDynamicsCompressor()).connect(audio.destination);   // no clipping
      setup(audio);
      await audio.resume();   // some browsers start the context suspended
    } else if (audio.state === 'running') await audio.suspend();
    else await audio.resume();
    btn.textContent = audio.state === 'running' ? '🔇 Тише' : '🔊 Слушать';
  };
  return () => audio !== null && audio.state === 'running';
}

// A steady tone with overtones (amplitudes of harmonics 1, 2, 3, ...). Laptop speakers barely play
// anything below ~150 Hz, so a low hum needs its overtones to be heard at all.
function toneVoice(audio, f, harmonics = [1, 0.7, 0.5, 0.3]) {
  const osc = audio.createOscillator(), g = audio.createGain();
  const imag = new Float32Array([0, ...harmonics]);
  osc.setPeriodicWave(audio.createPeriodicWave(new Float32Array(imag.length), imag));
  osc.frequency.value = f;
  g.gain.value = 0;
  osc.connect(g).connect(audio.master);
  osc.start();
  return {
    osc,
    // Glide to a new loudness (and pitch) instead of jumping: jumps click.
    set(gain, freq) {
      g.gain.setTargetAtTime(gain, audio.currentTime, 0.05);
      if (freq) osc.frequency.setTargetAtTime(freq, audio.currentTime, 0.05);
    },
    stop() { osc.stop(); g.disconnect(); },
  };
}

// Steady filtered noise (air rushing through the fans).
function noiseVoice(audio, centre, q, gain) {
  const buf = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = audio.createBufferSource(), bp = audio.createBiquadFilter(), g = audio.createGain();
  src.buffer = buf;
  src.loop = true;
  bp.type = 'bandpass';
  bp.frequency.value = centre;
  bp.Q.value = q;
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(audio.master);
  src.start();
  return { src, g };
}
