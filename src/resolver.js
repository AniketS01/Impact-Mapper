const path = require('path');
const fs = require('fs');

/**
 * Resolve a JS import specifier to an actual file path.
 * Handles: relative paths, missing extensions, index files.
 *
 * @param {string} specifier - The import string (e.g. './utils', '../models')
 * @param {string} fromFile  - Absolute path of the importing file
 * @param {string} projectRoot - Absolute path of the project root
 * @returns {string|null} Resolved absolute file path, or null if unresolvable
 */
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

/**
 * Get the module name (relative to project root) from an absolute path.
 *
 * @param {string} filePath - Absolute file path
 * @param {string} projectRoot - Absolute path of the project root
 * @returns {string} Relative module name
 */
function getModuleName(filePath, projectRoot) {
    return path.relative(projectRoot, filePath);
}

module.exports = { resolveImport, getModuleName };
