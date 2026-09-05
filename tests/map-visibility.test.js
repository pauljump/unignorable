const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function source(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const lineEnd = html.indexOf('\n', start);
  return html.slice(start, html.slice(start, lineEnd).endsWith('}') ? lineEnd : html.indexOf('\n}', start) + 2);
}
function load(name, env) { return new Function('env', `with(env){${source(name)};return ${name};}`)(env); }
function fixture() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/map-layers.json')));
  const DEFS = Object.fromEntries(Object.keys(data.layers).map(name => [name, {color:'#abc',label:name}]));
  // Exercise the shipped initializer, not a duplicate test-only default.
  const stateSource = html.slice(html.indexOf('const state='), html.indexOf('\nconst PREF_KEY='));
  const state = new Function('DEFS', `${stateSource}; return state;`)(DEFS);state.data=data;
  const nodes=new Map(),markerGroups=[];
  function node(id) { if(!nodes.has(id))nodes.set(id,{hidden:false,style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){}});return nodes.get(id); }
  const env={state,DEFS,FULL_DETAIL_ZOOM:14,canvas:{},selectionRenderer:{},
    map:{getZoom:()=>15,getBounds:()=>({pad(){return this;},contains:()=>true})},
    document:{getElementById:node},popup:()=>'',forecastFor:()=>({probability:.6}),
    L:{layerGroup(){const group={layers:[],addTo(){return this;},remove(){},clearLayers(){this.layers=[];}};markerGroups.push(group);return group;},circleMarker(point,style){return {point,style,handlers:{},on(name,fn){this.handlers[name]=fn;return this;},bindPopup(){return this;},bindTooltip(){return this;},addTo(group){group.layers.push(this);return this;}}}},
  };
  for(const name of ['featureSeverity','featureMarkerStyle','featureCellSize','drawFeatures','closeWalkPlanner','drawForecastAnchor'])env[name]=load(name,env);
  state.forecast.group=env.L.layerGroup();return {env,node,state};
}
test('reported areas remain drawn with no avoidance, after closing walking, and after clearing avoidance',()=>{
  const {env,state,node}=fixture();
  assert.equal(state.enabled.size,0);assert.equal(state.visible.has('alpr'),false);
  env.drawFeatures();const count=state.featureGroup.layers.length;assert.ok(count>0);
  state.enabled.add('homelessness');env.drawFeatures();assert.equal(state.featureGroup.layers.length,count);
  state.enabled.clear();env.closeWalkPlanner();assert.equal(node('route-form').hidden,true);assert.equal(node('results').hidden,true);
  assert.equal(state.featureGroup.layers.length,count);assert.equal(state.enabled.size,0);
  const before=state.featureGroup.layers.length;state.visible.delete('homelessness');env.drawFeatures();assert.ok(state.featureGroup.layers.length<before);assert.equal(state.enabled.size,0);
});
test('tapping a condition dot selects that record and does not bubble into a different nearest record',()=>{
  const {env,state}=fixture();let selection;
  env.selectForecastAnchor=(anchor,options)=>{selection={anchor,options};};
  env.drawFeatures();const marker=state.featureGroup.layers.find(x=>x.handlers.click);assert.ok(marker);
  assert.equal(marker.style.bubblingMouseEvents,false);assert.ok(marker.style.radius>=5);marker.handlers.click();
  const record=Object.values(state.data.layers).flat().find(x=>x.id===selection.options.featureId);assert.ok(record);
  assert.deepEqual(marker.point,[record.lat,record.lng]);assert.equal(selection.anchor.lat,record.lat);
});
test('a map tap draws its actual coordinate even without nearby forecast evidence',()=>{
  const {env,state}=fixture();state.forecast.anchor={lat:40.75,lng:-73.98};env.drawForecastAnchor();
  assert.deepEqual(state.forecast.group.layers[0].point,[40.75,-73.98]);assert.equal(state.forecast.group.layers[0].style.renderer,env.selectionRenderer);
});
test('selected area and tap are fitted above the mobile detail sheet',()=>{
  const {env,state,node}=fixture();let fit;
  state.forecast.feature={lat:40.74,lng:-73.98};state.forecast.anchor={lat:40.741,lng:-73.982};
  node('map').getBoundingClientRect=()=>({left:0,top:0,width:390,height:844});
  node('forecast-card').getBoundingClientRect=()=>({left:8,right:382,top:400});
  env.compactMap=()=>true;env.map.latLngToContainerPoint=()=>({x:195,y:600});
  env.L.latLngBounds=points=>points;env.map.fitBounds=(points,options)=>{fit={points,options};};
  load('revealForecastSelection',env)();
  assert.deepEqual(fit.points,[[40.74,-73.98],[40.741,-73.982]]);assert.ok(fit.options.paddingBottomRight[1]>=444);assert.equal(fit.options.maxZoom,15);
});
test('late route results cannot cover the map after the planner is dismissed',()=>{
  const {env,node}=fixture();node('route-form').hidden=true;
  env.esc=String;load('renderResults',env)('Route request completed');assert.equal(node('results').hidden,true);
});
