#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Generate stable ID from content
function generateStableId(content, prefix) {
  const hash = crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
  return `${prefix}-${hash}`;
}

function parseAuxFile(auxPath) {
  if (!auxPath || !fs.existsSync(auxPath)) {
    console.warn(`⚠️  Aux file not found: ${auxPath}`);
    return { labels: {} };
  }
  
  const labels = {};
  const auxDir = path.dirname(auxPath);
  
  const content = fs.readFileSync(auxPath, 'utf-8');
  
  const labelRegex = /\\newlabel\{([^}]+)\}\{\{([^}]*)\}\{([^}]*)\}(?:\{([^}]*)\}\{([^}]*)\})?/g;
  let match;
  while ((match = labelRegex.exec(content)) !== null) {
    const [, label, number, page, title, anchor] = match;
    labels[label] = { number, page, title: title || '', anchor: anchor || label };
  }
  
  const inputRegex = /\\@input\{([^}]+)\}/g;
  while ((match = inputRegex.exec(content)) !== null) {
    const chapterAuxFile = match[1];
    const chapterAuxPath = path.join(auxDir, chapterAuxFile);
    
    if (fs.existsSync(chapterAuxPath)) {
      const chapterContent = fs.readFileSync(chapterAuxPath, 'utf-8');
      let chapterMatch;
      while ((chapterMatch = labelRegex.exec(chapterContent)) !== null) {
        const [, label, number, page, title, anchor] = chapterMatch;
        labels[label] = { number, page, title: title || '', anchor: anchor || label };
      }
    }
  }
  
  console.log(`✓ Loaded ${Object.keys(labels).length} labels from aux file(s)`);
  const labelNames = Object.keys(labels).slice(0, 3);
  if (labelNames.length > 0) {
    console.log(`   Sample labels: ${labelNames.join(', ')}`);
  }
  return { labels };
}

function extractTheorems(text, auxData) {
  const theorems = [];
  const theoremTypes = ['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'example', 'remark', 'conjecture', 'claim', 'fact', 'notation', 'axiom', 'construction', 'exercise', 'problem'];
  const theoremRegex = new RegExp(`\\\\begin\\{(${theoremTypes.join('|')})\\}(?:\\[([^\\]]+)\\])?([\\s\\S]*?)\\\\end\\{\\1\\}`, 'g');
  let match;
  let typeCounts = {};
  
  while ((match = theoremRegex.exec(text)) !== null) {
    const [fullMatch, envName, optionalTitle, content] = match;
    const labelMatch = content.match(/\\label\{([^}]+)\}/);
    const label = labelMatch ? labelMatch[1] : null;
    let number = '?';
    if (label && auxData.labels[label]) {
      number = auxData.labels[label].number;
    }
    
    let cleanContent = content.replace(/\\label\{[^}]+\}/, '').trim();
    cleanContent = convertListsInContent(cleanContent);
    cleanContent = processFiguresInContent(cleanContent);
    
    if (!typeCounts[envName]) {
      typeCounts[envName] = 0;
    }
    typeCounts[envName]++;
    
    theorems.push({ 
      type: 'theorem', 
      envName, 
      number, 
      label, 
      title: optionalTitle || null, 
      content: cleanContent, 
      fullMatch, 
      startIndex: match.index,
      typeCount: typeCounts[envName]
    });
  }
  return theorems;
}

function convertListsInContent(content) {
  content = content.replace(/\\begin\{enumerate\}(?:\[([^\]]+)\])?([\s\S]*?)\\end\{enumerate\}/g, (match, optType, enumContent) => {
    let listContent = enumContent.trim();
    
    listContent = listContent.replace(/\\setcounter\{enumi+\}\{[^}]+\}/g, '');
    listContent = listContent.replace(/\\stepcounter\{enumi+\}/g, '');
    listContent = listContent.replace(/\\addtocounter\{enumi+\}\{[^}]+\}/g, '');
    
    listContent = listContent.replace(/\\item\s*/g, '</li><li>');
    listContent = listContent.replace(/^<\/li>/, '');
    if (!listContent.endsWith('</li>')) {
      listContent += '</li>';
    }
    
    let typeAttr = '';
    let startAttr = '';
    
    const setcounterMatch = match.match(/\\setcounter\{enumi\}\{(\d+)\}/);
    if (setcounterMatch) {
      const startNum = parseInt(setcounterMatch[1]) + 1;
      startAttr = ` start="${startNum}"`;
    }
    
    if (optType) {
      if (optType.includes('(a)')) {
        typeAttr = ' style="list-style-type: lower-alpha;"';
      } else if (optType.includes('(i)')) {
        typeAttr = ' style="list-style-type: lower-roman;"';
      } else if (optType.includes('(A)')) {
        typeAttr = ' style="list-style-type: upper-alpha;"';
      } else if (optType.includes('(I)')) {
        typeAttr = ' style="list-style-type: upper-roman;"';
      }
    }
    
    return `<ol${typeAttr}${startAttr}>${listContent}</ol>`;
  });
  
  content = content.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (match, itemContent) => {
    let listContent = itemContent.trim();
    listContent = listContent.replace(/\\item\s*/g, '</li><li>');
    listContent = listContent.replace(/^<\/li>/, '');
    if (!listContent.endsWith('</li>')) {
      listContent += '</li>';
    }
    return `<ul>${listContent}</ul>`;
  });
  
  return content;
}

function extractProofs(text) {
  const proofs = [];
  let pos = 0;
  const usedIds = new Set();
  let proofCounter = 0;
  
  while (pos < text.length) {
    const startMatch = text.substring(pos).match(/\\begin\{proof\}(?:\[([^\]]+)\])?/);
    if (!startMatch) break;
    
    const startPos = pos + startMatch.index;
    const optionalTitle = startMatch[1];
    let depth = 1;
    let searchPos = startPos + startMatch[0].length;
    
    while (depth > 0 && searchPos < text.length) {
      const nextBegin = text.substring(searchPos).search(/\\begin\{proof\}/);
      const nextEnd = text.substring(searchPos).search(/\\end\{proof\}/);
      
      if (nextEnd === -1) {
        break;
      }
      
      if (nextBegin !== -1 && nextBegin < nextEnd) {
        depth++;
        searchPos += nextBegin + '\\begin{proof}'.length;
      } else {
        depth--;
        if (depth === 0) {
          const endPos = searchPos + nextEnd;
          const fullMatch = text.substring(startPos, endPos + '\\end{proof}'.length);
          const content = text.substring(startPos + startMatch[0].length, endPos);
          
          let cleanContent = convertListsInContent(content.trim());
          cleanContent = processFiguresInContent(cleanContent);
          cleanContent = processNestedProofs(cleanContent);
          
          const textBefore = text.substring(0, startPos);
          const labelMatch = textBefore.match(/\\label\{([^}]+)\}(?![\s\S]*\\end\{(?:theorem|lemma|proposition|corollary|definition|example|remark|exercise|problem)\})/);
          
          let stableId;
          if (labelMatch) {
            const baseId = `proof-for-${labelMatch[1]}`;
            stableId = baseId;
            let counter = 1;
            while (usedIds.has(stableId)) {
              stableId = `${baseId}-${counter}`;
              counter++;
            }
          } else if (optionalTitle) {
            const sanitized = optionalTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            stableId = `proof-${sanitized}`;
            let counter = 1;
            while (usedIds.has(stableId)) {
              stableId = `proof-${sanitized}-${counter}`;
              counter++;
            }
          } else {
            stableId = `proof-num-${proofCounter}`;
          }
          
          usedIds.add(stableId);
          
          proofs.push({ 
            type: 'proof', 
            title: optionalTitle || 'Proof', 
            content: cleanContent, 
            fullMatch, 
            startIndex: startPos,
            proofNumber: proofCounter++,
            stableId: stableId
          });
          
          pos = endPos + '\\end{proof}'.length;
          break;
        } else {
          searchPos += nextEnd + '\\end{proof}'.length;
        }
      }
    }
    
    if (depth > 0) {
      pos = startPos + startMatch[0].length;
    }
  }
  
  return proofs;
}

