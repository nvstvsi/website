#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const http = require('http');
const crypto = require('crypto');

const execAsync = promisify(exec);

// Import parser functions
const parser = require('./simple-latex-parser.js');
const convertLaTeXToHTML = parser.convertLaTeXToHTML;

const CONFIG = {
  mainFile: 'main.tex',
  preambleFile: 'preamble.tex',
  srcDir: 'src',
  buildDir: 'build',
  outputDir: 'html_preview',
  figuresDir: 'figures',
  debounceDelay: 500,
  reloadPort: 35729,
};

// Chapter metadata organized by folder structure
const CHAPTERS_METADATA = {
  '01-measure-theory': {
    number: 1,
    title: 'Measure Theory Foundations',
    color: '#2ecc71',
    sections: {
      'basics': { 
        title: 'Outer Measures and σ-Algebras',
        file: 'basics.tex',
        order: 1,
        tags: ['first-course', 'foundations']
      },
      'lebesgue-meas': { 
        title: 'Lebesgue Measure on ℝⁿ',
        file: 'lebesgue-meas.tex',
        order: 2,
        tags: ['first-course', 'euclidean']
      },
      'cantor': { 
        title: 'The Cantor Set',
        file: 'cantor.tex',
        order: 3,
        tags: ['advanced']
      },
      'measure-spaces': { 
        title: 'Measure Spaces and Measurable Functions',
        file: 'measure-spaces.tex',
        order: 4,
        tags: ['first-course', 'foundations']
      }
    }
  },
  '02-integration': {
    number: 2,
    title: 'Integration Theory',
    color: '#3498db',
    sections: {
      'integrals-1': { 
        title: 'Integration I: Simple Functions',
        file: 'integrals-1.tex',
        order: 1,
        tags: ['first-course']
      },
      'integrals-2': { 
        title: 'Integration II: General Functions',
        file: 'integrals-2.tex',
        order: 2,
        tags: ['first-course']
      },
      'convergence': { 
        title: 'Convergence Theorems',
        file: 'convergence.tex',
        order: 3,
        tags: ['first-course']
      },
      'inequality-party': { 
        title: 'Integral Inequalities',
        file: 'inequality-party.tex',
        order: 4,
        tags: ['advanced']
      },
      'lp_spaces': { 
        title: 'Lᵖ Spaces',
        file: 'lp_spaces.tex',
        order: 5,
        tags: ['advanced']
      }
    }
  },
  '03-riesz': {
    number: 3,
    title: 'Functional Analysis & Riesz Representation',
    color: '#9b59b6',
    sections: {
      'riesz_functional': { 
        title: 'Riesz Representation Theorem',
        file: 'riesz_functional.tex',
        order: 1,
        tags: ['advanced', 'road-to-gmt']
      },
      'LCH_spaces': { 
        title: 'Locally Compact Hausdorff Spaces',
        file: 'LCH_spaces.tex',
        order: 2,
        tags: ['road-to-gmt']
      }
    }
  },
  '04-fubini': {
    number: 4,
    title: 'Product Measures & Fubini',
    color: '#e74c3c',
    sections: {
      'fubini': { 
        title: 'Fubini and Tonelli Theorems',
        file: 'fubini.tex',
        order: 1,
        tags: ['first-course', 'euclidean']
      },
      'integrals-3': { 
        title: 'Integration III: Product Measures',
        file: 'integrals-3.tex',
        order: 2,
        tags: ['road-to-gmt']
      }
    }
  },
  '05-differentiation-1': {
    number: 5,
    title: 'Differentiation Theory',
    color: '#f39c12',
    sections: {
      'covering': { 
        title: 'Vitali Covering Theorems',
        file: 'covering.tex',
        order: 1,
        tags: ['first-course', 'euclidean']
      },
      'monotone': { 
        title: 'Monotone Functions',
        file: 'monotone.tex',
        order: 2,
        tags: ['first-course', 'euclidean']
      },
      'BV_on_R': { 
        title: 'Functions of Bounded Variation',
        file: 'BV_on_R.tex',
        order: 3,
        tags: ['road-to-gmt']
      },
      'HL': { 
        title: 'Hardy-Littlewood Maximal Function',
        file: 'HL.tex',
        order: 4,
        tags: ['road-to-gmt']
      }
    }
  },
  '06-differentiation-2': {
    number: 6,
    title: 'Advanced Differentiation',
    color: '#1abc9c',
    sections: {}
  }
};

