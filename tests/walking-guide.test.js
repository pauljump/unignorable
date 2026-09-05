const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function load(name,env){const a=html.indexOf('function '+name+'('),e=html.indexOf('\n}',a)+2;return new Function('env',`with(env){${html.slice(a,e)};return ${name};}`)(env);}
function setup(){
 const steps=[{instruction:'Walk east on 23rd Street.',distance:50,location:{lat:40.74,lng:-73.99}},{instruction:'Turn right onto Third Avenue.',distance:100,location:{lat:40.741,lng:-73.98}},{instruction:'Arrive at your destination.',distance:0,location:{lat:40.742,lng:-73.98}}];
 const state={routes:[{id:'a',steps}],selectedRoute:0,guide:{open:false,index:0,route:null,group:null}};
 const nodes=new Map();function node(id){if(!nodes.has(id))nodes.set(id,{hidden:false,innerHTML:'',querySelectorAll:()=>[],getBoundingClientRect:()=>({right:398,height:300})});return nodes.get(id);}
 const env={state,document:{getElementById:node},window:{speechSynthesis:{cancel(){}}},esc:s=>String(s).replace(/</g,'&lt;'),stepDistance:n=>n+' m',compactMap:()=>true,
  closeWalkPlanner(){node('route-form').hidden=true;node('results').hidden=true;},
  map:{closePopup(){},fitBounds(points,options){this.focus={points,options};}},
  L:{latLngBounds:p=>p,layerGroup:()=>({addTo(){return this;},clearLayers(){}}),circleMarker:()=>({bindTooltip(){return this;},addTo(){return this;}})},selectionRenderer:{}};
 for(const name of ['closeWalkGuide','leaveWalkGuide','renderWalkGuide','selectWalkStep','startWalkGuide','renderRouteHandoff'])env[name]=load(name,env);
 return {env,state,node,steps};
}
test('walking guide follows each actual maneuver and keeps its map location above the mobile sheet',()=>{
 const {env,state,node,steps}=setup();env.startWalkGuide();
 assert.equal(node('route-form').hidden,true);assert.equal(node('walk-guide').hidden,false);
 assert.match(node('walk-guide').innerHTML,/Step 1 of 3/);
 env.selectWalkStep(1);assert.match(node('walk-guide').innerHTML,/Turn right onto Third Avenue/);
 assert.deepEqual(env.map.focus.points,[[steps[1].location.lat,steps[1].location.lng],[steps[1].location.lat,steps[1].location.lng]]);
 assert.equal(env.map.focus.options.paddingBottomRight[1],324);
 env.selectWalkStep(999);assert.equal(state.guide.index,2);assert.match(node('walk-guide').innerHTML,/Finish walk/);
 env.selectWalkStep(-1);assert.equal(state.guide.index,0);
});
test('closing and resuming a walk retains progress; a replacement route starts at the first step',()=>{
 const {env,state,node,steps}=setup();env.startWalkGuide();env.selectWalkStep(1);env.closeWalkGuide();assert.equal(node('walk-guide').hidden,true);
 env.startWalkGuide();assert.equal(state.guide.index,1);
 state.routes=[{id:'a',steps:[...steps]}];env.startWalkGuide();assert.equal(state.guide.index,0);
});
test('missing instructions do not fabricate a guided walk',()=>{
 const {env,state,node}=setup();state.routes[0].steps=[];node('walk-guide').hidden=true;env.startWalkGuide();assert.equal(state.guide.open,false);assert.equal(node('walk-guide').hidden,true);
});
test('external-map controls are secondary and identify separate stop legs',()=>{
 const {env}=setup();const out=env.renderRouteHandoff({export:{legs:[{name:'To stop: <Cafe>',apple:'https://maps.apple.com/?saddr=a&daddr=b',google:'https://www.google.com/maps/dir/?api=1'},{name:'From stop to destination',apple:'https://maps.apple.com/',google:'https://www.google.com/maps/dir/'}]}});
 assert.match(out,/Plan separately/);assert.match(out,/not transferred/);assert.match(out,/To stop: &lt;Cafe>/);assert.match(out,/From stop to destination/);assert.doesNotMatch(out,/Start in/);
});

test('leaving the guide restores route controls without requesting or replacing the walk',()=>{
 const {env,state,node}=setup();let rendered=0;env.renderResults=()=>{rendered++;};env.fitRoute=()=>{};
 env.startWalkGuide();env.selectWalkStep(1);const route=state.routes[0];env.leaveWalkGuide();
 assert.equal(node('route-form').hidden,false);assert.equal(node('walk-guide').hidden,true);
 assert.equal(rendered,1);assert.equal(state.routes[0],route);env.startWalkGuide();assert.equal(state.guide.index,1);
});
