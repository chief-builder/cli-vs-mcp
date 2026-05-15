import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const http = require('http');
const fs = require('fs');

const url = 'http://localhost:50695/scrape/article.html';
const outPath = '/var/folders/h7/mhpz888d6xzcm62796jyks1c0000gn/T/clivsmcp-playwright-baseline-tier1_scrape-KOiTAL/table.json';

http.get(url, (res) => {
  let html = '';
  res.on('data', chunk => html += chunk);
  res.on('end', () => {
    // Find the population-table tbody rows
    const tableMatch = html.match(/<table[^>]*id=["']population-table["'][^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
      console.error('Table not found');
      process.exit(1);
    }
    const tableHtml = tableMatch[1];

    // Find tbody
    const tbodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    const bodyHtml = tbodyMatch ? tbodyMatch[1] : tableHtml;

    // Extract rows
    const rows = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(bodyHtml)) !== null) {
      const rowHtml = rowMatch[1];
      const cells = [];
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        // Strip any inner HTML tags and trim
        const text = cellMatch[1].replace(/<[^>]+>/g, '').trim();
        cells.push(text);
      }
      if (cells.length >= 4) {
        const rank = parseInt(cells[0].replace(/,/g, ''), 10);
        const city = cells[1];
        const country = cells[2];
        const population = parseInt(cells[3].replace(/,/g, ''), 10);
        rows.push({ rank, city, country, population });
      }
    }

    fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
    console.log(`Wrote ${rows.length} rows to ${outPath}`);
    console.log(JSON.stringify(rows.slice(0, 3), null, 2));
  });
}).on('error', (e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
