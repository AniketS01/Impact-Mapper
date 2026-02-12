const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

// Terminal Output 

const SEVERITY_COLORS = {
  NONE: chalk.green,
  LOW: chalk.yellow,
  MEDIUM: chalk.hex('#FF8800'),
  HIGH: chalk.red,
};

const REF_TYPE_ICONS = {
  definition: '◆',
  import: '⬇',
  call: '▶',
  instantiation: '✦',
  'member-access': '•',
  reference: '○',
};

const REF_TYPE_COLORS = {
  definition: chalk.cyan,
  import: chalk.blue,
  call: chalk.green,
  instantiation: chalk.magenta,
  'member-access': chalk.yellow,
  reference: chalk.gray,
};


 // Print the scan results (all entities) to the terminal.
 
function printScanResults(entityMap, fileCount) {
  console.log();
  console.log(chalk.bold.white('  ╔══════════════════════════════════════╗'));
  console.log(chalk.bold.white('  ║') + chalk.bold.cyan('   ⚡ IMPACT MAPPER — Scan Results   ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ╚══════════════════════════════════════╝'));
  console.log();
  console.log(chalk.gray(`  Scanned ${chalk.white.bold(fileCount)} files\n`));

  let totalEntities = 0;
  for (const [moduleName, entities] of entityMap) {
    if (entities.length === 0) continue;

    console.log(chalk.bold.blue(`  📄 ${moduleName}`));

    for (const entity of entities) {
      totalEntities++;
      const typeTag =
        entity.type === 'function'
          ? chalk.green('ƒ func  ')
          : entity.type === 'class'
            ? chalk.magenta('◇ class ')
            : chalk.yellow('▪ var   ');

      const exportTag = entity.exported
        ? chalk.cyan(' ⬆ exported')
        : chalk.gray(' ⬚ local');

      console.log(
        chalk.gray('    ├─ ') +
        typeTag +
        chalk.white.bold(entity.name) +
        exportTag +
        chalk.gray(` :${entity.line}`)
      );
    }
    console.log();
  }

  console.log(chalk.gray(`  ─────────────────────────────────────────`));
  console.log(chalk.gray(`  Total: ${chalk.white.bold(totalEntities)} entities across ${chalk.white.bold(fileCount)} files\n`));
}


 // Print the impact analysis results to the terminal.
 
function printImpactResults(impact) {
  const { entity, references, affectedModules, severity } = impact;
  const colorFn = SEVERITY_COLORS[severity] || chalk.white;

  console.log();
  console.log(chalk.bold.white('  ╔══════════════════════════════════════╗'));
  console.log(chalk.bold.white('  ║') + chalk.bold.cyan('   💥 IMPACT MAPPER — Impact Report  ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ╚══════════════════════════════════════╝'));
  console.log();

  // Entity info
  const typeLabel =
    entity.type === 'function' ? 'ƒ Function' : entity.type === 'class' ? '◇ Class' : '▪ Variable';
  console.log(chalk.gray('  Target:   ') + chalk.bold.white(entity.name) + chalk.gray(` (${typeLabel})`));
  console.log(chalk.gray('  Defined:  ') + chalk.blue(entity.module) + chalk.gray(`:${entity.line}`));
  console.log(chalk.gray('  Exported: ') + (entity.exported ? chalk.green('Yes') : chalk.red('No')));
  console.log(
    chalk.gray('  Severity: ') + colorFn.bold(`■ ${severity}`) + chalk.gray(` (${affectedModules.length} modules affected)`)
  );
  console.log();

  // Group references by file
  const byFile = {};
  for (const ref of references) {
    if (!byFile[ref.file]) byFile[ref.file] = [];
    byFile[ref.file].push(ref);
  }

  console.log(chalk.bold.white('  References:'));
  console.log();

  for (const [moduleName, refs] of Object.entries(byFile)) {
    const isDefFile = moduleName === entity.module;
    const fileLabel = isDefFile
      ? chalk.cyan(`  📄 ${moduleName}`) + chalk.gray(' (definition)')
      : chalk.yellow(`  📄 ${moduleName}`) + chalk.red(' ← AFFECTED');

    console.log(fileLabel);

    for (const ref of refs) {
      const icon = REF_TYPE_ICONS[ref.type] || '○';
      const lineColor = REF_TYPE_COLORS[ref.type] || chalk.gray;
      console.log(
        chalk.gray('    ├─ ') +
        lineColor(`${icon} ${ref.type.padEnd(14)}`) +
        chalk.gray(` :${ref.line}  `) +
        chalk.dim(ref.code)
      );
    }
    console.log();
  }

  // Affected modules summary
  if (affectedModules.length > 0) {
    console.log(chalk.bold.red('  ⚠  Modules that will break:'));
    for (const mod of affectedModules) {
      console.log(chalk.red(`    ✗ ${mod}`));
    }
  } else {
    console.log(chalk.green('  ✓  No other modules reference this entity.'));
  }

  console.log();
  console.log(chalk.gray('  ─────────────────────────────────────────'));
  console.log(
    chalk.gray(`  ${references.length} references across ${Object.keys(byFile).length} files\n`)
  );
}

//  HTML Graph Output 