// Learning paths for filtering
const LEARNING_PATHS = {
  'all': {
    title: 'All Chapters',
    description: 'Complete course notes',
    icon: '📖',
    color: '#34495e'
  },
  'first-course': {
    title: 'First Course (Focus on ℝⁿ)',
    description: 'Essential topics for an undergraduate introduction to measure theory on Euclidean spaces',
    icon: '📚',
    color: '#2ecc71'
  },
  'advanced': {
    title: 'Advanced Topics',
    description: 'Advanced topics in real analysis and measure theory',
    icon: '🎓',
    color: '#e74c3c'
  },
  'road-to-gmt': {
    title: 'Road to Geometric Measure Theory',
    description: 'Preparation for geometric measure theory and harmonic analysis',
    icon: '🔬',
    color: '#9b59b6'
  }
};

let buildTimer = null;
let isBuilding = false;
let watchers = [];
let lastMainFileHash = null;
let lastPreambleHash = null;
let reloadClients = [];

function getFileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

function ensureDirectories() {
  [CONFIG.buildDir, CONFIG.outputDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✓ Created directory: ${dir}`);
    }
  });
}

// Simple reload server
const reloadServer = http.createServer((req, res) => {
  if (req.url === '/reload-stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    
    reloadClients.push(res);
    console.log(`🔌 Browser connected (${reloadClients.length} client(s))`);
    
    req.on('close', () => {
      const index = reloadClients.indexOf(res);
      if (index !== -1) {
        reloadClients.splice(index, 1);
      }
      console.log(`🔌 Browser disconnected (${reloadClients.length} client(s))`);
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

function notifyReload() {
  reloadClients.forEach(client => {
    client.write('data: reload\n\n');
  });
  if (reloadClients.length > 0) {
    console.log(`🔄 Sent reload signal to ${reloadClients.length} client(s)`);
  }
}

async function compileMainFile() {
  console.log('\n🔨 Compiling main.tex with pdflatex...');
  
  try {
    // Run pdflatex twice for cross-references
    for (let i = 1; i <= 2; i++) {
      console.log(`   Pass ${i}/2...`);
      const { stdout, stderr } = await execAsync(
        `pdflatex -output-directory=${CONFIG.buildDir} -interaction=nonstopmode ${CONFIG.mainFile}`,
        { maxBuffer: 10 * 1024 * 1024 }
      );
      
      if (stderr && !stderr.includes('Warning')) {
        console.warn('   LaTeX warnings:', stderr.substring(0, 200));
      }
    }
    
    const auxPath = path.join(CONFIG.buildDir, 'main.aux');
    if (fs.existsSync(auxPath)) {
      console.log(`✓ Compilation successful: ${auxPath}`);
      return auxPath;
    } else {
      throw new Error('Aux file not generated');
    }
  } catch (error) {
    console.error('❌ LaTeX compilation failed:', error.message);
    if (error.stdout) {
      const lines = error.stdout.split('\n');
      const errorLines = lines.filter(line => line.includes('!') || line.includes('Error'));
      if (errorLines.length > 0) {
        console.error('   Errors:', errorLines.join('\n   '));
      }
    }
    return null;
  }
}

function findTexFiles(chapterFolder = null) {
  const files = [];
  
  function scanDir(dir, relativeBase = '') {
    if (!fs.existsSync(dir)) return;
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(relativeBase, entry.name);
      
      if (entry.isDirectory()) {
        // If filtering by chapter, only scan that folder
        if (!chapterFolder || entry.name === chapterFolder) {
          scanDir(fullPath, relativePath);
        }
      } else if (entry.isFile() && entry.name.endsWith('.tex')) {
        files.push({ 
          fullPath, 
          relativePath, 
          name: entry.name,
          chapter: relativeBase
        });
      }
    }
  }
  
  scanDir(CONFIG.srcDir);
  return files;
}

async function convertFileToHTML(texPath, auxPath, options = {}) {
  if (!fs.existsSync(texPath)) {
    console.error(`❌ File not found: ${texPath}`);
    return null;
  }

  if (!auxPath || !fs.existsSync(auxPath)) {
    console.warn(`⚠️  No aux file available, references may not work`);
    auxPath = null;
  }

  // Create output path maintaining directory structure
  const relativePath = path.relative(CONFIG.srcDir, texPath);
  const outputPath = path.join(CONFIG.outputDir, relativePath.replace('.tex', '.html'));
  
  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Calculate relative path from output HTML to figures directory
  const htmlDir = path.dirname(outputPath);
  const relativeToRoot = path.relative(htmlDir, CONFIG.outputDir);
  const imageBasePath = path.posix.join(relativeToRoot, '..', CONFIG.figuresDir).replace(/\\/g, '/');

  try {
    convertLaTeXToHTML(texPath, auxPath, outputPath, { imageBasePath });
    console.log(`✓ Converted ${relativePath} → ${path.relative(CONFIG.outputDir, outputPath)}`);
    return outputPath;
  } catch (error) {
    console.error(`❌ Conversion failed:`, error.message);
    return null;
  }
}

async function generateIndexFile(texFiles) {
  const indexPath = path.join(CONFIG.outputDir, 'index.html');
  
  // Build the chapter structure with actual files
  const chapters = {};
  for (const [chapterFolder, chapterData] of Object.entries(CHAPTERS_METADATA)) {
    chapters[chapterFolder] = {
      ...chapterData,
      sections: {}
    };
    
    for (const [sectionKey, sectionData] of Object.entries(chapterData.sections)) {
      const sectionFile = texFiles.find(f => 
        f.relativePath.includes(chapterFolder) && f.name === sectionData.file
      );
      
      if (sectionFile) {
        const htmlPath = sectionFile.relativePath.replace('.tex', '.html');
        chapters[chapterFolder].sections[sectionKey] = {
          ...sectionData,
          htmlPath: htmlPath,
          exists: true
        };
      }
    }
  }
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Real Analysis Notes - Navigation</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #2c3e50;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .header {
      text-align: center;
      color: white;
      margin-bottom: 40px;
      padding: 40px 20px;
    }
    
    .header h1 {
      font-size: 3em;
      margin-bottom: 10px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
      font-weight: 700;
    }
    
    .header p {
      font-size: 1.2em;
      opacity: 0.95;
      font-weight: 300;
    }
    
    .filter-tabs {
      display: flex;
      justify-content: center;
      gap: 15px;
      margin-bottom: 30px;
      flex-wrap: wrap;
    }
    
    .filter-tab {
      background: white;
      border: none;
      padding: 12px 24px;
      border-radius: 25px;
      cursor: pointer;
      font-size: 1em;
      font-weight: 600;
      transition: all 0.3s ease;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      display: flex;
      align-items: center;
      gap: 8px;
      color: #2c3e50;
    }
    
    .filter-tab:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 12px rgba(0,0,0,0.15);
    }
    
    .filter-tab.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      box-shadow: 0 6px 12px rgba(102, 126, 234, 0.4);
    }
    
    .chapters-grid {
      display: grid;
      gap: 20px;
    }
    
    .chapter-card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.1);
      overflow: hidden;
      transition: all 0.3s ease;
    }
    
    .chapter-card.hidden {
      display: none;
    }
    
    .chapter-header {
      padding: 20px 25px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-left: 5px solid;
      transition: background 0.3s ease;
    }
    
    .chapter-header:hover {
      background: #f8f9fa;
    }
    
    .chapter-title-area {
      display: flex;
      align-items: center;
      gap: 15px;
      flex: 1;
    }
    
    .chapter-number {
      font-size: 2em;
      font-weight: 700;
      opacity: 0.3;
      min-width: 50px;
    }
    
    .chapter-title {
      font-size: 1.5em;
      font-weight: 600;
      color: #2c3e50;
    }
    
    .chapter-toggle {
      font-size: 1.5em;
      transition: transform 0.3s ease;
      color: #7f8c8d;
    }
    
    .chapter-card.expanded .chapter-toggle {
      transform: rotate(180deg);
    }
    
    .chapter-content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.4s ease;
      background: #f8f9fa;
    }
    
    .chapter-card.expanded .chapter-content {
      max-height: 2000px;
    }
    
    .sections-list {
      padding: 20px 25px;
    }
    
    .section-item {
      background: white;
      margin-bottom: 12px;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      transition: all 0.3s ease;
    }
    
    .section-item:hover {
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
      transform: translateX(5px);
    }
    
    .section-link {
      display: flex;
      align-items: center;
      padding: 15px 20px;
      text-decoration: none;
      color: #2c3e50;
      gap: 12px;
    }
    
    .section-order {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.9em;
      flex-shrink: 0;
    }
    
    .section-title {
      font-weight: 500;
      font-size: 1.05em;
      flex: 1;
    }
    
    .section-tags {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    
    .tag {
      font-size: 0.75em;
      padding: 4px 10px;
      border-radius: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .tag.first-course {
      background: #d4edda;
      color: #155724;
    }
    
    .tag.advanced {
      background: #f8d7da;
      color: #721c24;
    }
    
    .tag.road-to-gmt {
      background: #e2d9f3;
      color: #4a148c;
    }
    
    .tag.euclidean {
      background: #d1ecf1;
      color: #0c5460;
    }
    
    .tag.foundations {
      background: #fff3cd;
      color: #856404;
    }
    
    .empty-message {
      text-align: center;
      padding: 60px 20px;
      color: white;
      font-size: 1.2em;
    }
    
    .footer {
      text-align: center;
      color: white;
      padding: 40px 20px;
      opacity: 0.8;
      margin-top: 40px;
    }
    
    @media (max-width: 768px) {
      .header h1 {
        font-size: 2em;
      }
      
      .filter-tabs {
        flex-direction: column;
        align-items: stretch;
      }
      
      .chapter-title {
        font-size: 1.2em;
      }
      
      .section-link {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📐 Real Analysis Notes</h1>
      <p>An Interactive Guide to Measure Theory and Integration</p>
    </div>
    
    <div class="filter-tabs">
      ${Object.entries(LEARNING_PATHS).map(([key, path]) => `
        <button class="filter-tab ${key === 'all' ? 'active' : ''}" data-filter="${key}">
          <span>${path.icon}</span>
          <span>${path.title}</span>
        </button>
      `).join('')}
    </div>
    
    <div class="chapters-grid" id="chaptersGrid">
      ${Object.entries(chapters).map(([chapterKey, chapter]) => {
        if (Object.keys(chapter.sections).length === 0) return '';
        
        return `
          <div class="chapter-card" data-chapter="${chapterKey}">
            <div class="chapter-header" style="border-left-color: ${chapter.color};" onclick="toggleChapter('${chapterKey}')">
              <div class="chapter-title-area">
                <div class="chapter-number">${chapter.number}</div>
                <div class="chapter-title">${chapter.title}</div>
              </div>
              <div class="chapter-toggle">▼</div>
            </div>
            <div class="chapter-content">
              <div class="sections-list">
                ${Object.entries(chapter.sections)
                  .filter(([, section]) => section.exists)
                  .sort((a, b) => a[1].order - b[1].order)
                  .map(([sectionKey, section]) => `
                    <div class="section-item" data-tags="${section.tags.join(',')}">
                      <a href="${section.htmlPath}" class="section-link">
                        <div class="section-order">${section.order}</div>
                        <div class="section-title">${section.title}</div>
                        <div class="section-tags">
                          ${section.tags.map(tag => `<span class="tag ${tag}">${tag.replace('-', ' ')}</span>`).join('')}
                        </div>
                      </a>
                    </div>
                  `).join('')}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    
    <div class="empty-message" id="emptyMessage" style="display: none;">
      <p>No chapters match this filter</p>
    </div>
    
    <div class="footer">
      <p>Built with ❤️ using LaTeX and JavaScript</p>
      <p style="font-size: 0.9em; margin-top: 10px;">Auto-reload enabled • Last updated: ${new Date().toLocaleString()}</p>
    </div>
  </div>
  
  <script>
    // Auto-reload functionality
    (function() {
      const eventSource = new EventSource('http://localhost:${CONFIG.reloadPort}/reload-stream');
      
      eventSource.onmessage = function(event) {
        if (event.data === 'reload') {
          console.log('📝 Content updated, reloading...');
          window.location.reload();
        }
      };
      
      eventSource.onerror = function() {
        console.log('⚠️  Auto-reload server not available');
        eventSource.close();
      };
      
      console.log('🔄 Auto-reload enabled');
    })();
    
    // Chapter toggle functionality
    function toggleChapter(chapterKey) {
      const card = document.querySelector(\`[data-chapter="\${chapterKey}"]\`);
      card.classList.toggle('expanded');
    }
    
    // Filter functionality
    const filterTabs = document.querySelectorAll('.filter-tab');
    const chapterCards = document.querySelectorAll('.chapter-card');
    const emptyMessage = document.getElementById('emptyMessage');
    
    filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const filter = tab.dataset.filter;
        
        // Update active tab
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Filter chapters
        let visibleCount = 0;
        chapterCards.forEach(card => {
          if (filter === 'all') {
            card.classList.remove('hidden');
            visibleCount++;
          } else {
            const sections = card.querySelectorAll('.section-item');
            let hasMatchingSection = false;
            
            sections.forEach(section => {
              const tags = section.dataset.tags.split(',');
              if (tags.includes(filter)) {
                hasMatchingSection = true;
                section.style.display = 'block';
              } else {
                section.style.display = 'none';
              }
            });
            
            if (hasMatchingSection) {
              card.classList.remove('hidden');
              visibleCount++;
            } else {
              card.classList.add('hidden');
            }
          }
        });
        
        // Show/hide empty message
        if (visibleCount === 0) {
          emptyMessage.style.display = 'block';
        } else {
          emptyMessage.style.display = 'none';
          // Reset section visibility if showing all
          if (filter === 'all') {
            document.querySelectorAll('.section-item').forEach(s => s.style.display = 'block');
          }
        }
      });
    });
    
    // Restore expanded chapters from localStorage
    window.addEventListener('DOMContentLoaded', () => {
      const expandedChapters = JSON.parse(localStorage.getItem('expandedChapters') || '[]');
      expandedChapters.forEach(chapterKey => {
        const card = document.querySelector(\`[data-chapter="\${chapterKey}"]\`);
        if (card) {
          card.classList.add('expanded');
        }
      });
    });
    
    // Save expanded chapters to localStorage
    window.addEventListener('beforeunload', () => {
      const expandedChapters = Array.from(document.querySelectorAll('.chapter-card.expanded'))
        .map(card => card.dataset.chapter);
      localStorage.setItem('expandedChapters', JSON.stringify(expandedChapters));
    });
  </script>
</body>
</html>`;
  
  fs.writeFileSync(indexPath, html);
  console.log(`✓ Generated navigation page: ${indexPath}`);
}

async function build(options = {}) {
  if (isBuilding) {
    console.log('⏳ Build already in progress, skipping...');
    return;
  }

  isBuilding = true;
  const { targetFile, chapter, skipCompile } = options;
  
  console.log('\n' + '='.repeat(60));
  if (targetFile) {
    console.log(`📄 Building single file: ${path.basename(targetFile)}`);
  } else if (chapter) {
    console.log(`📚 Building chapter: ${chapter}`);
  } else {
    console.log(`📦 Building entire project`);
  }
  console.log('='.repeat(60));

  try {
    let auxPath;
    const currentMainHash = getFileHash(CONFIG.mainFile);
    const currentPreambleHash = getFileHash(CONFIG.preambleFile);
    
    // Determine if we need to recompile main.tex
    const needsMainCompile = (
      lastMainFileHash !== currentMainHash ||
      lastPreambleHash !== currentPreambleHash ||
      !fs.existsSync(path.join(CONFIG.buildDir, 'main.aux'))
    );
    
    if (skipCompile) {
      console.log('⚡ Skipping LaTeX compilation (fast mode)');
      auxPath = path.join(CONFIG.buildDir, 'main.aux');
      if (!fs.existsSync(auxPath)) {
        console.warn('⚠️  Aux file missing, references may not work. Run full build once.');
        auxPath = null;
      }
    } else if (needsMainCompile) {
      console.log('🔍 Changes detected in main.tex or preamble.tex - full compilation needed');
      auxPath = await compileMainFile();
      lastMainFileHash = currentMainHash;
      lastPreambleHash = currentPreambleHash;
    } else {
      console.log('⚡ No changes to main.tex or preamble.tex - using cached aux file');
      auxPath = path.join(CONFIG.buildDir, 'main.aux');
    }

    // Convert files
    if (targetFile) {
      console.log(`\n📝 Converting: ${path.relative(process.cwd(), targetFile)}`);
      await convertFileToHTML(targetFile, auxPath);
    } else {
      const texFiles = findTexFiles(chapter);
      console.log(`\n📝 Converting ${texFiles.length} .tex file(s)...`);
      
      for (const { fullPath, relativePath } of texFiles) {
        console.log(`   ${relativePath}`);
        await convertFileToHTML(fullPath, auxPath);
      }
      
      // Only regenerate index if building all or no specific target
      if (!chapter) {
        const allFiles = findTexFiles();
        await generateIndexFile(allFiles);
      }
    }

    console.log('\n✅ Build complete!');
    if (!targetFile && !chapter) {
      console.log(`   View at: file://${path.resolve(CONFIG.outputDir, 'index.html')}`);
    }
    notifyReload();
    
  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    console.error(error.stack);
  } finally {
    isBuilding = false;
  }
}

function scheduleBuild(options = {}) {
  if (buildTimer) {
    clearTimeout(buildTimer);
  }
  buildTimer = setTimeout(() => build(options), CONFIG.debounceDelay);
}

function watchDirectory(dir) {
  if (!fs.existsSync(dir)) return;
  
  const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith('.tex')) {
      const fullPath = path.join(dir, filename);
      console.log(`🔍 ${filename} changed`);
      
      // Build only the changed file (fast mode)
      scheduleBuild({ 
        targetFile: fullPath,
        skipCompile: true  // Don't recompile main.tex unless necessary
      });
    }
  });
  
  watchers.push(watcher);
  console.log(`👁️  Watching ${dir}/ recursively`);
}