function processNestedProofs(content) {
  let subproofCounter = 0;
  return content.replace(/\\begin\{proof\}(?:\[([^\]]+)\])?([\s\S]*?)\\end\{proof\}/g, (match, title, proofContent) => {
    const cleanContent = convertListsInContent(proofContent.trim());
    const subproofId = `subproof-${Date.now()}-${subproofCounter++}`;
    return `<div class="subproof collapsed" data-subproof-id="${subproofId}">
      <div class="subproof-header">
        <button class="subproof-toggle" onclick="toggleSubproof('${subproofId}')" aria-expanded="false">
          <span class="subproof-toggle-icon">▼</span>
          <strong>${title || 'Proof'}</strong>
        </button>
      </div>
      <div class="subproof-content" id="${subproofId}">
        ${cleanContent}
        <span class="proof-end">□</span>
      </div>
    </div>`;
  });
}

function processFiguresInContent(content) {
  return content.replace(/\\begin\{figure\}\s*([\s\S]*?)\\end\{figure\}/g, (match, figContent) => {
    const captionMatch = figContent.match(/\\caption\{([^}]+)\}/);
    const caption = captionMatch ? captionMatch[1] : '';
    
    const labelMatch = figContent.match(/\\label\{([^}]+)\}/);
    const label = labelMatch ? labelMatch[1] : '';
    
    figContent = figContent.replace(/\\caption\{[^}]+\}/g, '');
    figContent = figContent.replace(/\\label\{[^}]+\}/g, '');
    figContent = figContent.replace(/\\centering/g, '');
    
    figContent = figContent.replace(/\\begin\{minipage\}\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}([\s\\S]*?)\\end\{minipage\}/g, (match, width, content) => {
      let widthStyle = '';
      const widthMatch = width.match(/([\d.]+)\\textwidth/);
      if (widthMatch) {
        const widthPercent = parseFloat(widthMatch[1]) * 100;
        widthStyle = `width: ${widthPercent}%;`;
      } else {
        widthStyle = `width: ${width};`;
      }
      content = content.replace(/\\centering/g, '');
      return `<div class="minipage" style="${widthStyle} display: inline-block; vertical-align: top;">${content}</div>`;
    });
    
    figContent = figContent.replace(/\\hfill/g, '<span style="display: inline-block; width: 1em;"></span>');
    figContent = figContent.replace(/\\hspace\*?\{([^}]+)\}/g, (match, size) => {
      const sizeMatch = size.match(/([\d.]+)(cm|mm|em|ex|pt|px)/);
      if (sizeMatch) {
        const value = parseFloat(sizeMatch[1]);
        const unit = sizeMatch[2];
        return `<span style="display: inline-block; width: ${value}${unit};"></span>`;
      }
      return '<span style="display: inline-block; width: 1em;"></span>';
    });
    
    let processedContent = figContent.replace(/\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g, (match, options, filename) => {
      let cleanFilename = filename.trim();
      let styleAttr = '';
      
      if (options) {
        const widthMatch = options.match(/width\s*=\s*([\d.]+)\\textwidth/);
        if (widthMatch) {
          const widthPercent = parseFloat(widthMatch[1]) * 100;
          styleAttr += `width: ${widthPercent}%;`;
        }
        
        const absWidthMatch = options.match(/width\s*=\s*([\d.]+)(cm|mm|in|pt|px)/);
        if (absWidthMatch && !widthMatch) {
          const value = parseFloat(absWidthMatch[1]);
          const unit = absWidthMatch[2];
          let pixels = value;
          if (unit === 'cm') pixels = value * 37.8;
          else if (unit === 'mm') pixels = value * 3.78;
          else if (unit === 'in') pixels = value * 96;
          else if (unit === 'pt') pixels = value * 1.33;
          styleAttr += `width: ${pixels}px;`;
        }
        
        const heightMatch = options.match(/height\s*=\s*([\d.]+)\\textheight/);
        if (heightMatch) {
          const heightPercent = parseFloat(heightMatch[1]) * 100;
          styleAttr += `height: ${heightPercent}vh;`;
        }
        
        const scaleMatch = options.match(/scale\s*=\s*([\d.]+)/);
        if (scaleMatch) {
          const scalePercent = parseFloat(scaleMatch[1]) * 100;
          styleAttr += `width: ${scalePercent}%;`;
        }
      }
      
      if (!cleanFilename.match(/\.(png|jpg|jpeg|gif|svg|pdf)$/i)) {
        cleanFilename += '.png';
      }
      
      if (cleanFilename.match(/\.pdf$/i)) {
        cleanFilename = cleanFilename.replace(/\.pdf$/i, '.png');
      }
      
      const styleString = styleAttr ? ` style="${styleAttr}"` : '';
      return `<img src="${cleanFilename}" alt="${caption || 'Figure'}" class="latex-image"${styleString}>`;
    });
    
    let figHtml = '\n<figure class="latex-figure"';
    if (label) {
      figHtml += ` id="${label}"`;
    }
    figHtml += '>\n';
    figHtml += `  <div class="figure-content">${processedContent.trim()}</div>\n`;
    if (caption) {
      figHtml += `  <figcaption>${caption}</figcaption>\n`;
    }
    figHtml += '</figure>\n';
    
    return figHtml;
  });
}

function extractSections(text) {
  const sections = [];
  const sectionRegex = /\\(section|subsection|subsubsection)\*?\{([^}]+)\}/g;
  let match;
  while ((match = sectionRegex.exec(text)) !== null) {
    const [fullMatch, level, title] = match;
    sections.push({ type: 'section', level, title, fullMatch, startIndex: match.index });
  }
  return sections;
}

function extractFigures(text) {
  const figures = [];
  const figureRegex = /\\begin\{figure\}(?:\s*\[[^\]]*\])?([\s\S]*?)\\end\{figure\}/g;
  let match;
  while ((match = figureRegex.exec(text)) !== null) {
    const [fullMatch, content] = match;
    figures.push({ type: 'figure', content: content.trim(), fullMatch, startIndex: match.index });
    console.log(`   Extracted figure at position ${match.index}, length ${fullMatch.length}`);
  }
  return figures;
}

function extractEnumerates(text) {
  const enumerates = [];
  const enumRegex = /\\begin\{enumerate\}(?:\[([^\]]+)\])?([\s\S]*?)\\end\{enumerate\}/g;
  let match;
  while ((match = enumRegex.exec(text)) !== null) {
    const [fullMatch, optionalType, content] = match;
    enumerates.push({ type: 'enumerate', listType: optionalType || null, content: content.trim(), fullMatch, startIndex: match.index });
  }
  return enumerates;
}

function extractItemizes(text) {
  const itemizes = [];
  const itemizeRegex = /\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g;
  let match;
  while ((match = itemizeRegex.exec(text)) !== null) {
    const [fullMatch, content] = match;
    itemizes.push({ type: 'itemize', content: content.trim(), fullMatch, startIndex: match.index });
  }
  return itemizes;
}

function processImages(html) {
  let imageCount = 0;
  
  html = html.replace(/\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, (match, filename) => {
    imageCount++;
    let cleanFilename = filename.trim();
    
    console.log(`   Found standalone image: ${cleanFilename}`);
    
    if (!cleanFilename.match(/\.(png|jpg|jpeg|gif|svg|pdf)$/i)) {
      cleanFilename += '.png';
      console.log(`   → Added .png extension: ${cleanFilename}`);
    }
    
    if (cleanFilename.match(/\.pdf$/i)) {
      cleanFilename = cleanFilename.replace(/\.pdf$/i, '.png');
      console.log(`   → Converted .pdf to .png: ${cleanFilename}`);
    }
    
    return `<img src="${cleanFilename}" alt="Figure" class="latex-image" onerror="console.error('Failed to load image: ${cleanFilename}'); this.style.border='2px solid red';">`;
  });
  
  if (imageCount > 0) {
    console.log(`✓ Processed ${imageCount} standalone image(s)`);
  }
  
  return html;
}

