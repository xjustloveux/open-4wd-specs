import fs from 'node:fs';
import path from 'node:path';
import { inlineCodeSpans, linkSpans, parseMd, rel } from './lib.mjs';

function isOutside(root, target) {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function key(file) {
  const normalized = path.normalize(file);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function parseLocalMarkdownTarget(rawTarget) {
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
  return path.extname(decodedPath).toLowerCase() === '.md' ? { decodedPath, suffix } : null;
}

function resolveInside(root, relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) throw new Error(`${label}必須是非空字串`);
  if (path.isAbsolute(relativePath) || /^[a-z]:[/\\]/iu.test(relativePath)) {
    throw new Error(`${label}不可使用絕對路徑：${relativePath}`);
  }
  const resolved = path.resolve(root, relativePath);
  if (isOutside(root, resolved)) throw new Error(`${label}越界：${relativePath}`);
  return resolved;
}

function webRelative(fromDirectory, destination, suffix) {
  let target = path.relative(fromDirectory, destination).split(path.sep).join('/');
  target = `${target}${suffix}`;
  return /\s/u.test(target) ? `<${target}>` : target;
}

export function stageMarkdownAliases({ repoRoot, stageRoot, markdownFiles, aliases }) {
  if (!Array.isArray(aliases)) throw new Error('Markdown staging aliases 必須是陣列');
  const rootReal = fs.realpathSync(repoRoot);
  const sourceFiles = new Map(
    markdownFiles.map((file) => {
      const real = fs.realpathSync(file);
      return [key(real), { source: real, staged: path.join(stageRoot, path.relative(repoRoot, file)) }];
    }),
  );
  const aliasBySource = new Map();
  const destinationKeys = new Set();

  for (const [index, alias] of aliases.entries()) {
    if (!alias || typeof alias !== 'object' || Array.isArray(alias)) {
      throw new Error(`Markdown staging alias 第 ${index + 1} 筆必須是物件`);
    }
    const source = resolveInside(repoRoot, alias.source, 'Markdown alias 來源路徑');
    const destination = resolveInside(stageRoot, alias.stagedPath, 'Markdown alias staging 路徑');
    if (!fs.existsSync(source)) throw new Error(`${alias.source}：找不到 Markdown alias 來源`);
    const sourceReal = fs.realpathSync(source);
    if (isOutside(rootReal, sourceReal)) throw new Error(`Markdown alias 來源實體路徑越界：${alias.source}`);
    if (!fs.statSync(sourceReal).isFile() || path.extname(sourceReal).toLowerCase() !== '.md') {
      throw new Error(`${alias.source}：Markdown alias 來源必須是 .md 檔案`);
    }
    const sourceKey = key(sourceReal);
    if (!sourceFiles.has(sourceKey)) throw new Error(`${alias.source}：來源不屬於上站 Markdown`);
    if (aliasBySource.has(sourceKey)) throw new Error(`Markdown alias 來源重複：${alias.source}`);
    const destinationKey = key(destination);
    if (destinationKeys.has(destinationKey)) throw new Error(`Markdown alias staging 路徑重複：${alias.stagedPath}`);
    if (alias.stagedPath.replace(/\\/gu, '/').split('/').some((segment) => segment.startsWith('.'))) {
      throw new Error(`Markdown alias staging 路徑不可包含隱藏目錄：${alias.stagedPath}`);
    }
    destinationKeys.add(destinationKey);
    aliasBySource.set(sourceKey, {
      source: sourceReal,
      originalStaged: sourceFiles.get(sourceKey).staged,
      destination,
    });
  }

  const stagedOwners = new Map();
  for (const [sourceKey, record] of sourceFiles) {
    const staged = aliasBySource.get(sourceKey)?.destination ?? record.staged;
    const stagedKey = key(staged);
    if (stagedOwners.has(stagedKey)) {
      throw new Error(`Markdown staging 路徑碰撞：${rel(stageRoot, staged)}`);
    }
    stagedOwners.set(stagedKey, sourceKey);
    record.staged = staged;
  }

  for (const alias of aliasBySource.values()) {
    if (!fs.existsSync(alias.originalStaged)) throw new Error(`找不到已 staged 的 alias 來源：${rel(stageRoot, alias.originalStaged)}`);
    fs.mkdirSync(path.dirname(alias.destination), { recursive: true });
    fs.copyFileSync(alias.originalStaged, alias.destination);
  }
  for (const alias of aliasBySource.values()) fs.rmSync(alias.originalStaged);

  const errors = [];
  for (const record of sourceFiles.values()) {
    const text = fs.readFileSync(record.staged, 'utf8');
    const parsed = parseMd(text);
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
          parsedTarget = parseLocalMarkdownTarget(span.target);
        } catch (error) {
          errors.push(`${rel(repoRoot, record.source)}:${lineIndex + 1} ${error.message}`);
          continue;
        }
        if (!parsedTarget) continue;
        const candidate = path.resolve(path.dirname(record.source), parsedTarget.decodedPath);
        if (isOutside(repoRoot, candidate) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
        const alias = aliasBySource.get(key(fs.realpathSync(candidate)));
        if (!alias) continue;
        const replacementTarget = webRelative(path.dirname(record.staged), alias.destination, parsedTarget.suffix);
        replacements.push({ start: span.start, end: span.end, value: `[${span.text}](${replacementTarget})` });
      }
      for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
        rewrittenLines[lineIndex] = `${rewrittenLines[lineIndex].slice(0, replacement.start)}${replacement.value}${rewrittenLines[lineIndex].slice(replacement.end)}`;
      }
    }
    fs.writeFileSync(record.staged, rewrittenLines.join('\n'), 'utf8');
  }
  if (errors.length) throw new Error(`Markdown staging alias 失敗：\n- ${errors.join('\n- ')}`);
  return { aliased: aliasBySource.size };
}
