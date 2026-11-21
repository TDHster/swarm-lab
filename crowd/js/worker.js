// Web Worker for plan evolution: evaluates one door layout (several evacuations) off the main thread.
importScripts('rng.js', 'plan.js', 'model.js');

const MAX_TIME = 200;   // s: a plan that cannot empty the room by then is stopped (stuck people are penalized)

onmessage = ({ data }) => {
  const { id, genome, seeds, v0, opts } = data;
  let time = 0, inj = 0, stuck = 0;
  for (const s of seeds) {
    const c = new Crowd(makeDoorRoom(genome, opts), { v0, herding: 0 }, makeRng(s));
    while (c.n > 0 && c.t < MAX_TIME) c.step();
    time += c.t; inj += c.injuredTotal(); stuck += c.n;
  }
  postMessage({ id, time: time / seeds.length, inj: inj / seeds.length, stuck: stuck / seeds.length });
};
