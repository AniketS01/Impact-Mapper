const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { globSync } = require('glob');
const { resolveImport, getModuleName } = require('./resolver');


 //Parse a JS file into a Babel AST.
 
function parseFile(filePath) {
    const code = fs.readFileSync(filePath, 'utf-8');
    return parser.parse(code, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
    });
}

// Discover entities


function discoverEntities(filePath) {
    const ast = parseFile(filePath);
    const entities = [];
    const exportedNames = new Set();

    traverse(ast, {
        // ── Functions ──
        FunctionDeclaration(nodePath) {
            if (nodePath.node.id) {
                entities.push({
                    name: nodePath.node.id.name,
                    type: 'function',
                    line: nodePath.node.loc.start.line,
                    exported: false,
                });
            }
        },

        // ── Classes ──
        ClassDeclaration(nodePath) {
            if (nodePath.node.id) {
                entities.push({
                    name: nodePath.node.id.name,
                    type: 'class',
                    line: nodePath.node.loc.start.line,
                    exported: false,
                });
            }
        },

        // ── Variables (const/let/var) ──
        VariableDeclaration(nodePath) {
            for (const decl of nodePath.node.declarations) {
                if (decl.id && decl.id.type === 'Identifier') {
                    // Determine sub-type: is the init a function/arrow/class?
                    let type = 'variable';
                    if (decl.init) {
                        if (
                            decl.init.type === 'ArrowFunctionExpression' ||
                            decl.init.type === 'FunctionExpression'
                        ) {
                            type = 'function';
                        } else if (decl.init.type === 'ClassExpression') {
                            type = 'class';
                        }
                    }
                    entities.push({
                        name: decl.id.name,
                        type,
                        line: decl.loc.start.line,
                        exported: false,
                    });
                }
            }
        },

        // ── Track what's exported ──
        ExportNamedDeclaration(nodePath) {
            // export { a, b }
            for (const spec of nodePath.node.specifiers) {
                const localName = spec.local ? spec.local.name : spec.exported.name;
                exportedNames.add(localName);
            }
            // export function foo() {}  /  export class Bar {}
            if (nodePath.node.declaration) {
                if (nodePath.node.declaration.id) {
                    exportedNames.add(nodePath.node.declaration.id.name);
                }
                if (nodePath.node.declaration.declarations) {
                    for (const d of nodePath.node.declaration.declarations) {
                        if (d.id && d.id.type === 'Identifier') exportedNames.add(d.id.name);
                    }
                }
            }
        },

        ExportDefaultDeclaration(nodePath) {
            const decl = nodePath.node.declaration;
            if (decl.id) exportedNames.add(decl.id.name);
        },

        // ── CommonJS: module.exports = { ... } ──
        AssignmentExpression(nodePath) {
            const node = nodePath.node;
            if (
                node.left.type === 'MemberExpression' &&
                node.left.object.name === 'module' &&
                node.left.property.name === 'exports'
            ) {
                if (node.right.type === 'ObjectExpression') {
                    for (const prop of node.right.properties) {
                        if (prop.key && prop.key.name) {
                            exportedNames.add(prop.key.name);
                        }
                    }
                } else if (node.right.type === 'Identifier') {
                    exportedNames.add(node.right.name);
                }
            }
        },
    });

    // Mark exported entities
    for (const entity of entities) {
        if (exportedNames.has(entity.name)) {
            entity.exported = true;
        }
    }

    return entities;
}

// Import Extraction


function extractImports(filePath, projectRoot) {
    const ast = parseFile(filePath);
    const imports = [];

    traverse(ast, {
        // import { a, b } from './module'
        ImportDeclaration(nodePath) {
            const source = nodePath.node.source.value;
            const names = nodePath.node.specifiers.map((s) => {
                if (s.type === 'ImportDefaultSpecifier') return 'default';
                if (s.type === 'ImportNamespaceSpecifier') return '*';
                return s.imported ? s.imported.name : s.local.name;
            });
            imports.push({
                source,
                resolvedPath: resolveImport(source, filePath, projectRoot),
                importedNames: names,
            });
        },

        // const { a, b } = require('./module')
        CallExpression(nodePath) {
            const node = nodePath.node;
            if (
                node.callee.name === 'require' &&
                node.arguments.length === 1 &&
                node.arguments[0].type === 'StringLiteral'
            ) {
                const source = node.arguments[0].value;
                let names = [];

                // Try to get destructured names: const { x, y } = require(...)
                const parent = nodePath.parent;
                if (parent.type === 'VariableDeclarator' && parent.id) {
                    if (parent.id.type === 'ObjectPattern') {
                        names = parent.id.properties
                            .filter((p) => p.key && p.key.name)
                            .map((p) => p.key.name);
                    } else if (parent.id.type === 'Identifier') {
                        names = [parent.id.name];
                    }
                }

                imports.push({
                    source,
                    resolvedPath: resolveImport(source, filePath, projectRoot),
                    importedNames: names,
                });
            }
        },
    });

    return imports;
}

// Reference Finding 


