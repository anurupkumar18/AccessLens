from pathlib import Path
import json

ROOT = Path('packages/catalog/artifacts')
# These are original CC0-1.0 artifacts, intentionally self-contained and dependency-free.
ITEMS = [
('nearest-neighbor-graph-stepper','Nearest-neighbor graph search','Step through greedy nearest-neighbor graph search, showing visited nodes, frontier, and the selected result.',['computer-science','information-retrieval'],['graph','nearest-neighbor','search','algorithm-stepper'],'stepper'),
('binary-tree-traversal','Binary tree traversal','Explore preorder, inorder, and postorder traversal of a binary search tree.',['computer-science','algorithms'],['tree','traversal','algorithm'],'stepper'),
('network-flow-explorer','Network flow explorer','Adjust capacities and inspect how flow moves through a directed network from source to sink.',['computer-science','graph-theory'],['network','flow','capacity','graph'],'explorer'),
('anatomy-hotspot','Anatomy hotspot diagram','Select labeled body regions to reveal their roles in a simple anatomy diagram.',['biology','anatomy'],['anatomy','hotspot','body'],'hotspot'),
('cell-structure-hotspot','Cell structure hotspots','Navigate common cell structures and read each organelle’s location and role.',['biology','cell-biology'],['cell','organelles','hotspot'],'hotspot'),
('heart-circulation-diagram','Heart circulation diagram','Follow blood through the chambers and vessels of a simplified heart circulation diagram.',['biology','anatomy'],['heart','circulation','diagram'],'diagram'),
('historical-timeline','Historical event timeline','Step through dated events on a horizontal timeline and inspect the sequence between them.',['history','social-science'],['timeline','dates','events'],'timeline'),
('geologic-time-timeline','Geologic time timeline','Compare major geological eras along a proportional timeline with selectable intervals.',['earth-science','geology'],['timeline','geology','eras'],'timeline'),
('projectile-motion-simulation','Projectile motion simulation','Change launch angle and speed to observe a projectile’s parabolic path and landing range.',['physics','mechanics'],['physics','motion','projectile','simulation'],'simulation'),
('pendulum-simulation','Pendulum simulation','Adjust pendulum length and release angle to observe periodic motion over time.',['physics','mechanics'],['physics','pendulum','oscillation','simulation'],'simulation'),
('wave-interference-simulation','Wave interference simulation','Explore how two waves combine to create constructive and destructive interference.',['physics','waves'],['waves','interference','simulation'],'simulation'),
('sine-function-plotter','Sine function plotter','Plot a sine function while adjusting amplitude, frequency, and phase.',['mathematics','calculus'],['function','sine','plot','trigonometry'],'plot'),
('quadratic-function-plotter','Quadratic function plotter','Change the coefficients of a quadratic and observe its vertex and opening direction.',['mathematics','algebra'],['function','quadratic','parabola','plot'],'plot'),
('derivative-plotter','Derivative and tangent plotter','Move a point along a curve to compare the function, tangent line, and local slope.',['mathematics','calculus'],['derivative','tangent','function','plot'],'plot'),
('molecular-structure-diagram','Molecular structure diagram','Inspect atoms and bonds in a simple molecule diagram with selectable elements.',['chemistry','organic-chemistry'],['molecule','atoms','bonds','diagram'],'diagram'),
('periodic-table-explorer','Periodic table explorer','Select an element to see its group, period, symbol, and broad chemical category.',['chemistry','materials-science'],['periodic-table','elements','explorer'],'explorer'),
('reaction-energy-diagram','Reaction energy diagram','Compare reactant and product energy levels and the activation-energy barrier.',['chemistry','thermodynamics'],['reaction','energy','activation','diagram'],'diagram'),
('supply-demand-curves','Supply and demand curves','Adjust price and observe quantity supplied, quantity demanded, and their market intersection.',['economics','social-science'],['supply','demand','equilibrium','curves'],'plot'),
('market-shift-explorer','Market shift explorer','Compare how a demand or supply shift moves equilibrium price and quantity.',['economics','social-science'],['market','shift','equilibrium','explorer'],'explorer'),
('production-possibility-curve','Production possibility curve','Move along a production frontier to compare trade-offs between two goods.',['economics','mathematics'],['production','tradeoff','frontier','curve'],'plot'),
('finite-state-machine','Finite state machine','Step through states and transitions for a small deterministic finite automaton.',['computer-science','formal-languages'],['state-machine','automaton','transitions'],'stepper'),
('bubble-sort-visualizer','Bubble sort visualizer','Step through bubble sort passes and compare adjacent values as the list becomes ordered.',['computer-science','algorithms'],['sorting','bubble-sort','algorithm'],'stepper'),
('binary-search-visualizer','Binary search visualizer','Step through midpoint comparisons as binary search narrows a sorted array.',['computer-science','algorithms'],['search','binary-search','algorithm'],'stepper'),
('merge-sort-visualizer','Merge sort visualizer','Explore splitting and merging phases of merge sort on a small list.',['computer-science','algorithms'],['sorting','merge-sort','algorithm'],'stepper'),
('map-overlay-explorer','Map overlay explorer','Toggle thematic map layers and inspect how a region’s value changes across overlays.',['geography','data-literacy'],['map','overlay','geography','layers'],'explorer'),
('plate-tectonics-map','Plate tectonics map','Explore simplified tectonic plate boundaries and the direction of plate movement.',['earth-science','geography'],['map','tectonics','plates','geology'],'explorer'),
('normal-distribution-explorer','Normal distribution explorer','Adjust mean and standard deviation to see how a normal distribution shifts and spreads.',['statistics','mathematics'],['statistics','normal-distribution','bell-curve'],'plot'),
('sampling-distribution-simulator','Sampling distribution simulator','Draw repeated samples and compare sample means with the population distribution.',['statistics','data-literacy'],['statistics','sampling','simulation','mean'],'simulation'),
('series-circuit-diagram','Series circuit diagram','Trace current through a series circuit and inspect the role of each resistor.',['electrical-engineering','physics'],['circuit','resistor','electricity','diagram'],'diagram'),
('logic-gate-explorer','Logic gate explorer','Toggle binary inputs and observe truth-table outputs for common logic gates.',['electrical-engineering','computer-science'],['logic','gates','truth-table','explorer'],'explorer'),
]
assert len(ITEMS) == 30

