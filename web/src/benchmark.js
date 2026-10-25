/**
 * Lightweight, opt-in, real-browser FPS benchmark.
 *
 * Open http://localhost:5173/?benchmark=1 and leave the tab in the foreground.
 * Vite's dev-only endpoint receives the JSON report and writes it locally.
 * No telemetry is sent to the Internet.
 */

const PHASES = [
  { id: 'idle', label: 'Idle (static camera)', motion: 'idle', orbit: false, durationMs: 4500 },
  { id: 'walk', label: 'Walk (static camera)', motion: 'walk', orbit: false, durationMs: 4500 },
  { id: 'orbit', label: 'Walk + camera orbit', motion: 'walk', orbit: true, durationMs: 4500 },
];
const WARMUP_MS = 750;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(2));
}

function describe(samples, triangles, drawCalls) {
  const values = samples.filter(n => n > 0 && Number.isFinite(n)).sort((a, b) => a - b);
  const elapsedMs = values.reduce((sum, n) => sum + n, 0);
  const frames = values.length;
  return {
    fps: Number((frames * 1000 / Math.max(1, elapsedMs)).toFixed(1)),
    frames,
    frameMs: {
      median: percentile(values, 50),
      p95: percentile(values, 95),
      p99: percentile(values, 99),
      max: values.length ? Number(values.at(-1).toFixed(2)) : null,
    },
    over33msPct: Number((100 * values.filter(x => x > 33.3).length / Math.max(1, frames)).toFixed(1)),
    renderTriangles: triangles,
    drawCalls,
  };
}

export function getWebGLContextInfo(renderer) {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const safeGet = (key) => {
    try { return gl.getParameter(key); } catch { return null; }
  };
  return {
    renderer: ext ? safeGet(ext.UNMASKED_RENDERER_WEBGL) : safeGet(gl.RENDERER),
    vendor: ext ? safeGet(ext.UNMASKED_VENDOR_WEBGL) : safeGet(gl.VENDOR),
    version: safeGet(gl.VERSION),
    webgl2: gl instanceof WebGL2RenderingContext,
  };
}

export function makeBenchmark({ renderer, onStatus, onFinished }) {
  let phaseIndex = -1;
  let phaseStart = 0;
  let lastFrame = 0;
  let samples = [];
  let results = [];
  let triangles = 0;
  let drawCalls = 0;
  let model = null;
  let done = false;
  let tabHidden = false;

  const onVisibility = () => {
    if (document.hidden) tabHidden = true;
  };
  document.addEventListener('visibilitychange', onVisibility);

  function begin(now, selectedModel) {
    if (phaseIndex >= 0) return;
    model = selectedModel;
    phaseIndex = 0;
    phaseStart = now;
    lastFrame = now;
    onStatus('Benchmark 1/3: Idle');
  }

  function finishPhase(now) {
    const phase = PHASES[phaseIndex];
    const result = { id: phase.id, label: phase.label, ...describe(samples, triangles, drawCalls) };
    results.push(result);

    phaseIndex += 1;
    phaseStart = now;
    lastFrame = now;
    samples = [];
    triangles = 0;
    drawCalls = 0;

    if (phaseIndex === PHASES.length) {
      done = true;
      onStatus('Benchmark completed — check Vite terminal');
      document.removeEventListener('visibilitychange', onVisibility);
      const report = {
        schemaVersion: 1,
        measuredAt: new Date().toISOString(),
        model,
        source: 'real browser / requestAnimationFrame (not headless)',
        methodology: {
          note: 'Each phase has 750 ms warmup; uses frame-to-frame requestAnimationFrame deltas. FPS is display-refresh capped. Camera orbit is synthetic. Focus the tab.',
          phaseLengthMs: PHASES[0].durationMs,
          warmupMs: WARMUP_MS,
          tabWasHidden: tabHidden,
        },
        environment: {
          browser: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency || null,
          devicePixelRatio: window.devicePixelRatio,
          canvasPixels: {
            width: renderer.domElement.width,
            height: renderer.domElement.height,
          },
          ...getWebGLContextInfo(renderer),
        },
        results,
      };
      onFinished(report);
    } else {
      onStatus('Benchmark ' + (phaseIndex + 1) + '/3: ' + PHASES[phaseIndex].label);
    }
  }

  return {
    begin,
    get active() { return phaseIndex >= 0 && !done; },
    get finished() { return done; },
    get phase() { return PHASES[phaseIndex] || null; },
    sample(now, renderInfo) {
      if (phaseIndex < 0 || done) return;
      const dt = now - lastFrame;
      lastFrame = now;
      if (now - phaseStart > WARMUP_MS && dt > 0) {
        samples.push(dt);
        triangles = renderInfo.triangles;
        drawCalls = renderInfo.calls;
      }
      if (now - phaseStart >= PHASES[phaseIndex].durationMs) finishPhase(now);
    },
    dispose() { document.removeEventListener('visibilitychange', onVisibility); },
  };
}

export async function saveBenchmark(report) {
  // Dev-only local Vite server. If opened through a static production build,
  // the JSON remains available as a browser download.
  window.__ROBOTISTS_BENCHMARK__ = report;
  const text = JSON.stringify(report, null, 2);
  const resultName = 'robotists-benchmark.json';

  try {
    const response = await fetch('/__robotists/benchmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text,
    });
    if (!response.ok) throw new Error('Server refused report: ' + response.status);
    console.info('Robotists benchmark saved locally:', await response.text());
  } catch (err) {
    console.warn('Local benchmark save unavailable:', err);
    const blobUrl = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = resultName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
  }
  console.table(report.results.map(({ id, fps, frameMs, over33msPct, renderTriangles, drawCalls }) => ({
    phase: id,
    fps,
    p95ms: frameMs.p95,
    p99ms: frameMs.p99,
    slowFramesPct: over33msPct,
    triangles: renderTriangles,
    draws: drawCalls,
  })));
}
