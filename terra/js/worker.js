// Runs the rotation engine off the main thread. Keeps the last weather and
// settings in memory so a single custom rotation scores in milliseconds.
import { run, createContext, scoreOne, cropUse } from './engine.js';

let ctx = null;
let baseline = null;

const slim = (r) => ({ netAcft: r.netAcft, scores: { soil: r.scores.soil } });

self.onmessage = (e) => {
  const { id, type, weather, inputs, rotation } = e.data;
  try {
    if (type === 'run') {
      const res = run(weather, inputs);
      ctx = res.ctx;
      baseline = res.baseline;
      self.postMessage({ id, type, ok: true, climate: res.climate, cropYears: res.prep.cropYears, baseline: res.baseline, options: res.options, all: res.all.map(slim), inArea: ctx.inArea, cropUse: cropUse(ctx), calibrated: res.prep.calibrated, pmShare: res.prep.pmShare });
    } else if (type === 'scoreMany') {
      if (!ctx) throw new Error('No field loaded yet');
      self.postMessage({ id, type, ok: true, results: e.data.rotations.map((rot) => scoreOne(ctx, rot, baseline)) });
    } else if (type === 'score') {
      if (!ctx) throw new Error('No field loaded yet');
      self.postMessage({ id, type, ok: true, result: scoreOne(ctx, rotation, baseline) });
    }
  } catch (err) {
    self.postMessage({ id, type, ok: false, error: String((err && err.message) || err) });
  }
};

export { createContext };