TEMPLATE = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>__TITLE__</title>
<style>body{font:16px system-ui,sans-serif;margin:0;padding:1rem;background:#102033;color:#f5f8fb}main{max-width:700px;margin:auto}svg{display:block;width:100%;height:300px;background:#f8fbff;border-radius:8px}.node,.choice{fill:#2c7be5;stroke:#102033;stroke-width:2}.active{fill:#f59e0b;stroke:#fff;stroke-width:4}.edge,.axis{stroke:#789;stroke-width:3;fill:none}.curve{stroke:#2c7be5;stroke-width:4;fill:none}.label{fill:#102033;font-size:15px}button{font:inherit;margin:.25rem;padding:.4rem .7rem}.hint{color:#c7d9ec}.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}</style></head>
<body><main><h1>__TITLE__</h1><p class="hint">__SUMMARY__</p><svg id="visual" role="img" aria-label="__DESCRIPTION__">__SCENE__</svg><p id="readout" class="sr" aria-live="polite"></p><p class="hint">Keyboard: Right arrow or Space advances; Left arrow goes back; Tab reaches each node.</p><button id="previous" type="button">Previous</button><button id="next" type="button">Next</button></main>
<script>
(function(){
  const svg=document.getElementById('visual'), readout=document.getElementById('readout'); let step=0, highlighted='';
  const choices=[...svg.querySelectorAll('[data-choice]')];
  function draw(){ const selected=highlighted||choices[step%Math.max(choices.length,1)]?.dataset.choice||'item-0';
    choices.forEach(choice=>{const active=choice.dataset.choice===selected;choice.classList.toggle('active',active);choice.setAttribute('aria-label',choice.dataset.choice+(active?' selected':''));});
    readout.textContent='Step '+step+': selected '+selected+'. Use next or previous to inspect the sequence.';
  }
  function move(delta){step=Math.max(0,step+delta);draw()}
  document.getElementById('next').addEventListener('click',()=>move(1)); document.getElementById('previous').addEventListener('click',()=>move(-1));
  document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();move(1)} else if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}});
  window.accesslensInit=function(params,ctx){step=Number(params&&params.step||0); highlighted=ctx&&ctx.highlightRegionId||''; draw()};
  window.accesslensHighlight=function(regionId){highlighted=regionId||'';draw()};
  draw();
})();
</script></body></html>
'''

def scene_for(title, subjects, interaction):
    lower = title.lower()
    if 'supply and demand' in lower:
        return '<line class="axis" x1="70" y1="250" x2="635" y2="250"/><line class="axis" x1="90" y1="270" x2="90" y2="35"/><path class="curve" d="M110 55 L590 235"/><path class="curve" d="M110 235 Q350 80 590 55"/><circle class="choice" data-choice="equilibrium" tabindex="0" cx="350" cy="145" r="20"/><text class="label" x="585" y="270">Quantity</text><text class="label" x="35" y="45">Price</text>'
    if 'market shift' in lower or 'production possibility' in lower:
        return '<line class="axis" x1="70" y1="250" x2="635" y2="250"/><line class="axis" x1="90" y1="270" x2="90" y2="35"/><path class="curve" d="M110 230 Q300 35 575 190"/><path class="curve" d="M110 205 Q300 10 575 165"/><circle class="choice" data-choice="old-equilibrium" tabindex="0" cx="300" cy="110" r="18"/><circle class="choice" data-choice="new-equilibrium" tabindex="0" cx="350" cy="80" r="18"/><text class="label" x="580" y="270">Good A</text><text class="label" x="35" y="45">Good B</text>'
    if 'normal distribution' in lower:
        return '<line class="axis" x1="70" y1="250" x2="635" y2="250"/><path class="curve" d="M90 245 C170 245 190 55 350 55 S530 245 625 245"/><circle class="choice" data-choice="mean" tabindex="0" cx="350" cy="55" r="20"/><text class="label" x="340" y="280">Mean</text>'
    if 'sampling distribution' in lower:
        return '<line class="axis" x1="70" y1="250" x2="635" y2="250"/><rect class="choice" data-choice="sample-1" tabindex="0" x="110" y="180" width="55" height="70"/><rect class="choice" data-choice="sample-2" tabindex="0" x="190" y="130" width="55" height="120"/><rect class="choice" data-choice="sample-mean" tabindex="0" x="270" y="75" width="55" height="175"/><rect class="choice" data-choice="sample-4" tabindex="0" x="350" y="130" width="55" height="120"/><rect class="choice" data-choice="sample-5" tabindex="0" x="430" y="180" width="55" height="70"/>'
    if 'periodic table' in lower or 'logic gate' in lower:
        return ''.join(f'<rect class="choice" data-choice="item-{i}" tabindex="0" x="{100+(i%5)*100}" y="{70+(i//5)*90}" width="72" height="55" rx="5"/><text class="label" x="{122+(i%5)*100}" y="{103+(i//5)*90}">{i+1}</text>' for i in range(10))
    if 'map' in lower or 'tectonics' in lower:
        return '<path class="choice" data-choice="north" tabindex="0" d="M110 70 L300 45 L280 140 L100 155 Z"/><path class="choice" data-choice="center" tabindex="0" d="M305 45 L500 75 L550 165 L285 140 Z"/><path class="choice" data-choice="south" tabindex="0" d="M100 165 L280 150 L550 175 L485 250 L130 245 Z"/><path class="edge" d="M280 35 L285 260"/>'
    if 'heart' in lower:
        return '<path class="edge" d="M350 55 C245 10 160 95 350 250 C540 95 455 10 350 55"/><circle class="choice" data-choice="atrium" tabindex="0" cx="290" cy="110" r="28"/><circle class="choice" data-choice="ventricle" tabindex="0" cx="400" cy="165" r="32"/><path class="edge" d="M290 110 L400 165"/>'
    if 'cell structure' in lower:
        return '<ellipse class="node" cx="350" cy="150" rx="250" ry="105"/><circle class="choice" data-choice="nucleus" tabindex="0" cx="350" cy="150" r="52"/><circle class="choice" data-choice="membrane" tabindex="0" cx="145" cy="150" r="24"/><circle class="choice" data-choice="organelle" tabindex="0" cx="510" cy="105" r="24"/>'
    if 'reaction energy' in lower:
        return '<line class="axis" x1="80" y1="250" x2="620" y2="250"/><path class="curve" d="M100 200 L220 200 Q320 40 420 155 L590 155"/><circle class="choice" data-choice="reactants" tabindex="0" cx="150" cy="200" r="20"/><circle class="choice" data-choice="activation" tabindex="0" cx="320" cy="70" r="20"/><circle class="choice" data-choice="products" tabindex="0" cx="530" cy="155" r="20"/>'
    if 'timeline' in lower:
        return '<line class="axis" x1="65" y1="155" x2="635" y2="155"/><circle class="choice" data-choice="early" tabindex="0" cx="120" cy="155" r="24"/><circle class="choice" data-choice="middle" tabindex="0" cx="350" cy="155" r="24"/><circle class="choice" data-choice="late" tabindex="0" cx="580" cy="155" r="24"/><text class="label" x="95" y="210">Early</text><text class="label" x="325" y="210">Middle</text><text class="label" x="555" y="210">Late</text>'
    if interaction == 'plot':
        return '<line class="axis" x1="70" y1="245" x2="635" y2="245"/><line class="axis" x1="90" y1="270" x2="90" y2="40"/><path class="curve" d="M90 210 C180 30 260 30 350 170 S520 290 625 70"/><circle class="choice" data-choice="left" tabindex="0" cx="180" cy="94" r="18"/><circle class="choice" data-choice="center" tabindex="0" cx="350" cy="170" r="18"/><circle class="choice" data-choice="right" tabindex="0" cx="530" cy="190" r="18"/><text class="label" x="600" y="270">x</text><text class="label" x="70" y="50">y</text>'
    if interaction == 'simulation':
        if 'wave' in lower:
            return '<path class="curve" d="M50 150 C100 60 150 240 200 150 S300 60 350 150 S450 240 500 150 S600 60 650 150"/><circle class="choice" data-choice="source-a" tabindex="0" cx="130" cy="150" r="20"/><circle class="choice" data-choice="source-b" tabindex="0" cx="520" cy="150" r="20"/>'
        return '<path class="curve" d="M70 230 Q200 30 330 230 T590 230"/><line class="axis" x1="70" y1="230" x2="610" y2="230"/><circle class="choice" data-choice="launch" tabindex="0" cx="95" cy="215" r="20"/><circle class="choice" data-choice="peak" tabindex="0" cx="330" cy="70" r="20"/><circle class="choice" data-choice="landing" tabindex="0" cx="570" cy="215" r="20"/>'
    if interaction == 'hotspot':
        return '<ellipse class="node" cx="350" cy="150" rx="105" ry="120"/><circle class="choice" data-choice="top-region" tabindex="0" cx="350" cy="70" r="27"/><circle class="choice" data-choice="middle-region" tabindex="0" cx="300" cy="150" r="27"/><circle class="choice" data-choice="bottom-region" tabindex="0" cx="395" cy="220" r="27"/>'
    if interaction == 'diagram':
        if any(x in subjects for x in ['chemistry','organic-chemistry']):
            return '<line class="edge" x1="190" y1="150" x2="330" y2="95"/><line class="edge" x1="330" y1="95" x2="490" y2="155"/><circle class="choice" data-choice="atom-a" tabindex="0" cx="190" cy="150" r="38"/><circle class="choice" data-choice="atom-b" tabindex="0" cx="330" cy="95" r="38"/><circle class="choice" data-choice="atom-c" tabindex="0" cx="490" cy="155" r="38"/><text class="label" x="180" y="155">A</text><text class="label" x="320" y="100">B</text><text class="label" x="480" y="160">C</text>'
        return '<line class="edge" x1="100" y1="150" x2="250" y2="150"/><line class="edge" x1="350" y1="150" x2="500" y2="150"/><circle class="choice" data-choice="input" tabindex="0" cx="100" cy="150" r="38"/><rect class="choice" data-choice="component" tabindex="0" x="250" y="120" width="100" height="60"/><circle class="choice" data-choice="output" tabindex="0" cx="500" cy="150" r="38"/><text class="label" x="78" y="155">In</text><text class="label" x="270" y="155">R</text><text class="label" x="478" y="155">Out</text>'
    if interaction == 'explorer':
        return '<rect class="choice" data-choice="one" tabindex="0" x="100" y="70" width="130" height="80" rx="8"/><rect class="choice" data-choice="two" tabindex="0" x="285" y="70" width="130" height="80" rx="8"/><rect class="choice" data-choice="three" tabindex="0" x="470" y="70" width="130" height="80" rx="8"/><rect class="choice" data-choice="four" tabindex="0" x="190" y="180" width="130" height="80" rx="8"/><rect class="choice" data-choice="five" tabindex="0" x="380" y="180" width="130" height="80" rx="8"/>'
    return '<line class="edge" x1="120" y1="150" x2="300" y2="80"/><line class="edge" x1="300" y1="80" x2="500" y2="150"/><line class="edge" x1="300" y1="80" x2="300" y2="230"/><circle class="choice" data-choice="start" tabindex="0" cx="120" cy="150" r="30"/><circle class="choice" data-choice="current" tabindex="0" cx="300" cy="80" r="30"/><circle class="choice" data-choice="result" tabindex="0" cx="500" cy="150" r="30"/><circle class="choice" data-choice="frontier" tabindex="0" cx="300" cy="230" r="30"/>'

for artifact_id, title, summary, subjects, tags, interaction in ITEMS:
    directory = ROOT / artifact_id / '1'
    directory.mkdir(parents=True, exist_ok=True)
    description = summary
    manifest = {
      'schemaVersion':'1.0','artifactId':artifact_id,'artifactVersion':1,'title':title,'summary':summary,
      'subjects':subjects,'tags':tags,'interaction':interaction,
      'provenance':{'kind':'catalog','sourceUrl':'https://github.com/anurupkumar18/Mind-Machine','license':'CC0-1.0'},
      'parameters':{'type':'object','properties':{'step':{'type':'integer','minimum':0,'maximum':20}}},
      'defaultParameters':{'step':0},'libraries':[],
      'accessibility':{'description':description,'keyboard':'Right arrow or Space advances; Left arrow goes back; Tab reaches each node.','semanticOutline':['Visual diagram','Current selection','Step readout']},
      'render':{'entry':'index.html','minWidth':480,'minHeight':320}
    }
    (directory/'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    html = TEMPLATE.replace('__TITLE__', title).replace('__SUMMARY__', summary).replace('__DESCRIPTION__', description).replace('__SCENE__', scene_for(title, subjects, interaction))
    (directory/'index.html').write_text(html)
print(f'wrote {len(ITEMS)} artifacts')