function findReferences(entityName, definedIn, allFiles, projectRoot) {
    const references = [];

    for (const filePath of allFiles) {
        const code = fs.readFileSync(filePath, 'utf-8');
        const lines = code.split('\n');
        let ast;
        try {
            ast = parseFile(filePath);
        } catch (e) {
            continue; // Skip unparseable files
        }

        // Check if this file imports from the defining file
        const imports = extractImports(filePath, projectRoot);
        const importsFromDefiner = imports.some(
            (imp) => imp.resolvedPath === definedIn
        );

        traverse(ast, {
            Identifier(nodePath) {
                if (nodePath.node.name !== entityName) return;

                const line = nodePath.node.loc.start.line;
                const column = nodePath.node.loc.start.column;
                const lineContent = lines[line - 1] || '';

                // Determine reference type
                let refType = 'reference';
                const parent = nodePath.parent;

                if (filePath === definedIn) {
                    // In the defining file
                    if (
                        parent.type === 'FunctionDeclaration' ||
                        parent.type === 'ClassDeclaration' ||
                        (parent.type === 'VariableDeclarator' && parent.id === nodePath.node)
                    ) {
                        refType = 'definition';
                    } else if (
                        parent.type === 'CallExpression' &&
                        parent.callee === nodePath.node
                    ) {
                        refType = 'call';
                    } else if (
                        parent.type === 'MemberExpression' &&
                        parent.object === nodePath.node
                    ) {
                        refType = 'member-access';
                    }
                } else if (importsFromDefiner) {
                    // In an importing file
                    if (
                        parent.type === 'ImportSpecifier' ||
                        parent.type === 'ImportDefaultSpecifier' ||
                        (parent.type === 'ObjectPattern' || parent.type === 'Property')
                    ) {
                        refType = 'import';
                    } else if (
                        parent.type === 'CallExpression' &&
                        parent.callee === nodePath.node
                    ) {
                        refType = 'call';
                    } else if (parent.type === 'NewExpression' && parent.callee === nodePath.node) {
                        refType = 'instantiation';
                    } else if (
                        parent.type === 'MemberExpression' &&
                        parent.object === nodePath.node
                    ) {
                        refType = 'member-access';
                    }
                } else {
                    // Same-name reference in an unrelated file — could be coincidental
                    // Only include if the file actually imports from the definer
                    return;
                }

                references.push({
                    file: getModuleName(filePath, projectRoot),
                    absolutePath: filePath,
                    line,
                    column,
                    type: refType,
                    code: lineContent.trim(),
                });
            },
        });
    }

    return references;
}

// Dependency Graph 

function buildDependencyGraph(projectRoot) {
    const files = getAllJsFiles(projectRoot);
    const nodes = [];
    const edges = [];

    for (const filePath of files) {
        const moduleName = getModuleName(filePath, projectRoot);
        nodes.push({ id: moduleName, file: filePath });

        const imports = extractImports(filePath, projectRoot);
        for (const imp of imports) {
            if (imp.resolvedPath) {
                const targetModule = getModuleName(imp.resolvedPath, projectRoot);
                edges.push({
                    from: moduleName,
                    to: targetModule,
                    imports: imp.importedNames,
                });
            }
        }
    }

    return { nodes, edges };
}

// File Discovery 


function getAllJsFiles(projectRoot) {
    const pattern = path.join(projectRoot, '**/*.{js,jsx,mjs,cjs}');
    return globSync(pattern, {
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
        absolute: true,
    });
}

// Main Analyzer Class 

class ImpactAnalyzer {
    constructor(projectRoot) {
        this.projectRoot = path.resolve(projectRoot);
        this.files = [];
        this.entityMap = new Map(); // moduleName -> entities[]
    }

    /**
     * Scan the entire project: discover all files and entities.
     */
    scan() {
        this.files = getAllJsFiles(this.projectRoot);

        for (const filePath of this.files) {
            const moduleName = getModuleName(filePath, this.projectRoot);
            try {
                const entities = discoverEntities(filePath);
                this.entityMap.set(moduleName, entities);
            } catch (e) {
                // Skip unparseable files
                this.entityMap.set(moduleName, []);
            }
        }

        return {
            fileCount: this.files.length,
            entityMap: this.entityMap,
        };
    }

   
    findEntity(entityName, fileName) {
        for (const [moduleName, entities] of this.entityMap) {
            if (fileName && !moduleName.endsWith(fileName)) continue;

            const found = entities.find((e) => e.name === entityName);
            if (found) {
                return {
                    ...found,
                    module: moduleName,
                    absolutePath: path.join(this.projectRoot, moduleName),
                };
            }
        }
        return null;
    }

   
    getImpact(entityName, fileName) {
        const entity = this.findEntity(entityName, fileName);
        if (!entity) {
            return null;
        }

        const references = findReferences(
            entityName,
            entity.absolutePath,
            this.files,
            this.projectRoot
        );

        // Unique affected modules (excluding the definition file)
        const affectedModules = [
            ...new Set(
                references
                    .filter((r) => r.type !== 'definition' && r.file !== entity.module)
                    .map((r) => r.file)
            ),
        ];

        // Severity based on spread
        let severity;
        if (affectedModules.length === 0) severity = 'NONE';
        else if (affectedModules.length <= 2) severity = 'LOW';
        else if (affectedModules.length <= 5) severity = 'MEDIUM';
        else severity = 'HIGH';

        return {
            entity,
            references,
            affectedModules,
            severity,
        };
    }

    
     // Build the full dependency graph.
     
    getDependencyGraph() {
        return buildDependencyGraph(this.projectRoot);
    }
}

module.exports = { ImpactAnalyzer, discoverEntities, extractImports, findReferences, buildDependencyGraph, getAllJsFiles };
