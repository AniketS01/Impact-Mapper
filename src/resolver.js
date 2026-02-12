const path = require('path');
const fs = require('fs');

function resolveImport(specifier, fromFile, projectRoot) {
    // Skip non-relative imports (node_modules, built-ins)
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        return null;
    }

    const dir = path.dirname(fromFile);
    const basePath = path.resolve(dir, specifier);

    // Try direct path
    if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
        return basePath;
    }

    // Try with extensions
    const extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
    for (const ext of extensions) {
        const withExt = basePath + ext;
        if (fs.existsSync(withExt)) {
            return withExt;
        }
    }

    // Try as directory with index file
    if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
        for (const ext of extensions) {
            const indexFile = path.join(basePath, `index${ext}`);
            if (fs.existsSync(indexFile)) {
                return indexFile;
            }
        }
    }

    return null;
}


function getModuleName(filePath, projectRoot) {
    return path.relative(projectRoot, filePath);
}

module.exports = { resolveImport, getModuleName };
