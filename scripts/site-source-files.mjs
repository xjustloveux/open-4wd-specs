import fs from 'node:fs';
import path from 'node:path';
import { inlineCodeSpans, linkSpans, parseMd, rel } from './lib.mjs';
import { SITE_ASSET_EXTENSIONS } from './site-assets.mjs';

function isOutside(root, target) {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function parseLocalTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
  if (!target || target.startsWith('#') || target.startsWith('/') || target.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(target) && !/^[a-z]:[/\\]/iu.test(target)) return null;

  const suffixIndex = target.search(/[?#]/u);
  const suffix = suffixIndex < 0 ? '' : target.slice(suffixIndex);
  const encodedPath = suffixIndex < 0 ? target : target.slice(0, suffixIndex);
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    throw new Error(`無法解析 URL encoding：${rawTarget}`);
  }
  return { decodedPath, suffix };
}

function validateRelativePath(value, label, root) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必須是非空字串`);
  if (path.isAbsolute(value) || /^[a-z]:[/\\]/iu.test(value)) throw new Error(`${label}不可使用絕對路徑：${value}`);
  const resolved = path.resolve(root, value);
  if (isOutside(root, resolved)) throw new Error(`${label}越界：${value}`);
  return resolved;
}

function loadManifest({ repoRoot, stageRoot, manifestFile }) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    throw new Error(`無法讀取站點來源白名單 ${rel(repoRoot, manifestFile)}：${error.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('站點來源白名單根節點必須是陣列');

  const rootReal = fs.realpathSync(repoRoot);
  const sources = new Set();
  const destinations = new Set();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`站點來源白名單第 ${index + 1} 筆必須是物件`);
    }
    const source = validateRelativePath(entry.source, '來源路徑', repoRoot);
    const destination = validateRelativePath(entry.publicPath, '發布路徑', stageRoot);
    const sourceKey = path.normalize(source).toLowerCase();
    const destinationKey = path.normalize(destination).toLowerCase();
    if (sources.has(sourceKey)) throw new Error(`站點來源白名單重複來源：${entry.source}`);
    if (destinations.has(destinationKey)) throw new Error(`站點來源白名單重複發布路徑：${entry.publicPath}`);
    sources.add(sourceKey);
    destinations.add(destinationKey);

    if (!fs.existsSync(source)) throw new Error(`${entry.source}：找不到白名單來源檔`);
    const sourceReal = fs.realpathSync(source);
    if (isOutside(rootReal, sourceReal)) throw new Error(`來源實體路徑越界：${entry.source}`);
    if (!fs.statSync(sourceReal).isFile()) throw new Error(`${entry.source}：白名單來源不是檔案`);

    const publicSegments = entry.publicPath.replace(/\\/gu, '/').split('/');
    if (publicSegments.some((segment) => segment.startsWith('.'))) {
      throw new Error(`發布路徑不可包含隱藏目錄：${entry.publicPath}`);
    }
    return {
      source: sourceReal,
      sourceKey: path.normalize(sourceReal).toLowerCase(),
      sourceLabel: entry.source,
      destination,
      publicPath: entry.publicPath.replace(/\\/gu, '/'),
    };
  });
}

function webRelative(fromDirectory, destination, suffix) {
  let target = path.relative(fromDirectory, destination).split(path.sep).join('/');
  if (/\s/u.test(target)) target = `<${target}>`;
  return `${target}${suffix}`;
}

export function stageAllowlistedSourceFiles({ repoRoot, stageRoot, markdownFiles, manifestFile }) {
  const entries = loadManifest({ repoRoot, stageRoot, manifestFile });
  const bySource = new Map(entries.map((entry) => [entry.sourceKey, entry]));
  const referenced = new Set();
  const errors = [];

  for (const markdownFile of markdownFiles) {
    const sourceText = fs.readFileSync(markdownFile, 'utf8');
    const parsed = parseMd(sourceText);
    const stagedMarkdown = path.join(stageRoot, path.relative(repoRoot, markdownFile));
    const rewrittenLines = [...parsed.lines];

    for (let lineIndex = 0; lineIndex < parsed.lines.length; lineIndex++) {
      if (parsed.inFence[lineIndex]) continue;
      const line = parsed.lines[lineIndex];
      const codeSpans = inlineCodeSpans(line);
      const replacements = [];
      for (const span of linkSpans(line)) {
        if (codeSpans.some((code) => span.start >= code.start && span.end <= code.end)) continue;
        let parsedTarget;
        try {
          parsedTarget = parseLocalTarget(span.target);
        } catch (error) {
          errors.push(`${rel(repoRoot, markdownFile)}:${lineIndex + 1} ${error.message}`);
          continue;
        }
        if (!parsedTarget) continue;

        const extension = path.extname(parsedTarget.decodedPath).toLowerCase();
        if (extension === '.md' || SITE_ASSET_EXTENSIONS.has(extension)) continue;
        const candidate = path.resolve(path.dirname(markdownFile), parsedTarget.decodedPath);
        if (isOutside(repoRoot, candidate) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
        const candidateReal = fs.realpathSync(candidate);
        const entry = bySource.get(path.normalize(candidateReal).toLowerCase());
        if (!entry) {
          errors.push(`${rel(repoRoot, markdownFile)}:${lineIndex + 1} → ${span.target}：本地來源檔未列入站點來源白名單`);
          continue;
        }

        referenced.add(entry.sourceKey);
        const replacementTarget = webRelative(path.dirname(stagedMarkdown), entry.destination, parsedTarget.suffix);
        replacements.push({ start: span.start, end: span.end, value: `[${span.text}](${replacementTarget})` });
      }
      for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
        rewrittenLines[lineIndex] = `${rewrittenLines[lineIndex].slice(0, replacement.start)}${replacement.value}${rewrittenLines[lineIndex].slice(replacement.end)}`;
      }
    }
    fs.writeFileSync(stagedMarkdown, rewrittenLines.join('\n'), 'utf8');
  }

  for (const entry of entries) {
    if (!referenced.has(entry.sourceKey)) errors.push(`${entry.sourceLabel}：白名單來源未被上站 Markdown 引用`);
  }
  if (errors.length) throw new Error(`站點來源檔收集失敗：\n- ${errors.join('\n- ')}`);

  for (const entry of entries) {
    fs.mkdirSync(path.dirname(entry.destination), { recursive: true });
    fs.copyFileSync(entry.source, entry.destination);
  }
  return { copied: entries.length };
}
