// Fetches the Nepal Flood Response Hub Notion pages and converts them to
// simplified HTML (generic) plus a structured "updates" list for the
// Situation page. Requires env var NOTION_TOKEN (Notion internal integration
// secret shared with every page below).

const NOTION_VERSION = '2022-06-28';

const PAGE_IDS = {
  home: '3d01ab0d-8a88-80d8-8443-f58c22c8a5bd',
  situation: '3d01ab0d-8a88-80ad-94dd-fcb93082c556',
  donate: '3d01ab0d-8a88-80fd-b61e-f9131b6bbc5c',
  rescue: '3d01ab0d-8a88-809d-9dac-e29ec231d6d4',
  missing: '3d01ab0d-8a88-809a-9816-d4189e864e50',
  volunteer: '3d01ab0d-8a88-8050-b6dc-f5de4d75454a',
  outside: '3d01ab0d-8a88-8072-b7e3-e9d920053ab8',
  coordination: '3d01ab0d-8a88-8085-bf99-cf2e83741945',
  about: '3d01ab0d-8a88-804e-a3f5-fb55cf064822',
};

async function notionFetch(path) {
  const res = await fetch('https://api.notion.com/v1' + path, {
    headers: {
      Authorization: 'Bearer ' + process.env.NOTION_TOKEN,
      'Notion-Version': NOTION_VERSION,
    },
  });
  if (!res.ok) throw new Error('Notion API ' + res.status + ' for ' + path);
  return res.json();
}

async function getChildren(blockId) {
  let results = [];
  let cursor;
  do {
    const q = cursor ? '?start_cursor=' + cursor + '&page_size=100' : '?page_size=100';
    const data = await notionFetch('/blocks/' + blockId + '/children' + q);
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function richTextToHtml(arr) {
  return (arr || []).map(t => {
    let s = esc(t.plain_text || '');
    const a = t.annotations || {};
    if (a.code) s = '<code>' + s + '</code>';
    if (a.bold) s = '<strong>' + s + '</strong>';
    if (a.italic) s = '<em>' + s + '</em>';
    if (a.strikethrough) s = '<s>' + s + '</s>';
    if (t.href) s = '<a href="' + esc(t.href) + '" target="_blank" rel="noopener">' + s + '</a>';
    return s;
  }).join('');
}

function plainText(arr) {
  return (arr || []).map(t => t.plain_text || '').join('').trim();
}

// Renders one level of blocks to HTML, recursing into toggles/lists up to `depth`.
async function blocksToHtml(blocks, depth) {
  let html = '';
  let listBuffer = [];
  let listType = null;
  const flushList = () => {
    if (!listBuffer.length) return;
    const tag = listType === 'numbered_list_item' ? 'ol' : 'ul';
    html += '<' + tag + ' style="margin:0 0 10px;padding-left:20px">' + listBuffer.join('') + '</' + tag + '>';
    listBuffer = [];
    listType = null;
  };
  for (const b of blocks) {
    const t = b.type;
    if (t === 'bulleted_list_item' || t === 'numbered_list_item') {
  if (listType && listType !== t) flushList();
      listType = t;
      listBuffer.push('<li style="margin-bottom:4px;font-size:14.5px;line-height:1.5">' + richTextToHtml(b[t].rich_text) + '</li>');
      continue;
    }
    flushList();
    if (t === 'paragraph') {
      const txt = richTextToHtml(b.paragraph.rich_text);
      if (txt) html += '<p style="margin:0 0 10px;font-size:14.5px;line-height:1.6">' + txt + '</p>';
    } else if (t === 'heading_1' || t === 'heading_2' || t === 'heading_3') {
      const size = t === 'heading_1' ? '18px' : t === 'heading_2' ? '16.5px' : '15px';
      html += '<div style="font-weight:700;font-size:' + size + ';margin:14px 0 8px;font-family:Caprasimo,serif">' + richTextToHtml(b[t].rich_text) + '</div>';
    } else if (t === 'quote') {
      html += '<blockquote style="margin:0 0 10px;padding:2px 0 2px 14px;border-left:3px solid #c67139;font-size:14.5px;line-height:1.6">' + richTextToHtml(b.quote.rich_text) + '</blockquote>';
    } else if (t === 'callout') {
      html += '<div style="background:#e1eecc;color:#272e1b;border-radius:16px;padding:12px 16px;margin:0 0 10px;font-size:14px;line-height:1.55">' + richTextToHtml(b.callout.rich_text) + '</div>';
    } else if (t === 'divider') {
      html += '<hr style="border:none;border-top:1px solid rgba(32,30,29,.12);margin:14px 0">';
    } else if (t === 'to_do') {
      html += '<p style="margin:0 0 8px;font-size:14.5px">' + (b.to_do.checked ? '☑ ' : '☐ ') + richTextToHtml(b.to_do.rich_text) + '</p>';
    } else if (t === 'bookmark' || t === 'embed' || t === 'link_preview') {
      const url = b[t].url;
      if (url) html += '<p style="margin:0 0 8px"><a href="' + esc(url) + '" target="_blank" rel="noopener" style="color:#8c491a;font-weight:600">' + esc(url) + '</a></p>';
    } else if (t === 'toggle') {
      const summary = richTextToHtml(b.toggle.rich_text);
      let inner = '';
      if (depth > 0 && b.has_children) {
        const kids = await getChildren(b.id);
        inner = await blocksToHtml(kids, depth - 1);
      }
      html += '<details style="margin:0 0 8px"><summary style="cursor:pointer;font-weight:600;font-size:14.5px">' + summary + '</summary><div style="padding:8px 0 4px 14px">' + inner + '</div></details>';
    }
  }
  flushList();
  return html;
}

function stripBoldMarkers(s) {
  return s.replace(/\*\*/g, '').trim();
}

async function blockText(block) {
  const type = block.type;
  const rt = block[type] && block[type].rich_text;
  return rt ? plainText(rt) : '';
}

async function parseUpdateToggle(toggleBlock) {
  const summary = plainText(toggleBlock.toggle.rich_text);
  const dateMatch = summary.match(/Report:\s*([^*]+?NPT)/i);
  const date = dateMatch ? dateMatch[1].trim() : '';
  let title = summary.split(/We are issuing this update/i)[0];
  title = stripBoldMarkers(title).replace(/^NEPAL[^:]*:?\s*/i, '').replace(/Report:.*NPT\)?\s*\*?\(?[^)]*\)?/i, '').trim();
  if (title.length > 140) title = title.slice(0, 140).trim() + '…';
  const kind = /MAJOR/i.test(summary) ? 'Major update' : /LATEST/i.test(summary) ? 'Latest' : 'Update';
  const children = await getChildren(toggleBlock.id);
  const points = [];
  let bottom = '';
  for (const c of children) {
    if (c.type !== 'paragraph') continue;
    const plain = stripBoldMarkers(await blockText(c));
    if (!plain) continue;
    const htmlText = richTextToHtml(c.paragraph.rich_text);
    if (/^Bottom line:/i.test(plain)) {
      bottom = htmlText.replace(/^\s*(<strong>)?\s*Bottom line:\s*(<\/strong>)?\s*/i, '');
    } else {
      points.push(htmlText);
    }
  }
  return { date, kind, title, points: points.slice(0, 6), bottom };
}

