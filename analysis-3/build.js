#!/usr/bin/env node

/**
 * Build Script - Convenient build commands for LaTeX to HTML conversion
 * 
 * Usage:
 *   node build.js                      # Build everything
 *   node build.js file path/to/file.tex # Build single file
 *   node build.js chapter 01            # Build chapter 1
 *   node build.js chapter 05            # Build chapter 5
 *   node build.js watch                 # Start watch mode (same as node watch.js)
 */

const { build } = require('./watch.js');
const path = require('path');

const args = process.argv.slice(2);

async function main() {
  if (args.length === 0 || args[0] === 'all') {
    console.log('🏗️  Building entire project...\n');
    await build();
  } else if (args[0] === 'file' && args[1]) {
    console.log(`🏗️  Building file: ${args[1]}\n`);
    await build({ targetFile: args[1], skipCompile: true });
  } else if (args[0] === 'chapter' && args[1]) {
    const chapterNum = args[1].padStart(2, '0');
    const chapterFolders = {
      '01': '01-measure-theory',
      '02': '02-integration',
      '03': '03-riesz',
      '04': '04-fubini',
      '05': '05-differentiation-1',
      '06': '06-differentiation-2'
    };
    
    const chapterFolder = chapterFolders[chapterNum];
    if (chapterFolder) {
      console.log(`🏗️  Building chapter ${chapterNum}: ${chapterFolder}\n`);
      await build({ chapter: chapterFolder, skipCompile: true });
    } else {
      console.error(`❌ Chapter ${chapterNum} not found`);
      process.exit(1);
    }
  } else if (args[0] === 'watch') {
    console.log('Starting watch mode...');
    require('./watch.js');
  } else {
    console.log('LaTeX to HTML Build Script\n');
    console.log('Usage:');
    console.log('  node build.js                        # Build entire project');
    console.log('  node build.js file <path>            # Build single .tex file');
    console.log('  node build.js chapter <num>          # Build chapter (e.g., 01, 02, ...)');
    console.log('  node build.js watch                  # Start watch mode');
    console.log('\nExamples:');
    console.log('  node build.js');
    console.log('  node build.js file src/01-measure-theory/basics.tex');
    console.log('  node build.js chapter 01');
    console.log('  node build.js chapter 05');
  }
}

main().catch(error => {
  console.error('Build error:', error);
  process.exit(1);
});