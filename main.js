#!/usr/bin/env node
// ============================================================
// main.js — Entry point for Impact Mapper
// ============================================================

const { createCLI } = require('./src/cli');

const program = createCLI();
program.parse(process.argv);