function generateHtmlGraph(graph, outputPath, impact) {
  const highlightedNodes = new Set();
  let impactEntity = null;
  let impactEntityModule = null;

  if (impact) {
    impactEntity = impact.entity.name;
    impactEntityModule = impact.entity.module;
    highlightedNodes.add(impact.entity.module);
    for (const mod of impact.affectedModules) {
      highlightedNodes.add(mod);
    }
  }

  const graphData = JSON.stringify({
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      group: highlightedNodes.has(n.id)
        ? n.id === impactEntityModule
          ? 'source'
          : 'affected'
        : 'normal',
    })),
    links: graph.edges.map((e) => ({
      source: e.from,
      target: e.to,
      imports: e.imports,
    })),
    impactEntity,
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Impact Mapper — Dependency Graph</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0d1117;
    color: #c9d1d9;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
  }
  #header {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    background: linear-gradient(135deg, #161b22 0%, #0d1117 100%);
    border-bottom: 1px solid #30363d;
    padding: 16px 24px;
    display: flex; align-items: center; justify-content: space-between;
  }
  #header h1 {
    font-size: 18px; font-weight: 600;
    background: linear-gradient(90deg, #58a6ff, #bc8cff);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  #header .subtitle { font-size: 13px; color: #8b949e; }
  #legend {
    position: fixed; bottom: 20px; left: 20px; z-index: 100;
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 12px 16px; font-size: 12px;
  }
  #legend div { margin: 4px 0; display: flex; align-items: center; gap: 8px; }
  #legend .dot {
    width: 12px; height: 12px; border-radius: 50%; display: inline-block;
  }
  #tooltip {
    position: fixed; display: none; z-index: 200;
    background: #1c2128; border: 1px solid #30363d; border-radius: 8px;
    padding: 12px 16px; font-size: 13px; pointer-events: none;
    box-shadow: 0 8px 24px rgba(0,0,0,.4);
    max-width: 320px;
  }
  #tooltip .tt-title { font-weight: 600; color: #58a6ff; margin-bottom: 6px; }
  #tooltip .tt-imports { color: #8b949e; }
  svg { width: 100vw; height: 100vh; }
  .link { stroke-opacity: 0.4; }
  .link:hover { stroke-opacity: 1; }
  .node-label {
    font-size: 11px; fill: #c9d1d9; pointer-events: none;
    text-anchor: middle; dominant-baseline: central;
  }
</style>
</head>
<body>
<div id="header">
  <div>
    <h1>⚡ Impact Mapper</h1>
    <div class="subtitle">${impact ? `Impact analysis for <strong>${impactEntity}</strong>` : 'Full dependency graph'}</div>
  </div>
</div>
<div id="legend">
  <div><span class="dot" style="background:#58a6ff;"></span> Normal module</div>
  <div><span class="dot" style="background:#f85149;"></span> Source of change</div>
  <div><span class="dot" style="background:#d29922;"></span> Affected module</div>
  <div style="color:#8b949e; margin-top:8px;">Drag nodes · Scroll to zoom</div>
</div>
<div id="tooltip">
  <div class="tt-title"></div>
  <div class="tt-imports"></div>
</div>

<svg></svg>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const data = ${graphData};

const colors = { normal: '#58a6ff', source: '#f85149', affected: '#d29922' };
const svg = d3.select('svg');
const width = window.innerWidth;
const height = window.innerHeight;

const simulation = d3.forceSimulation(data.nodes)
  .force('link', d3.forceLink(data.links).id(d => d.id).distance(140))
  .force('charge', d3.forceManyBody().strength(-400))
  .force('center', d3.forceCenter(width / 2, height / 2))
  .force('collision', d3.forceCollide().radius(50));

const g = svg.append('g');

svg.call(d3.zoom().scaleExtent([0.2, 5]).on('zoom', (event) => {
  g.attr('transform', event.transform);
}));

// Arrow marker
svg.append('defs').append('marker')
  .attr('id', 'arrow').attr('viewBox', '0 -5 10 10')
  .attr('refX', 28).attr('refY', 0)
  .attr('markerWidth', 6).attr('markerHeight', 6)
  .attr('orient', 'auto')
  .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', '#30363d');

const link = g.append('g').selectAll('line')
  .data(data.links).join('line')
  .attr('class', 'link')
  .attr('stroke', '#30363d').attr('stroke-width', 1.5)
  .attr('marker-end', 'url(#arrow)');

const tooltip = d3.select('#tooltip');

link.on('mouseover', (event, d) => {
  tooltip.style('display', 'block')
    .style('left', (event.pageX + 12) + 'px')
    .style('top', (event.pageY - 12) + 'px');
  tooltip.select('.tt-title').text(d.source.id + ' → ' + d.target.id);
  tooltip.select('.tt-imports').text(d.imports.length ? 'Imports: ' + d.imports.join(', ') : '');
}).on('mouseout', () => tooltip.style('display', 'none'));

const node = g.append('g').selectAll('g')
  .data(data.nodes).join('g')
  .call(d3.drag()
    .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
    .on('end', (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
  );

node.append('circle')
  .attr('r', d => d.group === 'source' ? 20 : d.group === 'affected' ? 16 : 14)
  .attr('fill', d => colors[d.group])
  .attr('stroke', d => d.group === 'source' ? '#f85149' : 'none')
  .attr('stroke-width', d => d.group === 'source' ? 3 : 0)
  .attr('opacity', 0.85);

node.append('text')
  .attr('class', 'node-label')
  .attr('dy', d => (d.group === 'source' ? 32 : 28))
  .text(d => d.id);

simulation.on('tick', () => {
  link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
});
</script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf-8');
}

module.exports = { printScanResults, printImpactResults, generateHtmlGraph };
