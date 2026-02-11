const { Command } = require('commander');
const path = require('path');
const chalk = require('chalk');
const { ImpactAnalyzer } = require('./analyzer');
const { printScanResults, printImpactResults, generateHtmlGraph } = require('./visualizer');

function createCLI() {
    const program = new Command();

    program
        .name('impact-mapper')
        .description('Static analysis dependency mapper for JavaScript codebases')
        .version('1.0.0');

    // ── scan ─────────────────────────────────────────────────
    program
        .command('scan')
        .description('Scan a project and list all discovered entities')
        .argument('<directory>', 'Path to the JavaScript project')
        .action((directory) => {
            const projectRoot = path.resolve(directory);
            const analyzer = new ImpactAnalyzer(projectRoot);
            const result = analyzer.scan();
            printScanResults(result.entityMap, result.fileCount);
        });

    // ── impact ───────────────────────────────────────────────
    program
        .command('impact')
        .description('Analyze the impact of changing a specific entity')
        .argument('<directory>', 'Path to the JavaScript project')
        .requiredOption('-e, --entity <name>', 'Name of the entity (function, class, or variable)')
        .option('-f, --file <filename>', 'File where the entity is defined (for disambiguation)')
        .option('-o, --output <path>', 'Generate an HTML dependency graph with impact highlighted')
        .action((directory, options) => {
            const projectRoot = path.resolve(directory);
            const analyzer = new ImpactAnalyzer(projectRoot);
            analyzer.scan();

            const impact = analyzer.getImpact(options.entity, options.file);
            if (!impact) {
                console.log();
                console.log(chalk.red(`  ✗ Entity "${options.entity}" not found.`));
                if (options.file) {
                    console.log(chalk.gray(`    Searched in files matching: ${options.file}`));
                }
                console.log(chalk.gray('    Run "impact-mapper scan <dir>" to see all entities.\n'));
                process.exit(1);
            }

            printImpactResults(impact);

            if (options.output) {
                const graph = analyzer.getDependencyGraph();
                const outputPath = path.resolve(options.output);
                generateHtmlGraph(graph, outputPath, impact);
                console.log(chalk.green(`  ✓ HTML graph saved to: ${outputPath}\n`));
            }
        });

    // ── graph ────────────────────────────────────────────────
    program
        .command('graph')
        .description('Generate a full dependency graph of the project')
        .argument('<directory>', 'Path to the JavaScript project')
        .requiredOption('-o, --output <path>', 'Output path for the HTML file')
        .action((directory, options) => {
            const projectRoot = path.resolve(directory);
            const analyzer = new ImpactAnalyzer(projectRoot);
            analyzer.scan();

            const graph = analyzer.getDependencyGraph();
            const outputPath = path.resolve(options.output);
            generateHtmlGraph(graph, outputPath);

            console.log();
            console.log(chalk.bold.white('  ╔══════════════════════════════════════╗'));
            console.log(chalk.bold.white('  ║') + chalk.bold.cyan('   📊 IMPACT MAPPER — Graph Export    ') + chalk.bold.white('║'));
            console.log(chalk.bold.white('  ╚══════════════════════════════════════╝'));
            console.log();
            console.log(chalk.gray('  Nodes: ') + chalk.white.bold(graph.nodes.length) + chalk.gray(' modules'));
            console.log(chalk.gray('  Edges: ') + chalk.white.bold(graph.edges.length) + chalk.gray(' dependencies'));
            console.log();
            console.log(chalk.green(`  ✓ Graph saved to: ${outputPath}`));
            console.log(chalk.gray('    Open in a browser to explore interactively.\n'));
        });

    return program;
}

module.exports = { createCLI };