async function getSituationUpdatesAndHtml() {
  const topLevel = await getChildren(PAGE_IDS.situation);
  const outer = topLevel.find(b => b.type === 'toggle' && /Updated Periodically/i.test(plainText(b.toggle.rich_text)));
  let updates = [];
  if (outer) {
    const innerToggles = (await getChildren(outer.id)).filter(b => b.type === 'toggle');
    updates = await Promise.all(innerToggles.map(parseUpdateToggle));
  }
  // Render everything else on the page generically (excluding the outer toggle,
  // which is already fully represented by the structured `updates` above —
  // rendering it generically too would show empty/broken nested toggles since
  // its update entries are several levels deep).
  const rest = topLevel.filter(b => b !== outer);
  const html = await blocksToHtml(rest, 2);
  return { updates, html };
}

async function getPageHtml(pageId) {
  const blocks = await getChildren(pageId);
  return blocksToHtml(blocks, 1);
}

exports.handler = async function () {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 's-maxage=300, stale-while-revalidate=900',
    'Access-Control-Allow-Origin': '*',
  };
  if (!process.env.NOTION_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'NOTION_TOKEN not set' }) };
  }
  try {
    const keys = Object.keys(PAGE_IDS).filter(k => k !== 'situation');
    const [situation, pageEntries] = await Promise.all([
      getSituationUpdatesAndHtml().catch(() => ({ updates: [], html: '' })),
      Promise.all(keys.map(async k => {
        try { return [k, await getPageHtml(PAGE_IDS[k])]; }
        catch (e) { return [k, '']; }
      })),
    ]);
    const pages = {};
    for (const [k, html] of pageEntries) pages[k] = { html };
    pages.situation = { html: situation.html };
    const updates = situation.updates;
    // Fold Coordination content into the "outside" page.
    if (pages.coordination && pages.coordination.html) {
      pages.outside = pages.outside || { html: '' };
      pages.outside.html = pages.outside.html + '<hr>' + pages.coordination.html;
    }
    delete pages.coordination;
    return { statusCode: 200, headers, body: JSON.stringify({ updatedAt: new Date().toISOString(), updates, pages }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(err) }) };
  }
};
