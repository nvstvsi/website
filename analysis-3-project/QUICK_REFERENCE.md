# Quick Reference Card

## 🚀 Most Common Commands

```bash
# Start watch mode (recommended for editing)
node watch.js

# Build entire project
node build.js

# Build single file
node build.js file src/05-differentiation-1/BV_on_R.tex

# Build chapter
node build.js chapter 05
```

## 📊 Speed Comparison

| Action | Old System | New System | Speedup |
|--------|-----------|------------|---------|
| Edit single .tex file | ~30s | ~1s | **30x faster** |
| Edit main.tex | ~30s | ~30s | Same |
| Full project build | ~30s | ~30s | Same |

## 🎯 When To Use Each Command

### `node watch.js` (Use this 90% of the time)
- ✅ Regular editing sessions
- ✅ Working on multiple files
- ✅ Want auto-reload
- ✅ Active development

### `node build.js chapter XX`
- ✅ Review entire chapter
- ✅ Rebuild chapter after adding new file
- ✅ Check chapter consistency
- ❌ Don't use for single file edits

### `node build.js file path`
- ✅ Quick rebuild of one file
- ✅ Testing changes to specific file
- ❌ Don't use if watch mode is running

### `node build.js` (full build)
- ✅ First time setup
- ✅ After major restructuring
- ✅ When references break
- ❌ Don't use for normal editing

## 🎨 Landing Page Features

### Filter Tabs
- **All Chapters**: Shows everything
- **📚 First Course**: Chapters 1, 2, 4, 5 (focus on ℝⁿ)
- **🎓 Advanced Topics**: Advanced material
- **🔬 Road to GMT**: Geometric measure theory prep

### Interactions
- **Click chapter header**: Expand/collapse sections
- **Click section**: Open that HTML file
- **Expanded state**: Automatically saved

## 🔍 File Locations

```
html_preview/index.html          # Landing page (open this!)
html_preview/XX-name/file.html   # Individual sections
build/main.aux                   # Cross-reference data
build/main.pdf                   # Full PDF
```

## 💡 Pro Tips

1. Keep watch mode running - don't restart it
2. Let browser auto-reload - don't manual refresh
3. Use landing page filters to focus
4. Expanded chapters persist across reloads
5. References work automatically with cached .aux

## ⚡ Keyboard Shortcuts

In the HTML preview pages:
- `Ctrl+P`: Collapse/expand all proofs

## 🐛 Common Issues

**"References not working"**
→ Run `node build.js` once

**"Images not showing"**
→ Check they're in `figures/` directory

**"Browser not auto-reloading"**
→ Look for "Auto-reload enabled" in console
→ Check port 35729 is available

**"Build too slow"**
→ Use watch mode instead of rebuilding manually
→ Only main.tex/preamble.tex changes trigger full rebuild

## 📁 What Gets Rebuilt

| You Edit | What Rebuilds | Time |
|----------|---------------|------|
| `src/XX-name/file.tex` | Just that file | ~1s ⚡ |
| `main.tex` | Everything | ~30s |
| `preamble.tex` | Everything | ~30s |
| Other files | Nothing | N/A |

---

**Need more details?** See `README.md` for full documentation.

**Questions about the upgrade?** See `UPGRADE_SUMMARY.md`.
