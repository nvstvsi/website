# Real Analysis Notes - Build System

A smart LaTeX to HTML conversion system with incremental builds and a beautiful landing page.

## 🚀 Quick Start

### Watch Mode (Recommended for Development)
```bash
node watch.js
```
This will:
- Do an initial full build
- Watch for file changes
- Automatically rebuild only changed files (fast!)
- Auto-reload your browser
- Open the navigation page

### Single Build Commands

Build everything:
```bash
node build.js
# or
node build.js all
```

Build a single file (fast - no LaTeX recompilation):
```bash
node build.js file src/05-differentiation-1/BV_on_R.tex
```

Build an entire chapter (fast - no LaTeX recompilation):
```bash
node build.js chapter 01  # Build Chapter 1
node build.js chapter 05  # Build Chapter 5
```

## 🎯 Key Features

### Smart Incremental Compilation

The system now intelligently decides when to recompile:

- **Editing a .tex file in src/**: Only that file is converted to HTML (~1 second)
- **Editing main.tex or preamble.tex**: Full LaTeX recompilation + convert all files
- **No changes to main/preamble**: Uses cached .aux file (fast!)

This means you can edit individual chapter files and see changes in ~1 second instead of waiting for full LaTeX compilation.

### Beautiful Landing Page

The new `index.html` landing page features:

- **Expandable chapters**: Click to expand/collapse chapter sections
- **Filter tabs**: View all chapters, or filter by:
  - 📚 **First Course (Focus on ℝⁿ)**: Essential undergraduate topics
  - 🎓 **Advanced Topics**: More advanced real analysis
  - 🔬 **Road to GMT**: Prep for geometric measure theory
- **Tagged sections**: Each section shows which learning paths it belongs to
- **State preservation**: Expanded chapters persist across page reloads
- **Auto-reload**: Page automatically refreshes when you save changes

## 📁 File Structure

```
project/
├── src/                          # LaTeX source files
│   ├── 01-measure-theory/
│   │   ├── basics.tex
│   │   ├── lebesgue-meas.tex
│   │   └── ...
│   ├── 02-integration/
│   ├── 03-riesz/
│   ├── 04-fubini/
│   └── 05-differentiation-1/
├── html_preview/                 # Generated HTML files
│   ├── index.html               # Landing page
│   ├── 01-measure-theory/
│   ├── 02-integration/
│   └── ...
├── build/                        # LaTeX build artifacts (.aux, .pdf, etc.)
├── figures/                      # Images referenced in LaTeX
├── main.tex                      # Main LaTeX file (includes all chapters)
├── preamble.tex                  # LaTeX preamble
├── simple-latex-parser.js        # LaTeX → HTML converter
├── watch.js                      # Build system with watch mode
└── build.js                      # Convenient build script
```

## 🔧 How It Works

### The Build Process

1. **LaTeX Compilation** (only when needed):
   - Compiles `main.tex` with pdflatex (2 passes)
   - Generates `build/main.aux` with all labels and references
   - Cached and reused unless main.tex or preamble.tex changes

2. **HTML Conversion**:
   - Reads individual .tex files from `src/`
   - Uses the .aux file for cross-references
   - Converts LaTeX to HTML with:
     - Theorem boxes (collapsible for examples/remarks)
     - Proof boxes (collapsible)
     - MathJax for math rendering
     - Proper image paths
   - Generates HTML in `html_preview/`

3. **Index Generation**:
   - Scans all converted files
   - Generates the landing page with filters
   - Organizes by chapters and learning paths

### Watch Mode Behavior

When you save a file in watch mode:

| File Changed | Action | Speed |
|-------------|---------|-------|
| `src/**/*.tex` | Convert only that file | ⚡ ~1s |
| `main.tex` | Full rebuild (compile + convert all) | 🐌 ~30s |
| `preamble.tex` | Full rebuild | 🐌 ~30s |

## 🎨 Customizing the Landing Page

Edit the metadata in `watch.js`:

```javascript
const CHAPTERS_METADATA = {
  '01-measure-theory': {
    number: 1,
    title: 'Measure Theory Foundations',
    color: '#2ecc71',  // Chapter color
    sections: {
      'basics': {
        title: 'Outer Measures and σ-Algebras',
        file: 'basics.tex',
        order: 1,
        tags: ['first-course', 'foundations']  // Learning path tags
      },
      // ... more sections
    }
  },
  // ... more chapters
};
```

### Available Tags

- `first-course`: Appears in "First Course" filter
- `advanced`: Appears in "Advanced Topics" filter
- `road-to-gmt`: Appears in "Road to GMT" filter
- `euclidean`: Focuses on ℝⁿ
- `foundations`: Foundational concepts

## 💡 Tips

1. **For regular editing**: Just run `node watch.js` once and leave it running
2. **For quick single file builds**: `node build.js file path/to/file.tex`
3. **For chapter reviews**: `node build.js chapter 05` rebuilds just that chapter
4. **First time setup**: Run `node build.js` once to do a full build

## 🐛 Troubleshooting

**References not working?**
- Run a full build once: `node build.js`
- This generates the .aux file with all cross-references

**Images not showing?**
- Make sure images are in the `figures/` directory
- Image paths are automatically calculated relative to each HTML file

**Browser not auto-reloading?**
- Check that port 35729 is available
- Look for "Auto-reload enabled" message in browser console

**LaTeX compilation fails?**
- Check `build/main.log` for LaTeX errors
- Make sure all packages in `preamble.tex` are installed

## 📝 Command Reference

```bash
# Watch mode (recommended)
node watch.js

# Build commands
node build.js                    # Build everything
node build.js file <path>        # Build single file  
node build.js chapter <num>      # Build chapter

# Advanced watch.js options
node watch.js --help             # Show all options
node watch.js --build-all        # Build once and exit
node watch.js --build-chapter 01 # Build chapter once
node watch.js --no-compile       # Skip LaTeX compilation
```

## 🎯 Workflow Example

Typical workflow when editing chapter 5:

```bash
# Start watch mode (do this once)
node watch.js

# Edit src/05-differentiation-1/BV_on_R.tex in your editor
# Save the file
# → Browser auto-reloads in ~1 second ⚡

# Edit another file in chapter 5
# Save
# → Browser auto-reloads in ~1 second ⚡

# Add a new theorem that you want to reference elsewhere
# Now edit main.tex to verify it compiles
# Save main.tex
# → Full rebuild happens (~30 seconds)
# → All files now have correct cross-references

# Continue editing individual files with fast rebuilds
```

Enjoy your fast LaTeX editing workflow! 🎉
