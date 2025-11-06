const fs = require('fs');
const path = require('path');

// Read the main.js file
const mainJsPath = path.join(__dirname, 'main.js');
let content = fs.readFileSync(mainJsPath, 'utf8');

// Replace all ternary operators with PostgreSQL versions (? with $N)
// Pattern: const query = USE_POSTGRESQL ? 'PostgreSQL query' : 'SQLite query'
content = content.replace(
  /const (\w+) = USE_POSTGRESQL\s*\?\s*'([^']+)'\s*:\s*'[^']+'/g,
  "const $1 = '$2'"
);

// Pattern: query += USE_POSTGRESQL ? 'PostgreSQL' : 'SQLite'
content = content.replace(
  /query \+= USE_POSTGRESQL \? '([^']+)' : '[^']+'/g,
  "query += '$1'"
);

// Pattern: if (USE_POSTGRESQL) { ... } else { ... }
// Find and replace multi-line if-else blocks
const lines = content.split('\n');
const newLines = [];
let skipUntil = -1;
let inIfBlock = false;
let ifBlockStart = -1;
let pgBlockLines = [];

for (let i = 0; i < lines.length; i++) {
  if (skipUntil > i) {
    continue;
  }

  const line = lines[i];
  const trimmed = line.trim();

  // Check for if (USE_POSTGRESQL)
  if (trimmed.startsWith('if (USE_POSTGRESQL)')) {
    inIfBlock = true;
    ifBlockStart = i;
    pgBlockLines = [];
    continue;
  }

  if (inIfBlock) {
    // Collect PostgreSQL block lines
    if (trimmed === '} else {') {
      // Found the else, skip to the end of the else block
      let braceCount = 1;
      let j = i + 1;
      while (j < lines.length && braceCount > 0) {
        const elseLine = lines[j].trim();
        if (elseLine.startsWith('}')) braceCount--;
        if (elseLine.endsWith('{')) braceCount++;
        j++;
      }
      skipUntil = j;
      // Add PostgreSQL block lines
      newLines.push(...pgBlockLines);
      inIfBlock = false;
      pgBlockLines = [];
      continue;
    } else if (trimmed === '}') {
      // End of if block without else
      newLines.push(...pgBlockLines);
      inIfBlock = false;
      pgBlockLines = [];
      continue;
    } else {
      // Collect line from PostgreSQL block
      pgBlockLines.push(line);
      continue;
    }
  }

  newLines.push(line);
}

content = newLines.join('\n');

// Write back
fs.writeFileSync(mainJsPath, content, 'utf8');
console.log('Conversion complete!');