function watchMainFiles() {
  [CONFIG.mainFile, CONFIG.preambleFile].forEach(file => {
    if (fs.existsSync(file)) {
      const watcher = fs.watch(file, () => {
        console.log(`🔍 ${file} changed - triggering full rebuild`);
        scheduleBuild({ skipCompile: false });
      });
      watchers.push(watcher);
      console.log(`👁️  Watching ${file}`);
    }
  });
}

function openInBrowser(htmlPath) {
  const fullPath = path.resolve(htmlPath);
  const url = `file://${fullPath}`;
  
  let cmd;
  switch (process.platform) {
    case 'darwin': cmd = `open "${url}"`; break;
    case 'win32': cmd = `start "${url}"`; break;
    default: cmd = `xdg-open "${url}"`; break;
  }
  
  exec(cmd, (error) => {
    if (error) {
      console.log(`\n📋 Open this file in your browser:\n   ${url}\n`);
    } else {
      console.log(`\n🌐 Opened in browser: ${url}\n`);
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║      LaTeX to HTML Live Preview System v2.0              ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  ensureDirectories();
  
  // Parse command line arguments
  if (args.includes('--help')) {
    console.log('Usage:');
    console.log('  node watch.js                      # Watch all files and auto-rebuild');
    console.log('  node watch.js file1.tex file2.tex  # Watch specific files only');
    console.log('  node watch.js --build-all          # Build entire project once');
    console.log('  node watch.js --build-chapter 01   # Build specific chapter');
    console.log('  node watch.js --build-file path    # Build specific file');
    console.log('  node watch.js --no-compile         # Build without LaTeX compilation');
    console.log('\nExamples:');
    console.log('  node watch.js src/05-differentiation-1/BV_on_R.tex');
    console.log('  node watch.js src/05-differentiation-1/*.tex');
    return;
  }

  const buildAll = args.includes('--build-all');
  const buildChapterIdx = args.indexOf('--build-chapter');
  const buildFileIdx = args.indexOf('--build-file');
  const noCompile = args.includes('--no-compile');

  // Check if user provided specific .tex files to watch
  const texFileArgs = args.filter(arg => 
    !arg.startsWith('--') && 
    arg.endsWith('.tex') && 
    fs.existsSync(arg)
  );

  if (buildAll) {
    await build({ skipCompile: noCompile });
    process.exit(0);
  } else if (buildChapterIdx !== -1 && args[buildChapterIdx + 1]) {
    const chapterNum = args[buildChapterIdx + 1].padStart(2, '0');
    const chapterFolder = Object.keys(CHAPTERS_METADATA).find(k => k.startsWith(chapterNum));
    if (chapterFolder) {
      await build({ chapter: chapterFolder, skipCompile: noCompile });
    } else {
      console.error(`❌ Chapter ${chapterNum} not found`);
    }
    process.exit(0);
  } else if (buildFileIdx !== -1 && args[buildFileIdx + 1]) {
    const targetFile = args[buildFileIdx + 1];
    await build({ targetFile, skipCompile: noCompile });
    process.exit(0);
  }

  // Watch mode (default or with specific files)
  reloadServer.listen(CONFIG.reloadPort, () => {
    console.log(`🔄 Auto-reload server listening on port ${CONFIG.reloadPort}\n`);
  });

  // Initial build
  if (texFileArgs.length > 0) {
    // Build only specified files initially
    console.log(`📝 Building ${texFileArgs.length} specified file(s)...\n`);
    const auxPath = path.join(CONFIG.buildDir, 'main.aux');
    
    if (!fs.existsSync(auxPath)) {
      console.log('⚠️  No aux file found. Running full build first...');
      await build();
    } else {
      for (const file of texFileArgs) {
        await convertFileToHTML(file, auxPath);
      }
      notifyReload();
    }
  } else {
    // Build everything
    await build();
  }
  
  // Watch directories or specific files
  if (texFileArgs.length > 0) {
    // Watch only specified files
    console.log(`\n👁️  Watching ${texFileArgs.length} specific file(s):\n`);
    texFileArgs.forEach(file => {
      console.log(`   - ${file}`);
      const watcher = fs.watch(file, (eventType) => {
        if (eventType === 'change') {
          console.log(`🔍 ${path.basename(file)} changed`);
          scheduleBuild({ targetFile: file, skipCompile: true });
        }
      });
      watchers.push(watcher);
    });
    
    // Also watch main.tex and preamble.tex for full rebuilds
    watchMainFiles();
    
    // Open the first file's HTML
    const firstFileHtml = texFileArgs[0]
      .replace(CONFIG.srcDir, CONFIG.outputDir)
      .replace('.tex', '.html');
    if (fs.existsSync(firstFileHtml)) {
      openInBrowser(firstFileHtml);
    }
    
    console.log('\n💡 Watching only specified files (main.tex/preamble.tex also watched)');
  } else {
    // Watch all files
    watchDirectory(CONFIG.srcDir);
    watchMainFiles();
    
    // Open navigation page
    const navPath = path.join(CONFIG.outputDir, 'index.html');
    if (fs.existsSync(navPath)) {
      openInBrowser(navPath);
    }
    
    console.log('\n💡 Tip: Only changed files will be rebuilt for fast updates!');
  }

  console.log('\n👀 Watching for changes... (Press Ctrl+C to stop)\n');

  process.on('SIGINT', () => {
    console.log('\n\n👋 Stopping watchers...');
    watchers.forEach(w => w.close());
    reloadServer.close();
    console.log('✓ Done!\n');
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { build, compileMainFile, convertFileToHTML };