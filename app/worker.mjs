import { Liga } from './engine.mjs';

self.onmessage = ({ data: { clubs, training, context, model, seed, runs } }) => {
  const rate = Liga.fit(clubs, training, model);
  const result = Liga.summarize(rate, seed, runs, done => {
    self.postMessage({ kind: 'progress', done });
  }, context);
  self.postMessage({ kind: 'result', result });
};
