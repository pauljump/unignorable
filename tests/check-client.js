const fs = require('fs');

const path = require('path');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);

if (!scripts.length) throw new Error('index.html contains no inline scripts');
for (const [index, source] of scripts.entries()) {
  try {
    new Function(source);
  } catch (error) {
    throw new Error(`inline script ${index + 1} does not compile: ${error.message}`);
  }
}

for (const id of ['forecast-card', 'forecast-title', 'forecast-window', 'forecast-route', 'forecast-loop', 'forecast-loop-track', 'forecast-verify', 'forecast-check', 'forecast-evidence']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`prediction-first control is missing: ${id}`);
}
if (!/id="forecast-card"[^>]*\shidden/.test(html) || !/id="map-tools"[^>]*\shidden/.test(html)) throw new Error('the map must launch without forecast or data panels in the way');
for (const id of ['forecast-open', 'forecast-close', 'walk-open', 'layers-open', 'layers-close']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`map-first control is missing: ${id}`);
}
if (!html.includes("function openWalkPlanner(){state.enabled.add('homelessness');setTravelMode('walking')")) throw new Error('walking avoidance must remain available from the clear map');
if (!html.includes("state.profile='walking';state.enabled=new Set(['homelessness']);")) throw new Error('saved route settings must preserve the canonical encampment layer on the default map');
if (!html.includes('enabled:new Set()')) throw new Error('the default map should keep supporting layers out of the foreground');
if (!html.includes('width:calc(100vw - 16px);max-width:calc(100vw - 16px)')) throw new Error('the mobile forecast shell must fit inside the viewport');
if (!html.includes('data-clear-field="origin"') || !html.includes('data-clear-field="destination"')) throw new Error('directions need explicit clear controls');
if (!html.includes('function clearRouteField(id)')) throw new Error('clearing a direction must reset its saved route state');
if (!html.includes("document.getElementById('forecast-card').scrollTo({top:0") || html.includes('evidence.scrollIntoView')) throw new Error('the forecast dot must open the URL-backed sheet at its stable top without forcing a nested evidence scroll');
if (!html.includes('touch-action:pan-y') || !html.includes('-webkit-overflow-scrolling:touch')) throw new Error('the mobile forecast sheet must own a momentum-enabled vertical scroll surface');
if (!html.includes("const center=state.forecast.anchor,limit=1200;if(!center)return null")) throw new Error('forecast selection must be anchored to an explicit place, not the moving map center');
if (!html.includes("history[push?'pushState':'replaceState']") || !html.includes("window.addEventListener('popstate'")) throw new Error('forecast selections must have restorable URLs and browser history');
if (!html.includes("feature?.local_time_window||nowcast.local_time_window")) throw new Error('the client must accept the nested forecast time-window contract');
if (!html.includes('nowcast.uncalibrated_score') || !html.includes('nowcast.score_range')) throw new Error('the client must prefer the explicit uncalibrated score contract');
if (!html.includes("'Historical reports most often arrived'")) throw new Error('historical report timing must not be presented as an exact future prediction');
const headlineSource = html.match(/function forecastHeadline\(label,type\)\{[\s\S]*?\n\}/)?.[0];
if (!headlineSource) throw new Error('forecast headline composer is missing');
const forecastHeadline = new Function(`${headlineSource}; return forecastHeadline;`)();
assert.equal(forecastHeadline('Likely live now', 'Encampment'), 'Encampment likely near this location');
assert.equal(forecastHeadline('Likely encampment present', 'Encampment'), 'Encampment likely near this location');
assert.equal(forecastHeadline('Condition likely near this location', 'Encampment'), 'Encampment likely near this location');
assert.equal(forecastHeadline('Condition may be near this location', 'Encampment'), 'Encampment may be near this location');
assert.equal(forecastHeadline('Condition less likely near this location', 'Encampment'), 'Encampment less likely near this location');
assert.equal(forecastHeadline('Persistent recurring site; current status needs a fresh check', 'Encampment'), 'Persistent recurring site · check current status');
assert.match(forecastHeadline('Insufficient current evidence', 'Encampment'), /^Encampment:/);
const latestTimestampSource = html.match(/function latestTimestamp\(\.\.\.values\)\{[\s\S]*?\n\}/)?.[0];
if (!latestTimestampSource) throw new Error('latest signal timestamp selector is missing');
const latestTimestamp = new Function(`${latestTimestampSource}; return latestTimestamp;`)();
assert.equal(latestTimestamp('2026-08-01T12:00:00Z', 'not-a-date', '2026-08-05T09:00:00Z'), '2026-08-05T09:00:00.000Z');
if (!html.includes("fetch('/api/condition-observations'")) throw new Error('forecast verification must submit to the calibration endpoint');
if (!html.includes('data-condition-state="present"') || !html.includes('data-condition-state="absent"') || !html.includes('data-condition-state="uncertain"')) throw new Error('forecast verification choices are incomplete');
if (!html.includes('data-results-back')) throw new Error('route results must provide a path back to the forecast');
if (!html.includes('report:{issues:null,enabled:new Set()')) throw new Error('legacy report markers must default off');
const bootStart = html.indexOf('async function boot(){');
const bootEnd = html.indexOf('\nappReady=boot();', bootStart);
if (bootStart < 0 || bootEnd < 0) throw new Error('client boot function is missing');
const bootSource = html.slice(bootStart, bootEnd);
if (bootSource.includes('loadReportIssues')) throw new Error('legacy report data must not load during normal boot');
if (!html.includes("getElementById('report-link').addEventListener('click',openForecastRecord)")) throw new Error('public records must open through a type-matched forecast action');
if (!html.includes("getElementById('forecast-verify').addEventListener('click',event=>{const mode=")) throw new Error('the primary next action must advance the condition loop');
if (!html.includes("fetch(`/api/condition-loop?feature_id=")) throw new Error('the forecast must load its joined condition lifecycle');
if (!html.includes('Resolve it · prove it held') || !html.includes('Detected</span><span class="loop-step">Checked') || !html.includes('<span class="loop-step">Held</span>')) throw new Error('the forecast must make the five-state durable-resolution lifecycle visible');
if (!html.includes("getElementById('results').addEventListener('click'")) throw new Error('route results must implement the back-to-forecast action');
if (/% estimated presence|% probability/.test(html)) throw new Error('uncalibrated scores must not be presented as probabilities');
if (!html.includes('uncalibrated current score') || !html.includes('heuristic score range')) throw new Error('numeric forecast scores need explicit uncalibrated labels');
if (!html.includes("windowStrength==='weak'?null")) throw new Error('weak historical windows must stay off the primary card');
if (!html.includes("state.enabled.add('homelessness')")) throw new Error('planning around a forecast must select its routing layer');
if (!html.includes('lastSignal=latestTimestamp(')) throw new Error('last signal must compare all available timestamps');
if (!html.includes('Nearest forecast, ${Math.round(anchorDistance)} m away') || !html.includes('approximate ±${radius} m')) throw new Error('forecast location copy must disclose distance and uncertainty');
if (!html.includes('Do not photograph or characterize people')) throw new Error('condition verification needs adjacent human-safety guidance');
if (!html.includes("setAttribute('aria-activedescendant'")) throw new Error('autocomplete must expose its active option');
if (/id="forecast-card"[^>]*aria-live/.test(html)) throw new Error('the entire forecast card must not be a live region');
if (!html.includes('.forecast-actions button{min-height:44px') || !html.includes('.results-back{width:100%;min-height:44px')) throw new Error('new interactive targets must be at least 44px tall');
if (!html.includes('window.UnignorableWebMCPBridge=') || !html.includes('<script src="/webmcp.js?v=location-v3"></script>')) throw new Error('the map must expose and load its versioned WebMCP bridge');
if (!html.includes('feature.id_aliases||[]') || !html.includes("!==String(feature.id))syncForecastUrl(false)")) throw new Error('legacy reported-coordinate URLs must resolve and canonicalize to one location envelope');
if (html.includes("(state.report.issues||[]).forEach(issue=>{if(issue.type==='Encampment'") || html.includes("if(state.report.issues&&(name==='homelessness'||name==='drugs'))continue")) throw new Error('coarse accountability issues must not be mixed into or replace canonical forecast envelopes');
if (!html.includes('No location permission was requested.') || !html.includes('Nothing was posted.')) throw new Error('WebMCP action preparation must state its human-control boundary');
if (!html.includes('appReady=boot();')) throw new Error('WebMCP tools must share the application readiness promise');
if (!html.includes('id="webmcp-mission"') || !html.includes('function webMcpPlanCivicAudit(')) throw new Error('the agent-compiled civic field audit must have a shared visible surface');
if (!html.includes('Machine: reconcile records and prioritize uncertainty. Human: verify only the condition')) throw new Error('the civic field audit must preserve the machine/human truth boundary');
if (!html.includes('seenRecords.has(key)')) throw new Error('the civic field audit must not spend multiple stops on one accountability record');

console.log(`client check passed (${scripts.length} inline scripts)`);