function processReferences(text, auxData) {
  const refRegex = /\\(?:ref|eqref|cref|Cref)\{([^}]+)\}/g;
  let count = 0;
  const result = text.replace(refRegex, (match, label) => {
    count++;
    const labelData = auxData.labels[label];
    if (!labelData) {
      console.warn(`⚠️  Reference not found: ${label}`);
      return `<span class="ref-unknown" title="Reference not found: ${label}">[${label}?]</span>`;
    }
    const number = labelData.number;
    const anchor = labelData.anchor || label;
    return `<a href="#${anchor}" class="ref-link">${number}</a>`;
  });
  
  if (count > 0) {
    console.log(`✓ Processed ${count} references`);
  }
  return result;
}

function convertLaTeXToHTML(texPath, auxPath, outputPath, options = {}) {
  console.log(`\n🔄 Converting ${path.basename(texPath)}...`);
  console.log(`   Using aux file: ${auxPath || 'NONE'}`);
  
  const imageBasePath = options.imageBasePath || '';
  
  let texContent = fs.readFileSync(texPath, 'utf-8');
  const auxData = parseAuxFile(auxPath);
  
  console.log(`   Labels available: ${Object.keys(auxData.labels).length}`);
  
  texContent = texContent.replace(/\\documentclass[\s\S]*?\\begin\{document\}/, '');
  texContent = texContent.replace(/\\end\{document\}[\s\S]*$/, '');
  
  const figures = extractFigures(texContent);
  console.log(`   Found ${figures.length} figure(s)`);
  
  const theorems = extractTheorems(texContent, auxData);
  const proofs = extractProofs(texContent);
  const sections = extractSections(texContent);
  
  let maskedText = texContent;
  const allBoxes = [...theorems, ...proofs].sort((a, b) => a.startIndex - b.startIndex);
  
  for (let i = allBoxes.length - 1; i >= 0; i--) {
    const box = allBoxes[i];
    maskedText = maskedText.substring(0, box.startIndex) + 
                 ' '.repeat(box.fullMatch.length) + 
                 maskedText.substring(box.startIndex + box.fullMatch.length);
  }
  
  const enumerates = extractEnumerates(maskedText);
  const itemizes = extractItemizes(maskedText);
  
  const allElements = [...theorems, ...proofs, ...sections, ...figures, ...enumerates, ...itemizes].sort((a, b) => a.startIndex - b.startIndex);
  
  console.log(`\n📊 Processing order:`);
  allElements.forEach((el, i) => {
    console.log(`   ${i}: ${el.type} at position ${el.startIndex}, length ${el.fullMatch.length}`);
  });
  
  let html = texContent;
  let offset = 0;
  for (const element of allElements) {
    const index = element.startIndex + offset;
    
    const textAtPosition = html.substring(index, index + element.fullMatch.length);
    
    if (textAtPosition !== element.fullMatch) {
      console.error(`❌ MISMATCH at position ${index}!`);
      console.error(`   Expected: "${element.fullMatch.substring(0, 50)}..."`);
      console.error(`   Found:    "${textAtPosition.substring(0, 50)}..."`);
      console.error(`   This element will be skipped!`);
      continue;
    }
    
    const before = html.substring(0, index);
    const after = html.substring(index + element.fullMatch.length);
    
    const snippet = element.fullMatch.substring(0, 50).replace(/\n/g, '↵');
    console.log(`\n   Replacing at ${index}: "${snippet}..."`);
    
    let replacement = '';
    if (element.type === 'theorem') {
      replacement = generateTheoremHTML(element);
    } else if (element.type === 'proof') {
      replacement = generateProofHTML(element);
    } else if (element.type === 'section') {
      replacement = generateSectionHTML(element);
    } else if (element.type === 'figure') {
      replacement = generateFigureHTML(element, imageBasePath);
    } else if (element.type === 'enumerate') {
      replacement = generateEnumerateHTML(element);
    } else if (element.type === 'itemize') {
      replacement = generateItemizeHTML(element);
    }
    
    console.log(`   → Replaced with ${replacement.length} chars (was ${element.fullMatch.length})`);
    
    html = before + replacement + after;
    offset += replacement.length - element.fullMatch.length;
    
    console.log(`   → New offset: ${offset}`);
  }
  
  html = html.replace(/(\\begin\{(?:align|equation|gather)[*]?\}[\s\S]*?\\end\{(?:align|equation|gather)[*]?\})/g, (mathBlock) => {
    return mathBlock.replace(/\\(?:ref|eqref|cref|Cref)\{([^}]+)\}/g, (match, label) => {
      const labelData = auxData.labels[label];
      if (!labelData) {
        console.warn(`⚠️  Reference in math not found: ${label}`);
        return `[${label}?]`;
      }
      return labelData.number;
    });
  });
  
  html = processReferences(html, auxData);
  
  html = html.replace(/<figure[\s\S]*?<\/figure>/g, (match) => {
    return '\n\n' + match + '\n\n';
  });
  
  html = html.split(/\n\s*\n/).map(para => para.trim()).filter(para => para.length > 0).map(para => {
    if (para.match(/^<(figure|h\d|div|ol|ul)/)) {
      return para;
    }
    return `<p>${para}</p>`;
  }).join('\n');
  
  html = html.replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, '<div style="text-align: center;">$1</div>');
  
  html = html.replace(/\\vspace\*?\{[^}]+\}/g, '<div style="margin: 1em 0;"></div>');
  html = html.replace(/\\hspace\{[^}]+\}/g, '');
  html = html.replace(/\\noindent\s*/g, '<span class="noindent"></span>');
  html = html.replace(/\\medskip/g, '<br>');
  html = html.replace(/\\bigskip/g, '<br><br>');
  html = html.replace(/\\newpage/g, '');
  html = html.replace(/\\clearpage/g, '');
  html = html.replace(/\\pagebreak/g, '');
  
  // Handle umlauts
  html = html.replace(/\\"o/g, 'ö');
  html = html.replace(/\\"O/g, 'Ö');
  html = html.replace(/\\"a/g, 'ä');
  html = html.replace(/\\"A/g, 'Ä');
  html = html.replace(/\\"u/g, 'ü');
  html = html.replace(/\\"U/g, 'Ü');
  html = html.replace(/\\"i/g, 'ï');
  html = html.replace(/\\"I/g, 'Ï');
  html = html.replace(/\\"e/g, 'ë');
  html = html.replace(/\\"E/g, 'Ë');
  html = html.replace(/\\"\{o\}/g, 'ö');
  html = html.replace(/\\"\{O\}/g, 'Ö');
  html = html.replace(/\\"\{a\}/g, 'ä');
  html = html.replace(/\\"\{A\}/g, 'Ä');
  html = html.replace(/\\"\{u\}/g, 'ü');
  html = html.replace(/\\"\{U\}/g, 'Ü');
  html = html.replace(/\\"\{i\}/g, 'ï');
  html = html.replace(/\\"\{I\}/g, 'Ï');
  html = html.replace(/\\"\{e\}/g, 'ë');
  html = html.replace(/\\"\{E\}/g, 'Ë');
  
  html = html.replace(/\\emph\{([^}]+)\}/g, '<em>$1</em>');
  html = html.replace(/\\textbf\{([^}]+)\}/g, '<strong>$1</strong>');
  html = html.replace(/\\textit\{([^}]+)\}/g, '<em>$1</em>');
  html = html.replace(/\\texttt\{([^}]+)\}/g, '<code>$1</code>');
  
  html = html.replace(/\\sub\b/g, '\\sub');
  
  const fullHTML = generateHTMLDocument(html, path.basename(texPath, '.tex'), outputPath);
  fs.writeFileSync(outputPath, fullHTML, 'utf-8');
  console.log(`✓ Generated ${path.basename(outputPath)}`);
}

function generateTheoremHTML(element) {
  const envClass = element.envName;
  const envLabel = element.envName.charAt(0).toUpperCase() + element.envName.slice(1);
  const anchor = element.label || `${element.envName}-${element.number}`;
  let header = `<strong>${envLabel} ${element.number}</strong>`;
  if (element.title) {
    header += ` (${element.title})`;
  }
  if (element.envName === 'remark' || element.envName === 'example') {
    let collapsibleId;
    if (element.label) {
      collapsibleId = `collapsible-${element.label}`;
    } else if (element.title) {
      const sanitized = element.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      collapsibleId = `collapsible-${element.envName}-${sanitized}`;
    } else {
      collapsibleId = `collapsible-${element.envName}-${element.typeCount}`;
    }
    
    return `\n<div class="theorem-box ${envClass}-box collapsible-box collapsed" id="${anchor}" data-collapsible-id="${collapsibleId}">\n  <div class="theorem-header clickable" onclick="toggleCollapsible('${collapsibleId}')">\n    <span class="collapsible-icon">▼</span>\n    ${header}\n  </div>\n  <div class="theorem-content collapsible-content" id="${collapsibleId}">${element.content}</div>\n</div>\n`;
  }
  return `\n<div class="theorem-box ${envClass}-box" id="${anchor}">\n  <div class="theorem-header">${header}</div>\n  <div class="theorem-content">${element.content}</div>\n</div>\n`;
}

function generateProofHTML(element) {
  const proofId = element.stableId;
  return `\n<div class="proof-box collapsed" data-proof-id="${proofId}">\n  <div class="proof-header">\n    <button class="proof-toggle" onclick="toggleProof('${proofId}')" aria-expanded="false">\n      <span class="proof-toggle-icon">▼</span>\n      <strong>${element.title}</strong>\n    </button>\n  </div>\n  <div class="proof-content" id="${proofId}">\n    ${element.content}\n    <span class="proof-end">□</span>\n  </div>\n</div>\n`;
}

function generateSectionHTML(element) {
  const levelMap = { 'section': 'h2', 'subsection': 'h3', 'subsubsection': 'h4' };
  const tag = levelMap[element.level] || 'h2';
  return `<${tag}>${element.title}</${tag}>`;
}

function generateFigureHTML(element, imageBasePath = '') {
  let figContent = element.content;
  
  const captionMatch = figContent.match(/\\caption\{([^}]+)\}/);
  const caption = captionMatch ? captionMatch[1] : '';
  
  const labelMatch = figContent.match(/\\label\{([^}]+)\}/);
  const label = labelMatch ? labelMatch[1] : '';
  
  figContent = figContent.replace(/\\caption\{[^}]+\}/g, '');
  figContent = figContent.replace(/\\label\{[^}]+\}/g, '');
  figContent = figContent.replace(/\\centering/g, '');
  
  figContent = figContent.replace(/\\begin\{minipage\}\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}([\s\\S]*?)\\end\{minipage\}/g, (match, width, content) => {
    let widthStyle = '';
    const widthMatch = width.match(/([\d.]+)\\textwidth/);
    if (widthMatch) {
      const widthPercent = parseFloat(widthMatch[1]) * 100;
      widthStyle = `width: ${widthPercent}%;`;
    } else {
      widthStyle = `width: ${width};`;
    }
    
    content = content.replace(/\\centering/g, '');
    
    return `<div class="minipage" style="${widthStyle} display: inline-block; vertical-align: top;">${content}</div>`;
  });
  
  figContent = figContent.replace(/\\hfill/g, '<span style="display: inline-block; width: 1em;"></span>');
  
  figContent = figContent.replace(/\\hspace\*?\{([^}]+)\}/g, (match, size) => {
    const sizeMatch = size.match(/([\d.]+)(cm|mm|em|ex|pt|px)/);
    if (sizeMatch) {
      const value = parseFloat(sizeMatch[1]);
      const unit = sizeMatch[2];
      return `<span style="display: inline-block; width: ${value}${unit};"></span>`;
    }
    return '<span style="display: inline-block; width: 1em;"></span>';
  });
  
  let processedContent = figContent.replace(/\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g, (match, options, filename) => {
    let cleanFilename = filename.trim();
    
    console.log(`   Found image in figure: ${cleanFilename}`);
    
    let styleAttr = '';
    if (options) {
      console.log(`   Image options: ${options}`);
      
      const widthMatch = options.match(/width\s*=\s*([\d.]+)\\textwidth/);
      if (widthMatch) {
        const widthPercent = parseFloat(widthMatch[1]) * 100;
        styleAttr += `width: ${widthPercent}%;`;
        console.log(`   → Width: ${widthPercent}%`);
      }
      
      const absWidthMatch = options.match(/width\s*=\s*([\d.]+)(cm|mm|in|pt|px)/);
      if (absWidthMatch && !widthMatch) {
        const value = parseFloat(absWidthMatch[1]);
        const unit = absWidthMatch[2];
        let pixels = value;
        if (unit === 'cm') pixels = value * 37.8;
        else if (unit === 'mm') pixels = value * 3.78;
        else if (unit === 'in') pixels = value * 96;
        else if (unit === 'pt') pixels = value * 1.33;
        styleAttr += `width: ${pixels}px;`;
        console.log(`   → Width: ${pixels}px`);
      }
      
      const heightMatch = options.match(/height\s*=\s*([\d.]+)\\textheight/);
      if (heightMatch) {
        const heightPercent = parseFloat(heightMatch[1]) * 100;
        styleAttr += `height: ${heightPercent}vh;`;
        console.log(`   → Height: ${heightPercent}vh`);
      }
      
      const scaleMatch = options.match(/scale\s*=\s*([\d.]+)/);
      if (scaleMatch) {
        const scalePercent = parseFloat(scaleMatch[1]) * 100;
        styleAttr += `width: ${scalePercent}%;`;
        console.log(`   → Scale: ${scalePercent}%`);
      }
    }
    
    if (!cleanFilename.match(/\.(png|jpg|jpeg|gif|svg|pdf)$/i)) {
      cleanFilename += '.png';
      console.log(`   → Added .png extension: ${cleanFilename}`);
    }
    
    if (cleanFilename.match(/\.pdf$/i)) {
      cleanFilename = cleanFilename.replace(/\.pdf$/i, '.png');
      console.log(`   → Converted .pdf to .png: ${cleanFilename}`);
    }
    
    if (imageBasePath && !cleanFilename.startsWith('/') && !cleanFilename.match(/^[a-z]+:/i)) {
      cleanFilename = path.posix.join(imageBasePath, cleanFilename);
      console.log(`   → Full path: ${cleanFilename}`);
    }
    
    const styleString = styleAttr ? ` style="${styleAttr}"` : '';
    return `<img src="${cleanFilename}" alt="${caption || 'Figure'}" class="latex-image"${styleString} onerror="this.style.border='3px solid red'; this.style.padding='20px'; this.style.background='#fee'; this.alt='Image not found: ${cleanFilename}'; console.error('Failed to load: ${cleanFilename}');">`;
  });
  
  let figHtml = '\n<figure class="latex-figure"';
  if (label) {
    figHtml += ` id="${label}"`;
  }
  figHtml += '>\n';
  figHtml += `  <div class="figure-content">${processedContent.trim()}</div>\n`;
  if (caption) {
    figHtml += `  <figcaption>${caption}</figcaption>\n`;
  }
  figHtml += '</figure>\n';
  
  return figHtml;
}

function generateEnumerateHTML(element) {
  let content = element.content;
  content = content.replace(/\\item\s*/g, '</li><li>');
  content = content.replace(/^<\/li>/, '');
  if (!content.endsWith('</li>')) {
    content += '</li>';
  }
  let listTag = 'ol';
  let typeAttr = '';
  if (element.listType) {
    if (element.listType.includes('(a)')) {
      typeAttr = ' style="list-style-type: lower-alpha;"';
    } else if (element.listType.includes('(i)')) {
      typeAttr = ' style="list-style-type: lower-roman;"';
    } else if (element.listType.includes('(A)')) {
      typeAttr = ' style="list-style-type: upper-alpha;"';
    } else if (element.listType.includes('(I)')) {
      typeAttr = ' style="list-style-type: upper-roman;"';
    }
  }
  return `<${listTag}${typeAttr}>${content}</${listTag}>`;
}

function generateItemizeHTML(element) {
  let content = element.content;
  content = content.replace(/\\item\s*/g, '</li><li>');
  content = content.replace(/^<\/li>/, '');
  if (!content.endsWith('</li>')) {
    content += '</li>';
  }
  return `<ul>${content}</ul>`;
}

// Helper to determine path depth for correct relative links
function getPathDepth(outputPath) {
  // Count how many directories deep we are from html_preview root
  const parts = outputPath.split(path.sep);
  // Find html_preview in path
  const htmlPreviewIndex = parts.indexOf('html_preview');
  if (htmlPreviewIndex === -1) return 1;
  // Count directories after html_preview (excluding filename)
  return parts.length - htmlPreviewIndex - 2;
}

function generateHTMLDocument(bodyContent, title, outputPath) {
  // Calculate relative path prefix based on output location
  const depth = outputPath ? getPathDepth(outputPath) : 1;
  const pathPrefix = '../'.repeat(depth);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script>
  window.MathJax = {
    tex: {
      inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
      displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']],
      processEscapes: true,
      processEnvironments: true,
      tags: 'ams',
      tagSide: 'right',
      tagIndent: '0.8em',
      packages: {'[+]': ['ams']},
      macros: {
        R: '\\\\mathbb{R}',
        C: '\\\\mathbb{C}',
        N: '\\\\mathbb{N}',
        Z: '\\\\mathbb{Z}',
        Q: '\\\\mathbb{Q}',
        E: '\\\\mathbb{E}',
        F: '\\\\mathbb{F}',
        S: '\\\\mathbb{S}',
        H: '\\\\mathcal{H}',
        L: '\\\\mathcal{L}',
        dif: '\\\\,\\\\mathrm{d}',
        supp: '\\\\operatorname{supp}',
        proj: '\\\\operatorname{proj}',
        Id: '\\\\operatorname{Id}',
        Span: '\\\\operatorname{span}',
        graph: '\\\\operatorname{graph}',
        dist: '\\\\operatorname{dist}',
        diam: '\\\\operatorname{diam}',
        avg: '\\\\operatorname{avg}',
        div: '\\\\operatorname{div}',
        vol: '\\\\operatorname{vol}',
        ord: '\\\\operatorname{ord}',
        Chi: '\\\\mathbf{1}',
        sub: '\\\\subseteq',
        mres: '\\\\downharpoonright',
        ddag: '\\\\ddagger',
        dag: '\\\\dagger',
        norm: ['\\\\left\\\\| #1 \\\\right\\\\|', 1],
        abs: ['\\\\left| #1 \\\\right|', 1],
        set: ['\\\\left\\\\{ #1 \\\\right\\\\}', 1],
        inner: ['\\\\langle #1, #2 \\\\rangle', 2],
        floor: ['\\\\lfloor #1 \\\\rfloor', 1],
        ceil: ['\\\\lceil #1 \\\\rceil', 1],
        llbracket: '\\\\unicode{x27E6}',
        rrbracket: '\\\\unicode{x27E7}',
        bigskull: '\\\\unicode{x1F480}',
        skull: '\\\\unicode{x2620}',
        mathwitch: '\\\\unicode{x1F9D9}',
        pumpkin: '\\\\unicode{x1F383}',
        mathpumpkin: '\\\\unicode{x1F383}',
        bigpumpkin: '\\\\unicode{x1F383}',
        mathghost: '\\\\unicode{x1F47B}',
        mathcat: '\\\\unicode{x1F408}',
        mathbat: '\\\\unicode{x1F987}',
        esssup: '\\\\operatorname{ess\\\\,sup}',
        essinf: '\\\\operatorname{ess\\\\,inf}',
        Lip: '\\\\operatorname{Lip}',
        pd: ['\\\\frac{\\\\partial#1}{\\\\partial#2}', 2],
        od: ['\\\\frac{\\\\mathrm{d}#1}{\\\\mathrm{d}#2}', 2],
        dashint: '\\\\mathchoice{\\\\rlap{-}\\\\!\\\\int}{\\\\rlap{\\\\raise.15ex\\\\hbox{\\\\smash{\\\\scriptscriptstyle-}}}\\\\int}{\\\\rlap{\\\\raise.09ex\\\\hbox{\\\\smash{\\\\scriptscriptstyle-}}}\\\\int}{\\\\rlap{\\\\raise.09ex\\\\hbox{\\\\smash{\\\\scriptscriptstyle-}}}\\\\int}',
        eurologo: '\\\\unicode{x20AC}',
        starredbullet: '\\\\unicode{x2726}',
        grimace: '\\\\unicode{x1F62C}',
        textthing: '\\\\unicode{x2639}',
        noway: '\\\\unicode{x26D4}',
        warning: '\\\\unicode{x26A0}',
        danger: '\\\\unicode{x26A0}',
        textxswup: '\\\\unicode{x2195}',
        textxswdown: '\\\\unicode{x2195}',
        decoone: '\\\\unicode{x2756}',
        decotwo: '\\\\unicode{x2767}',
        decothreeleft: '\\\\unicode{x2619}',
        decothreeright: '\\\\unicode{x2767}',
        decofourleft: '\\\\unicode{x261A}',
        decofourright: '\\\\unicode{x261B}',
        floweroneleft: '\\\\unicode{x2740}',
        floweroneright: '\\\\unicode{x2740}',
        lefthand: '\\\\unicode{x261C}',
        righthand: '\\\\unicode{x261E}',
        decosix: '\\\\unicode{x2766}',
        bomb: '\\\\unicode{x1F4A3}',
        caution: '\\\\unicode{x2621}',
        leftblackhand: '\\\\unicode{x261A}',
        rightblackhand: '\\\\unicode{x261B}',
        leafleft: '\\\\unicode{x2618}',
        leafright: '\\\\unicode{x2618}',
        leafNW: '\\\\unicode{x2618}',
        leafNE: '\\\\unicode{x2618}',
        leafSE: '\\\\unicode{x2618}',
        leafSW: '\\\\unicode{x2618}',
        aldineleft: '\\\\unicode{x2619}',
        aldineright: '\\\\unicode{x2767}',
        aldine: '\\\\unicode{x2766}',
        aldinesmall: '\\\\unicode{x2767}',
        aldinesmallrevert: '\\\\unicode{x2619}',
        aldinesmallup: '\\\\unicode{x2766}',
        grappe: '\\\\unicode{x2766}',
        rightgrappe: '\\\\unicode{x2767}',
        leftgrappe: '\\\\unicode{x2619}',
        oldpilcrowone: '\\\\unicode{x00B6}',
        oldpilcrowtwo: '\\\\unicode{x00B6}',
        oldpilcrowthree: '\\\\unicode{x00B6}',
        oldpilcrowfour: '\\\\unicode{x00B6}',
        oldpilcrowfive: '\\\\unicode{x00B6}',
        oldpilcrowsix: '\\\\unicode{x00B6}'
      }
    },
    startup: {
      pageReady: () => {
        return MathJax.startup.defaultPageReady().then(() => {
          console.log('MathJax ready');
        });
      }
    }
  };
  </script>
  <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" id="MathJax-script"></script>
  <script>
  (function() {
    window.addEventListener('beforeunload', function() {
      saveProofState();
      saveCollapsibleState();
    });
    
    const eventSource = new EventSource('http://localhost:35729/reload-stream');
    
    eventSource.onmessage = function(event) {
      if (event.data === 'reload') {
        console.log('📝 File updated, saving state and reloading...');
        saveProofState();
        saveCollapsibleState();
        setTimeout(() => {
          window.location.reload();
        }, 50);
      }
    };
    
    eventSource.onerror = function() {
      console.log('⚠️  Auto-reload server not available. Run node watch.js to enable auto-reload.');
      eventSource.close();
    };
    
    console.log('🔄 Auto-reload enabled');
  })();
  </script>
  <style>
    * { box-sizing: border-box; }
    
    body {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 16px;
      line-height: 1.7;
      margin: 0;
      padding: 0;
      color: #1a1a1a;
      background: #ffffff;
    }
    
    /* Layout with sidebar */
    .page-layout {
      display: flex;
      min-height: 100vh;
    }
    
    /* Sidebar styles */
    .sidebar {
      width: 280px;
      background: #fff;
      border-right: 1px solid #e0e0e0;
      position: fixed;
      top: 0;
      left: 0;
      height: 100vh;
      overflow-y: auto;
      padding: 20px 0;
      font-size: 14px;
    }
    
    .sidebar-header {
      padding: 15px 20px 25px;
      border-bottom: 1px solid #e0e0e0;
    }
    
    .sidebar-header h1 {
      font-size: 1.3em;
      font-weight: 600;
      color: #1a1a1a;
      margin: 0 0 5px 0;
    }
    
    .sidebar-header .subtitle {
      font-size: 0.85em;
      color: #666;
      font-style: italic;
    }
    
    .sidebar-header .back-link {
      display: block;
      font-size: 0.8em;
      color: #666;
      text-decoration: none;
      margin-top: 12px;
    }
    
    .sidebar-header .back-link:hover {
      color: #1a1a1a;
    }
    
    .sidebar-nav {
      padding: 10px 0;
    }
    
    .chapter-group {
      margin-bottom: 2px;
    }
    
    .chapter-title {
      padding: 12px 20px;
      font-size: 0.9em;
      font-weight: 600;
      color: #333;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .chapter-title:hover {
      background: #f5f5f5;
    }
    
    .chapter-title .toggle {
      font-size: 0.65em;
      color: #999;
      transition: transform 0.2s;
    }
    
    .chapter-group.expanded .chapter-title .toggle {
      transform: rotate(90deg);
    }
    
    .section-list {
      display: none;
      padding: 5px 0;
      background: #f8f8f8;
    }
    
    .chapter-group.expanded .section-list {
      display: block;
    }
    
    .section-link {
      display: block;
      padding: 8px 20px 8px 35px;
      font-size: 0.85em;
      color: #555;
      text-decoration: none;
      border-left: 3px solid transparent;
    }
    
    .section-link:hover {
      background: #f0f0f0;
      color: #1a1a1a;
    }
    
    .section-link.active {
      background: #e8e8e8;
      border-left-color: #333;
      color: #000;
      font-weight: 500;
    }
    
    /* Main content area */
    .main-content {
      margin-left: 280px;
      flex: 1;
      max-width: 900px;
      padding: 40px 60px;
    }
    
    @media (max-width: 1100px) {
      .sidebar {
        width: 240px;
      }
      .main-content {
        margin-left: 240px;
        padding: 30px 40px;
      }
    }
    
    @media (max-width: 800px) {
      .sidebar {
        position: relative;
        width: 100%;
        height: auto;
        border-right: none;
        border-bottom: 1px solid #e0e0e0;
      }
      .main-content {
        margin-left: 0;
        padding: 20px;
      }
      .page-layout {
        flex-direction: column;
      }
    }
    
    h2, h3, h4 {
      margin-top: 2em;
      margin-bottom: 0.75em;
      color: #000;
      font-weight: 600;
    }
    h2 { font-size: 1.5em; border-bottom: 1px solid #e0e0e0; padding-bottom: 0.3em; }
    h3 { font-size: 1.25em; }
    h4 { font-size: 1.1em; }
    p {
      margin: 1em 0;
      text-indent: 2em;
    }
    p:first-of-type,
    h2 + p,
    h3 + p,
    h4 + p,
    .theorem-box + p,
    .proof-box + p {
      text-indent: 0;
    }
    .noindent + p,
    p:has(> .noindent:first-child) {
      text-indent: 0 !important;
    }
    .noindent {
      display: none;
    }
    .theorem-box {
      margin: 1.75em 0;
      padding: 1.25em;
      border-left: 5px solid #16a34a;
      background: linear-gradient(to top, #bbf7d0 0%, #d1fae5 100%);
      border-radius: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .definition-box { border-left-color: #16a34a; background: linear-gradient(to top, #d1fae5 0%, #ecfdf5 100%); }
    .lemma-box { border-left-color: #1e3a8a; background: linear-gradient(to top, #bfdbfe 0%, #dbeafe 100%); }
    .corollary-box { border-left-color: #9333ea; background: linear-gradient(to top, #e9d5ff 0%, #f3e8ff 100%); }
    .proposition-box { border-left-color: #dc2626; background: linear-gradient(to top, #fecaca 0%, #fee2e2 100%); }
    .remark-box { border-left-color: #64748b; background: linear-gradient(to top, #e2e8f0 0%, #f1f5f9 100%); }
    .example-box { border-left-color: #0891b2; background: linear-gradient(to top, #a5f3fc 0%, #cffafe 100%); }
    .construction-box { border-left-color: #ea580c; background: linear-gradient(to top, #fed7aa 0%, #ffedd5 100%); }
    .notation-box { border-left-color: #ca8a04; background: linear-gradient(to top, #fef08a 0%, #fef9c3 100%); }
    .exercise-box { border-left-color: #ea580c; background: linear-gradient(to top, #fed7aa 0%, #ffedd5 100%); }
    .problem-box { border-left-color: #ec4899; background: linear-gradient(to top, #fbcfe8 0%, #fce7f3 100%); }
    .theorem-header {
      margin-bottom: 0.75em;
      font-size: 1.05em;
      font-weight: 600;
    }
    .theorem-header.clickable {
      cursor: pointer;
      user-select: none;
    }
    .theorem-header.clickable:hover {
      background: rgba(0,0,0,0.03);
      margin: -0.5em -0.75em 0.75em -0.75em;
      padding: 0.5em 0.75em;
      border-radius: 4px;
    }
    .collapsible-icon {
      display: inline-block;
      transition: transform 0.2s ease;
      font-size: 0.75em;
      margin-right: 0.5em;
      color: #6b7280;
    }
    .collapsible-box.collapsed .collapsible-icon {
      transform: rotate(-90deg);
    }
    .collapsible-content {
      transition: max-height 0.3s ease;
      overflow: hidden;
    }
    .collapsible-box.collapsed .collapsible-content {
      display: none;
    }
    .theorem-content {
      padding-left: 0.5em;
      line-height: 1.8;
    }
    .proof-box {
      margin: 1.5em 0;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: white;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .proof-header {
      position: sticky;
      top: 0;
      background: linear-gradient(to bottom, #fafafa 0%, #f5f5f5 100%);
      border-bottom: 1px solid #e5e7eb;
      z-index: 100;
      border-radius: 6px 6px 0 0;
    }
    .proof-toggle {
      width: 100%;
      padding: 0.85em 1.25em;
      border: none;
      background: transparent;
      text-align: left;
      cursor: pointer;
      font-family: inherit;
      font-size: 1em;
      display: flex;
      align-items: center;
      gap: 0.75em;
      transition: background 0.15s;
    }
    .proof-toggle:hover { background: rgba(0,0,0,0.03); }
    .proof-toggle-icon {
      display: inline-block;
      transition: transform 0.2s ease;
      font-size: 0.75em;
      color: #6b7280;
    }
    .proof-box.collapsed .proof-toggle-icon {
      transform: rotate(-90deg);
    }
    .proof-content {
      padding: 1.25em;
      line-height: 1.8;
    }
    .proof-box.collapsed .proof-content {
      display: none;
    }
    .proof-end {
      float: right;
      font-size: 1.3em;
      margin-left: 0.5em;
      color: #374151;
    }
    .subproof {
      margin: 1em 0;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      background: #f9fafb;
    }
    .subproof-header {
      background: linear-gradient(to bottom, #f9fafb 0%, #f3f4f6 100%);
      border-bottom: 1px solid #d1d5db;
      border-radius: 4px 4px 0 0;
    }
    .subproof-toggle {
      width: 100%;
      padding: 0.6em 1em;
      border: none;
      background: transparent;
      text-align: left;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.95em;
      display: flex;
      align-items: center;
      gap: 0.5em;
      transition: background 0.15s;
    }
    .subproof-toggle:hover {
      background: rgba(0,0,0,0.03);
    }
    .subproof-toggle-icon {
      display: inline-block;
      transition: transform 0.2s ease;
      font-size: 0.7em;
      color: #6b7280;
    }
    .subproof.collapsed .subproof-toggle-icon {
      transform: rotate(-90deg);
    }
    .subproof-content {
      padding: 1em;
      line-height: 1.7;
    }
    .subproof.collapsed .subproof-content {
      display: none;
    }
    .ref-link {
      color: #2563eb;
      text-decoration: none;
      font-weight: 500;
      padding: 0 0.15em;
      border-radius: 2px;
    }
    .ref-link:hover {
      background: #dbeafe;
      text-decoration: underline;
    }
    .ref-unknown {
      color: #dc2626;
      font-weight: bold;
      background: #fee2e2;
      padding: 0.1em 0.3em;
      border-radius: 3px;
    }
    strong { font-weight: 600; }
    em { font-style: italic; }
    ol, ul {
      margin: 1em 0;
      padding-left: 2.5em;
      line-height: 1.8;
    }
    li {
      margin: 0.5em 0;
    }
    .latex-image {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1.5em auto;
    }
    .latex-figure .latex-image {
      display: inline-block;
      margin: 0.5em;
      vertical-align: middle;
    }
    .latex-figure {
      margin: 2em 0;
      text-align: center;
      line-height: 0;
    }
    .latex-figure .figure-content {
      margin-bottom: 0.75em;
      line-height: normal;
    }
    .latex-figure .figure-content > * {
      vertical-align: middle;
    }
    .latex-figure figcaption {
      font-size: 0.9em;
      color: #4b5563;
      font-style: italic;
      margin-top: 0.5em;
    }
  </style>
</head>
<body>
  <div class="page-layout">
    <nav class="sidebar">
      <div class="sidebar-header">
        <h1>Analysis III</h1>
        <div class="subtitle">Measure Theory &amp; Integration</div>
        <a href="${pathPrefix}index.html" class="back-link">← Table of Contents</a>
      </div>
      <div class="sidebar-nav">
        <div class="chapter-group expanded">
          <div class="chapter-title" onclick="toggleChapter(this)"><span>1. Measure Theory</span><span class="toggle">▶</span></div>
          <div class="section-list">
            <a href="${pathPrefix}01-measure-theory/measure-theory.html" class="section-link">Overview</a>
            <a href="${pathPrefix}01-measure-theory/basics.html" class="section-link">Outer Measures</a>
            <a href="${pathPrefix}01-measure-theory/lebesgue-meas.html" class="section-link">Lebesgue Measure</a>
            <a href="${pathPrefix}01-measure-theory/cantor.html" class="section-link">The Cantor Set</a>
            <a href="${pathPrefix}01-measure-theory/measure-spaces.html" class="section-link">Measure Spaces</a>
          </div>
        </div>
        <div class="chapter-group">
          <div class="chapter-title" onclick="toggleChapter(this)"><span>2. Integration</span><span class="toggle">▶</span></div>
          <div class="section-list">
            <a href="${pathPrefix}02-integration/integration.html" class="section-link">Overview</a>
            <a href="${pathPrefix}02-integration/integrals-1.html" class="section-link">Simple Functions</a>
            <a href="${pathPrefix}02-integration/integrals-2.html" class="section-link">General Functions</a>
            <a href="${pathPrefix}02-integration/convergence.html" class="section-link">Convergence Theorems</a>
            <a href="${pathPrefix}02-integration/inequality-party.html" class="section-link">Integral Inequalities</a>
            <a href="${pathPrefix}02-integration/lp_spaces.html" class="section-link">Lᵖ Spaces</a>
          </div>
        </div>
        <div class="chapter-group">
          <div class="chapter-title" onclick="toggleChapter(this)"><span>3. Product Measures</span><span class="toggle">▶</span></div>
          <div class="section-list">
            <a href="${pathPrefix}03-fubini/fubini_ch.html" class="section-link">Overview</a>
            <a href="${pathPrefix}03-fubini/fubini.html" class="section-link">Fubini-Tonelli</a>
            <a href="${pathPrefix}03-fubini/integrals-3.html" class="section-link">Product Measures</a>
          </div>
        </div>
        <div class="chapter-group">
          <div class="chapter-title" onclick="toggleChapter(this)"><span>4. Differentiation I</span><span class="toggle">▶</span></div>
          <div class="section-list">
            <a href="${pathPrefix}04-differentiation-1/differentiation.html" class="section-link">Overview</a>
            <a href="${pathPrefix}04-differentiation-1/covering.html" class="section-link">Vitali Covering</a>
            <a href="${pathPrefix}04-differentiation-1/monotone.html" class="section-link">Monotone Functions</a>
            <a href="${pathPrefix}04-differentiation-1/BV_on_R.html" class="section-link">Bounded Variation</a>
            <a href="${pathPrefix}04-differentiation-1/FTOC.html" class="section-link">FTC for Lebesgue</a>
            <a href="${pathPrefix}04-differentiation-1/HL.html" class="section-link">Hardy-Littlewood</a>
          </div>
        </div>
        <div class="chapter-group">
          <div class="chapter-title" onclick="toggleChapter(this)"><span>5. Differentiation I (cont)</span><span class="toggle">▶</span></div>
          <div class="section-list">
            <a href="${pathPrefix}05-differentiation-1/differentiation.html" class="section-link">Overview</a>
            <a href="${pathPrefix}05-differentiation-1/r-nik.html" class="section-link">Radon-Nikodym</a>
          </div>
        </div>
        <div class="chapter-group">
          <div class="chapter-title" onclick="toggleChapter(this)"><span>6. Differentiation II</span><span class="toggle">▶</span></div>
          <div class="section-list">
            <a href="${pathPrefix}06-differentiation-2/diff-2.html" class="section-link">Overview</a>
            <a href="${pathPrefix}06-differentiation-2/vector-measures.html" class="section-link">Vector Measures</a>
            <a href="${pathPrefix}06-differentiation-2/r-nik.html" class="section-link">Radon-Nikodym</a>
            <a href="${pathPrefix}06-differentiation-2/besi.html" class="section-link">Besicovitch</a>
            <a href="${pathPrefix}06-differentiation-2/densities.html" class="section-link">Densities</a>
            <a href="${pathPrefix}06-differentiation-2/diff-measures.html" class="section-link">Measure Derivatives</a>
          </div>
        </div>
        <div class="chapter-group">
          <div class="chapter-title" onclick="toggleChapter(this)"><span>7. Riesz Representation</span><span class="toggle">▶</span></div>
          <div class="section-list">
            <a href="${pathPrefix}06-riesz/riesz.html" class="section-link">Overview</a>
            <a href="${pathPrefix}06-riesz/riesz_functional.html" class="section-link">Riesz Representation</a>
            <a href="${pathPrefix}06-riesz/LCH_spaces.html" class="section-link">LCH Spaces</a>
          </div>
        </div>
        <div class="chapter-group">
          <div class="chapter-title" onclick="toggleChapter(this)"><span>8. Integral Formulas</span><span class="toggle">▶</span></div>
          <div class="section-list">
            <a href="${pathPrefix}07-formulas/formulas.html" class="section-link">Overview</a>
            <a href="${pathPrefix}07-formulas/hausdorff_meas.html" class="section-link">Hausdorff Measures</a>
            <a href="${pathPrefix}07-formulas/lippy.html" class="section-link">Lipschitz Maps</a>
            <a href="${pathPrefix}07-formulas/rademacher.html" class="section-link">Rademacher</a>
            <a href="${pathPrefix}07-formulas/coarea-prereq.html" class="section-link">Coarea Prerequisites</a>
            <a href="${pathPrefix}07-formulas/coarea.html" class="section-link">Coarea Formula</a>
            <a href="${pathPrefix}07-formulas/area-prereq.html" class="section-link">Area Prerequisites</a>
            <a href="${pathPrefix}07-formulas/area-formula.html" class="section-link">Area Formula</a>
          </div>
        </div>
        <div class="chapter-group">
          <div class="chapter-title" onclick="toggleChapter(this)"><span>9. Extension Results</span><span class="toggle">▶</span></div>
          <div class="section-list">
            <a href="${pathPrefix}08-ext-res/ext-res.html" class="section-link">Overview</a>
            <a href="${pathPrefix}08-ext-res/taylor_thm_integral_remainder.html" class="section-link">Taylor's Theorem</a>
            <a href="${pathPrefix}08-ext-res/whitney-cover.html" class="section-link">Whitney Covering</a>
            <a href="${pathPrefix}08-ext-res/whitney-partition-of-unity.html" class="section-link">Partition of Unity</a>
            <a href="${pathPrefix}08-ext-res/whitney-decomposition.html" class="section-link">Decomposition</a>
            <a href="${pathPrefix}08-ext-res/whitney-extension-theorem.html" class="section-link">Extension Theorem</a>
            <a href="${pathPrefix}08-ext-res/whitney-extension-proof.html" class="section-link">Extension Proof</a>
            <a href="${pathPrefix}08-ext-res/whitney-extension-applications.html" class="section-link">Applications</a>
            <a href="${pathPrefix}08-ext-res/whitney-extension.html" class="section-link">Summary</a>
            <a href="${pathPrefix}08-ext-res/more-bump.html" class="section-link">More Bump Functions</a>
          </div>
        </div>
      </div>
    </nav>
    
    <main class="main-content">
      ${bodyContent}
    </main>
  </div>
  
  <script>
    function toggleChapter(element) {
      element.parentElement.classList.toggle('expanded');
    }
    
    // Highlight current page in sidebar
    document.addEventListener('DOMContentLoaded', () => {
      const currentPath = window.location.pathname;
      const links = document.querySelectorAll('.section-link');
      links.forEach(link => {
        if (currentPath.endsWith(link.getAttribute('href').split('/').pop())) {
          link.classList.add('active');
          // Expand parent chapter
          const group = link.closest('.chapter-group');
          if (group) group.classList.add('expanded');
        }
      });
    });
    
    window.addEventListener('DOMContentLoaded', () => {
      console.log('Restoring proof collapse states...');
      try {
        const openProofs = JSON.parse(localStorage.getItem('openProofs') || '{}');
        const currentPage = window.location.pathname;
        const pageOpen = openProofs[currentPage] || [];
        
        console.log('Current page:', currentPage);
        console.log('Open proof IDs stored:', pageOpen);
        console.log('Found ' + pageOpen.length + ' open proofs for this page');
        
        document.querySelectorAll('.proof-box').forEach(box => {
          const proofId = box.getAttribute('data-proof-id');
          console.log('Checking proof:', proofId, 'Should be open:', pageOpen.includes(proofId));
          if (pageOpen.includes(proofId)) {
            box.classList.remove('collapsed');
            const button = box.querySelector('.proof-toggle');
            button.setAttribute('aria-expanded', 'true');
          } else {
            box.classList.add('collapsed');
            const button = box.querySelector('.proof-toggle');
            button.setAttribute('aria-expanded', 'false');
          }
        });
        
        const openBoxes = JSON.parse(localStorage.getItem('openBoxes') || '{}');
        const pageBoxes = openBoxes[currentPage] || [];
        
        console.log('Open box IDs stored:', pageBoxes);
        
        document.querySelectorAll('.collapsible-box').forEach(box => {
          const boxId = box.getAttribute('data-collapsible-id');
          console.log('Checking box:', boxId, 'Should be open:', pageBoxes.includes(boxId));
          if (pageBoxes.includes(boxId)) {
            box.classList.remove('collapsed');
          } else {
            box.classList.add('collapsed');
          }
        });
        
        console.log('Proof states restored');
      } catch (e) {
        console.error('Error restoring collapse state:', e);
      }
    });
    
    function toggleProof(proofId) {
      const proofContent = document.getElementById(proofId);
      const proofBox = proofContent.closest('.proof-box');
      proofBox.classList.toggle('collapsed');
      
      const button = proofBox.querySelector('.proof-toggle');
      button.setAttribute('aria-expanded', !proofBox.classList.contains('collapsed'));
      
      saveProofState();
    }
    
    function toggleSubproof(subproofId) {
      const subproofContent = document.getElementById(subproofId);
      const subproof = subproofContent.closest('.subproof');
      subproof.classList.toggle('collapsed');
      
      const button = subproof.querySelector('.subproof-toggle');
      button.setAttribute('aria-expanded', !subproof.classList.contains('collapsed'));
    }
    
    function saveProofState() {
      try {
        const currentPage = window.location.pathname;
        const openProofs = JSON.parse(localStorage.getItem('openProofs') || '{}');
        if (!openProofs[currentPage]) {
          openProofs[currentPage] = [];
        }
        
        openProofs[currentPage] = [];
        document.querySelectorAll('.proof-box:not(.collapsed)').forEach(box => {
          const proofId = box.getAttribute('data-proof-id');
          if (proofId) {
            openProofs[currentPage].push(proofId);
          }
        });
        
        localStorage.setItem('openProofs', JSON.stringify(openProofs));
        console.log('Saved proof state (open proofs):', openProofs[currentPage]);
      } catch (e) {
        console.error('Error saving collapse state:', e);
      }
    }
    
    function toggleCollapsible(collapsibleId) {
      const content = document.getElementById(collapsibleId);
      const box = content.closest('.collapsible-box');
      box.classList.toggle('collapsed');
      
      saveCollapsibleState();
    }
    
    function saveCollapsibleState() {
      try {
        const currentPage = window.location.pathname;
        const openBoxes = JSON.parse(localStorage.getItem('openBoxes') || '{}');
        if (!openBoxes[currentPage]) {
          openBoxes[currentPage] = [];
        }
        
        openBoxes[currentPage] = [];
        document.querySelectorAll('.collapsible-box:not(.collapsed)').forEach(box => {
          const boxId = box.getAttribute('data-collapsible-id');
          if (boxId) {
            openBoxes[currentPage].push(boxId);
          }
        });
        
        localStorage.setItem('openBoxes', JSON.stringify(openBoxes));
      } catch (e) {
        console.error('Error saving box state:', e);
      }
    }
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'p' && e.ctrlKey) {
        e.preventDefault();
        const proofBoxes = document.querySelectorAll('.proof-box');
        const anyExpanded = Array.from(proofBoxes).some(box => !box.classList.contains('collapsed'));
        
        proofBoxes.forEach(box => {
          if (anyExpanded) {
            box.classList.add('collapsed');
          } else {
            box.classList.remove('collapsed');
          }
        });
        
        saveProofState();
      }
    });
    
    document.querySelectorAll('a.ref-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('href').substring(1);
        const target = document.getElementById(targetId);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.style.background = '#fef3c7';
          target.style.transition = 'background 0.3s ease';
          setTimeout(() => { target.style.background = ''; }, 1500);
        }
      });
    });
  </script>
</body>
</html>`;
}

module.exports = { 
  convertLaTeXToHTML: convertLaTeXToHTML, 
  parseAuxFile: parseAuxFile 
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log('Usage: node simple-latex-parser.js <input.tex> <main.aux> <output.html> [imageBasePath]');
    console.log('');
    console.log('Example: node simple-latex-parser.js doc.tex main.aux output.html ../images');
    console.log('         (images will be referenced as ../images/filename.png)');
    process.exit(1);
  }
  const [texPath, auxPath, outputPath, imageBasePath] = args;
  const options = imageBasePath ? { imageBasePath } : {};
  convertLaTeXToHTML(texPath, auxPath, outputPath, options);
}